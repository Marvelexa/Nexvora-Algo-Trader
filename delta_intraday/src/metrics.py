"""
Performance metrics calculation, trade attribution, and report generation.
Calculates expectancy in R, profit factor, win rate, Sharpe/Sortino ratios,
drawdowns, fee/slippage impact, and per-symbol attribution.
"""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
import numpy as np
import pandas as pd


def calculate_metrics(
    trades_df: pd.DataFrame,
    equity_df: pd.DataFrame,
    initial_equity_usd: float,
    usd_inr_rate: float = 88.0
) -> Dict[str, Any]:
    """Calculate comprehensive performance metrics from backtest trade logs and equity curve."""
    if trades_df.empty:
        return {
            "total_trades": 0,
            "win_rate_pct": 0.0,
            "profit_factor": 0.0,
            "net_pnl_usd": 0.0,
            "net_pnl_inr": 0.0,
            "total_return_pct": 0.0,
            "max_drawdown_pct": 0.0,
            "sharpe_ratio": 0.0,
            "expectancy_r": 0.0,
        }

    total_trades = len(trades_df)
    winning_trades = trades_df[trades_df["net_pnl"] > 0]
    losing_trades = trades_df[trades_df["net_pnl"] < 0]
    breakeven_trades = trades_df[trades_df["net_pnl"] == 0]

    n_wins = len(winning_trades)
    n_losses = len(losing_trades)
    win_rate = (n_wins / total_trades) * 100.0 if total_trades > 0 else 0.0

    gross_profit = winning_trades["gross_pnl"].sum()
    gross_loss = abs(losing_trades["gross_pnl"].sum())
    profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (999.0 if gross_profit > 0 else 0.0)

    total_gross_pnl = trades_df["gross_pnl"].sum()
    total_entry_fee = trades_df["entry_fee"].sum()
    total_exit_fee = trades_df["exit_fee"].sum()
    total_fees = total_entry_fee + total_exit_fee
    total_entry_slip = trades_df["entry_slippage"].sum()
    total_exit_slip = trades_df["exit_slippage"].sum()
    total_slippage = total_entry_slip + total_exit_slip
    total_funding = trades_df["funding_pnl"].sum()
    total_net_pnl = trades_df["net_pnl"].sum()

    total_net_pnl_inr = total_net_pnl * usd_inr_rate
    total_return_pct = (total_net_pnl / initial_equity_usd) * 100.0

    avg_win = winning_trades["net_pnl"].mean() if n_wins > 0 else 0.0
    avg_loss = abs(losing_trades["net_pnl"].mean()) if n_losses > 0 else 0.0
    win_loss_ratio = (avg_win / avg_loss) if avg_loss > 0 else 0.0

    # R-multiple expectancy
    # Approximate 1R risk from trade record: planned risk = 1.5 * ATR * multiplier * quantity
    planned_risks = (1.5 * trades_df["atr"] * trades_df["contract_multiplier"] * trades_df["quantity"]).replace(0, np.nan)
    r_multiples = trades_df["net_pnl"] / planned_risks
    r_multiples = r_multiples.dropna()
    avg_r = r_multiples.mean() if not r_multiples.empty else 0.0

    # Drawdown metrics
    max_dd_pct = 0.0
    max_dd_usd = 0.0
    if not equity_df.empty and "equity" in equity_df.columns:
        equity_series = equity_df["equity"]
        peaks = equity_series.cummax()
        dds = (peaks - equity_series) / peaks
        max_dd_pct = dds.max() * 100.0
        max_dd_usd = (peaks - equity_series).max()

    # Sharpe ratio from daily equity returns
    sharpe = 0.0
    sortino = 0.0
    if not equity_df.empty and len(equity_df) > 1:
        daily_returns = equity_df["equity"].pct_change().dropna()
        if len(daily_returns) > 1 and daily_returns.std() > 0:
            sharpe = (daily_returns.mean() / daily_returns.std()) * np.sqrt(365)
            downside_std = daily_returns[daily_returns < 0].std()
            if downside_std > 0:
                sortino = (daily_returns.mean() / downside_std) * np.sqrt(365)

    # Breakdown by exit reason
    exit_reasons = trades_df["exit_reason"].value_counts().to_dict()

    # Breakdown by coin/symbol
    symbols_breakdown = {}
    for sym, group in trades_df.groupby("symbol"):
        g_wins = group[group["net_pnl"] > 0]
        g_gross_prof = g_wins["gross_pnl"].sum()
        g_gross_loss = abs(group[group["net_pnl"] < 0]["gross_pnl"].sum())
        symbols_breakdown[sym] = {
            "trades": len(group),
            "win_rate": round(len(g_wins) / len(group) * 100.0, 2),
            "gross_pnl_usd": round(group["gross_pnl"].sum(), 2),
            "fees_usd": round(group["entry_fee"].sum() + group["exit_fee"].sum(), 2),
            "funding_pnl_usd": round(group["funding_pnl"].sum(), 2),
            "net_pnl_usd": round(group["net_pnl"].sum(), 2),
            "net_pnl_inr": round(group["net_pnl"].sum() * usd_inr_rate, 2),
            "profit_factor": round(g_gross_prof / g_gross_loss, 2) if g_gross_loss > 0 else (999.0 if g_gross_prof > 0 else 0.0)
        }

    return {
        "initial_capital_usd": round(initial_equity_usd, 2),
        "initial_capital_inr": round(initial_equity_usd * usd_inr_rate, 2),
        "ending_equity_usd": round(initial_equity_usd + total_net_pnl, 2),
        "ending_equity_inr": round((initial_equity_usd + total_net_pnl) * usd_inr_rate, 2),
        "total_net_pnl_usd": round(total_net_pnl, 2),
        "total_net_pnl_inr": round(total_net_pnl_inr, 2),
        "total_return_pct": round(total_return_pct, 2),
        "total_trades": total_trades,
        "winning_trades": n_wins,
        "losing_trades": n_losses,
        "breakeven_trades": len(breakeven_trades),
        "win_rate_pct": round(win_rate, 2),
        "profit_factor": round(profit_factor, 2),
        "avg_win_usd": round(avg_win, 2),
        "avg_loss_usd": round(avg_loss, 2),
        "win_loss_ratio": round(win_loss_ratio, 2),
        "expectancy_r": round(avg_r, 3),
        "max_drawdown_pct": round(max_dd_pct, 2),
        "max_drawdown_usd": round(max_dd_usd, 2),
        "sharpe_ratio": round(sharpe, 2),
        "sortino_ratio": round(sortino, 2),
        "total_gross_pnl_usd": round(total_gross_pnl, 2),
        "total_fees_usd": round(total_fees, 2),
        "total_slippage_usd": round(total_slippage, 2),
        "total_funding_usd": round(total_funding, 2),
        "exit_reasons": exit_reasons,
        "symbols_breakdown": symbols_breakdown,
    }


def generate_markdown_report(metrics: Dict[str, Any], config: Dict[str, Any]) -> str:
    """Generate a clean markdown report summarizing backtest results."""
    lines = [
        "# Delta Exchange India: Intraday Backtest Results",
        "",
        f"**Run Timestamp:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}  ",
        f"**Strategy:** 15m Trend (EMA 50/200) + 5m Pullback (EMA 20 touch + RSI 50 cross) + ATR Stop & 2R Target  ",
        f"**Exchange:** Delta Exchange India (`api.india.delta.exchange`)  ",
        "",
        "---",
        "",
        "## 1. Executive Performance Summary",
        "",
        "| Metric | Result (USD) | Result (INR) |",
        "| :--- | :--- | :--- |",
        f"| **Initial Capital** | ${metrics['initial_capital_usd']:,.2f} | ₹{metrics['initial_capital_inr']:,.2f} |",
        f"| **Ending Equity** | ${metrics['ending_equity_usd']:,.2f} | ₹{metrics['ending_equity_inr']:,.2f} |",
        f"| **Net Profit / Loss** | **${metrics['total_net_pnl_usd']:+,.2f}** | **₹{metrics['total_net_pnl_inr']:+,.2f}** |",
        f"| **Total Return** | **{metrics['total_return_pct']:+.2f}%** | - |",
        f"| **Max Drawdown** | {metrics['max_drawdown_pct']:.2f}% (${metrics['max_drawdown_usd']:,.2f}) | - |",
        f"| **Sharpe Ratio (Ann.)** | {metrics['sharpe_ratio']:.2f} | - |",
        f"| **Sortino Ratio** | {metrics['sortino_ratio']:.2f} | - |",
        f"| **Profit Factor** | {metrics['profit_factor']:.2f} | - |",
        f"| **Expectancy** | **{metrics['expectancy_r']:+.3f} R** | - |",
        "",
        "---",
        "",
        "## 2. Trade Statistics",
        "",
        "| Metric | Value |",
        "| :--- | :--- |",
        f"| **Total Trades** | {metrics['total_trades']} |",
        f"| **Winning Trades** | {metrics['winning_trades']} ({metrics['win_rate_pct']:.1f}%) |",
        f"| **Losing Trades** | {metrics['losing_trades']} ({100.0 - metrics['win_rate_pct']:.1f}%) |",
        f"| **Avg Win** | ${metrics['avg_win_usd']:,.2f} |",
        f"| **Avg Loss** | ${metrics['avg_loss_usd']:,.2f} |",
        f"| **Win / Loss Ratio** | {metrics['win_loss_ratio']:.2f} |",
        "",
        "### Exit Breakdown",
    ]

    for reason, count in metrics.get("exit_reasons", {}).items():
        pct = (count / metrics['total_trades'] * 100.0) if metrics['total_trades'] > 0 else 0
        lines.append(f"- **{reason}**: {count} trades ({pct:.1f}%)")

    lines.extend([
        "",
        "---",
        "",
        "## 3. Friction & Cost Breakdown",
        "",
        "| Cost Component | Incurred (USD) | Incurred (INR) |",
        "| :--- | :--- | :--- |",
        f"| **Gross Trading P&L** | ${metrics['total_gross_pnl_usd']:+,.2f} | ₹{metrics['total_gross_pnl_usd']*88:+,.2f} |",
        f"| **Exchange Fees** | -${metrics['total_fees_usd']:,.2f} | -₹{metrics['total_fees_usd']*88:,.2f} |",
        f"| **Slippage Impact** | -${metrics['total_slippage_usd']:,.2f} | -₹{metrics['total_slippage_usd']*88:,.2f} |",
        f"| **Funding Cashflows** | ${metrics['total_funding_usd']:+,.2f} | ₹{metrics['total_funding_usd']*88:+,.2f} |",
        f"| **Net Realized P&L** | **${metrics['total_net_pnl_usd']:+,.2f}** | **₹{metrics['total_net_pnl_inr']:+,.2f}** |",
        "",
        "---",
        "",
        "## 4. Per-Coin Performance Attribution",
        "",
        "| Symbol | Trades | Win Rate | Gross P&L ($) | Fees ($) | Funding ($) | Net P&L ($) | Net P&L (₹) | Profit Factor |",
        "| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |"
    ])

    for sym, attr in metrics.get("symbols_breakdown", {}).items():
        lines.append(
            f"| `{sym}` | {attr['trades']} | {attr['win_rate']:.1f}% | ${attr['gross_pnl_usd']:+,.2f} | "
            f"${attr['fees_usd']:,.2f} | ${attr['funding_pnl_usd']:+,.2f} | "
            f"**${attr['net_pnl_usd']:+,.2f}** | ₹{attr['net_pnl_inr']:+,.2f} | {attr['profit_factor']:.2f} |"
        )

    return "\n".join(lines)
