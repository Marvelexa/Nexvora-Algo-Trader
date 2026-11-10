"""
Strategy logic implementing 15m trend filter, 5m EMA(20) pullback touch,
RSI(14) 50-cross, and ATR-based dynamic brackets.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional
import numpy as np
import pandas as pd


@dataclass(frozen=True)
class Signal:
    symbol: str
    signal_time: int       # Candle start timestamp where signal was formed
    complete_time: int     # Candle completion timestamp
    side: int              # +1 for Long, -1 for Short
    signal_close: float
    rsi: float
    atr: float
    stop_distance: float
    target_distance: float
    max_hold_bars: int = 24


class IntradayStrategy:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.stop_atr_mult = float(config.get("stop_atr_multiple", 1.5))
        self.target_r_mult = float(config.get("target_r_multiple", 2.0))
        self.max_hold_bars = int(config.get("max_hold_bars", 24))
        self.rsi_long_cross = float(config.get("rsi_long_cross", 50.0))
        self.rsi_short_cross = float(config.get("rsi_short_cross", 50.0))

    def generate_signals(self, df: pd.DataFrame, symbol: str) -> pd.DataFrame:
        """
        Generate Long (+1) and Short (-1) signals on a prepared multi-timeframe DataFrame.
        Returns the DataFrame with additional columns:
        'signal', 'stop_distance', 'target_distance'.
        """
        df = df.copy()

        # Warm-up check: need sufficient history for 200 EMA
        min_bars = 200
        if len(df) < min_bars:
            df["signal"] = 0
            df["stop_distance"] = np.nan
            df["target_distance"] = np.nan
            return df

        # Pullback zone touch: low <= EMA20 * 1.002 and high >= EMA20 * 0.998
        touch_curr = (df["low"] <= df["ema_20_5m"] * 1.002) & (df["high"] >= df["ema_20_5m"] * 0.998)
        touch_prev = touch_curr.shift(1).fillna(False)
        pullback_touch = touch_curr | touch_prev

        # RSI crossing 50
        prev_rsi = df["rsi_14_5m"].shift(1)
        curr_rsi = df["rsi_14_5m"]
        rsi_cross_up = (prev_rsi <= self.rsi_long_cross) & (curr_rsi > self.rsi_long_cross)
        rsi_cross_down = (prev_rsi >= self.rsi_short_cross) & (curr_rsi < self.rsi_short_cross)

        # 15m trend filter
        trend_bull = df["ema_50_15m"] > df["ema_200_15m"]
        trend_bear = df["ema_50_15m"] < df["ema_200_15m"]

        # 5m direction filter
        price_above_ema200 = df["close"] > df["ema_200_5m"]
        price_below_ema200 = df["close"] < df["ema_200_5m"]

        # Long Signal
        long_cond = (
            trend_bull &
            price_above_ema200 &
            rsi_cross_up &
            pullback_touch &
            (df.index >= min_bars) &
            df["atr_14_5m"].notna() &
            (df["atr_14_5m"] > 0)
        )

        # Short Signal
        short_cond = (
            trend_bear &
            price_below_ema200 &
            rsi_cross_down &
            pullback_touch &
            (df.index >= min_bars) &
            df["atr_14_5m"].notna() &
            (df["atr_14_5m"] > 0)
        )

        signals = np.zeros(len(df), dtype=int)
        signals[long_cond.to_numpy()] = 1
        signals[short_cond.to_numpy()] = -1

        df["signal"] = signals
        stop_dist = df["atr_14_5m"] * self.stop_atr_mult
        target_dist = stop_dist * self.target_r_mult

        df["stop_distance"] = stop_dist
        df["target_distance"] = target_dist

        return df
