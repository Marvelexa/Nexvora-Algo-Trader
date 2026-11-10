"""
Data ingestion, caching, and multi-timeframe alignment pipeline.
Aligns 15m trend filter to 5m execution candles without lookahead bias.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict, List, Optional
import pandas as pd

from .delta_client import DeltaClient
from .indicators import calc_atr, calc_ema, calc_rsi

logger = logging.getLogger(__name__)


class DataPipeline:
    def __init__(
        self,
        client: DeltaClient,
        raw_dir: Path = Path("data/raw"),
        processed_dir: Path = Path("data/processed")
    ):
        self.client = client
        self.raw_dir = Path(raw_dir)
        self.processed_dir = Path(processed_dir)
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.processed_dir.mkdir(parents=True, exist_ok=True)

    def get_candles(
        self,
        symbol: str,
        resolution: str,
        start_ts: int,
        end_ts: int,
        force_refresh: bool = False
    ) -> pd.DataFrame:
        """Fetch candles from disk cache or REST API."""
        cache_path = self.raw_dir / f"{symbol}_{resolution}.parquet"

        if not force_refresh and cache_path.exists():
            try:
                df = pd.read_parquet(cache_path)
                # Verify cache covers the window (with 4-hour tolerance for boundary differences)
                if not df.empty and df["time"].min() <= (start_ts + 14400) and df["time"].max() >= (end_ts - 14400):
                    df_sub = df[(df["time"] >= start_ts) & (df["time"] <= end_ts)].copy()
                    if not df_sub.empty:
                        return df_sub.sort_values("time").reset_index(drop=True)
            except Exception as e:
                logger.warning(f"Failed reading cache for {symbol} ({resolution}): {e}")

        # Fetch from API
        logger.info(f"Downloading {symbol} ({resolution}) candles from {start_ts} to {end_ts}...")
        df = self.client.fetch_candles(symbol, resolution, start_ts, end_ts)
        if not df.empty:
            # Save or append to cache
            if cache_path.exists() and not force_refresh:
                try:
                    existing = pd.read_parquet(cache_path)
                    combined = pd.concat([existing, df]).drop_duplicates(subset=["time"]).sort_values("time")
                    combined.to_parquet(cache_path, index=False)
                except Exception:
                    df.to_parquet(cache_path, index=False)
            else:
                df.to_parquet(cache_path, index=False)

        return df

    def get_funding_history(
        self,
        symbol: str,
        start_ts: int,
        end_ts: int,
        force_refresh: bool = False
    ) -> pd.DataFrame:
        """Fetch funding rate history."""
        cache_path = self.raw_dir / f"{symbol}_funding.parquet"

        if not force_refresh and cache_path.exists():
            try:
                df = pd.read_parquet(cache_path)
                if not df.empty and df["time"].min() <= start_ts:
                    return df[(df["time"] >= start_ts) & (df["time"] <= end_ts)].reset_index(drop=True)
            except Exception:
                pass

        logger.info(f"Downloading funding history for {symbol}...")
        df = self.client.fetch_funding_history(symbol, start_ts, end_ts)
        if not df.empty:
            df.to_parquet(cache_path, index=False)
        return df

    def prepare_symbol_data(
        self,
        symbol: str,
        start_ts: int,
        end_ts: int,
        strategy_config: Dict[str, Any],
        use_funding: bool = True
    ) -> pd.DataFrame:
        """
        Build unified multi-timeframe dataset for strategy execution.
        Computes 15m EMA(50) and EMA(200) trend filter,
        5m EMA(20), EMA(200), RSI(14), ATR(14), and merges without lookahead.
        """
        # Fetch 5m candles
        df_5m = self.get_candles(symbol, "5m", start_ts, end_ts)
        if df_5m.empty:
            raise ValueError(f"No 5m candles returned for {symbol}")

        # Fetch 15m candles
        df_15m = self.get_candles(symbol, "15m", start_ts, end_ts)
        if df_15m.empty:
            raise ValueError(f"No 15m candles returned for {symbol}")

        # Compute 15m indicators
        ema_fast_15m = strategy_config.get("ema_fast_15m", 50)
        ema_slow_15m = strategy_config.get("ema_slow_15m", 200)

        df_15m["ema_50_15m"] = calc_ema(df_15m["close"], ema_fast_15m)
        df_15m["ema_200_15m"] = calc_ema(df_15m["close"], ema_slow_15m)

        # 15m candle starting at T completes at T + 900 seconds
        df_15m["complete_time"] = df_15m["time"] + 900

        # Compute 5m indicators
        ema_pullback_5m = strategy_config.get("ema_pullback_5m", 20)
        ema_filter_5m = strategy_config.get("ema_filter_5m", 200)
        rsi_period = strategy_config.get("rsi_period", 14)
        atr_period = strategy_config.get("atr_period", 14)

        df_5m["ema_20_5m"] = calc_ema(df_5m["close"], ema_pullback_5m)
        df_5m["ema_200_5m"] = calc_ema(df_5m["close"], ema_filter_5m)
        df_5m["rsi_14_5m"] = calc_rsi(df_5m["close"], rsi_period)
        df_5m["atr_14_5m"] = calc_atr(df_5m["high"], df_5m["low"], df_5m["close"], atr_period)

        # 5m candle starting at t completes at t + 300 seconds
        df_5m["complete_time"] = df_5m["time"] + 300

        # Merge 15m indicators onto 5m candles using completed time (lookahead-free)
        df_15m_features = df_15m[["complete_time", "ema_50_15m", "ema_200_15m"]].sort_values("complete_time")
        df_merged = pd.merge_asof(
            df_5m.sort_values("complete_time"),
            df_15m_features,
            on="complete_time",
            direction="backward"
        )

        # Fetch and merge funding rates
        if use_funding:
            df_funding = self.get_funding_history(symbol, start_ts, end_ts)
            if not df_funding.empty:
                df_fund_features = df_funding[["time", "funding_rate"]].sort_values("time")
                df_fund_features = df_fund_features.rename(columns={"time": "funding_time"})
                df_merged = pd.merge_asof(
                    df_merged.sort_values("time"),
                    df_fund_features,
                    left_on="time",
                    right_on="funding_time",
                    direction="backward"
                )
                df_merged["funding_rate"] = df_merged["funding_rate"].fillna(0.0)
            else:
                df_merged["funding_rate"] = 0.0
        else:
            df_merged["funding_rate"] = 0.0

        processed_path = self.processed_dir / f"{symbol}_prepared.parquet"
        df_merged.to_parquet(processed_path, index=False)

        return df_merged
