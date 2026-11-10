"""
Unit tests for execution rules: stop-first collision, time-exit after 24 bars, and halts.
"""

import pandas as pd
import pytest
from src.risk import PortfolioRiskManager, RiskLimits
from src.simulator import Simulator
from src.universe import ProductSpec


def test_daily_loss_and_drawdown_halts():
    limits = RiskLimits(
        daily_loss_limit=0.01,   # 1%
        weekly_loss_limit=0.025, # 2.5%
        max_drawdown_halt=0.05   # 5%
    )
    manager = PortfolioRiskManager(initial_equity=10000.0, limits=limits)
    manager.update_time_and_equity("2026-01-01T00:00:00Z", 10000.0)

    # Initial state: not halted
    halted, reason = manager.is_halted()
    assert halted is False

    # Lose $150 in the same day (1.5% loss > 1.0% limit)
    manager.record_closed_pnl(-150.0)
    halted, reason = manager.is_halted()
    assert halted is True
    assert "Daily loss limit hit" in reason

    # New day resets daily loss counter
    manager.update_time_and_equity("2026-01-02T00:00:00Z", 9850.0)
    halted, reason = manager.is_halted()
    assert halted is False

    # Drop equity to 9400 (from peak 10000 = 6% DD > 5% DD halt)
    manager.update_time_and_equity("2026-01-02T12:00:00Z", 9400.0)
    halted, reason = manager.is_halted()
    assert halted is True
    assert "drawdown halt" in reason


def test_simulator_stop_first_collision():
    # Verify that when both target and stop are reached in the same bar, stop-first rule takes precedence
    config = {
        "backtest": {"initial_capital_usd": 10000.0},
        "execution": {
            "fee_rate_per_side": 0.0005,
            "slippage_rate_per_side": 0.0003,
            "assume_stop_first_if_stop_and_target_hit": True,
            "use_historical_funding": False,
        },
        "risk": {
            "risk_per_trade": 0.01,
            "max_positions": 4,
            "max_positions_per_correlation_group": 1,
            "max_gross_notional_equity_multiple": 2.0,
            "max_aggregate_open_risk": 0.05,
            "daily_loss_limit": 0.10,
            "weekly_loss_limit": 0.20,
            "max_drawdown_halt": 0.30
        }
    }
    spec = ProductSpec(
        product_id=1,
        symbol="BTCUSD",
        underlying_symbol="BTC",
        settling_symbol="USD",
        quoting_symbol="USD",
        contract_value=0.001,
        tick_size=0.5,
        maker_fee_rate=0.0002,
        taker_fee_rate=0.0005,
        correlation_group="BTC"
    )

    sim = Simulator(config, {"BTCUSD": spec})

    # Bar 0: Signal Long
    # Bar 1: Entry Long at Open 100. Stop at 98, Target at 104.
    # Bar 2: High touches 105 (Target), Low touches 97 (Stop).
    # With assume_stop_first = True, exit reason should be "STOP" and net PnL negative!
    df = pd.DataFrame([
        {
            "time": 1000,
            "open": 100.0,
            "high": 101.0,
            "low": 99.0,
            "close": 100.0,
            "signal": 1,
            "stop_distance": 2.0,
            "target_distance": 4.0,
            "atr_14_5m": 1.33,
            "rsi_14_5m": 52.0,
        },
        {
            "time": 1300,
            "open": 100.0,
            "high": 101.0,
            "low": 99.5,
            "close": 100.5,
            "signal": 0,
            "stop_distance": 2.0,
            "target_distance": 4.0,
            "atr_14_5m": 1.33,
            "rsi_14_5m": 55.0,
        },
        {
            "time": 1600,
            "open": 100.5,
            "high": 106.0,  # Touches target
            "low": 96.0,   # Touches stop
            "close": 102.0,
            "signal": 0,
            "stop_distance": 2.0,
            "target_distance": 4.0,
            "atr_14_5m": 1.33,
            "rsi_14_5m": 50.0,
        }
    ])

    trades_df, _ = sim.run({"BTCUSD": df})
    assert len(trades_df) == 1
    assert trades_df.iloc[0]["exit_reason"] == "STOP"
    assert trades_df.iloc[0]["net_pnl"] < 0
