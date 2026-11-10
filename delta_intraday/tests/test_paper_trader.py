"""
Unit test for PaperTrader state persistence and execution flow.
"""

import json
from pathlib import Path
import pytest
from src.paper_trader import PaperTrader
from src.universe import ProductSpec


def test_paper_trader_safety_and_persistence(tmp_path):
    state_file = tmp_path / "paper_state.json"
    config = {
        "backtest": {
            "initial_capital_usd": 1000.0,
            "allow_live_orders": False,
        },
        "strategy": {
            "stop_atr_multiple": 1.5,
            "target_r_multiple": 2.0,
            "max_hold_bars": 24,
        },
        "risk": {
            "risk_per_trade": 0.0025,
            "max_positions": 2,
            "max_positions_per_correlation_group": 1,
        },
        "execution": {
            "fee_rate_per_side": 0.0005,
            "slippage_rate_per_side": 0.0003,
        }
    }

    # Safety check: allow_live_orders = True must raise RuntimeError
    bad_config = dict(config)
    bad_config["backtest"] = {"allow_live_orders": True}
    with pytest.raises(RuntimeError):
        PaperTrader(bad_config, None, None, {}, state_file=state_file)

    # Valid config
    trader = PaperTrader(config, None, None, {}, state_file=state_file)
    assert trader.equity == 1000.0

    # Simulate opening a position and saving state
    trader.equity = 1050.0
    trader.risk_manager.open_positions["BTCUSD"] = {
        "symbol": "BTCUSD",
        "side_dir": 1,
        "entry_fill": 80000.0,
        "stop_price": 79000.0,
        "target_price": 82000.0,
        "quantity": 10,
        "bars_held": 2,
        "max_hold_bars": 24
    }
    trader.save_state()

    assert state_file.exists()

    # Re-initialize another PaperTrader instance from the saved state file
    restored_trader = PaperTrader(config, None, None, {}, state_file=state_file)
    assert restored_trader.equity == 1050.0
    assert "BTCUSD" in restored_trader.risk_manager.open_positions
    assert restored_trader.risk_manager.open_positions["BTCUSD"]["quantity"] == 10
