"""
Unit tests for 15m trend filter, 5m EMA(20) pullback touch, RSI cross, and signals.
"""

import numpy as np
import pandas as pd
import pytest

from src.indicators import calc_atr, calc_ema, calc_rsi
from src.strategy import IntradayStrategy


def test_indicator_calculations():
    # 30 bars of known prices
    prices = pd.Series([100.0 + i for i in range(30)])
    ema_10 = calc_ema(prices, 10)
    assert len(ema_10) == 30
    assert ema_10.iloc[-1] > ema_10.iloc[0]

    # RSI
    rsi_14 = calc_rsi(prices, 14)
    assert len(rsi_14) == 30
    assert rsi_14.iloc[-1] == 100.0  # Monotonically increasing prices

    # ATR
    high = prices + 2.0
    low = prices - 2.0
    close = prices
    atr_14 = calc_atr(high, low, close, 14)
    assert len(atr_14) == 30
    assert atr_14.iloc[-1] > 0.0


def test_signal_generation_long():
    config = {
        "ema_fast_15m": 50,
        "ema_slow_15m": 200,
        "ema_pullback_5m": 20,
        "ema_filter_5m": 200,
        "rsi_period": 14,
        "atr_period": 14,
        "rsi_long_cross": 50.0,
        "rsi_short_cross": 50.0,
        "stop_atr_multiple": 1.5,
        "target_r_multiple": 2.0,
        "max_hold_bars": 24,
    }
    strategy = IntradayStrategy(config)

    n = 250
    # Construct synthetic candles where long trigger occurs at bar 220
    df = pd.DataFrame({
        "time": [i * 300 for i in range(n)],
        "open": [100.0] * n,
        "high": [105.0] * n,
        "low": [98.0] * n,
        "close": [102.0] * n,
        "volume": [1000.0] * n,
        "ema_50_15m": [110.0] * n,    # Bullish trend filter (110 > 100)
        "ema_200_15m": [100.0] * n,
        "ema_20_5m": [100.0] * n,
        "ema_200_5m": [90.0] * n,     # 5m close (102) > ema_200 (90)
        "rsi_14_5m": [45.0] * n,      # Base RSI
        "atr_14_5m": [2.0] * n,
    })

    # At bar 220, RSI crosses from 48 to 52, and price touches EMA20 pullback zone (low 99.9 <= 100.2 and high 104 >= 99.8)
    df.loc[219, "rsi_14_5m"] = 48.0
    df.loc[220, "rsi_14_5m"] = 54.0
    df.loc[220, "low"] = 100.1
    df.loc[220, "high"] = 103.0
    df.loc[220, "close"] = 102.5

    result = strategy.generate_signals(df, "BTCUSD")
    assert result.loc[220, "signal"] == 1
    assert result.loc[220, "stop_distance"] == 2.0 * 1.5  # 3.0
    assert result.loc[220, "target_distance"] == 3.0 * 2.0  # 6.0


def test_signal_generation_short():
    config = {
        "stop_atr_multiple": 1.5,
        "target_r_multiple": 2.0,
        "max_hold_bars": 24,
        "rsi_long_cross": 50.0,
        "rsi_short_cross": 50.0,
    }
    strategy = IntradayStrategy(config)

    n = 250
    df = pd.DataFrame({
        "time": [i * 300 for i in range(n)],
        "open": [100.0] * n,
        "high": [102.0] * n,
        "low": [95.0] * n,
        "close": [98.0] * n,
        "volume": [1000.0] * n,
        "ema_50_15m": [90.0] * n,     # Bearish trend (90 < 100)
        "ema_200_15m": [100.0] * n,
        "ema_20_5m": [100.0] * n,
        "ema_200_5m": [110.0] * n,    # 5m close (98) < ema_200 (110)
        "rsi_14_5m": [55.0] * n,
        "atr_14_5m": [2.0] * n,
    })

    # At bar 220, RSI crosses down from 53 to 47
    df.loc[219, "rsi_14_5m"] = 53.0
    df.loc[220, "rsi_14_5m"] = 47.0
    df.loc[220, "low"] = 99.0
    df.loc[220, "high"] = 100.1
    df.loc[220, "close"] = 97.0

    result = strategy.generate_signals(df, "BTCUSD")
    assert result.loc[220, "signal"] == -1
