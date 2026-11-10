"""
Main Entrypoint for Delta Exchange India Backtester.
Discovers eligible perpetuals, fetches/caches candles, calculates multi-timeframe signals,
executes portfolio backtest, and writes reports and trade logs.
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
import yaml
import pandas as pd

from src.data_pipeline import DataPipeline
from src.delta_client import DeltaClient
from src.metrics import calculate_metrics, generate_markdown_report
from src.simulator import Simulator
from src.strategy import IntradayStrategy
from src.universe import UniverseBuilder

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("backtest_runner")


def load_config(config_path: Path) -> dict:
    with open(config_path, "r") as f:
        return yaml.safe_load(f)


def main():
    parser = argparse.ArgumentParser(description="Run Delta Exchange India Intraday Backtest")
    parser.add_argument("--config", type=str, default="config.yaml", help="Path to config.yaml")
    parser.add_argument("--days", type=int, default=120, help="Number of historical days to backtest")
    parser.add_argument("--symbols", type=str, default="", help="Comma-separated symbols to test (e.g. BTCUSD,ETHUSD,SOLUSD)")
    parser.add_argument("--capital-inr", type=float, default=None, help="Initial capital in INR")
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parent
    config_file = project_root / args.config
    config = load_config(config_file)

    usd_inr_rate = float(config.get("exchange", {}).get("usd_inr_rate", 88.0))
    if args.capital_inr:
        config["backtest"]["initial_capital_inr"] = args.capital_inr
        config["backtest"]["initial_capital_usd"] = args.capital_inr / usd_inr_rate
    elif "initial_capital_usd" not in config["backtest"]:
        capital_inr = float(config.get("backtest", {}).get("initial_capital_inr", 100000.0))
        config["backtest"]["initial_capital_usd"] = capital_inr / usd_inr_rate

    # Setup client and directories
    client = DeltaClient(base_url=config.get("exchange", {}).get("base_url", "https://api.india.delta.exchange"))
    data_pipeline = DataPipeline(client, raw_dir=project_root / "data/raw", processed_dir=project_root / "data/processed")
    universe_builder = UniverseBuilder(client, output_dir=project_root / "data/universe_history")

    logger.info("=== STEP 1: Discovering Delta India Perpetual Contracts ===")
    all_specs = universe_builder.discover_perpetuals()
    logger.info(f"Discovered {len(all_specs)} live perpetual futures contracts.")

    if args.symbols:
        requested = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
        selected_specs = [s for s in all_specs if s.symbol in requested]
        if not selected_specs:
            logger.error(f"None of requested symbols {requested} found in live perpetuals!")
            return
    else:
        logger.info("Filtering universe by liquidity and spreads...")
        selected_specs = universe_builder.filter_universe(
            all_specs,
            min_turnover_usd=float(config.get("universe", {}).get("min_median_daily_quote_volume_usd", 1_000_000.0)),
            max_spread_fraction=float(config.get("universe", {}).get("max_spread_fraction", 0.001)),
            top_n=5
        )

    specs_map = {s.symbol: s for s in selected_specs}
    logger.info(f"Universe selected {len(selected_specs)} contracts: {[s.symbol for s in selected_specs]}")
    for s in selected_specs:
        logger.info(f"  {s.symbol:<10} Multiplier: {s.contract_value} | Tick: {s.tick_size} | Maker: {s.maker_fee_rate} | Taker: {s.taker_fee_rate} | Group: {s.correlation_group}")

    # Determine backtest date range
    now_ts = int(datetime.now(timezone.utc).timestamp())
    start_ts = now_ts - (args.days * 86400)
    logger.info(f"=== STEP 2: Ingesting Data & Generating Indicators ({args.days} days) ===")
    logger.info(f"Time range: {datetime.fromtimestamp(start_ts, tz=timezone.utc).strftime('%Y-%m-%d')} to {datetime.fromtimestamp(now_ts, tz=timezone.utc).strftime('%Y-%m-%d')}")

    strategy = IntradayStrategy(config.get("strategy", {}))
    prepared_dfs = {}

    for spec in selected_specs:
        try:
            logger.info(f"Processing data for {spec.symbol}...")
            df = data_pipeline.prepare_symbol_data(
                symbol=spec.symbol,
                start_ts=start_ts,
                end_ts=now_ts,
                strategy_config=config.get("strategy", {}),
                use_funding=bool(config.get("execution", {}).get("use_historical_funding", True))
            )
            df = strategy.generate_signals(df, spec.symbol)
            signals_count = (df["signal"] != 0).sum()
            longs = (df["signal"] == 1).sum()
            shorts = (df["signal"] == -1).sum()
            logger.info(f"  {spec.symbol}: {len(df)} 5m bars. Generated {signals_count} signals ({longs} Long, {shorts} Short).")
            prepared_dfs[spec.symbol] = df
        except Exception as e:
            logger.error(f"Error preparing data for {spec.symbol}: {e}", exc_info=True)

    if not prepared_dfs:
        logger.error("No valid datasets prepared. Exiting.")
        return

    logger.info("=== STEP 3: Running Portfolio Simulator ===")
    simulator = Simulator(config=config, product_specs=specs_map)
    trades_df, equity_df = simulator.run(prepared_dfs)

    logger.info("=== STEP 4: Computing Performance Metrics & Trade Attribution ===")
    initial_usd = float(config.get("backtest", {}).get("initial_capital_usd", 1136.36))
    metrics = calculate_metrics(trades_df, equity_df, initial_equity_usd=initial_usd, usd_inr_rate=usd_inr_rate)

    # Save reports
    reports_dir = project_root / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)

    trades_csv = reports_dir / "trades.csv"
    trades_df.to_csv(trades_csv, index=False)
    logger.info(f"Saved {len(trades_df)} trade logs to {trades_csv}")

    equity_csv = reports_dir / "equity_curve.csv"
    equity_df.to_csv(equity_csv, index=False)
    logger.info(f"Saved daily equity curve to {equity_csv}")

    metrics_json = reports_dir / "metrics.json"
    with open(metrics_json, "w") as f:
        json.dump(metrics, f, indent=2)

    report_md = generate_markdown_report(metrics, config)
    report_file = reports_dir / "backtest_report.md"
    with open(report_file, "w", encoding="utf-8") as f:
        f.write(report_md)
    logger.info(f"Generated comprehensive report at {report_file}")

    print("\n" + "="*80)
    print("                      DELTA EXCHANGE INDIA BACKTEST RESULTS")
    print("="*80)
    print(f"Initial Capital:        ${metrics['initial_capital_usd']:,.2f}  (INR {metrics['initial_capital_inr']:,.2f})")
    print(f"Ending Equity:          ${metrics['ending_equity_usd']:,.2f}  (INR {metrics['ending_equity_inr']:,.2f})")
    print(f"Net Profit / Loss:      ${metrics['total_net_pnl_usd']:+,.2f}  (INR {metrics['total_net_pnl_inr']:+,.2f})")
    print(f"Total Return:           {metrics['total_return_pct']:+.2f}%")
    print(f"Total Trades:           {metrics['total_trades']}")
    print(f"Win Rate:               {metrics['win_rate_pct']:.2f}%  ({metrics['winning_trades']} wins, {metrics['losing_trades']} losses)")
    print(f"Profit Factor:          {metrics['profit_factor']:.2f}")
    print(f"Expectancy:             {metrics['expectancy_r']:+.3f} R")
    print(f"Max Drawdown:           {metrics['max_drawdown_pct']:.2f}%  (${metrics['max_drawdown_usd']:,.2f})")
    print(f"Sharpe Ratio (Ann.):    {metrics['sharpe_ratio']:.2f}")
    print(f"Sortino Ratio:          {metrics['sortino_ratio']:.2f}")
    print(f"Gross P&L:              ${metrics['total_gross_pnl_usd']:+,.2f}")
    print(f"Exchange Fees:         -${metrics['total_fees_usd']:,.2f}")
    print(f"Slippage Impact:       -${metrics['total_slippage_usd']:,.2f}")
    print(f"Funding Cashflows:     ${metrics['total_funding_usd']:+,.2f}")
    print("="*80)
    print("Per-Coin Breakdown:")
    for sym, attr in metrics.get("symbols_breakdown", {}).items():
        print(f"  {sym:<10}: {attr['trades']:>3} trades | Win: {attr['win_rate']:>5.1f}% | Net PnL: ${attr['net_pnl_usd']:>+8.2f} (INR {attr['net_pnl_inr']:>+10.2f}) | PF: {attr['profit_factor']:>5.2f}")
    print("="*80 + "\n")


if __name__ == "__main__":
    main()
