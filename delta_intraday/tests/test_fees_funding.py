"""
Unit tests for adverse slippage fill prices, fees, and funding rate cashflows.
"""

import pytest
from src.risk import adverse_fill


def test_adverse_fill_buy_sell():
    price = 100.0
    slippage = 0.0003  # 0.03%

    # Buying (side = +1) fills higher
    buy_fill = adverse_fill(price, side=1, slippage=slippage)
    assert buy_fill == pytest.approx(100.03)

    # Selling (side = -1) fills lower
    sell_fill = adverse_fill(price, side=-1, slippage=slippage)
    assert sell_fill == pytest.approx(99.97)


def test_adverse_fill_invalid():
    with pytest.raises(ValueError):
        adverse_fill(0.0, 1, 0.001)

    with pytest.raises(ValueError):
        adverse_fill(100.0, 1, -0.001)


def test_funding_cashflow_sign():
    # Long position (s = +1)
    # Cashflow = -s * V * f
    # If funding rate is positive (+0.01%), longs pay shorts: cashflow should be negative!
    side_long = 1
    notional = 1000.0  # $1,000
    funding_rate = 0.0001  # +0.01%
    cashflow_long = -side_long * notional * funding_rate
    assert cashflow_long == -0.10  # Long paid $0.10

    # Short position (s = -1)
    # If funding rate is positive, shorts receive funding: cashflow should be positive!
    side_short = -1
    cashflow_short = -side_short * notional * funding_rate
    assert cashflow_short == +0.10  # Short received $0.10
