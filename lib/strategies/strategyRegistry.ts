// src/lib/strategies/strategyRegistry.ts
export interface KlinePoint {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type TradeTier = 'STRONG_23PCT_RUNNER' | 'NORMAL_5_TO_8_USD_SCALP';
export type SixSlotBucket = 'CHOP_15PCT_SEAT' | 'NORMAL_23_TO_40PCT_SEAT' | 'OPTION_UNCAPPED_SEAT';
export type SeatBucketType = SixSlotBucket | 'BIG_SIGNAL_SEAT' | 'OPTION_SEAT' | 'CHOP_NORMAL_SEAT';

export interface MasterSixSlotBracketPlan {
  bucket: SixSlotBucket;
  tierLabel: string;
  leverage: number;
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
  slPct: number;
  tpPct: number;
  grossRoePct: number;
  netRoeAfterFeesPct: number; // After 0.12% round-trip Delta taker fee (~3.0% ROE at 25x)
  maxRiskUSD: number;
  expectedProfitUSD: number;
  rrRatio: number;
  breakevenPlusFeeTriggerPrice: number; // Moves SL above fees early
  breakevenPlusFeeLockPrice: number;
  runner23PctTriggerPrice: number;      // Locks +18%..+20% ROE once trade hits +23%..+24% ROE!
  runner18PctLockPrice: number;
  canTriggerOptionSeat: boolean;
  nearestReversalWall?: number | null;
  blockingWallPrice?: number | null;
  blockingWallDistPct?: number | null;
}

export interface ThreeBucketTradePlan {
  bucket: SeatBucketType;
  tierLabel: string;
  targetRoePct: number;       // Net ROE target after fees: >= 24% for Normal Runner, >= 15.0% Net (18%+ Gross) for Chop
  grossRoePct?: number;
  netRoeAfterFeesPct?: number;
  targetProfitUSD: number;    // $10-$18 for Normal Runner, $5.50-$7.50+ for Chop
  maxRiskUSD: number;         // $3.80 for Normal Runner, $3.20 for Chop
  leverage: number;           // 25x
  slPrice: number;
  tpPrice: number;
  trailActivationPrice: number;
  trailLockPrice: number;
  breakevenPlusFeeTriggerPrice?: number;
  breakevenPlusFeeLockPrice?: number;
  runner23PctTriggerPrice?: number;
  runner18PctLockPrice?: number;
  rrRatio: number;
  canAlsoTriggerOption: boolean;
  reversalWallPrice?: number | null;
  blockingWallPrice?: number | null;
  blockingWallDistPct?: number | null;
}

export interface TieredBracketPlan {
  tier: TradeTier;
  expectedRoePct: number;
  targetProfitUSD: number;
  maxRiskUSD: number;
  leverage: number;
  slPrice: number;
  tpPrice: number;
  trailTriggerPrice: number;
  useOptionsSlot: boolean; // True if this is a Tier-1 Strong BTC/ETH breakout and an Option slot is free!
}

export interface VideoStrategySignal {
  action: 'BUY' | 'SELL' | 'WAIT';
  signal: 'BUY' | 'SELL' | null;
  confidence: number;
  confidenceScore: number;
  strategyName: string;
  port: number;
  entryPrice: number;
  structuralSlPrice: number;
  customSL: number;
  structuralTpPrice: number;
  customTP: number;
  reason: string;
  reasons: string[];
  closedCandleTime: number;
  tierPlan?: TieredBracketPlan;
  threeBucketPlan?: ThreeBucketTradePlan;
  adx?: number;
}

// ============================================================================
// CANDLE SANITIZER AGAINST TESTNET FREAK NEEDLE GLITCH WICKS
// Never trust any wick sticking out more than 0.45% above or below the body!
// ============================================================================
export function sanitizeCandles(candles: KlinePoint[]): KlinePoint[] {
  return candles.map((c) => {
    const bodyTop = Math.max(c.open, c.close);
    const bodyBot = Math.min(c.open, c.close);
    // Clamp effective high and low to reject fake single-tick spikes (e.g. $2,226 -> $2,424 needle)
    const effectiveHigh = Math.min(c.high, bodyTop * 1.0045);
    const effectiveLow = Math.max(c.low, bodyBot * 0.9955);
    return {
      ...c,
      high: effectiveHigh,
      low: effectiveLow,
    };
  });
}

// ============================================================================
// CORE TECHNICAL HELPERS (EVALUATED STRICTLY ON CLOSED CANDLES)
// ============================================================================
export function calcEMA(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  if (values.length === 0) return ema;
  ema[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    ema[i] = values[i] * k + ema[i - 1] * (1 - k);
  }
  return ema;
}

export function calcATR(candles: KlinePoint[], period = 14): number {
  if (candles.length < 2) return 0;
  const cleanCandles = sanitizeCandles(candles);
  const trs: number[] = [];
  for (let i = 1; i < cleanCandles.length; i++) {
    const h = cleanCandles[i].high;
    const l = cleanCandles[i].low;
    const pc = cleanCandles[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length);
}

export function calcRSI(closes: number[], period = 14): number {
  if (closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return 100 - 100 / (1 + rs);
}

export function calcVWAP(candles: KlinePoint[], lookback = 32): number {
  const cleanCandles = sanitizeCandles(candles);
  const slice = cleanCandles.slice(-lookback);
  let pv = 0;
  let vol = 0;
  for (const c of slice) {
    const typical = (c.high + c.low + c.close) / 3;
    const v = c.volume > 0 ? c.volume : 1;
    pv += typical * v;
    vol += v;
  }
  return vol > 0 ? pv / vol : slice[slice.length - 1]?.close || 0;
}

export function calcBollinger(closes: number[], period = 20, mult = 2.0) {
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / Math.max(1, slice.length);
  const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / Math.max(1, slice.length);
  const std = Math.sqrt(variance);
  return {
    middle: mean,
    upper: mean + mult * std,
    lower: mean - mult * std,
    widthPct: mean > 0 ? ((2 * mult * std) / mean) : 0,
  };
}

export function calcADX(candles: KlinePoint[], period = 14): number {
  const clean = sanitizeCandles(candles);
  if (clean.length <= period + 2) return 20;

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];

  for (let i = 1; i < clean.length; i++) {
    const upMove = clean[i].high - clean[i - 1].high;
    const downMove = clean[i - 1].low - clean[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    const highLow = clean[i].high - clean[i].low;
    const highClose = Math.abs(clean[i].high - clean[i - 1].close);
    const lowClose = Math.abs(clean[i].low - clean[i - 1].close);
    tr.push(Math.max(highLow, highClose, lowClose));
  }

  const sliceLen = Math.min(period, tr.length);
  if (sliceLen === 0) return 20;

  let smoothTR = tr.slice(0, sliceLen).reduce((a, b) => a + b, 0);
  let smoothPlusDM = plusDM.slice(0, sliceLen).reduce((a, b) => a + b, 0);
  let smoothMinusDM = minusDM.slice(0, sliceLen).reduce((a, b) => a + b, 0);

  const dxValues: number[] = [];
  for (let i = sliceLen; i < tr.length; i++) {
    smoothTR = smoothTR - smoothTR / period + tr[i];
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i];
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i];

    const plusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    const minusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
    const sumDI = plusDI + minusDI;
    const dx = sumDI > 0 ? (Math.abs(plusDI - minusDI) / sumDI) * 100 : 0;
    dxValues.push(dx);
  }

  if (dxValues.length === 0) return 20;
  const recentDX = dxValues.slice(-period);
  return recentDX.reduce((a, b) => a + b, 0) / recentDX.length;
}

/**
 * MASTER CONVICTION & ROE BRAIN
 * Automatically senses whether the market has room for a 23%+ ROE Power Move
 * OR if it should lock in a clean $5–$8 USD quick structural scalp!
 */
export function classifyTradeTierAndBuildBracket(params: {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  closed15m: KlinePoint[];
  atr: number;
  adx: number;
  rsi: number;
  isMajorPattern: boolean; // W-Bottom, M-Top, BOS, or Engulfing
  openOptionSlots: number;
}): TieredBracketPlan {
  const { symbol, side, entryPrice, closed15m, atr, adx, isMajorPattern, openOptionSlots } = params;
  const c = closed15m[closed15m.length - 1];
  const bodySize = Math.abs(c.close - c.open);
  const candRange = Math.max(c.high - c.low, 1e-8);
  const bodyRatio = bodySize / candRange;

  // Measure room to the nearest opposing 40-bar Candle-Body Reversal Wall
  const history = closed15m.slice(-40, -1);
  let nearestWallDistPct = 0.0150; // Default 1.50% open room if blue-sky

  for (let i = 1; i < history.length - 1; i++) {
    const bTop = Math.max(history[i].open, history[i].close);
    const bBot = Math.min(history[i].open, history[i].close);
    if (side === 'BUY' && bTop > entryPrice * 1.0040) {
      const distPct = (bTop - entryPrice) / entryPrice;
      if (distPct < nearestWallDistPct) nearestWallDistPct = distPct;
    } else if (side === 'SELL' && bBot < entryPrice * 0.9960) {
      const distPct = (entryPrice - bBot) / entryPrice;
      if (distPct < nearestWallDistPct) nearestWallDistPct = distPct;
    }
  }

  // DOES THE MARKET HAVE POWER FOR A 23%+ ROE STRONG TRADE?
  // Requires: (ADX >= 22 OR Major Pattern) + Strong Closed 15m Body (>= 50% of range) + At least 0.95% clear runway to the next reversal wall!
  const isStrong23PctSetup =
    (adx >= 22 || isMajorPattern) &&
    bodyRatio >= 0.50 &&
    nearestWallDistPct >= 0.0095;

  // Structural Swing Wick SL (0.55% to 0.80% away)
  const recent4 = closed15m.slice(-4);
  const swingLow4 = Math.min(...recent4.map((k) => Math.max(k.low, Math.min(k.open, k.close) * 0.9955)));
  const swingHigh4 = Math.max(...recent4.map((k) => Math.min(k.high, Math.max(k.open, k.close) * 1.0045)));

  const rawSlDist =
    side === 'BUY'
      ? entryPrice - (swingLow4 - atr * 0.12)
      : (swingHigh4 + atr * 0.12) - entryPrice;

  const slDist = Math.max(entryPrice * 0.0055, Math.min(rawSlDist, entryPrice * 0.0080));
  const slPrice = side === 'BUY' ? entryPrice - slDist : entryPrice + slDist;

  if (isStrong23PctSetup) {
    // TIER 1: STRONG 23%+ ROE RUNNER (At 25x Leverage, a 0.95% to 1.25% price move = +23.75% to +31.25% ROE!)
    const leverage = 25;
    const minStrongMovePct = 0.0096; // 0.96% * 25x = 24.0% ROE minimum!
    const targetMovePct = Math.max(minStrongMovePct, Math.min(nearestWallDistPct - 0.0008, 0.0140));
    const tpDist = entryPrice * targetMovePct;
    const tpPrice = side === 'BUY' ? entryPrice + tpDist : entryPrice - tpDist;
    const trailTriggerPrice = side === 'BUY' ? entryPrice + tpDist * 0.55 : entryPrice - tpDist * 0.55;

    const isLeaderCoin = symbol === 'BTCUSD' || symbol === 'ETHUSD';

    return {
      tier: 'STRONG_23PCT_RUNNER',
      expectedRoePct: Number((targetMovePct * leverage * 100).toFixed(1)), // >= 24.0% ROE!
      targetProfitUSD: 11.50,
      maxRiskUSD: 4.20,
      leverage,
      slPrice: parseFloat(slPrice.toFixed(4)),
      tpPrice: parseFloat(tpPrice.toFixed(4)),
      trailTriggerPrice: parseFloat(trailTriggerPrice.toFixed(4)),
      useOptionsSlot: isLeaderCoin && openOptionSlots < 2,
    };
  } else {
    // TIER 2: NORMAL QUICK STRUCTURAL SCALP ($5.00 to $8.00 USD Profit before nearest wall!)
    const leverage = 25;
    const scalpMovePct = Math.max(0.0062, Math.min(nearestWallDistPct - 0.0006, 0.0088)); // 15.5% to 22% ROE ($5.50 to $8.00 USD)
    const tpDist = entryPrice * scalpMovePct;
    const tpPrice = side === 'BUY' ? entryPrice + tpDist : entryPrice - tpDist;
    const trailTriggerPrice = side === 'BUY' ? entryPrice + tpDist * 0.50 : entryPrice - tpDist * 0.50;

    return {
      tier: 'NORMAL_5_TO_8_USD_SCALP',
      expectedRoePct: Number((scalpMovePct * leverage * 100).toFixed(1)),
      targetProfitUSD: 6.50, // Right inside the $5–$8 USD sweet spot!
      maxRiskUSD: 3.50,
      leverage,
      slPrice: parseFloat(slPrice.toFixed(4)),
      tpPrice: parseFloat(tpPrice.toFixed(4)),
      trailTriggerPrice: parseFloat(trailTriggerPrice.toFixed(4)),
      useOptionsSlot: false,
    };
  }
}

// ============================================================================
// MASTER UNIFIED TP & SL ENGINE (ZERO GLITCH WICKS, FRONT-RUN REVERSAL TP, HARD CLAMPS)
// ============================================================================
export interface MasterBracketResult {
  slPrice: number;
  tpPrice: number;
  slDistance: number;
  tpDistance: number;
  slPct: number;
  tpPct: number;
  rrRatio: number;
  tier: 'STRONG_23PCT_RUNNER' | 'NORMAL_5_TO_8_USD_SCALP';
  trailActivationPrice: number;
  trailLockPrice: number;
  nearestReversalWall?: number | null;
  blockingWallPrice?: number | null;
  blockingWallDistPct?: number | null;
}

/**
 * Rounds any price cleanly to the coin's exact Delta Exchange tickSize
 * (Prevents Delta API `invalid_tick_size` bracket rejections!)
 */
export function roundToTickSize(price: number, tickSize = 0.01): number {
  if (!Number.isFinite(price)) return 0;
  if (!tickSize || !Number.isFinite(tickSize) || tickSize <= 0) {
    return Number(price.toFixed(4));
  }
  let decimals = 0;
  if (tickSize < 1) {
    const str = tickSize.toString();
    if (str.includes('e-')) {
      decimals = parseInt(str.split('e-')[1], 10) || 4;
    } else {
      const frac = str.split('.')[1];
      decimals = frac ? frac.length : Math.max(0, Math.ceil(-Math.log10(tickSize) - 1e-12));
    }
  }
  decimals = Math.min(Math.max(decimals, 0), 8);
  const rounded = Math.round(price / tickSize) * tickSize;
  return Number(rounded.toFixed(decimals));
}

/**
 * MASTER UNIFIED TP & SL ENGINE (ZERO GLITCH WICKS, FRONT-RUN REVERSAL TP, HARD CLAMPS)
 */
export function buildBulletproofBracket(params: {
  closedCandles: KlinePoint[];
  side: 'BUY' | 'SELL';
  entryPrice: number;
  atr: number;
  tickSize?: number;
}): MasterBracketResult {
  const { closedCandles, side, entryPrice, atr, tickSize = 0.01 } = params;
  const effectiveTick = tickSize && Number.isFinite(tickSize) && tickSize > 0
    ? tickSize
    : (entryPrice < 1 ? 0.0001 : entryPrice < 100 ? 0.001 : 0.01);

  // 1. SANITIZE CANDLES AGAINST TESTNET GLITCH WICKS
  // - Reject extreme freak needle spikes (> 1.5% beyond body) down to body +/- 0.08%
  // - Otherwise clamp wicks to max 0.45% beyond candle body
  const sanitized = (closedCandles || []).slice(-45).map((c) => {
    const bodyTop = Math.max(c.open, c.close);
    const bodyBot = Math.min(c.open, c.close);
    const isFreakHighSpike = bodyTop > 0 && c.high > bodyTop * 1.015;
    const isFreakLowSpike = bodyBot > 0 && c.low < bodyBot * 0.985;
    return {
      ...c,
      bodyTop,
      bodyBot,
      safeHigh: isFreakHighSpike ? bodyTop * 1.0008 : Math.min(c.high, bodyTop * 1.0045),
      safeLow: isFreakLowSpike ? bodyBot * 0.9992 : Math.max(c.low, bodyBot * 0.9955),
    };
  });

  const safeAtr = Math.min(Math.max(atr || entryPrice * 0.0040, entryPrice * 0.0020), entryPrice * 0.0080);

  // 2. EXACT STRUCTURAL STOP-LOSS (Behind last 5-bar safe swing wick + 0.12% buffer)
  // Strictly clamped between 0.55% (outside noise) and 0.80% (never huge -$50 glitch SL!)
  const recent5 = sanitized.slice(-5);
  const swingLow5 = recent5.length > 0
    ? Math.min(...recent5.map((c) => c.safeLow))
    : entryPrice * 0.9940;
  const swingHigh5 = recent5.length > 0
    ? Math.max(...recent5.map((c) => c.safeHigh))
    : entryPrice * 1.0060;

  const minSlDist = entryPrice * 0.0055; // 0.55% min SL
  const maxSlDist = entryPrice * 0.0080; // 0.80% max SL

  const rawSlDist =
    side === 'BUY'
      ? entryPrice - swingLow5 + entryPrice * 0.0012
      : swingHigh5 - entryPrice + entryPrice * 0.0012;

  const baseSlDistance = Math.max(minSlDist, Math.min(rawSlDist, maxSlDist));
  const rawSlPrice = side === 'BUY' ? entryPrice - baseSlDistance : entryPrice + baseSlDistance;

  // 3. EXACT FRONT-RUN REVERSAL TAKE-PROFIT (Scans last 40 bars for Candle-Body Reversal Wall + Bollinger Bands)
  // Places TP strictly IN FRONT OF the reversal wall (0.08% or 0.12*ATR buffer) so it fills BEFORE market reverses!
  const history = sanitized.length > 1 ? sanitized.slice(0, -1) : sanitized;
  const minWallDist = Math.max(entryPrice * 0.0062, baseSlDistance * 1.20); // Min 15.5%+ ROE
  const maxWallDist = Math.max(entryPrice * 0.0135, baseSlDistance * 2.25); // Up to 33.75% ROE

  let nearestReversalWall: number | null = null;

  for (let i = 1; i < history.length - 1; i++) {
    const currTop = history[i].bodyTop;
    const currBot = history[i].bodyBot;
    const prevTop = history[i - 1].bodyTop;
    const nextTop = history[i + 1].bodyTop;
    const prevBot = history[i - 1].bodyBot;
    const nextBot = history[i + 1].bodyBot;

    if (side === 'BUY') {
      // Local Candle-Body Resistance Peak
      if (currTop >= prevTop && currTop >= nextTop) {
        const dist = currTop - entryPrice;
        if (dist >= minWallDist && dist <= maxWallDist) {
          if (nearestReversalWall === null || currTop < nearestReversalWall) {
            nearestReversalWall = currTop;
          }
        }
      }
    } else {
      // Local Candle-Body Support Trough
      if (currBot <= prevBot && currBot <= nextBot) {
        const dist = entryPrice - currBot;
        if (dist >= minWallDist && dist <= maxWallDist) {
          if (nearestReversalWall === null || currBot > nearestReversalWall) {
            nearestReversalWall = currBot;
          }
        }
      }
    }
  }

  // Also check 20-bar Bollinger Upper/Lower Band as a structural Reversal Zone in wide-enough ranges
  const bb = history.length >= 20 ? calcBollinger(history.map((k) => k.close), 20, 2.0) : null;
  if (bb && bb.widthPct >= 0.0080) {
    if (side === 'BUY' && bb.upper > entryPrice) {
      const dist = bb.upper - entryPrice;
      if (dist >= minWallDist && dist <= maxWallDist) {
        if (nearestReversalWall === null || bb.upper < nearestReversalWall) {
          nearestReversalWall = bb.upper;
        }
      }
    } else if (side === 'SELL' && bb.lower > 0 && bb.lower < entryPrice) {
      const dist = entryPrice - bb.lower;
      if (dist >= minWallDist && dist <= maxWallDist) {
        if (nearestReversalWall === null || bb.lower > nearestReversalWall) {
          nearestReversalWall = bb.lower;
        }
      }
    }
  }

  // Detect tight-box trap: entire recent 35-bar range ceiling/floor lies strictly inside [0.18%, 0.60%) with NO higher/lower room (>= 0.62%)
  let blockingWallPrice: number | null = null;
  let blockingWallDistPct: number | null = null;
  const recentBox = history.slice(-35);
  if (recentBox.length >= 15 && nearestReversalWall === null) {
    if (side === 'BUY') {
      const boxMaxBody = Math.max(...recentBox.map((k) => k.bodyTop));
      const boxDistPct = (boxMaxBody - entryPrice) / (entryPrice || 1);
      const touchesNearTop = recentBox.filter((k) => Math.abs(k.bodyTop - boxMaxBody) <= entryPrice * 0.0020).length;
      if (boxDistPct >= 0.0018 && boxDistPct < 0.0060 && touchesNearTop >= 2) {
        blockingWallPrice = roundToTickSize(boxMaxBody, effectiveTick);
        blockingWallDistPct = Number((boxDistPct * 100).toFixed(2));
      }
    } else {
      const boxMinBody = Math.min(...recentBox.map((k) => k.bodyBot));
      const boxDistPct = (entryPrice - boxMinBody) / (entryPrice || 1);
      const touchesNearBot = recentBox.filter((k) => Math.abs(k.bodyBot - boxMinBody) <= entryPrice * 0.0020).length;
      if (boxDistPct >= 0.0018 && boxDistPct < 0.0060 && touchesNearBot >= 2) {
        blockingWallPrice = roundToTickSize(boxMinBody, effectiveTick);
        blockingWallDistPct = Number((boxDistPct * 100).toFixed(2));
      }
    }
  }

  const frontRunBuffer = Math.max(entryPrice * 0.0008, safeAtr * 0.12);
  let rawTpDistance: number;

  if (nearestReversalWall !== null) {
    rawTpDistance =
      side === 'BUY'
        ? nearestReversalWall - frontRunBuffer - entryPrice
        : entryPrice - (nearestReversalWall + frontRunBuffer);
  } else {
    // Open Runway: If last closed candle has strong displacement body, target 0.98% (24.5% ROE @ 25x), else 0.72% ($6-$8 Scalp)
    const lastBar = sanitized[sanitized.length - 1];
    const bodySize = lastBar ? lastBar.bodyTop - lastBar.bodyBot : 0;
    const isStrongImpulse = bodySize >= safeAtr * 0.55;
    rawTpDistance = isStrongImpulse
      ? Math.max(entryPrice * 0.0098, baseSlDistance * 1.65)
      : Math.max(entryPrice * 0.0072, baseSlDistance * 1.35);
  }

  // Final Safety Clamp on TP Distance (Minimum 1.25x SL distance so R:R is always profitable!)
  rawTpDistance = Math.max(baseSlDistance * 1.25, Math.min(rawTpDistance, entryPrice * 0.0145));
  const rawTpPrice = side === 'BUY' ? entryPrice + rawTpDistance : entryPrice - rawTpDistance;

  // 4. DIRECTIONAL SANITY & TICK-SIZE ROUNDING
  let slPrice = roundToTickSize(rawSlPrice, effectiveTick);
  let tpPrice = roundToTickSize(rawTpPrice, effectiveTick);

  if (side === 'BUY') {
    if (slPrice >= entryPrice) slPrice = roundToTickSize(entryPrice - Math.max(effectiveTick, baseSlDistance), effectiveTick);
    if (tpPrice <= entryPrice) tpPrice = roundToTickSize(entryPrice + Math.max(effectiveTick * 2, rawTpDistance), effectiveTick);
  } else {
    if (slPrice <= entryPrice) slPrice = roundToTickSize(entryPrice + Math.max(effectiveTick, baseSlDistance), effectiveTick);
    if (tpPrice >= entryPrice) tpPrice = roundToTickSize(entryPrice - Math.max(effectiveTick * 2, rawTpDistance), effectiveTick);
  }

  const slDistance = Math.abs(entryPrice - slPrice) > 0 ? Math.abs(entryPrice - slPrice) : baseSlDistance;
  const tpDistance = Math.abs(tpPrice - entryPrice) > 0 ? Math.abs(tpPrice - entryPrice) : rawTpDistance;
  const slPct = Number(((slDistance / entryPrice) * 100).toFixed(2));
  const tpPct = Number(((tpDistance / entryPrice) * 100).toFixed(2));
  const rrRatio = Number((tpDistance / Math.max(slDistance, 1e-8)).toFixed(2));
  const tier = tpPct >= 0.92 ? 'STRONG_23PCT_RUNNER' : 'NORMAL_5_TO_8_USD_SCALP';

  // Auto-Profit Lock Triggers: When price reaches 55% of TP, lock SL at +25% of TP in profit!
  let trailActivationPrice = roundToTickSize(
    side === 'BUY' ? entryPrice + tpDistance * 0.55 : entryPrice - tpDistance * 0.55,
    effectiveTick
  );
  let trailLockPrice = roundToTickSize(
    side === 'BUY' ? entryPrice + tpDistance * 0.25 : entryPrice - tpDistance * 0.25,
    effectiveTick
  );

  if (side === 'BUY') {
    if (trailLockPrice <= entryPrice) trailLockPrice = roundToTickSize(entryPrice + effectiveTick, effectiveTick);
    if (trailActivationPrice <= trailLockPrice) trailActivationPrice = roundToTickSize(trailLockPrice + effectiveTick, effectiveTick);
  } else {
    if (trailLockPrice >= entryPrice) trailLockPrice = roundToTickSize(entryPrice - effectiveTick, effectiveTick);
    if (trailActivationPrice >= trailLockPrice) trailActivationPrice = roundToTickSize(trailLockPrice - effectiveTick, effectiveTick);
  }

  return {
    slPrice,
    tpPrice,
    slDistance,
    tpDistance,
    slPct,
    tpPct,
    rrRatio,
    tier,
    trailActivationPrice,
    trailLockPrice,
    nearestReversalWall: nearestReversalWall ? roundToTickSize(nearestReversalWall, effectiveTick) : null,
    blockingWallPrice,
    blockingWallDistPct,
  };
}

// ============================================================================
// TRUE REVERSAL ZONE STOP-LOSS & TAKE-PROFIT CALCULATOR (FRONT-RUN BUFFER)
// ============================================================================
export function findStructuralBracket(
  closedCandles: KlinePoint[],
  side: 'BUY' | 'SELL',
  entryPrice: number,
  atr: number,
  tickSize?: number
): { slPrice: number; tpPrice: number } {
  const effectiveTickSize =
    tickSize && tickSize > 0
      ? tickSize
      : entryPrice < 1
      ? 0.0001
      : entryPrice < 100
      ? 0.001
      : 0.01;
  const bracket = buildBulletproofBracket({
    closedCandles,
    side,
    entryPrice,
    atr,
    tickSize: effectiveTickSize,
  });
  return { slPrice: bracket.slPrice, tpPrice: bracket.tpPrice };
}

/**
 * FEE-ADJUSTED 6-SLOT HYBRID BRACKET ENGINE (2 Chopping 15%+ Net + 2 Normal 23%-40%+ + 2 Options Uncapped)
 * Accounts for Delta Exchange round-trip taker fees (0.12% move = ~3.0% ROE drag at 25x leverage).
 */
export function buildMasterSixSlotBracket(params: {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  closedCandles: KlinePoint[];
  atr: number;
  reason: string;
  tickSize?: number;
}): MasterSixSlotBracketPlan {
  const { symbol, side, entryPrice, closedCandles, atr, reason, tickSize } = params;
  const cleanSym = (symbol || '').toUpperCase().replace('USDT', 'USD').trim();
  const effectiveTick = tickSize && Number.isFinite(tickSize) && tickSize > 0
    ? tickSize
    : (entryPrice < 1 ? 0.0001 : entryPrice < 100 ? 0.001 : 0.01);
  const leverage = 25;
  const roundTripFeePct = 0.12; // 0.059% x 2 sides = ~0.12% price move = 3.0% ROE drag at 25x

  // 1. Glitch-Sanitized Swing High/Low for Exact Stop-Loss (protects against testnet freak wicks)
  const sanitized = (closedCandles || []).slice(-45).map((c) => {
    const bodyTop = Math.max(c.open, c.close);
    const bodyBot = Math.min(c.open, c.close);
    const isFreakHighSpike = bodyTop > 0 && c.high > bodyTop * 1.015;
    const isFreakLowSpike = bodyBot > 0 && c.low < bodyBot * 0.985;
    return {
      ...c,
      bodyTop,
      bodyBot,
      safeHigh: isFreakHighSpike ? bodyTop * 1.0008 : Math.min(c.high, bodyTop * 1.0045),
      safeLow: isFreakLowSpike ? bodyBot * 0.9992 : Math.max(c.low, bodyBot * 0.9955),
    };
  });

  const recent5 = sanitized.slice(-5);
  const swingLow5 = recent5.length > 0
    ? Math.min(...recent5.map((c) => c.safeLow))
    : entryPrice * 0.9940;
  const swingHigh5 = recent5.length > 0
    ? Math.max(...recent5.map((c) => c.safeHigh))
    : entryPrice * 1.0060;

  const adx = calcADX(closedCandles, 14);
  const lastBar = sanitized[sanitized.length - 1];
  const bodySize = lastBar ? lastBar.bodyTop - lastBar.bodyBot : 0;
  const candRange = lastBar ? Math.max(lastBar.safeHigh - lastBar.safeLow, 1e-8) : 1;
  const bodyRatio = bodySize / candRange;

  // Scan recent bars for opposing Candle-Body Reversal Walls in Chop zone [0.68%, 0.90%] & Runner zone [1.02%, 1.68%]
  const history = sanitized.length > 1 ? sanitized.slice(0, -1) : sanitized;
  const foundChopWalls: number[] = [];
  const foundRunnerWalls: number[] = [];

  for (let i = 1; i < history.length - 1; i++) {
    const currTop = history[i].bodyTop;
    const currBot = history[i].bodyBot;
    if (side === 'BUY') {
      if (currTop >= history[i - 1].bodyTop && currTop >= history[i + 1].bodyTop) {
        const dist = currTop - entryPrice;
        if (dist >= entryPrice * 0.0068 && dist <= entryPrice * 0.0090) {
          foundChopWalls.push(dist);
        }
        if (dist >= entryPrice * 0.0102 && dist <= entryPrice * 0.0168) {
          foundRunnerWalls.push(dist);
        }
      }
    } else {
      if (currBot <= history[i - 1].bodyBot && currBot <= history[i + 1].bodyBot) {
        const dist = entryPrice - currBot;
        if (dist >= entryPrice * 0.0068 && dist <= entryPrice * 0.0090) {
          foundChopWalls.push(dist);
        }
        if (dist >= entryPrice * 0.0102 && dist <= entryPrice * 0.0168) {
          foundRunnerWalls.push(dist);
        }
      }
    }
  }

  // Also inspect Bollinger Band extremes as structural walls when wide enough
  const bb = history.length >= 20 ? calcBollinger(history.map((k) => k.close), 20, 2.0) : null;
  if (bb && bb.widthPct >= 0.0080) {
    const bbDist = side === 'BUY' ? (bb.upper - entryPrice) : (entryPrice - bb.lower);
    if (bbDist >= entryPrice * 0.0068 && bbDist <= entryPrice * 0.0090) {
      foundChopWalls.push(bbDist);
    }
    if (bbDist >= entryPrice * 0.0102 && bbDist <= entryPrice * 0.0168) {
      foundRunnerWalls.push(bbDist);
    }
  }

  const nearestChopWallDist = foundChopWalls.length > 0
    ? Math.min(...foundChopWalls)
    : entryPrice * 0.0081; // Default 0.81% -> front-runs at 0.76% (19.0% Gross / 16.0% Net ROE)
  const farRunnerWallDist = foundRunnerWalls.length > 0
    ? Math.max(...foundRunnerWalls)
    : entryPrice * 0.0142; // Default 1.42% -> front-runs at 1.36% (34.0% Gross / 31.0% Net ROE)

  // Detect tight-box trap: multi-touch range ceiling/floor strictly inside [0.18%, 0.60%) with no Chop room (>= 0.68%)
  let blockingWallPrice: number | null = null;
  let blockingWallDistPct: number | null = null;
  const recentBox = history.slice(-35);
  if (recentBox.length >= 15 && foundChopWalls.length === 0 && foundRunnerWalls.length === 0) {
    if (side === 'BUY') {
      const boxMaxBody = Math.max(...recentBox.map((k) => k.bodyTop));
      const boxDistPct = (boxMaxBody - entryPrice) / (entryPrice || 1);
      const touchesNearTop = recentBox.filter((k) => Math.abs(k.bodyTop - boxMaxBody) <= entryPrice * 0.0020).length;
      if (boxDistPct >= 0.0018 && boxDistPct < 0.0060 && touchesNearTop >= 2) {
        blockingWallPrice = roundToTickSize(boxMaxBody, effectiveTick);
        blockingWallDistPct = Number((boxDistPct * 100).toFixed(2));
      }
    } else {
      const boxMinBody = Math.min(...recentBox.map((k) => k.bodyBot));
      const boxDistPct = (entryPrice - boxMinBody) / (entryPrice || 1);
      const touchesNearBot = recentBox.filter((k) => Math.abs(k.bodyBot - boxMinBody) <= entryPrice * 0.0020).length;
      if (boxDistPct >= 0.0018 && boxDistPct < 0.0060 && touchesNearBot >= 2) {
        blockingWallPrice = roundToTickSize(boxMinBody, effectiveTick);
        blockingWallDistPct = Number((boxDistPct * 100).toFixed(2));
      }
    }
  }

  // Classify: 23%–40%+ Normal/Strong Trend Setup vs 15%+ Net Chopping Setup
  // Major Price Action reversals & breakouts qualify even before lagging ADX catches up (when not boxed under a nearby chop ceiling/floor),
  // whereas EMA pullback signals strictly require trending ADX >= 20 so sideways chop stays in CHOP_15PCT_SEAT!
  const upperReason = (reason || '').toUpperCase();
  const isStrongPattern =
    upperReason.includes('PA_W_BOTTOM') ||
    upperReason.includes('PA_M_TOP') ||
    upperReason.includes('ENGULFING') ||
    upperReason.includes('MORNING_STAR') ||
    upperReason.includes('EVENING_STAR') ||
    upperReason.includes('INSIDE_BAR') ||
    upperReason.includes('BOS') ||
    upperReason.includes('BREAKOUT') ||
    upperReason.includes('BREAKDOWN');

  const isBoxedByNearbyChopWall = foundChopWalls.length > 0 && adx < 20;
  const qualifiesFor23To40Pct =
    ((adx >= 20) || (isStrongPattern && !isBoxedByNearbyChopWall)) &&
    bodyRatio >= 0.42;

  // Calculate Safe Stop-Loss (0.55% to 0.72% away behind 5-bar safe swing wick + 0.10% buffer)
  const rawSlDist =
    side === 'BUY'
      ? entryPrice - swingLow5 + entryPrice * 0.0010
      : swingHigh5 - entryPrice + entryPrice * 0.0010;

  const clampedSlDistance = Math.max(entryPrice * 0.0055, Math.min(rawSlDist, entryPrice * 0.0072));
  let slPrice = roundToTickSize(
    side === 'BUY' ? entryPrice - clampedSlDistance : entryPrice + clampedSlDistance,
    effectiveTick
  );
  if (side === 'BUY' && slPrice >= entryPrice) {
    slPrice = roundToTickSize(entryPrice - Math.max(effectiveTick, clampedSlDistance), effectiveTick);
  } else if (side === 'SELL' && slPrice <= entryPrice) {
    slPrice = roundToTickSize(entryPrice + Math.max(effectiveTick, clampedSlDistance), effectiveTick);
  }
  const slDistance = Math.abs(entryPrice - slPrice) || clampedSlDistance;
  const slPct = Number(((slDistance / entryPrice) * 100).toFixed(2));

  if (qualifiesFor23To40Pct) {
    // ========================================================================
    // BUCKET 2: NORMAL / STRONG TRADE -> 23% TO 40%+ ROE (AFTER FEES!)
    // At 25x leverage: 1.08% move = 27% Gross (24% Net after 0.12% fees)
    //                  1.64% move = 41% Gross (38% Net after 0.12% fees)
    // ========================================================================
    const frontRun = entryPrice * 0.0006;
    const rawRunnerTp = Math.max(
      entryPrice * 0.0108, // Minimum 27% Gross ROE (24.0% Net ROE after fees!)
      Math.min(farRunnerWallDist - frontRun, entryPrice * 0.0164) // Up to 41% Gross ROE (38.0% Net!)
    );

    let tpPrice = roundToTickSize(
      side === 'BUY' ? entryPrice + rawRunnerTp : entryPrice - rawRunnerTp,
      effectiveTick
    );
    if (Math.abs(tpPrice - entryPrice) < entryPrice * 0.0108) {
      tpPrice = roundToTickSize(
        side === 'BUY' ? entryPrice + entryPrice * 0.0108 + effectiveTick : entryPrice - (entryPrice * 0.0108 + effectiveTick),
        effectiveTick
      );
    }

    const actualTpDist = Math.abs(tpPrice - entryPrice);
    const tpPct = Number(((actualTpDist / entryPrice) * 100).toFixed(2));
    const grossRoePct = Number((tpPct * leverage).toFixed(1));
    const netRoeAfterFeesPct = Number(((tpPct - roundTripFeePct) * leverage).toFixed(1));
    const rrRatio = Number((actualTpDist / Math.max(slDistance, 1e-8)).toFixed(2));

    // Step 1 Fee-Recovery Lock: At +0.48% (+12% Gross ROE), lock SL at +0.18% (+4.5% Gross ROE -> covers fees!)
    let beTrigger = roundToTickSize(
      side === 'BUY' ? entryPrice * 1.0048 : entryPrice * 0.9952,
      effectiveTick
    );
    let beLock = roundToTickSize(
      side === 'BUY' ? entryPrice * 1.0018 : entryPrice * 0.9982,
      effectiveTick
    );
    if (side === 'BUY') {
      if (beLock <= entryPrice) beLock = roundToTickSize(entryPrice + effectiveTick, effectiveTick);
      if (beTrigger <= beLock) beTrigger = roundToTickSize(beLock + effectiveTick, effectiveTick);
    } else {
      if (beLock >= entryPrice) beLock = roundToTickSize(entryPrice - effectiveTick, effectiveTick);
      if (beTrigger >= beLock) beTrigger = roundToTickSize(beLock - effectiveTick, effectiveTick);
    }

    // Step 2 Runner Lock: At +0.96% (+24% Gross / +21% Net ROE), lock SL at +0.80% (+20% Gross / +17% Net ROE) while chasing 40% ROE!
    let run23Trigger = roundToTickSize(
      side === 'BUY' ? entryPrice * 1.0096 : entryPrice * 0.9904,
      effectiveTick
    );
    let run18Lock = roundToTickSize(
      side === 'BUY' ? entryPrice * 1.0080 : entryPrice * 0.9920,
      effectiveTick
    );
    if (side === 'BUY') {
      if (run18Lock <= beLock) run18Lock = roundToTickSize(beLock + effectiveTick, effectiveTick);
      if (run23Trigger <= run18Lock) run23Trigger = roundToTickSize(run18Lock + effectiveTick, effectiveTick);
    } else {
      if (run18Lock >= beLock) run18Lock = roundToTickSize(beLock - effectiveTick, effectiveTick);
      if (run23Trigger >= run18Lock) run23Trigger = roundToTickSize(run18Lock - effectiveTick, effectiveTick);
    }

    const nearestWallAbs = foundRunnerWalls.length > 0
      ? roundToTickSize(side === 'BUY' ? entryPrice + farRunnerWallDist : entryPrice - farRunnerWallDist, effectiveTick)
      : null;

    return {
      bucket: 'NORMAL_23_TO_40PCT_SEAT',
      tierLabel: `NORMAL_RUNNER_${netRoeAfterFeesPct}PCT_NET_ROE`,
      leverage,
      entryPrice,
      slPrice,
      tpPrice,
      slPct,
      tpPct,
      grossRoePct,
      netRoeAfterFeesPct,
      maxRiskUSD: 3.80,
      expectedProfitUSD: Number(Math.max(10.00, (3.80 * rrRatio) - 0.85).toFixed(2)),
      rrRatio,
      breakevenPlusFeeTriggerPrice: beTrigger,
      breakevenPlusFeeLockPrice: beLock,
      runner23PctTriggerPrice: run23Trigger,
      runner18PctLockPrice: run18Lock,
      canTriggerOptionSeat: cleanSym === 'BTCUSD' || cleanSym === 'ETHUSD',
      nearestReversalWall: nearestWallAbs,
      blockingWallPrice,
      blockingWallDistPct,
    };
  } else {
    // ========================================================================
    // BUCKET 1: CHOPPING TRADE -> 15%+ NET ROE AFTER FEES!
    // At 25x leverage: 0.72% move = 18.0% Gross ROE -> 15.0% NET ROE after 0.12% fees!
    // Up to 0.88% move = 22.0% Gross ROE -> 19.0% NET ROE (~$5.50-$7.50 USD Net)
    // ========================================================================
    const frontRun = entryPrice * 0.0005;
    const rawChopTp = Math.max(
      entryPrice * 0.0072, // Minimum 18% Gross ROE = 15.0% Net ROE after fees!
      Math.min(nearestChopWallDist - frontRun, entryPrice * 0.0088) // Up to 22% Gross (19% Net ROE)
    );

    let tpPrice = roundToTickSize(
      side === 'BUY' ? entryPrice + rawChopTp : entryPrice - rawChopTp,
      effectiveTick
    );
    if (Math.abs(tpPrice - entryPrice) < entryPrice * 0.0072) {
      tpPrice = roundToTickSize(
        side === 'BUY' ? entryPrice + entryPrice * 0.0072 + effectiveTick : entryPrice - (entryPrice * 0.0072 + effectiveTick),
        effectiveTick
      );
    }

    const actualTpDist = Math.abs(tpPrice - entryPrice);
    const tpPct = Number(((actualTpDist / entryPrice) * 100).toFixed(2));
    const grossRoePct = Number((tpPct * leverage).toFixed(1));
    const netRoeAfterFeesPct = Number(((tpPct - roundTripFeePct) * leverage).toFixed(1));
    const rrRatio = Number((actualTpDist / Math.max(slDistance, 1e-8)).toFixed(2));

    // Step 1 Fee-Recovery Lock: At +0.44% (+11% Gross ROE), lock SL at +0.18% (+4.5% Gross ROE -> 100% Fee Recovered + Green!)
    let beTrigger = roundToTickSize(
      side === 'BUY' ? entryPrice * 1.0044 : entryPrice * 0.9956,
      effectiveTick
    );
    let beLock = roundToTickSize(
      side === 'BUY' ? entryPrice * 1.0018 : entryPrice * 0.9982,
      effectiveTick
    );
    if (side === 'BUY') {
      if (beLock <= entryPrice) beLock = roundToTickSize(entryPrice + effectiveTick, effectiveTick);
      if (beTrigger <= beLock) beTrigger = roundToTickSize(beLock + effectiveTick, effectiveTick);
    } else {
      if (beLock >= entryPrice) beLock = roundToTickSize(entryPrice - effectiveTick, effectiveTick);
      if (beTrigger >= beLock) beTrigger = roundToTickSize(beLock - effectiveTick, effectiveTick);
    }

    const nearestWallAbs = foundChopWalls.length > 0
      ? roundToTickSize(side === 'BUY' ? entryPrice + nearestChopWallDist : entryPrice - nearestChopWallDist, effectiveTick)
      : null;

    return {
      bucket: 'CHOP_15PCT_SEAT',
      tierLabel: `CHOP_FEE_COVERED_${netRoeAfterFeesPct}PCT_NET_ROE`,
      leverage,
      entryPrice,
      slPrice,
      tpPrice,
      slPct,
      tpPct,
      grossRoePct,
      netRoeAfterFeesPct,
      maxRiskUSD: 3.20,
      expectedProfitUSD: Number(Math.max(5.50, (3.20 * rrRatio) - 0.85).toFixed(2)),
      rrRatio,
      breakevenPlusFeeTriggerPrice: beTrigger,
      breakevenPlusFeeLockPrice: beLock,
      runner23PctTriggerPrice: tpPrice,
      runner18PctLockPrice: beLock,
      canTriggerOptionSeat: false,
      nearestReversalWall: nearestWallAbs,
      blockingWallPrice,
      blockingWallDistPct,
    };
  }
}

/**
 * MASTER 3-BUCKET CLASSIFIER & BRACKET BUILDER (2 Chop + 2 Normal 23%-40%+ + 2 Options = 6-Slot Architecture)
 */
export function buildThreeBucketTradePlan(params: {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  closedCandles: KlinePoint[];
  atr: number;
  rsi: number;
  reason: string;
  tickSize?: number;
}): ThreeBucketTradePlan {
  const plan = buildMasterSixSlotBracket(params);
  return {
    bucket: plan.bucket,
    tierLabel: plan.tierLabel,
    targetRoePct: plan.netRoeAfterFeesPct,
    grossRoePct: plan.grossRoePct,
    netRoeAfterFeesPct: plan.netRoeAfterFeesPct,
    targetProfitUSD: plan.expectedProfitUSD,
    maxRiskUSD: plan.maxRiskUSD,
    leverage: plan.leverage,
    slPrice: plan.slPrice,
    tpPrice: plan.tpPrice,
    trailActivationPrice: plan.breakevenPlusFeeTriggerPrice,
    trailLockPrice: plan.breakevenPlusFeeLockPrice,
    breakevenPlusFeeTriggerPrice: plan.breakevenPlusFeeTriggerPrice,
    breakevenPlusFeeLockPrice: plan.breakevenPlusFeeLockPrice,
    runner23PctTriggerPrice: plan.runner23PctTriggerPrice,
    runner18PctLockPrice: plan.runner18PctLockPrice,
    rrRatio: plan.rrRatio,
    canAlsoTriggerOption: plan.canTriggerOptionSeat,
    reversalWallPrice: plan.nearestReversalWall ?? null,
    blockingWallPrice: plan.blockingWallPrice ?? null,
    blockingWallDistPct: plan.blockingWallDistPct ?? null,
  };
}

export interface PriceActionPatternResult {
  matched: boolean;
  side: 'BUY' | 'SELL' | 'WAIT';
  patternName: string;
  confidence: number;
  isMajorReversal: boolean; // True for W-Bottom / M-Top / Pin-Bar at extremes (bypasses lagging EMA50!)
}

/**
 * NON-OVERLAPPING PRICE ACTION & CHART PATTERN DETECTOR
 * Uses a strict Priority Waterfall (`if / else if`) so patterns NEVER overlap or fire duplicate signals!
 */
export function detectNonOverlappingPriceAction(
  closed15m: KlinePoint[],
  ema9: number,
  ema20: number,
  atr: number,
  rsi: number,
  prevRsi: number,
  bb: { upper: number; lower: number; middle: number }
): PriceActionPatternResult {
  if (closed15m.length < 30) {
    return { matched: false, side: 'WAIT', patternName: 'NONE', confidence: 0, isMajorReversal: false };
  }

  const c = closed15m[closed15m.length - 1];     // Last closed candle
  const prev = closed15m[closed15m.length - 2];  // 1 bar ago
  const prev2 = closed15m[closed15m.length - 3]; // 2 bars ago

  // Sanitize wicks against Testnet glitches (max 0.45% wick extension trusted)
  const cBodyTop = Math.max(c.open, c.close);
  const cBodyBot = Math.min(c.open, c.close);
  const cHigh = Math.min(c.high, cBodyTop * 1.0045);
  const cLow = Math.max(c.low, cBodyBot * 0.9955);

  const bodySize = cBodyTop - cBodyBot;
  const candRange = Math.max(cHigh - cLow, 1e-8);
  const upperWick = cHigh - cBodyTop;
  const lowerWick = cBodyBot - cLow;

  const isGreen = c.close > c.open;
  const isRed = c.close < c.open;
  const prevIsGreen = prev.close > prev.open;
  const prevIsRed = prev.close < prev.open;
  const prevBodyTop = Math.max(prev.open, prev.close);
  const prevBodyBot = Math.min(prev.open, prev.close);
  const prevBodySize = prevBodyTop - prevBodyBot;

  // Scan last 24 closed candles (excluding last 2) for W-Bottom & M-Top structure
  const historyWindow = closed15m.slice(-26, -2);
  let swingLow1 = Infinity;
  let swingLow1Idx = -1;
  let swingHigh1 = -Infinity;
  let swingHigh1Idx = -1;

  for (let i = 1; i < historyWindow.length - 1; i++) {
    const k = historyWindow[i];
    if (k.low <= historyWindow[i - 1].low && k.low <= historyWindow[i + 1].low) {
      if (k.low < swingLow1) {
        swingLow1 = k.low;
        swingLow1Idx = i;
      }
    }
    if (k.high >= historyWindow[i - 1].high && k.high >= historyWindow[i + 1].high) {
      if (k.high > swingHigh1) {
        swingHigh1 = k.high;
        swingHigh1Idx = i;
      }
    }
  }

  // Recent 3-bar low/high (Leg 2 of W or M)
  const recentLow2 = Math.min(cLow, prev.low, prev2.low);
  const recentHigh2 = Math.max(cHigh, prev.high, prev2.high);

  // Check if there was a middle neckline peak (for W) or valley (for M)
  let wNecklineHigh = -Infinity;
  if (swingLow1Idx !== -1 && swingLow1Idx < historyWindow.length - 3) {
    for (let j = swingLow1Idx + 1; j < historyWindow.length; j++) {
      if (historyWindow[j].high > wNecklineHigh) wNecklineHigh = historyWindow[j].high;
    }
  }

  let mNecklineLow = Infinity;
  if (swingHigh1Idx !== -1 && swingHigh1Idx < historyWindow.length - 3) {
    for (let j = swingHigh1Idx + 1; j < historyWindow.length; j++) {
      if (historyWindow[j].low < mNecklineLow) mNecklineLow = historyWindow[j].low;
    }
  }

  // ==========================================================================
  // STRICT PRIORITY WATERFALL (ONLY 1 PATTERN CAN MATCH — ZERO OVERLAP!)
  // ==========================================================================

  // PRIORITY 1A: W-PATTERN (DOUBLE BOTTOM / HIGHER-LOW) NECKLINE RECLAIM BUY
  // Leg 2 holds near or slightly above Leg 1 (within 0.40%), separated by a bounce, and current green candle reclaims EMA 9 & prev.high!
  const isWPatternBuy =
    swingLow1 < Infinity &&
    recentLow2 >= swingLow1 * 0.9965 && // Holds support (Double Bottom or Higher Low)
    recentLow2 <= swingLow1 * 1.0055 && // Tested near the floor
    wNecklineHigh > swingLow1 + atr * 0.80 && // Valid middle peak of the 'W'
    isGreen &&
    bodySize >= candRange * 0.50 &&
    c.close > ema9 &&
    c.close > prev.high &&
    rsi <= 62;

  if (isWPatternBuy) {
    return {
      matched: true,
      side: 'BUY',
      patternName: 'PA_W_BOTTOM_REVERSAL_BUY',
      confidence: 94,
      isMajorReversal: true,
    };
  }

  // PRIORITY 1B: M-PATTERN (DOUBLE TOP / LOWER-HIGH) BREAKDOWN SELL
  // Leg 2 rejects near or slightly below Leg 1 (within 0.40%) and current red candle breaks below prev.low!
  const isMPatternSell =
    swingHigh1 > -Infinity &&
    recentHigh2 <= swingHigh1 * 1.0035 && // Rejects resistance ceiling
    recentHigh2 >= swingHigh1 * 0.9945 && // Tested near the top
    mNecklineLow < swingHigh1 - atr * 0.80 && // Valid middle valley of the 'M'
    isRed &&
    bodySize >= candRange * 0.50 &&
    (c.close < prevBodyBot || c.close < prev.low) &&
    rsi >= 38;

  if (isMPatternSell) {
    return {
      matched: true,
      side: 'SELL',
      patternName: 'PA_M_TOP_REVERSAL_SELL',
      confidence: 94,
      isMajorReversal: true,
    };
  }

  // PRIORITY 2A: BULLISH ENGULFING / MORNING STAR AT SUPPORT FLOOR
  const nearSupport = cLow <= swingLow1 * 1.0035 || cLow <= bb.lower * 1.0015 || prev.low <= bb.lower * 1.0015;
  const isBullEngulfing =
    nearSupport &&
    isGreen &&
    prevIsRed &&
    bodySize >= candRange * 0.55 &&
    c.close > prevBodyTop &&
    c.close > ema9 &&
    (rsi <= 48 || prevRsi <= 40);

  if (isBullEngulfing) {
    return {
      matched: true,
      side: 'BUY',
      patternName: 'PA_BULLISH_ENGULFING_SUPPORT_BUY',
      confidence: 91,
      isMajorReversal: true,
    };
  }

  // PRIORITY 2B: BEARISH ENGULFING / EVENING STAR AT RESISTANCE CEILING
  const nearResistance = cHigh >= swingHigh1 * 0.9965 || cHigh >= bb.upper * 0.9985 || prev.high >= bb.upper * 0.9985;
  const isBearEngulfing =
    nearResistance &&
    isRed &&
    prevIsGreen &&
    bodySize >= candRange * 0.55 &&
    c.close < prevBodyBot &&
    (rsi >= 52 || prevRsi >= 60);

  if (isBearEngulfing) {
    return {
      matched: true,
      side: 'SELL',
      patternName: 'PA_BEARISH_ENGULFING_RESISTANCE_SELL',
      confidence: 91,
      isMajorReversal: true,
    };
  }

  // PRIORITY 3A: HAMMER / BULLISH PIN-BAR REJECTION (Long lower wick >= 50% of candle range)
  const isHammerBuy =
    (nearSupport || (c.close > ema20 && cLow <= ema20 * 1.0015)) &&
    lowerWick >= candRange * 0.50 &&
    upperWick <= candRange * 0.20 &&
    c.close > ema9 &&
    isGreen &&
    rsi <= 60;

  if (isHammerBuy) {
    return {
      matched: true,
      side: 'BUY',
      patternName: 'PA_HAMMER_PINBAR_BUY',
      confidence: 89,
      isMajorReversal: nearSupport,
    };
  }

  // PRIORITY 3B: SHOOTING STAR / BEARISH PIN-BAR REJECTION (Long upper wick >= 50% of candle range)
  const isShootingStarSell =
    (nearResistance || (c.close < ema20 && cHigh >= ema20 * 0.9985)) &&
    upperWick >= candRange * 0.50 &&
    lowerWick <= candRange * 0.20 &&
    c.close < ema9 &&
    isRed &&
    rsi >= 40;

  if (isShootingStarSell) {
    return {
      matched: true,
      side: 'SELL',
      patternName: 'PA_SHOOTING_STAR_PINBAR_SELL',
      confidence: 89,
      isMajorReversal: nearResistance,
    };
  }

  // PRIORITY 4: 3-BAR MORNING STAR (BUY) & EVENING STAR (SELL)
  const prev2Body = Math.abs(prev2.close - prev2.open);
  const isMorningStar =
    nearSupport &&
    prev2.close < prev2.open &&
    prev2Body >= atr * 0.55 &&
    prevBodySize <= prev2Body * 0.45 && // Small indecision star candle in middle
    isGreen &&
    c.close > (prev2.open + prev2.close) / 2 &&
    c.close > ema9;

  if (isMorningStar) {
    return {
      matched: true,
      side: 'BUY',
      patternName: 'PA_MORNING_STAR_REVERSAL_BUY',
      confidence: 90,
      isMajorReversal: true,
    };
  }

  const isEveningStar =
    nearResistance &&
    prev2.close > prev2.open &&
    prev2Body >= atr * 0.55 &&
    prevBodySize <= prev2Body * 0.45 && // Small indecision star candle at top
    isRed &&
    c.close < (prev2.open + prev2.close) / 2;

  if (isEveningStar) {
    return {
      matched: true,
      side: 'SELL',
      patternName: 'PA_EVENING_STAR_REVERSAL_SELL',
      confidence: 90,
      isMajorReversal: true,
    };
  }

  return { matched: false, side: 'WAIT', patternName: 'NONE', confidence: 0, isMajorReversal: false };
}

export class FifteenMinCandleCloseGate {
  // Stores the last evaluated closed 15m candle timestamp per (port + symbol)
  private static evaluatedCandleMap: Map<string, number> = new Map();

  /**
   * Normalizes any timestamp (seconds or ms) to milliseconds
   */
  public static toMs(ts: number): number {
    return ts < 1e12 ? ts * 1000 : ts;
  }

  /**
   * Resets evaluated candle locks (used in deterministic unit tests)
   */
  public static resetForTesting(): void {
    this.evaluatedCandleMap.clear();
  }

  /**
   * Read-only peek of the newest closed 15m candle open timestamp (ms) without locking
   */
  public static peekLastClosedCandle(rawCandles15m: KlinePoint[], nowMs: number = Date.now()): {
    closedCandles: KlinePoint[];
    closedCandle: KlinePoint | null;
    closedCandleOpenMs: number;
    closedCandleEndMs: number;
  } {
    if (!rawCandles15m || rawCandles15m.length < 2) {
      return { closedCandles: [], closedCandle: null, closedCandleOpenMs: 0, closedCandleEndMs: 0 };
    }
    const FIFTEEN_MIN_MS = 15 * 60 * 1000;
    const sorted = [...rawCandles15m].sort((a, b) => this.toMs(a.time) - this.toMs(b.time));
    const lastBar = sorted[sorted.length - 1];
    const lastBarOpenMs = this.toMs(lastBar.time);
    const isLastBarStillForming = nowMs < lastBarOpenMs + FIFTEEN_MIN_MS - 2000;
    const closedCandles = isLastBarStillForming ? sorted.slice(0, -1) : sorted;
    const justClosedCandle = closedCandles[closedCandles.length - 1] || null;
    const closedCandleOpenMs = justClosedCandle ? this.toMs(justClosedCandle.time) : 0;
    return {
      closedCandles,
      closedCandle: justClosedCandle,
      closedCandleOpenMs,
      closedCandleEndMs: closedCandleOpenMs > 0 ? closedCandleOpenMs + FIFTEEN_MIN_MS : 0,
    };
  }

  /**
   * Extracts the true last CLOSED 15m candle and verifies:
   * 1. We haven't already evaluated this exact 15m candle for this port+symbol.
   * 2. The candle JUST closed (preventing mid-candle or 10-minute-late stale entries!).
   */
  public static getNewlyClosed15mCandles(params: {
    port: number;
    symbol: string;
    rawCandles15m: KlinePoint[];
    nowMs?: number;
  }): {
    shouldEvaluate: boolean;
    closedCandles: KlinePoint[];
    closedCandleTimeMs: number;
    skipReason?: string;
  } {
    const { port, symbol, rawCandles15m, nowMs = Date.now() } = params;
    if (!rawCandles15m || rawCandles15m.length < 35) {
      return {
        shouldEvaluate: false,
        closedCandles: [],
        closedCandleTimeMs: 0,
        skipReason: 'INSUFFICIENT_CANDLES',
      };
    }

    // Sort ascending by normalized ms timestamp just in case Delta/Gate API returned descending order
    const sorted = [...rawCandles15m].sort((a, b) => this.toMs(a.time) - this.toMs(b.time));

    const lastBar = sorted[sorted.length - 1];
    const lastBarOpenMs = this.toMs(lastBar.time);
    const FIFTEEN_MIN_MS = 15 * 60 * 1000;

    // Determine if the last bar in the array is still forming (unclosed)
    // A 15m candle opened at `lastBarOpenMs` closes at `lastBarOpenMs + 15m`
    const isLastBarStillForming = nowMs < lastBarOpenMs + FIFTEEN_MIN_MS - 2000;

    const closedCandles = isLastBarStillForming ? sorted.slice(0, -1) : sorted;
    const justClosedCandle = closedCandles[closedCandles.length - 1];
    if (!justClosedCandle) {
      return {
        shouldEvaluate: false,
        closedCandles: [],
        closedCandleTimeMs: 0,
        skipReason: 'NO_CLOSED_CANDLE',
      };
    }

    const closedCandleOpenMs = this.toMs(justClosedCandle.time);
    const closedCandleEndMs = closedCandleOpenMs + FIFTEEN_MIN_MS;

    // RULE 1: ONCE-PER-15M-CANDLE MEMORY LOCK
    // If we already made a decision (BUY, SELL, or WAIT) on this 15m candle, DO NOT evaluate again until the next 15m candle closes!
    const cleanSym = (symbol || '').toUpperCase().trim();
    const key = `${port}:${cleanSym}`;
    const lastEvaluatedMs = this.evaluatedCandleMap.get(key) || 0;

    if (lastEvaluatedMs === closedCandleOpenMs) {
      return {
        shouldEvaluate: false,
        closedCandles,
        closedCandleTimeMs: closedCandleOpenMs,
        skipReason: `WAITING_FOR_NEXT_15M_CANDLE_CLOSE (Already decided on candle ${new Date(
          closedCandleOpenMs
        ).toISOString()})`,
      };
    }

    // RULE 2: FRESH CANDLE-CLOSE WINDOW (MAX 90 SECONDS AFTER :00, :15, :30, :45)
    // Prevents entering 8 minutes late in the middle of the next candle if the bot was restarted mid-candle!
    const msSinceCandleClosed = nowMs - closedCandleEndMs;
    if (msSinceCandleClosed > 90 * 1000) {
      // Lock this candle as seen so we wait cleanly for the next :00 / :15 / :30 / :45 close!
      this.evaluatedCandleMap.set(key, closedCandleOpenMs);
      return {
        shouldEvaluate: false,
        closedCandles,
        closedCandleTimeMs: closedCandleOpenMs,
        skipReason: `MID_CANDLE_LATE_ENTRY_BLOCKED (${Math.round(
          msSinceCandleClosed / 1000
        )}s past 15m close — waiting for next 15m boundary!)`,
      };
    }

    // Lock this 15m candle timestamp so it is evaluated EXACTLY ONCE right at the close!
    this.evaluatedCandleMap.set(key, closedCandleOpenMs);

    return {
      shouldEvaluate: true,
      closedCandles,
      closedCandleTimeMs: closedCandleOpenMs,
    };
  }
}

// ============================================================================
// MASTER EVALUATOR: RUNS PURE YOUTUBE VIDEO RULES ON CLOSED CANDLES ONLY
// ============================================================================
export function evaluateStrategyForPort(
  portOrParams:
    | number
    | string
    | {
        port: number;
        symbol: string;
        candles15m: KlinePoint[];
        candles5m?: KlinePoint[];
        openOptionSlots?: number;
        nowMs?: number;
      },
  symbolArg?: string,
  candles15mArg?: KlinePoint[],
  candles5mArg?: KlinePoint[],
  openOptionSlotsArg?: number,
  nowMsArg?: number
): VideoStrategySignal {
  let port: number;
  let symbol: string;
  let candles15m: KlinePoint[];
  let candles5m: KlinePoint[] | undefined;
  let openOptionSlots: number = 0;
  let nowMs: number | undefined;

  if (typeof portOrParams === 'object' && portOrParams !== null && 'candles15m' in portOrParams) {
    port = typeof portOrParams.port === 'string' ? parseInt(portOrParams.port, 10) : portOrParams.port;
    symbol = portOrParams.symbol;
    candles15m = portOrParams.candles15m || [];
    candles5m = portOrParams.candles5m;
    openOptionSlots = portOrParams.openOptionSlots || 0;
    nowMs = portOrParams.nowMs;
  } else {
    port = typeof portOrParams === 'string' ? parseInt(portOrParams, 10) : Number(portOrParams || 3005);
    symbol = symbolArg || 'BTCUSD';
    candles15m = candles15mArg || [];
    candles5m = candles5mArg;
    openOptionSlots = openOptionSlotsArg || 0;
    nowMs = nowMsArg;
  }

  const gate = FifteenMinCandleCloseGate.getNewlyClosed15mCandles({
    port,
    symbol,
    rawCandles15m: candles15m,
    nowMs,
  });

  if (!gate.shouldEvaluate) {
    return {
      action: 'WAIT',
      signal: null,
      confidence: 0,
      confidenceScore: 0,
      strategyName: `Port-${port}-15mCloseGate`,
      port,
      entryPrice: candles15m[candles15m.length - 1]?.close || 0,
      structuralSlPrice: 0,
      customSL: 0,
      structuralTpPrice: 0,
      customTP: 0,
      reason: gate.skipReason || 'WAITING_FOR_15M_CANDLE_END',
      reasons: [gate.skipReason || 'WAITING_FOR_15M_CANDLE_END'],
      closedCandleTime: gate.closedCandleTimeMs,
    };
  }

  const closed15m = gate.closedCandles;
  const c = closed15m[closed15m.length - 1];
  const prev = closed15m[closed15m.length - 2];
  const prev2 = closed15m[closed15m.length - 3];

  if (!c || !prev || !prev2 || closed15m.length < 55) {
    return {
      action: 'WAIT',
      signal: null,
      confidence: 0,
      confidenceScore: 0,
      strategyName: `Port-${port}`,
      port,
      entryPrice: c?.close || 0,
      structuralSlPrice: 0,
      customSL: 0,
      structuralTpPrice: 0,
      customTP: 0,
      reason: 'INSUFFICIENT_CLOSED_CANDLES',
      reasons: ['INSUFFICIENT_CLOSED_CANDLES'],
      closedCandleTime: c?.time || 0,
    };
  }

  const closes = closed15m.map((k) => k.close);
  const ema5Arr = calcEMA(closes, 5);
  const ema9Arr = calcEMA(closes, 9);
  const ema20Arr = calcEMA(closes, 20);
  const ema50Arr = calcEMA(closes, 50);

  const ema5 = ema5Arr[ema5Arr.length - 1];
  const prevEma5 = ema5Arr[ema5Arr.length - 2];
  const ema9 = ema9Arr[ema9Arr.length - 1];
  const ema20 = ema20Arr[ema20Arr.length - 1];
  const ema50 = ema50Arr[ema50Arr.length - 1];

  const atr = calcATR(closed15m, 14);
  const rsi = calcRSI(closes, 14);
  const prevRsi = calcRSI(closes.slice(0, -1), 14);
  const vwap = calcVWAP(closed15m, 32);
  const bb = calcBollinger(closes, 20, 2.0);

  const isGreen = c.close > c.open;
  const isRed = c.close < c.open;
  const bodySize = Math.abs(c.close - c.open);
  const candRange = Math.max(c.high - c.low, 1e-8);

  // Macro Trend Backbone + Anti-Overextension (User Mandate: Fast Structure & V-Bottom Reversal)
  // 1. Fast Bullish Trend OR Bottom V-Reversal (Does NOT wait for lagging EMA 50!)
  const isFastBullish =
    (c.close > ema20 && ema9 >= ema20 * 0.9990) || // Confirmed above EMA 20
    (c.close > ema9 && isGreen && prev.close > prev.open && rsi <= 62 && c.close > prev.high); // 2-bar V-Bottom Reversal off lows!

  // 2. Fast Bearish Trend (STRICTLY FORBIDS shorting at oversold bottoms or when price is reclaiming EMA 9!)
  const distBelowEma20Pct = (ema20 - c.close) / c.close;
  const isFastBearish =
    c.close < ema20 &&
    c.close < ema9 &&
    ema9 <= ema20 * 1.0010 &&
    rsi >= 38 && // NEVER short when RSI < 38 (oversold floor)
    distBelowEma20Pct <= 0.0055; // NEVER short if price has already dumped >0.55% below EMA 20!

  const bullTrend = isFastBullish;
  const bearTrend = isFastBearish;

  // Balanced Overbought & Oversold filters (fair treatment: no premature BUY blocking on momentum)
  const notOverbought = c.close <= bb.upper * 1.002 && rsi <= 72;
  const notOversold = c.close >= bb.lower * 0.998 && rsi >= 28;

  let action: 'BUY' | 'SELL' | 'WAIT' = 'WAIT';
  let strategyName = 'Masterclass Hybrid V6';
  let reason = 'NO_CONFLUENCE_ON_CLOSED_CANDLE';

  switch (port) {
    case 3001: // System 3001 (Zero-Lag Trend Reclaim & SMC Master)
      strategyName = '3001-ZeroLag-TrendReclaim-Master';
      if (bullTrend && notOverbought && (c.low <= ema9 * 1.0015 || c.low <= ema20 * 1.0018) && isGreen && c.close > prev.high && c.close > ema9) {
        action = 'BUY';
        reason = 'ZEROLAG_EMA_PULLBACK_RECLAIM_BUY';
      } else if (bearTrend && notOversold && (c.high >= ema9 * 0.9985 || c.high >= ema20 * 0.9982) && isRed && c.close < prev.low && c.close < ema9) {
        action = 'SELL';
        reason = 'ZEROLAG_EMA_PULLBACK_REJECT_SELL';
      }
      break;

    case 3002: // Brad Goh (Mind Math Money): EMA 20/50 Pullback + Break of Structure
      strategyName = '3002-BradGoh-Pullback-BOS';
      if (bullTrend && notOverbought && (c.low <= ema20 * 1.002 || prev.low <= ema20 * 1.002) && isGreen && c.close > prev.high && c.close > ema9) {
        action = 'BUY';
        reason = 'BRAD_GOH_EMA20_PULLBACK_RECLAIM_BUY';
      } else if (bearTrend && notOversold && (c.high >= ema20 * 0.998 || prev.high >= ema20 * 0.998) && isRed && c.close < prev.low && c.close < ema9) {
        action = 'SELL';
        reason = 'BRAD_GOH_EMA20_PULLBACK_REJECT_SELL';
      }
      break;

    case 3003: // TradingLab: RSI Momentum Shift + 5 EMA / 9 EMA Reversal
      strategyName = '3003-TradingLab-5EMA-Sniper';
      if (prev.high < prevEma5 && prevRsi <= 38 && isGreen && c.close > prev.high && c.close > ema9) {
        action = 'BUY';
        reason = 'SUBASISH_5EMA_ALERT_BOTTOM_BUY';
      } else if (prev.low > prevEma5 && prevRsi >= 62 && isRed && c.close < prev.low && c.close < ema9) {
        action = 'SELL';
        reason = 'SUBASISH_5EMA_ALERT_TOP_SELL';
      }
      break;

    case 3004: // Fractal Flow: Inside Bar Breakout + Volume/Body Displacement
      strategyName = '3004-Ghanshyam-InsideBar-Blast';
      {
        const isInsideBar = prev.high <= prev2.high && prev.low >= prev2.low;
        if (bullTrend && notOverbought && isInsideBar && isGreen && c.close > prev.high && bodySize >= candRange * 0.50) {
          action = 'BUY';
          reason = 'INSIDE_BAR_MOTHER_CANDLE_BREAKOUT_BUY';
        } else if (bearTrend && notOversold && isInsideBar && isRed && c.close < prev.low && bodySize >= candRange * 0.50) {
          action = 'SELL';
          reason = 'INSIDE_BAR_MOTHER_CANDLE_BREAKDOWN_SELL';
        }
      }
      break;

    case 3008: // Solano VWAP + EMA 20 Institutional Bounce
      strategyName = '3008-Institutional-VWAP-Bounce';
      if (bullTrend && c.close > vwap && (c.low <= vwap * 1.002 || c.low <= ema20 * 1.002) && isGreen && c.close > prev.high) {
        action = 'BUY';
        reason = 'INSTITUTIONAL_VWAP_EMA20_BOUNCE_BUY';
      } else if (bearTrend && c.close < vwap && (c.high >= vwap * 0.998 || c.high >= ema20 * 0.998) && isRed && c.close < prev.low) {
        action = 'SELL';
        reason = 'INSTITUTIONAL_VWAP_EMA20_REJECT_SELL';
      }
      break;

    case 3010: // Wide Sideways Bollinger Boundary Sniper (Low Risk $2.85 / High Reward $5.25)
      strategyName = '3010-WideRange-Bollinger-Sniper';
      if (bb.widthPct >= 0.0090) {
        if ((prev.low <= bb.lower * 1.001 || c.low <= bb.lower * 1.001) && rsi <= 40 && isGreen && c.close > bb.lower && c.close > prev.high) {
          action = 'BUY';
          reason = 'WIDE_RANGE_LOWER_BB_BOUNCE_BUY';
        } else if ((prev.high >= bb.upper * 0.999 || c.high >= bb.upper * 0.999) && rsi >= 60 && isRed && c.close < bb.upper && c.close < prev.low) {
          action = 'SELL';
          reason = 'WIDE_RANGE_UPPER_BB_REJECT_SELL';
        }
      }
      break;

    case 3005: // Master Port 3005 (All-in-One V6 Hybrid: Pure Pullback Rejections Near EMA 9/20/VWAP)
    default:
      strategyName = '3005-Legends-V6-Master-Hybrid';
      {
        // Balanced Over-extension guards
        const isNotOverExtendedShort = ((ema20 - c.close) / c.close) <= 0.0055;
        const isNotOverExtendedLong = ((c.close - ema20) / c.close) <= 0.0055;

        // PULLBACK BUY: Price tested EMA 9 or EMA 20 within 0.25%, rejected upward, closed green above prev.high & ema9
        const touchedEmaBuy = (c.low <= ema9 * 1.0025 || prev.low <= ema9 * 1.0025 || c.low <= ema20 * 1.0025 || prev.low <= ema20 * 1.0025);
        const pullbackBuy = bullTrend && notOverbought && touchedEmaBuy && isGreen && c.close > ema9 && c.close > prev.high && isNotOverExtendedLong;

        // V-BOTTOM REVERSAL BUY: 2-bar bullish reversal off oversold bottom without waiting for lagging EMA 50
        const isVBottomReversalBuy = c.close > ema9 && isGreen && prev.close > prev.open && rsi <= 62 && c.close > prev.high && notOverbought;

        // PULLBACK SELL: Price pulled back to EMA 9 or EMA 20 within 0.25%, rejected downward, closed red below prev.low & ema9
        const touchedEmaSell = (c.high >= ema9 * 0.9975 || prev.high >= ema9 * 0.9975 || c.high >= ema20 * 0.9975 || prev.high >= ema20 * 0.9975);
        const pullbackSell = bearTrend && notOversold && touchedEmaSell && isRed && c.close < ema9 && c.close < prev.low && isNotOverExtendedShort;

        if (pullbackBuy || isVBottomReversalBuy) {
          action = 'BUY';
          reason = isVBottomReversalBuy ? 'V6_MASTER_V_BOTTOM_REVERSAL_BUY' : 'V6_MASTER_EMA_PULLBACK_BUY';
        } else if (pullbackSell) {
          action = 'SELL';
          reason = 'V6_MASTER_EMA_PULLBACK_SELL';
        }
      }
      break;
  }

  // --------------------------------------------------------------------------
  // NON-OVERLAPPING PRICE ACTION ENGINE (W-BOTTOM, M-TOP, PIN-BARS, ENGULFING)
  // --------------------------------------------------------------------------
  const paResult = detectNonOverlappingPriceAction(
    closed15m,
    ema9,
    ema20,
    atr,
    rsi,
    prevRsi,
    bb
  );

  // ANTI-OVERLAP RULE 1: If a Major Reversal Price Action pattern (W-Bottom or M-Top) fires in the OPPOSITE direction of a lagging EMA signal, the Price Action pattern WINS!
  if (paResult.matched && paResult.isMajorReversal) {
    action = paResult.side;
    reason = paResult.patternName;
  } else if (action === 'WAIT' && paResult.matched) {
    // ANTI-OVERLAP RULE 2: If the port's EMA rule is on WAIT, take the clean Price Action pattern!
    action = paResult.side;
    reason = paResult.patternName;
  }

  // 5M Structure Filter (User Mandate Fix 2: Block Counter-Bounce Shorts & Counter-Dump Buys)
  // Major Price Action Reversals (W-Bottom & M-Top) bypass 5m counter-filter so bottoms & tops are never missed
  const isPaMajorReversal = paResult.matched && paResult.isMajorReversal;
  if (!isPaMajorReversal && candles5m && candles5m.length >= 25 && action !== 'WAIT') {
    const clean5m = sanitizeCandles(candles5m);
    const closed5m = clean5m.slice(0, -1);
    if (closed5m.length >= 20) {
      const c5m_last = closed5m[closed5m.length - 1];
      const c5m_prev2 = closed5m[closed5m.length - 3];
      const closes5m = closed5m.map((k) => k.close);
      const ema9_5mArr = calcEMA(closes5m, 9);
      const ema20_5mArr = calcEMA(closes5m, 20);
      const ema9_5m = ema9_5mArr[ema9_5mArr.length - 1];
      const ema20_5m = ema20_5mArr[ema20_5mArr.length - 1];

      if (action === 'SELL') {
        const is5mBouncing = (c5m_last.close > c5m_prev2.close && c5m_last.close > ema20_5m) || c5m_last.close > ema9_5m;
        if (is5mBouncing) {
          console.log(`🛑 [5M RELIEF BOUNCE FILTER] ${symbol} SELL paused: 5m candles making higher closes above EMA20_5m/EMA9_5m.`);
          action = 'WAIT';
          reason = '5M_RELIEF_BOUNCE_PAUSE_SELL';
        }
      } else if (action === 'BUY') {
        const is5mDumping = (c5m_last.close < c5m_prev2.close && c5m_last.close < ema20_5m) || c5m_last.close < ema9_5m;
        if (is5mDumping) {
          console.log(`🛑 [5M ACTIVE DUMP FILTER] ${symbol} BUY paused: 5m candles making lower closes below EMA20_5m/EMA9_5m.`);
          action = 'WAIT';
          reason = '5M_ACTIVE_DUMP_PAUSE_BUY';
        }
      }
    }
  }

  // 3. MID-RALLY MOMENTUM BREAKOUT BUY / BREAKDOWN SELL
  const prev3High = Math.max(prev.high, prev2.high, closed15m[closed15m.length - 4]?.high || 0);
  const isMomentumBreakoutBuy =
    isGreen &&
    c.close > ema9 &&
    c.close > ema20 &&
    ema9 >= ema20 * 0.999 &&
    c.close > prev3High &&
    bodySize >= candRange * 0.60 &&
    bodySize >= atr * 0.75 &&
    rsi >= 50 &&
    rsi <= 74;

  const prev3Low = Math.min(prev.low, prev2.low, closed15m[closed15m.length - 4]?.low || Infinity);
  const isMomentumBreakdownSell =
    isRed &&
    c.close < ema9 &&
    c.close < ema20 &&
    ema9 <= ema20 * 1.001 &&
    c.close < prev3Low &&
    bodySize >= candRange * 0.60 &&
    bodySize >= atr * 0.75 &&
    rsi <= 50 &&
    rsi >= 26;

  if (action === 'WAIT') {
    if (isMomentumBreakoutBuy) {
      action = 'BUY';
      reason = 'MOMENTUM_DISPLACEMENT_BREAKOUT_BUY';
    } else if (isMomentumBreakdownSell) {
      action = 'SELL';
      reason = 'MOMENTUM_DISPLACEMENT_BREAKDOWN_SELL';
    }
  }

  if (action === 'WAIT') {
    return {
      action: 'WAIT',
      signal: null,
      confidence: 35,
      confidenceScore: 35,
      strategyName,
      port,
      entryPrice: c.close,
      structuralSlPrice: 0,
      customSL: 0,
      structuralTpPrice: 0,
      customTP: 0,
      reason,
      reasons: [reason],
      closedCandleTime: gate.closedCandleTimeMs,
    };
  }

  const adx = calcADX(closed15m, 14);
  const effectiveTick = c.close < 1 ? 0.0001 : c.close < 100 ? 0.001 : 0.01;
  const threeBucketPlan = buildThreeBucketTradePlan({
    symbol,
    side: action,
    entryPrice: c.close,
    closedCandles: closed15m,
    atr,
    rsi,
    reason,
    tickSize: effectiveTick,
  });

  const legacyTier: TradeTier =
    threeBucketPlan.bucket === 'NORMAL_23_TO_40PCT_SEAT' || threeBucketPlan.bucket === 'BIG_SIGNAL_SEAT'
      ? 'STRONG_23PCT_RUNNER'
      : 'NORMAL_5_TO_8_USD_SCALP';

  const tierPlan: TieredBracketPlan = {
    tier: legacyTier,
    expectedRoePct: threeBucketPlan.targetRoePct,
    targetProfitUSD: threeBucketPlan.targetProfitUSD,
    maxRiskUSD: threeBucketPlan.maxRiskUSD,
    leverage: threeBucketPlan.leverage,
    slPrice: threeBucketPlan.slPrice,
    tpPrice: threeBucketPlan.tpPrice,
    trailTriggerPrice: threeBucketPlan.trailActivationPrice,
    useOptionsSlot: threeBucketPlan.canAlsoTriggerOption && openOptionSlots < 2,
  };

  const finalSlPrice = threeBucketPlan.slPrice;
  const finalTpPrice = threeBucketPlan.tpPrice;
  const finalConfidence = paResult.matched && paResult.confidence > 0 ? paResult.confidence : 88;

  return {
    action,
    signal: action,
    confidence: finalConfidence,
    confidenceScore: finalConfidence,
    strategyName,
    port,
    entryPrice: c.close,
    structuralSlPrice: finalSlPrice,
    customSL: finalSlPrice,
    structuralTpPrice: finalTpPrice,
    customTP: finalTpPrice,
    reason,
    reasons: [reason],
    closedCandleTime: gate.closedCandleTimeMs,
    tierPlan,
    threeBucketPlan,
    adx,
  };
}

export const strategyRegistry = {
  evaluateStrategyForPort,
  FifteenMinCandleCloseGate,
};
