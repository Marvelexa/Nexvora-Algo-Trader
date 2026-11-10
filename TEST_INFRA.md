# Test Infrastructure Specification: Master Architecture Overhaul
**Ports 3002–3010, 189+ Universe Scanner, 4-Slot Rolling Risk Shield & Backtesting Engine**

## 1. Architectural Overview & Test Philosophy

The testing framework for the Master Architecture Overhaul implements a strict **4-Tier Opaque-Box Methodology** derived directly from `ORIGINAL_REQUEST.md`, `PROJECT.md`, and authoritative creator video specifications. 

The system operates across all 9 isolated trading ports (3002 through 3010) on the 189+ (250 verified) Delta Exchange India perpetual futures universe, while leaving Port 3001 strictly untouched as the production baseline and UI dashboard.

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               4-TIER OPAQUE-BOX TEST ARCHITECTURE                                      │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Tier 1: Feature Coverage (Category-Partition)                                                         │
│   - >=5 test cases per feature domain across Ports 3002–3010, Scanner, Risk Shield, Breakeven, Matrix  │
│ Tier 2: Boundary Value Analysis (BVA) & Corner Cases                                                  │
│   - Extreme ATR, zero-slope VWAP, empty/single candle, flash sweep vs blowout, 0.45% min SL distance   │
│ Tier 3: Cross-Feature Combinations & State Transitions                                                │
│   - Breakeven recycling freeing slots for 189+ queue, partial exits, bilateral symmetry under trend    │
│ Tier 4: Real-World Workload Scenarios & Historical Playback                                           │
│   - Multi-coin 1-month historical verification, 70%+ benchmark comparison, 24/7 scanning simulation   │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Core Execution Guarantees
1. **Opaque-Box Independence**: Tests evaluate system inputs (candles, ticks, order books, equity) against observable outputs (verdicts, signals, stop loss, take profit targets, risk allocations, position lifecycle states) without relying on internal private state.
2. **Authoritative Expected Outputs**: Expected values are derived from mathematical formulas, creator video rules, and the benchmark comparative matrix.
3. **Deterministic & Isolated**: Tests provide self-contained synthetic fixtures and cached historical market data from `.cache_candles_1m`, ensuring zero network flakiness.
4. **Execution Command**:
   ```bash
   node ./node_modules/tsx/dist/cli.mjs tests/e2e_master_architecture_overhaul.test.ts
   ```

---

## 2. Feature Inventory & Coverage Mapping (Tiers 1 to 4)

| Feature ID | Domain / Module | Target Port / Component | Authoritative Source | Tier 1 Tests | Tier 2 BVA | Tier 3 Pairwise | Tier 4 Workload |
|------------|-----------------|-------------------------|----------------------|:------------:|:----------:|:---------------:|:---------------:|
| **F01** | Brad Goh 5-Step Reversal Engine | Port 3002 | [PkAtVH6YVM8](https://youtu.be/PkAtVH6YVM8) | 5 | 2 | 2 | 1 |
| **F02** | TradingLab 10-Candle Divergence Grab | Port 3003 | [4cT8WTyxhYY](https://youtu.be/4cT8WTyxhYY) | 5 | 2 | 2 | 1 |
| **F03** | Fractal Flow Volume Profile Engine | Port 3004 | [9eqDWJSvCx4](http://www.youtube.com/watch?v=9eqDWJSvCx4) | 5 | 2 | 2 | 1 |
| **F04** | Hybrid Master Crypto SMC (Neeraj/Solomon) | Port 3005 | [FAt3PiB8-cM](http://www.youtube.com/watch?v=FAt3PiB8-cM) | 5 | 2 | 2 | 1 |
| **F05** | YT_PAT_ORB_ENGINE (Trade With Pat) | Port 3006 | [E3McKlAp3qk](http://www.youtube.com/watch?v=E3McKlAp3qk) | 5 | 2 | 2 | 1 |
| **F06** | YT_CRT_SMC_ENGINE (Iqshant Ladha) | Port 3007 | [KRl1JnWaOLU](http://www.youtube.com/watch?v=KRl1JnWaOLU) | 5 | 2 | 2 | 1 |
| **F07** | YT_SOLANO_VWAP_ENGINE (Sean Solano) | Port 3008 | [Ii1h78hBhZg](http://www.youtube.com/watch?v=Ii1h78hBhZg) | 5 | 2 | 2 | 1 |
| **F08** | YT_SECRET_MACD_ENGINE (Secret Mindset) | Port 3009 | [S2HaCa0b-bY](http://www.youtube.com/watch?v=S2HaCa0b-bY) | 5 | 2 | 2 | 1 |
| **F09** | YT_SIDEWAYS_RANGE_ENGINE (Sideways Box) | Port 3010 | [OhXnH8FnTzc](https://www.youtube.com/watch?v=OhXnH8FnTzc) | 5 | 2 | 2 | 1 |
| **F10** | Global 189+ Coin Universe Scanner | AutoTrader Scanner | ORIGINAL_REQUEST §R2 | 5 | 2 | 2 | 1 |
| **F11** | 4-Slot Rolling Risk Shield (1% Risk) | AutoTrader Risk | ORIGINAL_REQUEST §R2 | 5 | 2 | 2 | 1 |
| **F12** | Instant Breakeven Slot Recycling | DynamicTP2 / Risk | ORIGINAL_REQUEST §R2 | 5 | 2 | 2 | 1 |
| **F13** | Historical Backtest & Matrix Pipeline | Backtest Script | ORIGINAL_REQUEST §R3 | 5 | 2 | 2 | 1 |

---

## 3. Detailed Specification by Test Tier

### 3.1 Tier 1: Functional Feature Verification (>=5 Tests per Domain)

1. **Port 3002: Brad Goh 5-Step Reversal Engine**
   - *T1.01 (HTF Range Mapping)*: Verifies calculation of HTF range equilibrium (50%) over 40 bars to identify Discount (<50%) for Longs and Premium (>50%) for Shorts.
   - *T1.02 (Liquidity Sweep Detection)*: Verifies detection of sweep wick taking out prior swing high or low.
   - *T1.03 (Deceleration & Zone Mitigation)*: Verifies rejection wick or momentum deceleration at the sweep candle.
   - *T1.04 (Market Structure Shift)*: Verifies 5m/15m MSS candle body close beyond last internal structural pivot.
   - *T1.05 (Retest & PkAtVH6YVM8 TP/SL)*: Verifies entry on POI retest with SL beyond sweep wick + 0.30*ATR(14), TP1 at internal liquidity, and TP2 at opposing zone.
   - *T1.06 (Bilateral Symmetry)*: Verifies valid bearish short execution under identical symmetric rules in Premium.

2. **Port 3003: TradingLab Liquidity Grab + 10-Candle Divergence**
   - *T1.07 (Swing High/Low Identification)*: Verifies pivot high/low detection on 15m/5m timeframe.
   - *T1.08 (10-Candle Proximity Rule)*: Verifies that liquidity grab occurs within 2 to 10 candles from the pivot point (rejection if > 10 bars).
   - *T1.09 (Bullish Divergence Long)*: Verifies Long trigger when price makes a Lower Low and RSI/MACD prints a Higher Low.
   - *T1.10 (Bearish Divergence Short)*: Verifies Short trigger when price makes a Higher High and RSI/MACD prints a Lower High.
   - *T1.11 (Dual TP/SL Execution)*: Verifies SL beyond sweep wick + 0.25*ATR(14), TP1 at 1.0R / mid-range, and TP2 at 2.0R opposing swing.

3. **Port 3004: Fractal Flow Volume Profile Engine**
   - *T1.12 (Volume Profile Computation)*: Verifies POC (Point of Control) calculation as maximum volume price node.
   - *T1.13 (Value Area High/Low - VAH/VAL)*: Verifies 70% volume distribution bracketed between VAH and VAL.
   - *T1.14 (Mean Reversion Long Re-Entry)*: Verifies Long setup when price sweeps below VAL into LVN liquidity vacuum and closes back inside Value Area with bullish displacement.
   - *T1.15 (Mean Reversion Short Re-Entry)*: Verifies Short setup when price sweeps above VAH into LVN and closes back inside Value Area with bearish displacement.
   - *T1.16 (Native TP/SL Target)*: Verifies SL beyond LVN rejection wick + 0.25*ATR(14), TP1 (75%) at POC, and TP2 (25%) at opposing Value Area boundary.

4. **Port 3005: Hybrid Master Crypto SMC (Neeraj Joshi & Solomon King)**
   - *T1.17 (Structure Mapping)*: Verifies detection of 1H/15m BOS (Break of Structure) and CHoCH (Change of Character).
   - *T1.18 (Order Block & FVG)*: Verifies identification of unmitigated Order Blocks (OB) and Fair Value Gaps (FVG) behind Inducement (IDM).
   - *T1.19 (Bullish Discount Retest)*: Verifies Long on IDM sweep + tap and 5m rejection of Discount OB/FVG.
   - *T1.20 (Bearish Premium Retest)*: Verifies Short on IDM sweep + tap and 5m rejection of Premium OB/FVG.
   - *T1.21 (Native TP/SL Sizing)*: Verifies SL at OB extreme + 0.25*ATR(14), TP1 (75%) at 1.0R internal swing, TP2 (25%) at external structure (2.0R–3.0R).

5. **Port 3006: YT_PAT_ORB_ENGINE (Trade With Pat)**
   - *T1.22 (Asian Session Range)*: Verifies mapping of Asian Session High/Low box (00:00-07:00 UTC or 28-bar consolidation).
   - *T1.23 (London Push Directional Bias)*: Verifies London push sweep bias (sweeping Asian Low -> NY Bullish; sweeping Asian High -> NY Bearish; sweeping both -> NY Continuation).
   - *T1.24 (Opening Range Breakout)*: Verifies 15m ORB range and 5m displacement candles breaking outside ORB.
   - *T1.25 (Pullback Retest Entry)*: Verifies entry on pullback into Demand/Supply/FVG with engulfing or rejection confirmation.
   - *T1.26 (Native TP/SL Targets)*: Verifies SL beyond zone or FVG midline, TP1 (75%) at 1.0R–1.5R, TP2 (25%) at 2.0R or opposing Asian liquidity.

6. **Port 3007: YT_CRT_SMC_ENGINE (Iqshant Ladha)**
   - *T1.27 (1H CRT Range Definition)*: Verifies 1H Candle 1 High and Low definition.
   - *T1.28 (Candle 2 Turtle Soup Sweep)*: Verifies Candle 2 sweeps C1 Low (Buy) or C1 High (Sell) and closes back inside C1 range.
   - *T1.29 (5m Reversal CHoCH)*: Verifies 5m Change of Character in the reversal direction.
   - *T1.30 (Golden Zone Fib Retest)*: Verifies Fibonacci calculation on 5m leg with Order Block inside 50%–61.8% Golden Zone.
   - *T1.31 (Native CRT TP/SL)*: Verifies SL beyond 5m CRT sweep extreme, TP1 (70%) at 50% midpoint of Candle 1, TP2 (30%) at opposite extreme of Candle 1.

7. **Port 3008: YT_SOLANO_VWAP_ENGINE (Sean Solano)**
   - *T1.32 (Flat VWAP Rejection)*: Verifies that near-zero flat VWAP slope (|slope| < threshold) prevents trade execution.
   - *T1.33 (Trend Bias Alignment)*: Verifies 15m/1H CHoCH trend direction and 200 EMA alignment.
   - *T1.34 (Bullish Stacked Retest)*: Verifies Long when 9 EMA crosses above VWAP and pullback retests stacked pocket with next bar breakout.
   - *T1.35 (Bearish Stacked Retest)*: Verifies Short when 9 EMA crosses below VWAP and pullback retests stacked pocket with next bar breakdown.
   - *T1.36 (Native TP/SL Exits)*: Verifies SL underneath previous structure swing, TP1 (75%) at 1.0R, TP2 (25%) at 1.5R–2.0R or hold until 9 EMA cross.

8. **Port 3009: YT_SECRET_MACD_ENGINE (The Secret Mindset)**
   - *T1.37 (3-Timeframe Stack)*: Verifies 4H trend -> 1H setup -> 15m/5m trigger synchronization.
   - *T1.38 (Zero-Line Law)*: Verifies HTF MACD > 0 restricts signals to LONGS ONLY, while HTF MACD < 0 restricts to SHORTS ONLY.
   - *T1.39 (Distance Chop-Zone Filter)*: Verifies requirement for crossover far from zero chop-zone (> +0.5 or < -0.5 normalized).
   - *T1.40 (Histogram Color Flip Trigger)*: Verifies entry on candle close when LTF histogram prints shrinking exhaustion bars followed by first flipped bar.
   - *T1.41 (Native TP/SL Exits)*: Verifies SL at recent swing, TP1 (50%–75%) at 1.0R–2.0R with SL to BE, TP2 trailing until opposite MACD line crossover.

9. **Port 3010: YT_SIDEWAYS_RANGE_ENGINE (Best Strategies in Sideways Market)**
   - *T1.42 (Regime Detection)*: Verifies activation only when ADX(14) < 22 with defined 30-bar Range High and Low box.
   - *T1.43 (Breakout Deactivation)*: Verifies immediate strategy deactivation if high-volume breakout candle closes outside the box.
   - *T1.44 (Range Low Fade Long)*: Verifies Long on touch/sweep of Range Low with 5m rejection wick or bullish engulfing.
   - *T1.45 (Range High Fade Short)*: Verifies Short on touch/sweep of Range High with 5m rejection wick or bearish engulfing.
   - *T1.46 (Native TP/SL Exits)*: Verifies SL outside sweep wick + 0.25*ATR(14), TP1 (75%) at mid-range equilibrium (~1.0R), TP2 (25%) at opposite range boundary.

10. **Global Multi-Coin Scanner (250 Perpetual Futures Pairs)**
   - *T1.47 (Asynchronous 189+ Evaluation)*: Verifies scanning loop iterates through entire Delta Exchange India universe without blocking.
   - *T1.48 (Dual Timeframe Triggers)*: Verifies independent scheduled triggers on 5m and 15m candle close events.
   - *T1.49 (Concurrency & Chunking)*: Verifies parallel evaluation of coin chunks preventing event loop lag.
   - *T1.50 (Deduplication & Cooldown)*: Verifies 5-minute per-symbol cooldown and in-flight guards preventing duplicate position attempts.
   - *T1.51 (Malformed Data Resilience)*: Verifies scanner gracefully skips symbols with empty, incomplete, or corrupted candle data without crashing.

11. **Global 4-Slot Rolling Risk Shield (1% Risk Per Slot)**
   - *T1.52 (4-Slot Capacity Limit)*: Verifies that max concurrent active positions is strictly clamped to 4 slots.
   - *T1.53 (1% Fixed Risk Sizing)*: Verifies position sizing formula `size = (Equity * 0.01) / |Entry - SL|` exactly calculates $10 risk on $1,000 equity.
   - *T1.54 (Slot Saturation Rejection)*: Verifies 5th incoming signal is rejected or queued when 4 active risk slots are occupied.
   - *T1.55 (Contract Multiplier Quantization)*: Verifies position sizing rounds to integer contracts according to Delta Exchange contractValue.
   - *T1.56 (Capital Floor & Drawdown Circuit Breakers)*: Verifies trading halts if equity drops below minimum capital floor.

12. **Instant Breakeven Slot Recycling**
   - *T1.57 (+0.75R Early Breakeven Shift)*: Verifies that when an active trade reaches +0.75R, stop-loss is shifted to Entry + fee buffer.
   - *T1.58 (Downside Risk Zeroing)*: Verifies active trade downside risk is certified as 0.00% once breakeven is secured.
   - *T1.59 (Instant Slot Recycling)*: Verifies the risk slot is immediately freed to accept an incoming trade from the 189+ coin queue.
   - *T1.60 (TP1 Partial Hit Recycling)*: Verifies hitting TP1 also immediately releases the slot if not previously freed.
   - *T1.61 (Runner Preservation)*: Verifies 25% TP2 runner remains active and trailing risk-free while the recycled slot opens a new position.

13. **Historical Backtest & Comparative Performance Matrix**
   - *T1.62 (Multi-Coin Historical Execution)*: Verifies backtest pipeline executes bar-by-bar across 15+ cached pairs over 1-month lookback.
   - *T1.63 (Comparative Matrix Columns)*: Verifies report contains all mandated columns: `Port`, `Strategy`, `Total Trades`, `Long WR%`, `Short WR%`, `Overall Win Rate %`, `Profit Factor`, `Max DD%`, `Net PnL ($ & %)`.
   - *T1.64 (Bilateral Verification)*: Verifies every active strategy engine generates both Long and Short trades.
   - *T1.65 (70%+ Win Rate Benchmarking)*: Verifies automated comparison of actual win rates against the 70%+ benchmark target.
   - *T1.66 (Artifact Persistence)*: Verifies backtest report is persisted to `dist/isolated_youtube_systems_backtest_report.json`.

---

### 3.2 Tier 2: Boundary Value Analysis (BVA) & Corner Cases

- **B01 (Empty Candle Array)**: Passing `[]` into any strategy engine returns a clean verdict (`signal: null`, `reasons: ['Insufficient candle history...']`) with zero unhandled exceptions.
- **B02 (Single-Candle History)**: Passing a single candle returns graceful rejection without `NaN` or index out of bounds.
- **B03 (Below Warmup Threshold)**: Passing 10–25 candles (below 30–50 bar minimum required for ATR/EMA/Bands) returns clean rejection.
- **B04 (Extreme ATR / Flash Spike)**: Market with ATR expanding by 10x in a single candle maintains mathematically valid SL distances and clamps position size.
- **B05 (Ultra-Low ATR Flatline)**: Market with near-zero ATR (<0.0001) triggers low-volatility / chop protection.
- **B06 (Flash Sweep vs Runaway Breakout)**: Candle that sweeps a level with a wick but closes inside is accepted; candle that closes with a massive body outside is rejected.
- **B07 (Zero-Slope Flat VWAP Boundary)**: VWAP slope at 0.00005% is rejected as flat; VWAP slope at 0.05% is accepted as trending.
- **B08 (Sideways High-Volume Breakout)**: High-volume candle closing outside 30-bar box immediately terminates Port 3010 range trade.
- **B09 (Fee Erosion Protection - Min SL Distance 0.45%)**: SL distance at 0.0044 (0.44%) is rejected to prevent taker fee erosion; SL distance at 0.0046 (0.46%) is approved.
- **B10 (Extreme Asset Pricing)**: High-value asset ($95,000 BTC) vs micro-sat asset ($0.000021 PEPE) correctly computes contract quantities without float precision errors.
- **B11 (Slot Capacity Limit: 4 vs 5)**: When exactly 4 active slots exist, slot 5 is blocked; once 1 slot is recycled, slot 5 is accepted.
- **B12 (Breakeven Milestone Boundary: +0.749R vs +0.750R)**: Price at +0.749R does NOT recycle the slot; price at +0.750R triggers instant recycling.

---

### 3.3 Tier 3: Cross-Feature Combinations & State Transitions

- **C01 (Instant Breakeven Recycling + Queue Signal Acceptance)**: Active trade reaches +0.75R; test verifies slot becomes recyclable and next queued signal from scanner is admitted.
- **C02 (Bilateral Symmetry in Trending Environments)**: Strategy engines generate Long trades during uptrends and Short trades during downtrends without hardcoded bias.
- **C03 (Scanner Queue + Rolling Risk Shield Under Turnover)**: Continuous stream of candidate signals from scanner dynamically fills, recycles, and rotates through 4 slots.
- **C04 (Partial Exit Lifecycle: TP1 + TP2 Runner)**: Trade enters -> hits TP1 (75% closed, profit booked) -> SL moves to BE + buffer -> price hits TP2 (remaining 25% closed).
- **C05 (Fee Protection Interaction with Low ATR)**: Technically valid setup is filtered if structural SL distance is tighter than 0.45%.
- **C06 (Strategy Registry Forwarding Consistency)**: `evaluateStrategyForPort` forwards all native fields (`customSL`, `customTP`, `tp1Price`, `tp2Price`, `earlyBreakevenPrice`, `confidenceScore`) without data loss.
- **C07 (Concurrent Multi-Port Execution Isolation)**: Evaluating setups across ports 3002 through 3010 simultaneously causes zero cross-talk or state mutation.

---

### 3.4 Tier 4: Real-World Workload Scenarios

- **S01 (Multi-Coin Historical Replay Across Real Cached Datasets)**: Replays cached 1-month 15m candle data for BTC, ETH, SOL, XRP, DOGE, ADA, AVAX, SUI, LINK, INJ, OP, ARB through strategy engines.
- **S02 (End-to-End Trade Lifecycle Simulation)**: Full simulation of 4 concurrent positions across price ticks verifying entry, dynamic risk sizing, +0.75R breakeven trigger, 75% partial exit at TP1, and runner closure at TP2.
- **S03 (Full 189+ Universe Queue Processing Stress Test)**: Simulates 250 perpetual futures pairs streaming into scanner queue under high concurrency without memory leak.
- **S04 (Comparative Matrix Benchmarking against 70%+ Win Rate Target)**: Evaluates full backtest report against 70%+ benchmark win rate target and confirms complete column reporting.
- **S05 (Cluster Multi-Port Supervision Invariant Verification)**: Validates supervisor configuration ensuring all 9 ports (3002–3010) operate with dedicated state files and Port 3001 remains untouched.

---

## 4. Verification & Runner Commands

To execute the test suite:
```powershell
node ./node_modules/tsx/dist/cli.mjs tests/e2e_master_architecture_overhaul.test.ts
```

All assertions must pass cleanly with exit code 0.
