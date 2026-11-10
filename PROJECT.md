# Project: Master Architecture Overhaul (Ports 3002-3010, 189+ Universe, Risk Shield & Backtesting)

## Architecture
The system implements a high-frequency, multi-coin automated trading and backtesting architecture across all 9 isolated trading ports (3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, and 3010) on the 189+ (250 verified) Delta Exchange India perpetual futures universe. Port 3001 remains strictly untouched as the production baseline and UI dashboard.

```
                    ┌───────────────────────────────────────────────┐
                    │               Port 3001 (UNTOUCHED)           │
                    │  Zero-Lag Price Action & React SPA Dashboard  │
                    │      `server.ts`, `src/**`, `vite.config.ts`  │
                    └───────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       Master Cluster Supervisor (`master_cluster.mjs`)                                  │
├──────────────┬──────────────┬──────────────┬──────────────┬──────────────┬──────────────┬──────────────┬──────────────┬────┤
│ Port 3002    │ Port 3003    │ Port 3004    │ Port 3005    │ Port 3006    │ Port 3007    │ Port 3008    │ Port 3009    │3010│
│ Brad Goh     │ TradingLab   │ Fractal Flow │ Hybrid SMC   │ TradeWithPat │ Iqshant CRT  │ Sean Solano  │ Secret MACD  │Side│
│ 5-Step Rev   │ 10-Candle Div│ Vol Profile  │ Neeraj/Solom │ ORB Engine   │ SMC Engine   │ VWAP Engine  │ 3-TF Engine  │Rang│
├──────────────┴──────────────┴──────────────┴──────────────┴──────────────┴──────────────┴──────────────┴──────────────┴────┤
│                                  Global Multi-Coin Scanner (250 Perpetual Futures Pairs)                               │
│                      Continuous asynchronous scanning on every 5m and 15m candle close for 24/7 discovery              │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                Global Rolling Risk Shield                                              │
│  - 4 concurrent rolling risk slots capped at 1% account risk per active slot ($10 risk on $1,000 equity)               │
│  - Instant breakeven recycling: at +0.75R or TP1, shift SL to Breakeven (+ fee buffer), zeroing downside risk & slot   │
│  - Partial exits: TP1 (75% close) + TP2 (25% runner); native breakeven trail                                           │
│  - Fee protection: Strict enforcement of MIN_SL_DISTANCE_PCT = 0.45% against 30x leverage taker fee erosion           │
├────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                      Historical Backtest & Comparative Performance Matrix                              │
│  - 1-Month 15m bar-by-bar backtest across the full 189+ Delta Exchange India perpetual futures universe                │
│  - Standard Comparative Matrix: Port | Strategy | Total Trades | Long WR% | Short WR% | Overall WR% | PF | DD% | PnL   │
│  - Bilateral verification ensuring regular Long & Short trade execution against 70%+ Win Rate benchmark                │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Port 3002 Brad Goh Reversal Engine Overhaul | Exact video rules: HTF (1H/4H) S/R or Demand/Supply with Inducement, Impulsive sweep, 5m/15m MSS/CHoCH with displacement body, pullback retest of FVG/OB. SL beyond sweep wick + 0.30*ATR(14); TP1 (75%) at 1.0R-1.2R + BE; TP2 (25%) at opposing HTF zone or -2.0 to -2.5 SD. Strip over-filters & ensure bilateral symmetry. | M1 | ORIGINAL_REQUEST §R1 |
| 2 | Port 3003 TradingLab Divergence Grab Overhaul | Exact video rules: Clean swing high/low on 15m/5m, liquidity grab wick sweeping swing level and closing back inside range within 10 candles with RSI/MACD divergence. Buy on swing low sweep; Sell on swing high sweep. SL beyond sweep wick + 0.25*ATR(14); TP1 (75%) at 1.0R/mid-range; TP2 (25%) at 2.0R opposing swing. Strip 40-60% middle range choke & ensure bilateral symmetry. | M1 | ORIGINAL_REQUEST §R1 |
| 3 | Port 3004 Fractal Flow Volume Profile Overhaul | Exact video rules: Rolling Volume Profile (POC, VAH, VAL, HVN, LVN). Buy: price sweeps below VAL into LVN rejection and closes back inside Value Area with bullish displacement. Sell: price sweeps above VAH into LVN rejection and closes back inside with bearish displacement. SL beyond LVN rejection wick + 0.25*ATR(14); TP1 (75%) at POC; TP2 (25%) at opposite VA boundary. Strip Setup B & gatekeepers. | M1 | ORIGINAL_REQUEST §R1 |
| 4 | Port 3005 Hybrid Master Crypto SMC Overhaul | Pure video rules (Neeraj Joshi & Solomon King): Map 1H/15m BOS & CHoCH, unmitigated OB and FVG behind Inducement (IDM). Buy on IDM sweep + tap + 5m rejection of Discount OB/FVG; Sell on IDM sweep + tap + 5m rejection of Premium OB/FVG. SL at OB extreme + 0.25*ATR(14); TP1 (75%) at 1.0R/internal swing; TP2 (25%) at external structure (2.0R-3.0R). Strip 1.4x ATR and 0.70x ATR chokes. | M1 | ORIGINAL_REQUEST §R1 |
| 5 | Port 3006 YT_PAT_ORB_ENGINE Overhaul | Exact video rules (Trade With Pat): Map Asian Session High/Low, London push sweep bias (sweeping both Asian High & Low = NY Continuation bias). First 15m candle High/Low ORB. 5m 3-4 displacement candles break/close outside ORB creating Demand/Supply or FVG. Pullback entry with engulfing/rejection. SL beyond zone or FVG midline; TP1 (75%) at 1.0R-1.5R; TP2 (25%) at 2.0R or opposing Asian liquidity. | M1 | ORIGINAL_REQUEST §R1 |
| 6 | Strategy Registry & Standardized Verdict Interface | Standardize `StandardStrategyVerdict` returning `symbol`, `recommendedSide`, `confidenceScore`, `entryPrice`, `stopLossPrice`, `tp1Price`, `tp2Price`, `tp1Ratio` (0.75), `tp2Ratio` (0.25), and `earlyBreakevenPrice` (+0.75R). Forward fields through `strategyRegistry.ts` without dropping partial exit targets. | M1 | ORIGINAL_REQUEST §R1, §R2 |
| 7 | Port 3007 YT_CRT_SMC_ENGINE Overhaul | Exact video rules (Iqshant Ladha): 1H Candle 1 High and Low (CRT range); Candle 2 Turtle Soup sweeps C1 Low (Buy) or High (Sell) and closes back inside C1 range; 5m CHoCH in reversal direction; Fib on 5m CHoCH leg, enter at Order Block inside Golden Zone (50%-61.8% Fib). SL beyond 5m CRT sweep swing; TP1 (70%) at 50% midpoint of 1H C1; TP2 (30%) at 100% opposite extreme of 1H C1 or trail along 5m BOS swings. | M2 | ORIGINAL_REQUEST §R1 |
| 8 | Port 3008 YT_SOLANO_VWAP_ENGINE Overhaul | Exact video rules (Sean Solano): Flat VWAP filter: if 5m VWAP slope is flat (|slope| < 0.05%), take no trades. Follow 15m/1H CHoCH trend. Buy: price pushes above 9 EMA & VWAP, 9 EMA crosses above VWAP, pullback retests stacked 9 EMA + VWAP, enter on break of pullback high (Sell symmetric). SL under structure swing; TP1 (75%) at 1.0R / recent swing; TP2 (25%) at 1.5R-2.0R 1H target or hold until candle closes across 9 EMA. | M2 | ORIGINAL_REQUEST §R1 |
| 9 | Port 3009 YT_SECRET_MACD_ENGINE Overhaul | Exact video rules (The Secret Mindset): Stack 3 timeframes (4H trend -> 1H setup -> 15m/5m trigger). Zero-Line Law: HTF MACD > 0 = only Longs; HTF MACD < 0 = only Shorts. Setup: trend crossover far from zero chop-zone (> +0.5 or < -0.5 normalized) OR Price/MACD divergence at key S/R. Trigger: candle close when LTF MACD histogram prints shrinking bars followed by first flipped-color bar. SL at recent swing; TP1 (50%-75%) at 1.0R-2.0R with SL to BE; TP2 trails until opposite MACD line crossover. | M2 | ORIGINAL_REQUEST §R1 |
| 10 | Port 3010 YT_SIDEWAYS_RANGE_ENGINE Overhaul | Exact video rules: Active only when ADX(14) < 22 and price oscillating inside defined 30-bar Range High and Low box; disable immediately on high-volume breakout. Buy on Range Low touch/sweep + 5m rejection wick/engulfing; Sell on Range High touch/sweep + rejection/engulfing. SL outside sweep wick + 0.25*ATR(14); TP1 (75%) at mid-range equilibrium (~1.0R); TP2 (25%) at opposite range boundary. | M2 | ORIGINAL_REQUEST §R1 |
| 11 | Master Cluster Multi-Port Topology (`master_cluster.mjs`) | Update `master_cluster.mjs` to configure and supervise all 9 isolated ports (3002 through 3010) simultaneously, preserving Port 3001 untouched. Configure dedicated state files `.delta_auto_trader_state_${port}.json`, closed trade logs, ₹15,000 INR capital per port, and 4 concurrent rolling slots. | M2 | ORIGINAL_REQUEST §R1, §R2 |
| 12 | 189+ Coin Universe High-Frequency Asynchronous Scanner | Implement continuous asynchronous scanning across all 189+ (250 verified) Delta Exchange India perpetual futures pairs on every 5m and 15m candle close for 24/7 continuous trade discovery, replacing slow serial batching with concurrent chunked scanning. | M3 | ORIGINAL_REQUEST §R2 |
| 13 | 4-Slot Rolling Risk Shield (1% Risk Per Slot) | Enforce 4 concurrent rolling risk slots capped strictly at 1% account risk per active slot ($10 risk on $1,000 equity: `size = (Equity * 0.01) / |Entry - SL|`). | M3 | ORIGINAL_REQUEST §R2 |
| 14 | Instant Breakeven Slot Recycling | The moment an active trade reaches +0.75R (shifting SL to Breakeven + fee buffer) or hits TP1, its downside risk becomes 0%—immediately free that slot to accept the next incoming signal from the 189+ coin queue. | M3 | ORIGINAL_REQUEST §R2 |
| 15 | Live Partial Exit Execution in AutoTrader Engine | Implement 75% TP1 partial close and 25% TP2 runner handling in `DeltaAutoTraderEngine.monitorPositions()` and `src/types.ts` (`DeltaPosition`), banking realized gains, trailing stop loss to Breakeven, and managing position lifecycle. | M3 | ORIGINAL_REQUEST §R1, §R2 |
| 16 | Delta Exchange Fee Protection (`MIN_SL_DISTANCE_PCT = 0.45%`) | Strictly enforce `MIN_SL_DISTANCE_PCT = 0.45%` (0.0045) across all trade qualifications in all engines and risk managers to prevent ultra-tight setups from 30x leverage taker fee erosion. | M3 | ORIGINAL_REQUEST §R2 |
| 17 | Historical Backtest Pipeline across 189+ Coin Universe | Run historical backtest over 1-month lookback window across the 189+ Delta Exchange India perpetual futures universe using existing repository backtest scripts and Delta Exchange API data. | M4 | ORIGINAL_REQUEST §R3 |
| 18 | Comparative Performance Matrix Output Table | Output complete comparative summary table with columns: `Port | Strategy | Total Trades | Long WR% | Short WR% | Overall Win Rate % | Profit Factor | Max DD% | Net PnL ($ & %)`. | M4 | ORIGINAL_REQUEST §R3 |
| 19 | Bilateral Symmetry & 70%+ Benchmark Verification | Confirm that all 9 ports actively generate both Long and Short trades regularly, measuring and reporting actual performance against the 70%+ Win Rate benchmark target. | M4 | ORIGINAL_REQUEST §R1, §R3 |
| 20 | Dual Track Opaque-Box E2E Testing Suite | Requirements-driven E2E test suite (Tiers 1-4) covering all 9 engines, scanner, risk shield, and backtest, publishing `TEST_READY.md`, followed by Tier 5 adversarial coverage hardening. | M4 | ORIGINAL_REQUEST §Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| 1 | M1: Strategy Engines Overhaul (Ports 3002-3006) | Refactor engines for Ports 3002, 3003, 3004, 3005, 3006 to exact video formulas; strip over-filters; enforce bilateral symmetry; standardize `StandardStrategyVerdict` in `strategyRegistry.ts`. | none | PLANNED |
| 2 | M2: Strategy Engines Overhaul (Ports 3007-3010) & Cluster Supervisor | Refactor engines for Ports 3007, 3008, 3009, 3010 to exact video formulas; strip over-filters; update `master_cluster.mjs` to supervise all 9 ports (3002-3010) with Port 3001 untouched. | M1 | PLANNED |
| 3 | M3: Global 189+ Scanner & 4-Slot Rolling Risk Shield | Implement 250-coin asynchronous 5m/15m scanner, 4 rolling slots @ 1% risk, instant breakeven recycling at +0.75R/TP1, live 75% TP1 partial close & 25% TP2 runner in `deltaAutoTraderEngine.ts`, and 0.45% minimum SL distance. | M2 | PLANNED |
| 4 | M4: 189+ Historical Backtesting, Comparative Matrix & E2E Validation | Execute 1-month backtest across 189+ coin universe, generate full comparative performance matrix table, verify bilateral execution and 70%+ benchmark, pass full E2E testing suite, and achieve clean forensic audit. | M3 | PLANNED |

## Interface Contracts

### 1. `StandardStrategyVerdict` Contract
`lib/strategies/standardStrategyInterface.ts`:
```typescript
export interface StandardStrategyVerdict {
  symbol: string;
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  strategyName: string;
  setupType: string;
  entryPrice: number;
  stopLossPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp1Ratio: number; // 0.75 (75% close)
  tp2Ratio: number; // 0.25 (25% close)
  earlyBreakevenPrice: number; // +0.75R price level
  riskDistance: number;
  minSlDistancePct: number; // >= 0.0045 (0.45%)
  reasons: string[];
  auditLog?: Record<string, any>;
}
```

### 2. Evaluated Strategy Output Registry Contract
`lib/strategies/strategyRegistry.ts`:
```typescript
export interface EvaluatedStrategyOutput {
  signal: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  strategyName: string;
  customSL?: number;
  customTP?: number;
  tp1Price?: number;
  tp2Price?: number;
  tp1Ratio?: number;
  tp2Ratio?: number;
  earlyBreakevenPrice?: number;
  riskDistance?: number;
  reasons: string[];
  auditLog?: Record<string, any>;
}
```

### 3. Risk Shield Slot Management Contract
```typescript
export interface RiskShieldState {
  maxSlots: 4;
  riskPerSlotPct: 0.01; // 1%
  minSlDistancePct: 0.0045; // 0.45%
  activeSlots: Array<{
    symbol: string;
    port: number;
    entryPrice: number;
    currentPrice: number;
    stopLossPrice: number;
    tp1Price: number;
    tp2Price: number;
    isRiskRecycled: boolean; // true when price >= earlyBreakevenPrice (+0.75R) or tp1Hit
    tp1Hit: boolean;
    quantity: number;
    remainingQuantity: number;
  }>;
}
```

### 4. Comparative Performance Matrix Output Contract
```typescript
export interface ComparativePerformanceRow {
  port: number;
  strategy: string;
  totalTrades: number;
  longTrades: number;
  shortTrades: number;
  longWinRatePct: number;
  shortWinRatePct: number;
  overallWinRatePct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  netPnLUSD: number;
  netPnLPct: number;
  benchmark70Achieved: boolean;
}
```

## Code Layout
- `server.ts`, `src/**`, `vite.config.ts`, `.env`, `.delta_auto_trader_state_3001.json` — **PORT 3001 STRICTLY UNTOUCHED**
- `lib/strategies/bradGohMindMathMoney3002Engine.ts` — Strategy 3002 (M1)
- `lib/strategies/tradingLabDivergence3003Engine.ts` — Strategy 3003 (M1)
- `lib/strategies/fractalFlowVolumeProfile3004Engine.ts` — Strategy 3004 (M1)
- `lib/strategies/hybridMasterCryptoSMC3005Engine.ts` — Strategy 3005 (M1)
- `lib/strategies/ytPatOrb3006Engine.ts` — Strategy 3006 (M1)
- `lib/strategies/strategyRegistry.ts` — Registry Dispatch & Output Forwarding (M1, M2)
- `lib/strategies/ytCrtSmc3007Engine.ts` — Strategy 3007 (M2)
- `lib/strategies/ytSolanoVwap3008Engine.ts` — Strategy 3008 (M2)
- `lib/strategies/ytSecretMacd3009Engine.ts` — Strategy 3009 (M2)
- `lib/strategies/ytSidewaysRange3010Engine.ts` — Strategy 3010 (M2)
- `master_cluster.mjs` — Cluster Supervisor supervising 3002-3010 (M2)
- `lib/deltaAutoTraderEngine.ts` — Multi-Coin Scanner, 4-Slot Risk Shield, Breakeven Recycling, Partial Exits (M3)
- `src/types.ts` — DeltaPosition & Trade Interfaces (M3)
- `scripts/backtest_isolated_youtube_systems.ts` — 189+ Universe Backtest Engine & Matrix Output (M4)
- `tests/e2e_master_architecture_overhaul.test.ts` — E2E Test Suite (M4)
- `public/master_architecture_overhaul_matrix.json` — Comparative Matrix Report Artifact (M4)
