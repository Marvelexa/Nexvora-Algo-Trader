"""
Portfolio and Execution Simulator for Delta Exchange India perpetual contracts.
Enforces realistic fill execution at next bar open, adverse slippage, exchange fees,
8-hour funding cashflows, stop-first intraday collision, and portfolio risk limits.
"""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional
import numpy as np
import pandas as pd

from .risk import PortfolioRiskManager, RiskLimits, adverse_fill, calculate_position_size
from .universe import ProductSpec

logger = logging.getLogger(__name__)


@dataclass
class TradeRecord:
    trade_id: str
    product_id: int
    symbol: str
    signal_time: str
    entry_time: str
    exit_time: str
    side: str              # "LONG" or "SHORT"
    entry_price: float
    exit_price: float
    stop_price: float
    target_price: float
    atr: float
    rsi: float
    quantity: int          # Contracts
    contract_multiplier: float
    notional: float        # USD
    gross_pnl: float       # USD
    entry_fee: float       # USD
    exit_fee: float        # USD
    entry_slippage: float  # USD
    exit_slippage: float   # USD
    funding_pnl: float     # USD
    net_pnl: float         # USD
    equity_after: float    # USD
    drawdown: float        # Fraction
    exit_reason: str       # "TARGET", "STOP", "TIME_EXPIRE"
    strategy_version: str = "v1.0-5m15m"


class Simulator:
    def __init__(
        self,
        config: Dict[str, Any],
        product_specs: Dict[str, ProductSpec]
    ):
        self.config = config
        self.specs = product_specs

        backtest_cfg = config.get("backtest", {})
        exec_cfg = config.get("execution", {})
        risk_cfg = config.get("risk", {})

        self.initial_equity = float(backtest_cfg.get("initial_capital_usd", 1136.36))
        self.equity = self.initial_equity
        self.peak_equity = self.initial_equity

        self.default_fee_rate = float(exec_cfg.get("fee_rate_per_side", 0.0005))
        self.slippage_rate = float(exec_cfg.get("slippage_rate_per_side", 0.0003))
        self.use_actual_fee = bool(exec_cfg.get("use_actual_product_fee_when_available", True))
        self.use_funding = bool(exec_cfg.get("use_historical_funding", True))
        self.assume_stop_first = bool(exec_cfg.get("assume_stop_first_if_stop_and_target_hit", True))

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

        self.trades: List[TradeRecord] = []
        self.daily_equity_curve: List[Dict[str, Any]] = []

    def get_fee_rate(self, symbol: str) -> float:
        if self.use_actual_fee and symbol in self.specs:
            return self.specs[symbol].taker_fee_rate
        return self.default_fee_rate

    def run(self, symbol_dfs: Dict[str, pd.DataFrame]) -> tuple[pd.DataFrame, pd.DataFrame]:
        """
        Execute multi-instrument synchronized bar-by-bar backtest.
        """
        # Index each symbol's DataFrame by candle start timestamp
        bar_maps: Dict[str, Dict[int, Dict[str, Any]]] = {}
        all_timestamps = set()

        for sym, df in symbol_dfs.items():
            records = df.to_dict(orient="records")
            bmap = {r["time"]: r for r in records}
            bar_maps[sym] = bmap
            all_timestamps.update(bmap.keys())

        sorted_timestamps = sorted(list(all_timestamps))
        logger.info(f"Running simulation over {len(sorted_timestamps)} 5m timestamps across {len(symbol_dfs)} instruments...")

        # Pending orders triggered at previous close, to enter at current open
        pending_orders: List[Dict[str, Any]] = []
        # Active positions: symbol -> position dict
        active_positions: Dict[str, Dict[str, Any]] = {}
        trade_counter = 0

        last_recorded_day = ""

        for ts in sorted_timestamps:
            # 1. Update risk manager clock & equity
            dt_iso = pd.to_datetime(ts, unit="s", utc=True).isoformat()
            day_str = dt_iso[:10]

            # 2. Check funding settlements on active positions (Delta 8h schedule: 00:00, 08:00, 16:00 UTC)
            if self.use_funding and (ts % 28800 == 0):
                for sym, pos in active_positions.items():
                    bar = bar_maps[sym].get(ts)
                    if bar:
                        f_rate = float(bar.get("funding_rate", 0.0) or 0.0)
                        if f_rate != 0.0:
                            # Cashflow = -side * V * f
                            multiplier = pos["contract_multiplier"]
                            notional = pos["quantity"] * multiplier * bar["close"]
                            cashflow = -pos["side_dir"] * notional * f_rate
                            pos["cumulative_funding"] += cashflow
                            self.equity += cashflow

            # 3. Update / Evaluate active positions on current candle
            symbols_to_close = []
            for sym, pos in list(active_positions.items()):
                bar = bar_maps[sym].get(ts)
                if not bar:
                    continue

                pos["bars_held"] += 1
                high = bar["high"]
                low = bar["low"]
                close = bar["close"]
                open_p = bar["open"]
                side = pos["side_dir"]  # +1 Long, -1 Short
                multiplier = pos["contract_multiplier"]
                qty = pos["quantity"]

                stop_hit = False
                target_hit = False
                exit_price = 0.0
                exit_reason = ""
                raw_exit_level = 0.0

                if side == 1:  # LONG
                    if low <= pos["stop_price"]:
                        stop_hit = True
                    if high >= pos["target_price"]:
                        target_hit = True

                    if stop_hit and target_hit:
                        # Collision rule
                        if self.assume_stop_first:
                            raw_exit_level = pos["stop_price"]
                            exit_price = adverse_fill(pos["stop_price"], -1, self.slippage_rate)
                            exit_reason = "STOP"
                        else:
                            raw_exit_level = pos["target_price"]
                            exit_price = adverse_fill(pos["target_price"], -1, self.slippage_rate)
                            exit_reason = "TARGET"
                    elif stop_hit:
                        raw_exit_level = pos["stop_price"]
                        exit_price = adverse_fill(pos["stop_price"], -1, self.slippage_rate)
                        exit_reason = "STOP"
                    elif target_hit:
                        raw_exit_level = pos["target_price"]
                        exit_price = adverse_fill(pos["target_price"], -1, self.slippage_rate)
                        exit_reason = "TARGET"
                    elif pos["bars_held"] >= pos["max_hold_bars"]:
                        raw_exit_level = close
                        exit_price = adverse_fill(close, -1, self.slippage_rate)
                        exit_reason = "TIME_EXPIRE"

                else:  # SHORT
                    if high >= pos["stop_price"]:
                        stop_hit = True
                    if low <= pos["target_price"]:
                        target_hit = True

                    if stop_hit and target_hit:
                        if self.assume_stop_first:
                            raw_exit_level = pos["stop_price"]
                            exit_price = adverse_fill(pos["stop_price"], +1, self.slippage_rate)
                            exit_reason = "STOP"
                        else:
                            raw_exit_level = pos["target_price"]
                            exit_price = adverse_fill(pos["target_price"], +1, self.slippage_rate)
                            exit_reason = "TARGET"
                    elif stop_hit:
                        raw_exit_level = pos["stop_price"]
                        exit_price = adverse_fill(pos["stop_price"], +1, self.slippage_rate)
                        exit_reason = "STOP"
                    elif target_hit:
                        raw_exit_level = pos["target_price"]
                        exit_price = adverse_fill(pos["target_price"], +1, self.slippage_rate)
                        exit_reason = "TARGET"
                    elif pos["bars_held"] >= pos["max_hold_bars"]:
                        raw_exit_level = close
                        exit_price = adverse_fill(close, +1, self.slippage_rate)
                        exit_reason = "TIME_EXPIRE"

                if exit_reason:
                    # Finalize trade
                    trade_counter += 1
                    fee_rate = self.get_fee_rate(sym)
                    entry_notional = pos["entry_fill"] * qty * multiplier
                    exit_notional = exit_price * qty * multiplier
                    entry_fee = entry_notional * fee_rate
                    exit_fee = exit_notional * fee_rate

                    gross_pnl = side * (exit_price - pos["entry_fill"]) * qty * multiplier
                    entry_slippage_cost = abs(pos["entry_fill"] - pos["raw_entry_level"]) * qty * multiplier
                    exit_slippage_cost = abs(exit_price - raw_exit_level) * qty * multiplier
                    funding_pnl = pos["cumulative_funding"]
                    net_pnl = gross_pnl - entry_fee - exit_fee + funding_pnl

                    self.equity += net_pnl
                    if self.equity > self.peak_equity:
                        self.peak_equity = self.equity
                    current_dd = (self.peak_equity - self.equity) / self.peak_equity if self.peak_equity > 0 else 0.0

                    self.risk_manager.record_closed_pnl(net_pnl)

                    trade_rec = TradeRecord(
                        trade_id=f"TRD_{trade_counter:05d}",
                        product_id=pos["product_id"],
                        symbol=sym,
                        signal_time=pos["signal_time"],
                        entry_time=pos["entry_time"],
                        exit_time=dt_iso,
                        side="LONG" if side == 1 else "SHORT",
                        entry_price=round(pos["entry_fill"], 6),
                        exit_price=round(exit_price, 6),
                        stop_price=round(pos["stop_price"], 6),
                        target_price=round(pos["target_price"], 6),
                        atr=round(pos["atr"], 6),
                        rsi=round(pos["rsi"], 2),
                        quantity=qty,
                        contract_multiplier=multiplier,
                        notional=round(entry_notional, 2),
                        gross_pnl=round(gross_pnl, 4),
                        entry_fee=round(entry_fee, 4),
                        exit_fee=round(exit_fee, 4),
                        entry_slippage=round(entry_slippage_cost, 4),
                        exit_slippage=round(exit_slippage_cost, 4),
                        funding_pnl=round(funding_pnl, 4),
                        net_pnl=round(net_pnl, 4),
                        equity_after=round(self.equity, 2),
                        drawdown=round(current_dd, 6),
                        exit_reason=exit_reason,
                        strategy_version="v1.0-5m15m"
                    )
                    self.trades.append(trade_rec)
                    symbols_to_close.append(sym)

            for sym in symbols_to_close:
                del active_positions[sym]
                if sym in self.risk_manager.open_positions:
                    del self.risk_manager.open_positions[sym]

            # 4. Process pending orders at current candle Open
            for order in pending_orders:
                sym = order["symbol"]
                bar = bar_maps[sym].get(ts)
                if not bar or sym in active_positions:
                    continue

                open_price = bar["open"]
                side = order["side"]
                spec = self.specs.get(sym)
                multiplier = spec.contract_value if spec else 1.0
                corr_group = spec.correlation_group if spec else sym
                product_id = spec.product_id if spec else 0
                fee_rate = self.get_fee_rate(sym)

                raw_entry_level = open_price
                entry_fill = adverse_fill(raw_entry_level, side, self.slippage_rate)

                stop_dist = order["stop_distance"]
                target_dist = order["target_distance"]
                if side == 1:
                    stop_price = entry_fill - stop_dist
                    target_price = entry_fill + target_dist
                else:
                    stop_price = entry_fill + stop_dist
                    target_price = entry_fill - target_dist

                # Calculate position size in integer contracts
                qty = calculate_position_size(
                    equity=self.equity,
                    risk_fraction=self.risk_manager.limits.risk_per_trade,
                    entry=entry_fill,
                    stop=stop_price,
                    contract_multiplier=multiplier,
                    fee_rate=fee_rate,
                    slippage_rate=self.slippage_rate,
                    max_gross_equity_multiple=self.risk_manager.limits.max_gross_equity_multiple,
                    min_contracts=1
                )

                if qty <= 0:
                    continue

                planned_risk = abs(entry_fill - stop_price) * qty * multiplier
                can_open, reason = self.risk_manager.can_open_trade(sym, corr_group, planned_risk)
                if not can_open:
                    continue

                # Open the position
                pos_entry = {
                    "symbol": sym,
                    "product_id": product_id,
                    "correlation_group": corr_group,
                    "side_dir": side,
                    "raw_entry_level": raw_entry_level,
                    "entry_fill": entry_fill,
                    "stop_price": stop_price,
                    "target_price": target_price,
                    "quantity": qty,
                    "contract_multiplier": multiplier,
                    "bars_held": 0,
                    "max_hold_bars": order.get("max_hold_bars", 24),
                    "signal_time": order["signal_time"],
                    "entry_time": dt_iso,
                    "atr": order["atr"],
                    "rsi": order["rsi"],
                    "cumulative_funding": 0.0,
                    "risk_amount": planned_risk
                }
                active_positions[sym] = pos_entry
                self.risk_manager.open_positions[sym] = pos_entry

            pending_orders = []

            # 5. Check for new signals generated on candle close of bar ts
            for sym, bmap in bar_maps.items():
                bar = bmap.get(ts)
                if not bar:
                    continue

                sig = int(bar.get("signal", 0) or 0)
                if sig != 0 and sym not in active_positions:
                    pending_orders.append({
                        "symbol": sym,
                        "side": sig,
                        "signal_time": dt_iso,
                        "stop_distance": float(bar["stop_distance"]),
                        "target_distance": float(bar["target_distance"]),
                        "atr": float(bar["atr_14_5m"]),
                        "rsi": float(bar["rsi_14_5m"]),
                        "max_hold_bars": 24
                    })

            # Record daily equity point
            if day_str != last_recorded_day:
                last_recorded_day = day_str
                self.risk_manager.update_time_and_equity(dt_iso, self.equity)
                dd = (self.peak_equity - self.equity) / self.peak_equity if self.peak_equity > 0 else 0.0
                self.daily_equity_curve.append({
                    "date": day_str,
                    "equity": round(self.equity, 2),
                    "peak_equity": round(self.peak_equity, 2),
                    "drawdown": round(dd, 6),
                    "open_positions": len(active_positions)
                })

        trades_df = pd.DataFrame([asdict(t) for t in self.trades])
        equity_df = pd.DataFrame(self.daily_equity_curve)

        return trades_df, equity_df
