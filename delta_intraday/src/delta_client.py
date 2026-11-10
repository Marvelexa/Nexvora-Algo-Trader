"""
Delta Exchange India REST API Market Data Adapter.
Handles cursor-paginated products, tickers, and chunked historical candle fetching.
"""

from __future__ import annotations

import logging
import time
from typing import Any, Dict, List, Optional
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import pandas as pd

logger = logging.getLogger(__name__)

RESOLUTION_SECONDS: Dict[str, int] = {
    "1m": 60,
    "3m": 180,
    "5m": 300,
    "15m": 900,
    "30m": 1800,
    "1h": 3600,
    "2h": 7200,
    "4h": 14400,
    "6h": 21600,
    "1d": 86400,
}


class DeltaClient:
    """REST Client for Delta Exchange India with retry and pagination."""

    def __init__(self, base_url: str = "https://api.india.delta.exchange", timeout: int = 25):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            "Accept": "application/json",
            "User-Agent": "DeltaBacktester/1.0"
        })

        retries = Retry(
            total=5,
            backoff_factor=1.0,
            status_forcelist=[429, 500, 502, 503, 504],
            raise_on_status=False
        )
        adapter = HTTPAdapter(max_retries=retries)
        self.session.mount("https://", adapter)
        self.session.mount("http://", adapter)

    def _get_json(self, path: str, params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self.base_url}{path}"
        max_attempts = 5
        for attempt in range(max_attempts):
            try:
                response = self.session.get(url, params=params, timeout=self.timeout)
                if response.status_code == 429:
                    sleep_time = 2.0 * (attempt + 1)
                    logger.warning(f"Delta API rate limit (429) on {path}. Sleeping {sleep_time}s (attempt {attempt+1}/{max_attempts})...")
                    time.sleep(sleep_time)
                    continue
                response.raise_for_status()
                data = response.json()
                if not data.get("success", False):
                    raise RuntimeError(f"Delta API error on {path}: {data.get('error', data)}")
                return data
            except requests.exceptions.HTTPError as e:
                if attempt == max_attempts - 1:
                    raise
                if response.status_code == 429:
                    time.sleep(2.0 * (attempt + 1))
                else:
                    time.sleep(1.0)
            except Exception as e:
                if attempt == max_attempts - 1:
                    raise
                time.sleep(1.0)

        raise RuntimeError(f"Failed to fetch {path} after {max_attempts} attempts")

    def get_products(self, contract_types: str = "perpetual_futures") -> List[Dict[str, Any]]:
        """
        Fetch all products matching contract_types using cursor-based pagination.
        Follows 'meta.after' cursor until all pages are retrieved.
        """
        all_products: List[Dict[str, Any]] = []
        after: Optional[str] = None

        while True:
            params: Dict[str, Any] = {"page_size": 100}
            if contract_types:
                params["contract_types"] = contract_types
            if after:
                params["after"] = after

            data = self._get_json("/v2/products", params=params)
            items = data.get("result", [])
            all_products.extend(items)

            meta = data.get("meta", {})
            after = meta.get("after")
            if not after or not items:
                break

        return all_products

    def get_tickers(self) -> List[Dict[str, Any]]:
        """Fetch current tickers with 24h volume, bid, ask, and turnover."""
        data = self._get_json("/v2/tickers")
        return data.get("result", [])

    def fetch_candles_raw(
        self,
        symbol: str,
        resolution: str,
        start_ts: int,
        end_ts: int
    ) -> List[Dict[str, Any]]:
        """
        Fetch single-window historical candles.
        Delta API limits to 2000 candles per response.
        """
        params = {
            "symbol": symbol,
            "resolution": resolution,
            "start": int(start_ts),
            "end": int(end_ts),
        }
        data = self._get_json("/v2/history/candles", params=params)
        return data.get("result", [])

    def fetch_candles(
        self,
        symbol: str,
        resolution: str,
        start_ts: int,
        end_ts: int,
        max_candles_per_request: int = 1500
    ) -> pd.DataFrame:
        """
        Fetch historical OHLCV candles over arbitrary time ranges with pagination.
        Handles chunking, reverse-order normalization, timestamp deduplication,
        and bounds validation.
        """
        interval = RESOLUTION_SECONDS.get(resolution)
        if not interval:
            raise ValueError(f"Unsupported resolution '{resolution}'. Expected one of {list(RESOLUTION_SECONDS.keys())}")

        chunk_span = max_candles_per_request * interval
        current_start = int(start_ts)
        end_ts = int(end_ts)

        raw_candles: List[Dict[str, Any]] = []

        while current_start < end_ts:
            current_end = min(current_start + chunk_span, end_ts)
            candles = self.fetch_candles_raw(symbol, resolution, current_start, current_end)
            if candles:
                raw_candles.extend(candles)
            current_start = current_end
            time.sleep(0.05)  # respectful pause to avoid aggressive throttling

        if not raw_candles:
            return pd.DataFrame(columns=["time", "open", "high", "low", "close", "volume"])

        df = pd.DataFrame(raw_candles)
        # Delta returns newest first, so sort ascending by timestamp
        df = df.sort_values("time").drop_duplicates(subset=["time"]).reset_index(drop=True)

        # Filter strictly within requested bounds
        df = df[(df["time"] >= start_ts) & (df["time"] <= end_ts)].reset_index(drop=True)

        # Cast numeric types
        for col in ["open", "high", "low", "close", "volume"]:
            if col in df.columns:
                df[col] = pd.to_numeric(df[col], errors="coerce")

        df["time"] = pd.to_numeric(df["time"], errors="coerce").astype(int)
        df["datetime"] = pd.to_datetime(df["time"], unit="s", utc=True)

        return df

    def fetch_funding_history(
        self,
        symbol: str,
        start_ts: int,
        end_ts: int,
        resolution: str = "1h"
    ) -> pd.DataFrame:
        """Fetch historical funding rate candles with symbol FUNDING:{symbol}."""
        funding_symbol = f"FUNDING:{symbol}"
        df = self.fetch_candles(funding_symbol, resolution, start_ts, end_ts)
        if not df.empty:
            df["funding_rate"] = df["close"]
        return df

    def fetch_mark_price_history(
        self,
        symbol: str,
        start_ts: int,
        end_ts: int,
        resolution: str = "5m"
    ) -> pd.DataFrame:
        """Fetch historical mark price candles with symbol MARK:{symbol}."""
        mark_symbol = f"MARK:{symbol}"
        return self.fetch_candles(mark_symbol, resolution, start_ts, end_ts)
