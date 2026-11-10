"""
Chronological Walk-Forward Validation Engine.
Splits data into train, validation, and untouched test splits chronologically.
Evaluates out-of-sample performance without future candle lookahead.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Dict, List
import pandas as pd

from .metrics import calculate_metrics
from .simulator import Simulator
from .strategy import IntradayStrategy
from .universe import ProductSpec

logger = logging.getLogger(__name__)


@dataclass
class WalkForwardWindow:
    window_id: int
    train_start: int
    train_end: int
    val_start: int
    val_end: int
    test_start: int
    test_end: int


class WalkForwardValidator:
    def __init__(self, config: Dict[str, Any], specs: Dict[str, ProductSpec]):
        self.config = config
        self.specs = specs

    def run_window(
        self,
        symbol_dfs: Dict[str, pd.DataFrame],
        start_ts: int,
        end_ts: int
    ) -> Dict[str, Any]:
        """Run backtest on a bounded time slice."""
        sliced_dfs = {}
        for sym, df in symbol_dfs.items():
            sub = df[(df["time"] >= start_ts) & (df["time"] <= end_ts)].copy()
            if not sub.empty:
                sliced_dfs[sym] = sub

        if not sliced_dfs:
            return {"total_trades": 0, "net_pnl_usd": 0.0, "total_return_pct": 0.0}

        sim = Simulator(self.config, self.specs)
        trades_df, equity_df = sim.run(sliced_dfs)
        usd_rate = float(self.config.get("exchange", {}).get("usd_inr_rate", 88.0))
        init_usd = float(self.config.get("backtest", {}).get("initial_capital_usd", 1136.36))
        return calculate_metrics(trades_df, equity_df, init_usd, usd_rate)
