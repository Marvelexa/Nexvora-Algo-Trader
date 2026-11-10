"""
Paper trading execution layer for Delta Exchange India.
Uses identical signal, sizing, and risk modules as the backtester.
Persists simulated positions, order states, daily loss counters, and drawdown.
NEVER sends live orders.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
import pandas as pd

from .data_pipeline import DataPipeline
from .delta_client import DeltaClient
from .risk import PortfolioRiskManager, RiskLimits, adverse_fill, calculate_position_size
from .strategy import IntradayStrategy
from .universe import ProductSpec

logger = logging.getLogger(__name__)


class PaperTrader:
    def __init__(
        self,
        config: Dict[str, Any],
        client: DeltaClient,
        pipeline: DataPipeline,
        specs: Dict[str, ProductSpec],
        state_file: Path = Path("data/paper_trading_state.json")
    ):
        self.config = config
        self.client = client
        self.pipeline = pipeline
        self.specs = specs
        self.state_file = Path(state_file)
        self.state_file.parent.mkdir(parents=True, exist_ok=True)

        # Safety assertion: Live trading strictly disallowed
        allow_live = config.get("backtest", {}).get("allow_live_orders", False)
        if allow_live:
            raise RuntimeError("CRITICAL: allow_live_orders is set to True. Live trading is strictly blocked!")

        self.strategy = IntradayStrategy(config.get("strategy", {}))

        backtest_cfg = config.get("backtest", {})
        risk_cfg = config.get("risk", {})
        exec_cfg = config.get("execution", {})

        self.slippage_rate = float(exec_cfg.get("slippage_rate_per_side", 0.0003))
        self.default_fee_rate = float(exec_cfg.get("fee_rate_per_side", 0.0005))
        self.initial_equity = float(backtest_cfg.get("initial_capital_usd", 1136.36))

        limits = RiskLimits(
            risk_per_trade=float(risk_cfg.get("risk_per_trade", 0.0025)),
            max_aggregate_open_risk=float(risk_cfg.get("max_aggregate_open_risk", 0.01)),
            daily_loss_limit=float(risk_cfg.get("daily_loss_limit", 0.01)),
            weekly_loss_limit=float(risk_cfg.get("weekly_loss_limit", 0.025)),
            max_drawdown_halt=float(risk_cfg.get("max_drawdown_halt", 0.05)),
            max_gross_equity_multiple=float(risk_cfg.get("max_gross_notional_equity_multiple", 1.0)),
            max_positions=int(risk_cfg.get("max_positions", 4)),
            max_positions_per_correlation_group=int(risk_cfg.get("max_positions_per_correlation_group", 1)),
        )
        self.risk_manager = PortfolioRiskManager(self.initial_equity, limits)
        self.equity = self.initial_equity
        self.load_state()

    def load_state(self):
        """Restore state from disk across restarts."""
        if self.state_file.exists():
            try:
                with open(self.state_file, "r") as f:
                    data = json.load(f)
                    self.equity = data.get("equity", self.initial_equity)
                    self.risk_manager.equity = self.equity
                    self.risk_manager.peak_equity = data.get("peak_equity", self.equity)
                    self.risk_manager.day_start_equity = data.get("day_start_equity", self.equity)
                    self.risk_manager.day_closed_pnl = data.get("day_closed_pnl", 0.0)
                    self.risk_manager.open_positions = data.get("open_positions", {})
                    logger.info("Paper trading state restored successfully.")
            except Exception as e:
                logger.warning(f"Could not load state file: {e}")

    def save_state(self):
        """Persist current paper trading state to durable storage."""
        data = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "equity": self.equity,
            "peak_equity": self.risk_manager.peak_equity,
            "day_start_equity": self.risk_manager.day_start_equity,
            "day_closed_pnl": self.risk_manager.day_closed_pnl,
            "open_positions": self.risk_manager.open_positions,
        }
        with open(self.state_file, "w") as f:
            json.dump(data, f, indent=2)

    def step(self, symbols: List[str]):
        """
        Run one paper trading evaluation step for the universe symbols:
        1. Fetch latest candles.
        2. Evaluate open positions for stop / target / time exits.
        3. Evaluate new signals and execute paper entries.
        4. Save durable state.
        """
        now = int(datetime.now(timezone.utc).timestamp())
        start_ts = now - (3600 * 24 * 3)  # Fetch last 3 days to warm up indicators

        # Update clock
        self.risk_manager.update_time_and_equity(datetime.now(timezone.utc).isoformat(), self.equity)

        # 1. Update open positions
        closed = []
        for sym, pos in list(self.risk_manager.open_positions.items()):
            df_5m = self.pipeline.get_candles(sym, "5m", start_ts, now, force_refresh=True)
            if df_5m.empty:
                continue

            last_bar = df_5m.iloc[-1]
            pos["bars_held"] = pos.get("bars_held", 0) + 1
            high = float(last_bar["high"])
            low = float(last_bar["low"])
            close = float(last_bar["close"])
            side = pos["side_dir"]

            exit_price = None
            exit_reason = None

            if side == 1:
                if low <= pos["stop_price"]:
                    exit_price = adverse_fill(pos["stop_price"], -1, self.slippage_rate)
                    exit_reason = "STOP"
                elif high >= pos["target_price"]:
                    exit_price = adverse_fill(pos["target_price"], -1, self.slippage_rate)
                    exit_reason = "TARGET"
                elif pos["bars_held"] >= pos["max_hold_bars"]:
                    exit_price = adverse_fill(close, -1, self.slippage_rate)
                    exit_reason = "TIME_EXPIRE"
            else:
                if high >= pos["stop_price"]:
                    exit_price = adverse_fill(pos["stop_price"], +1, self.slippage_rate)
                    exit_reason = "STOP"
                elif low <= pos["target_price"]:
                    exit_price = adverse_fill(pos["target_price"], +1, self.slippage_rate)
                    exit_reason = "TARGET"
                elif pos["bars_held"] >= pos["max_hold_bars"]:
                    exit_price = adverse_fill(close, +1, self.slippage_rate)
                    exit_reason = "TIME_EXPIRE"

            if exit_price and exit_reason:
                # Close trade
                spec = self.specs.get(sym)
                mult = spec.contract_value if spec else 1.0
                qty = pos["quantity"]
                pnl = side * (exit_price - pos["entry_fill"]) * qty * mult
                self.equity += pnl
                self.risk_manager.record_closed_pnl(pnl)
                closed.append(sym)
                logger.info(f"[PAPER EXIT] {sym} {exit_reason} at {exit_price:.4f}, Net PnL: ${pnl:.2f}")

        for sym in closed:
            del self.risk_manager.open_positions[sym]

        # 2. Check for new signals
        for sym in symbols:
            if sym in self.risk_manager.open_positions:
                continue

            try:
                df = self.pipeline.prepare_symbol_data(sym, start_ts, now, self.config.get("strategy", {}), use_funding=False)
                df = self.strategy.generate_signals(df, sym)
                if df.empty:
                    continue

                last_completed = df.iloc[-2]  # Bar that just completed
                sig = int(last_completed.get("signal", 0) or 0)
                if sig != 0:
                    spec = self.specs.get(sym)
                    multiplier = spec.contract_value if spec else 1.0
                    corr = spec.correlation_group if spec else sym
                    current_bar = df.iloc[-1]
                    open_price = float(current_bar["open"])

                    entry_fill = adverse_fill(open_price, sig, self.slippage_rate)
                    stop_dist = float(last_completed["stop_distance"])
                    target_dist = float(last_completed["target_distance"])

                    stop_p = entry_fill - stop_dist if sig == 1 else entry_fill + stop_dist
                    target_p = entry_fill + target_dist if sig == 1 else entry_fill - target_dist

                    qty = calculate_position_size(
                        equity=self.equity,
                        risk_fraction=self.risk_manager.limits.risk_per_trade,
                        entry=entry_fill,
                        stop=stop_p,
                        contract_multiplier=multiplier,
                        fee_rate=self.default_fee_rate,
                        slippage_rate=self.slippage_rate,
                        max_gross_equity_multiple=self.risk_manager.limits.max_gross_equity_multiple,
                        min_contracts=1
                    )

                    if qty > 0:
                        risk_amt = abs(entry_fill - stop_p) * qty * multiplier
                        can_open, reason = self.risk_manager.can_open_trade(sym, corr, risk_amt)
                        if can_open:
                            self.risk_manager.open_positions[sym] = {
                                "symbol": sym,
                                "side_dir": sig,
                                "entry_fill": entry_fill,
                                "stop_price": stop_p,
                                "target_price": target_p,
                                "quantity": qty,
                                "bars_held": 0,
                                "max_hold_bars": 24,
                                "correlation_group": corr,
                                "risk_amount": risk_amt,
                                "entry_time": datetime.now(timezone.utc).isoformat()
                            }
                            logger.info(f"[PAPER ENTRY] {sym} {'LONG' if sig==1 else 'SHORT'} {qty} contracts at {entry_fill:.4f}")
            except Exception as e:
                logger.error(f"Error checking {sym} for paper signals: {e}")

        self.save_state()
