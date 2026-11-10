"""
Unit tests for position sizing, Delta contract multipliers, and risk constraints.
"""

import pytest
from src.risk import calculate_position_size, PortfolioRiskManager, RiskLimits


def test_calculate_position_size_linear():
    equity = 10000.0  # USD
    risk_fraction = 0.0025  # 0.25% = $25 risk budget
    entry = 80000.0
    stop = 79500.0  # $500 stop distance
    multiplier = 0.001  # Delta BTCUSD contract value = 0.001 BTC
    fee_rate = 0.0005
    slippage_rate = 0.0003

    # Price risk per contract = 500 * 0.001 = $0.50
    # Cost risk per contract = (80000 + 79500) * 0.0008 * 0.001 = 159.5 * 0.0008 = $0.1276
    # Total risk per contract ~= $0.6276
    # Contracts = floor(25 / 0.6276) = 39 contracts
    qty = calculate_position_size(
        equity=equity,
        risk_fraction=risk_fraction,
        entry=entry,
        stop=stop,
        contract_multiplier=multiplier,
        fee_rate=fee_rate,
        slippage_rate=slippage_rate,
        max_gross_equity_multiple=1.0,
        min_contracts=1
    )
    assert qty == 39


def test_gross_notional_cap():
    # If equity is small ($50) and contract notional is $80 (1 BTC contract = 0.001 * 80000 = $80)
    # Then max notional (1.0x = $50) < $80 -> size must be 0 (rejected)
    qty = calculate_position_size(
        equity=50.0,
        risk_fraction=0.01,
        entry=80000.0,
        stop=79000.0,
        contract_multiplier=0.001,
        fee_rate=0.0005,
        slippage_rate=0.0003,
        max_gross_equity_multiple=1.0
    )
    assert qty == 0


def test_correlation_and_position_limits():
    limits = RiskLimits(
        max_positions=2,
        max_positions_per_correlation_group=1,
        max_aggregate_open_risk=0.01
    )
    manager = PortfolioRiskManager(initial_equity=10000.0, limits=limits)

    # 1st trade: BTC (correlation group BTC)
    can_open, _ = manager.can_open_trade("BTCUSD", "BTC", planned_risk_amount=25.0)
    assert can_open is True

    manager.open_positions["BTCUSD"] = {
        "symbol": "BTCUSD",
        "correlation_group": "BTC",
        "risk_amount": 25.0
    }

    # 2nd trade in same correlation group BTC -> should be rejected
    can_open, reason = manager.can_open_trade("BTCUSD_ALT", "BTC", planned_risk_amount=25.0)
    assert can_open is False
    assert "correlation group" in reason

    # 2nd trade in different group ETH -> should be allowed
    can_open, _ = manager.can_open_trade("ETHUSD", "ETH", planned_risk_amount=25.0)
    assert can_open is True

    manager.open_positions["ETHUSD"] = {
        "symbol": "ETHUSD",
        "correlation_group": "ETH",
        "risk_amount": 25.0
    }

    # 3rd trade -> should be rejected because max_positions is 2
    can_open, reason = manager.can_open_trade("SOLUSD", "SOL", planned_risk_amount=25.0)
    assert can_open is False
    assert "Max open positions" in reason
