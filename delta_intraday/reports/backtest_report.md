# Delta Exchange India: Intraday Backtest Results

**Run Timestamp:** 2026-10-29 19:15:54 UTC  
**Strategy:** 15m Trend (EMA 50/200) + 5m Pullback (EMA 20 touch + RSI 50 cross) + ATR Stop & 2R Target  
**Exchange:** Delta Exchange India (`api.india.delta.exchange`)  

---

## 1. Executive Performance Summary

| Metric | Result (USD) | Result (INR) |
| :--- | :--- | :--- |
| **Initial Capital** | $1,136.36 | ₹99,999.68 |
| **Ending Equity** | $1,042.85 | ₹91,770.40 |
| **Net Profit / Loss** | **$-93.51** | **₹-8,229.28** |
| **Total Return** | **-8.23%** | - |
| **Max Drawdown** | 5.04% ($57.22) | - |
| **Sharpe Ratio (Ann.)** | -2.56 | - |
| **Sortino Ratio** | -6.07 | - |
| **Profit Factor** | 0.43 | - |
| **Expectancy** | **-0.580 R** | - |

---

## 2. Trade Statistics

| Metric | Value |
| :--- | :--- |
| **Total Trades** | 96 |
| **Winning Trades** | 28 (29.2%) |
| **Losing Trades** | 68 (70.8%) |
| **Avg Win** | $2.53 |
| **Avg Loss** | $2.42 |
| **Win / Loss Ratio** | 1.05 |

### Exit Breakdown
- **STOP**: 70 trades (72.9%)
- **TARGET**: 20 trades (20.8%)
- **TIME_EXPIRE**: 6 trades (6.2%)

---

## 3. Friction & Cost Breakdown

| Cost Component | Incurred (USD) | Incurred (INR) |
| :--- | :--- | :--- |
| **Gross Trading P&L** | $-68.22 | ₹-6,003.36 |
| **Exchange Fees** | -$61.60 | -₹5,420.80 |
| **Slippage Impact** | -$36.96 | -₹3,252.48 |
| **Funding Cashflows** | $+36.30 | ₹+3,194.40 |
| **Net Realized P&L** | **$-93.51** | **₹-8,229.28** |

---

## 4. Per-Coin Performance Attribution

| Symbol | Trades | Win Rate | Gross P&L ($) | Fees ($) | Funding ($) | Net P&L ($) | Net P&L (₹) | Profit Factor |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `BTCUSD` | 33 | 30.3% | $-17.93 | $24.39 | $+14.90 | **$-27.41** | ₹-2,412.31 | 0.49 |
| `ETHUSD` | 34 | 20.6% | $-35.50 | $21.39 | $+4.90 | **$-51.99** | ₹-4,575.28 | 0.32 |
| `SOLUSD` | 29 | 37.9% | $-14.79 | $15.82 | $+16.50 | **$-14.11** | ₹-1,241.69 | 0.56 |