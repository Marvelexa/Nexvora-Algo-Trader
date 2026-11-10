"""
Universe builder and contract eligibility engine for Delta Exchange India.
Discovers perpetual contracts dynamically, extracts contract specs,
calculates liquidity / spread filters, and handles correlation grouping.
"""

from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
import pandas as pd

from .delta_client import DeltaClient

logger = logging.getLogger(__name__)


@dataclass
class ProductSpec:
    product_id: int
    symbol: str
    underlying_symbol: str
    settling_symbol: str
    quoting_symbol: str
    contract_value: float  # Contract multiplier (e.g. 0.001 for BTC)
    tick_size: float
    maker_fee_rate: float
    taker_fee_rate: float
    correlation_group: str
    min_order_size: float = 1.0


class UniverseBuilder:
    def __init__(
        self,
        client: DeltaClient,
        output_dir: Path = Path("data/universe_history")
    ):
        self.client = client
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def discover_perpetuals(self) -> List[ProductSpec]:
        """Query Delta India API to find all live perpetual futures contracts."""
        raw_products = self.client.get_products(contract_types="perpetual_futures")
        specs: List[ProductSpec] = []

        for p in raw_products:
            # Check state/trading_status
            state = p.get("state", "").lower()
            trading_status = p.get("trading_status", "").lower()
            if state not in ("live", "tradable", "") and trading_status not in ("operational", ""):
                continue

            try:
                prod_id = int(p["id"])
                symbol = p["symbol"]
                underlying = p.get("underlying_asset", {}).get("symbol", symbol.replace("USD", ""))
                settling = p.get("settling_asset", {}).get("symbol", "USD")
                quoting = p.get("quoting_asset", {}).get("symbol", "USD")
                contract_val = float(p.get("contract_value", 1.0))
                tick = float(p.get("tick_size", 0.01))
                maker_fee = float(p.get("maker_commission_rate", 0.0002))
                taker_fee = float(p.get("taker_commission_rate", 0.0005))

                # Assign correlation group by underlying or sector
                tags = p.get("product_specs", {}).get("tags", [])
                corr_group = underlying
                if "meme" in tags or symbol in ("DOGEUSD", "SHIBUSD", "PEPEUSD", "BONKUSD", "FLOKIUSD"):
                    corr_group = "MEME"
                elif "defi" in tags or symbol in ("UNIUSD", "AAVEUSD", "MKRUSD", "CRVUSD"):
                    corr_group = "DEFI"
                elif underlying in ("BTC", "ETH", "SOL", "BNB", "XRP"):
                    corr_group = underlying

                spec = ProductSpec(
                    product_id=prod_id,
                    symbol=symbol,
                    underlying_symbol=underlying,
                    settling_symbol=settling,
                    quoting_symbol=quoting,
                    contract_value=contract_val,
                    tick_size=tick,
                    maker_fee_rate=maker_fee,
                    taker_fee_rate=taker_fee,
                    correlation_group=corr_group,
                    min_order_size=1.0
                )
                specs.append(spec)
            except Exception as e:
                logger.warning(f"Error parsing product {p.get('symbol')}: {e}")
                continue

        return specs

    def filter_universe(
        self,
        specs: List[ProductSpec],
        min_turnover_usd: float = 1_000_000.0,
        max_spread_fraction: float = 0.001,
        top_n: int = 10
    ) -> List[ProductSpec]:
        """
        Filter products by 24h turnover and bid/ask spread using live tickers.
        Ranks by liquidity descending.
        """
        tickers = self.client.get_tickers()
        ticker_map = {t.get("symbol"): t for t in tickers}

        eligible: List[tuple[ProductSpec, float]] = []

        for spec in specs:
            t = ticker_map.get(spec.symbol)
            if not t:
                continue

            turnover = float(t.get("turnover_usd") or 0.0)
            quotes = t.get("quotes", {})
            bid = float(quotes.get("best_bid") or 0.0)
            ask = float(quotes.get("best_ask") or 0.0)

            if ask > 0 and bid > 0:
                spread = (ask - bid) / ask
            else:
                spread = 1.0  # unknown or wide

            # Evaluate thresholds
            if turnover >= min_turnover_usd and spread <= max_spread_fraction:
                eligible.append((spec, turnover))
            elif spec.symbol in ("BTCUSD", "ETHUSD", "SOLUSD") and spread <= max_spread_fraction:
                # Always prioritize primary benchmark assets if spread is within limit
                eligible.append((spec, max(turnover, min_turnover_usd)))

        # Sort by turnover descending
        eligible.sort(key=lambda x: x[1], reverse=True)
        selected = [spec for spec, _ in eligible[:top_n]]

        # Save snapshot
        snapshot_time = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        snapshot_file = self.output_dir / f"universe_{snapshot_time}.json"
        with open(snapshot_file, "w") as f:
            json.dump([asdict(s) for s in selected], f, indent=2)

        return selected
