"""
Technical indicators implementation: EMA, Wilder's RSI, and Wilder's ATR.
Calculated strictly on completed bars with consistent warm-up logic.
"""

from __future__ import annotations
import numpy as np
import pandas as pd


def calc_ema(series: pd.Series, period: int) -> pd.Series:
    """
    Calculate Exponential Moving Average (EMA).
    Uses standard span formulation: alpha = 2 / (span + 1).
    """
    if len(series) == 0:
        return pd.Series(dtype=float)
    return series.ewm(span=period, adjust=False).mean()


def calc_rsi(series: pd.Series, period: int = 14) -> pd.Series:
    """
    Calculate Wilder-style Relative Strength Index (RSI).
    Uses exponential smoothing with alpha = 1 / period.
    """
    if len(series) < period:
        return pd.Series(index=series.index, data=np.nan, dtype=float)

    delta = series.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)

    # Wilder smoothing corresponds to alpha = 1 / period
    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0.0, np.nan)
    rsi = 100.0 - (100.0 / (1.0 + rs))

    # Handle edge cases: when loss is 0, RSI is 100
    rsi = rsi.where(~((avg_loss == 0) & (avg_gain > 0)), 100.0)
    # When both gain and loss are 0, RSI is 50
    rsi = rsi.where(~((avg_loss == 0) & (avg_gain == 0)), 50.0)

    return rsi


def calc_atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    """
    Calculate Wilder-style Average True Range (ATR).
    TR = max(H - L, |H - C_prev|, |L - C_prev|)
    ATR = Wilder_EMA(TR, period)
    """
    if len(close) < period:
        return pd.Series(index=close.index, data=np.nan, dtype=float)

    prev_close = close.shift(1)
    tr1 = high - low
    tr2 = (high - prev_close).abs()
    tr3 = (low - prev_close).abs()

    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = tr.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    return atr
