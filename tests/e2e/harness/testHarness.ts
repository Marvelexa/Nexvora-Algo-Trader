/**
 * Unified Test Harness & Fixture Builder for E2E Test Suite
 * Delta Exchange India Autonomous Trading System
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { KlinePoint } from '../../../src/types';
import { mockDeltaServer, MockDeltaServer } from './mockDeltaServer';
import { Assert } from './assertionUtils';

export interface GeometricTargetParams {
  side: 'BUY' | 'SELL';
  entryPrice: number;
  atr: number;
  bestBid?: number;
  bestAsk?: number;
  spread?: number;
  riskReward?: number;
}

export interface GeometricTargetResult {
  stopLoss: number;
  takeProfit: number;
  buffer: number;
  risk: number;
}

export class TestHarness {
  public static isLiveMode(): boolean {
    return process.env.LIVE_DELTA_TEST === 'true' && !!(process.env.DELTA_API_KEY && process.env.DELTA_API_SECRET);
  }

  public static getMockServer(): MockDeltaServer {
    return mockDeltaServer;
  }

  /**
   * Safe temporary sandbox directory runner.
   * Isolates file writes (cache files, state files, log files) from polluting workspace.
   */
  public static async withTempSandbox<T>(fn: (sandboxDir: string) => Promise<T> | T): Promise<T> {
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'delta-e2e-sandbox-'));
    try {
      return await fn(sandboxDir);
    } finally {
      try {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
      } catch {
        // Ignored
      }
    }
  }

  /**
   * Reference Mathematical Implementation of Geometric TP/SL Core (R3 Contract)
   * Dimensionless volatility-scaled risk units guaranteeing positive bounds.
   */
  public static calculateGeometricTargets(params: GeometricTargetParams): GeometricTargetResult {
    const { side, entryPrice, atr, riskReward = 2.0 } = params;
    Assert.isPositive(entryPrice, 'entryPrice must be strictly positive');
    Assert.isNonNegative(atr, 'atr must be non-negative');

    let spread = params.spread;
    if (spread === undefined && params.bestBid !== undefined && params.bestAsk !== undefined) {
      spread = Math.max(0, params.bestAsk - params.bestBid);
    }
    spread = spread || 0;

    // R3 Contract: Dynamic ATR + Spread Buffer: max(1.30 * ATR, 3.0 * Spread)
    const rawBuffer = Math.max(1.30 * atr, 3.0 * spread);
    // Safety minimum buffer floor (0.1% of price if ATR and spread are 0)
    const buffer = rawBuffer > 0 ? rawBuffer : entryPrice * 0.001;

    let stopLoss: number;
    let takeProfit: number;

    if (side === 'BUY') {
      // Long: 0 < SL < entry < TP
      stopLoss = Math.max(entryPrice * 0.01, entryPrice - buffer);
      const risk = entryPrice - stopLoss;
      takeProfit = entryPrice + (risk * riskReward);
      Assert.isStrictOrdering(stopLoss, entryPrice, takeProfit, 'BUY geometric ordering: 0 < SL < entry < TP');
      return { stopLoss, takeProfit, buffer, risk };
    } else {
      // Short: 0 < TP < entry < SL
      stopLoss = entryPrice + buffer;
      const risk = stopLoss - entryPrice;
      // Prohibit negative TP: Max allowed drop is bounded (e.g. at most 75% or 90% drop)
      takeProfit = Math.max(entryPrice * 0.05, entryPrice - Math.min(risk * riskReward, entryPrice * 0.85));
      Assert.isStrictOrdering(takeProfit, entryPrice, stopLoss, 'SELL geometric ordering: 0 < TP < entry < SL');
      Assert.isPositive(takeProfit, 'Short TP must be strictly positive');
      return { stopLoss, takeProfit, buffer, risk };
    }
  }

  /**
   * Price quantization to tick size and precision decimals
   */
  public static quantizePrice(price: number, tickSize: number, decimals: number): number {
    if (price <= 0 || tickSize <= 0) return price;
    const ticks = Math.round(price / tickSize);
    const quantized = ticks * tickSize;
    return Number(quantized.toFixed(decimals));
  }

  /**
   * Authentic Options & Perpetuals PnL Calculator (R3 Contract)
   * BTC options contract multiplier = 0.001
   * ETH options contract multiplier = 0.01
   */
  public static calculateContractPnL(params: {
    symbol: string;
    action: 'BUY' | 'SELL';
    entryPrice: number;
    exitPrice: number;
    contracts: number;
    contractValue?: number;
  }): { pnlUSD: number; pnlPercent: number } {
    const { symbol, action, entryPrice, exitPrice, contracts } = params;
    
    // Resolve contract multiplier
    let multiplier = params.contractValue;
    if (multiplier === undefined) {
      if (symbol.includes('BTC')) multiplier = 0.001;
      else if (symbol.includes('ETH')) multiplier = 0.01;
      else if (symbol.includes('DOGE')) multiplier = 100.0;
      else if (symbol.includes('1000PEPE')) multiplier = 1000.0;
      else multiplier = 1.0;
    }

    let pnlUSD: number;
    if (action === 'BUY') {
      // Long: profit when exit > entry
      pnlUSD = (exitPrice - entryPrice) * contracts * multiplier;
    } else {
      // Short / Option Writing: profit when exit < entry (premium decay)
      pnlUSD = (entryPrice - exitPrice) * contracts * multiplier;
    }

    const notionalEntry = entryPrice * contracts * multiplier;
    const pnlPercent = notionalEntry > 0 ? (pnlUSD / notionalEntry) * 100 : 0;

    return {
      pnlUSD: Number(pnlUSD.toFixed(4)),
      pnlPercent: Number(pnlPercent.toFixed(2)),
    };
  }

  /**
   * Candlestick Generator with Specialized Market Scenarios
   */
  public static createMockCandles(params: {
    count: number;
    basePrice: number;
    pattern: 
      | 'ICT_BULLISH_DISPLACEMENT_FVG'
      | 'ICT_BEARISH_DISPLACEMENT_FVG'
      | 'ICT_EXPANDING_GREEN_CANDLE_TRAP'
      | 'WYCKOFF_SPRING_PHASE_C'
      | 'WYCKOFF_UTAD_PHASE_C'
      | 'WYCKOFF_NO_SUPPLY_PULLBACK'
      | 'SUB_CENT_MICRO_TICKS'
      | 'NORMAL_UPTREND'
      | 'NORMAL_DOWNTREND'
      | 'TIGHT_CHOP';
    volatility?: number;
  }): KlinePoint[] {
    const { count, basePrice, pattern, volatility = 0.01 } = params;
    const candles: KlinePoint[] = [];
    const now = Date.now();
    const intervalMs = 15 * 60 * 1000;
    let current = basePrice;

    for (let i = 0; i < count; i++) {
      const time = now - (count - i) * intervalMs;
      let open = current;
      let close = current;
      let high = current * (1 + volatility * 0.5);
      let low = current * (1 - volatility * 0.5);
      let volume = 1000;

      if (pattern === 'NORMAL_UPTREND') {
        close = open * (1 + volatility * 0.6);
        high = close * (1 + volatility * 0.2);
        low = open * (1 - volatility * 0.2);
        current = close;
      } else if (pattern === 'NORMAL_DOWNTREND') {
        close = open * (1 - volatility * 0.6);
        high = open * (1 + volatility * 0.2);
        low = close * (1 - volatility * 0.2);
        current = close;
      } else if (pattern === 'TIGHT_CHOP') {
        close = i % 2 === 0 ? open * (1 + volatility * 0.1) : open * (1 - volatility * 0.1);
        high = Math.max(open, close) * 1.001;
        low = Math.min(open, close) * 0.999;
        current = close;
      } else if (pattern === 'SUB_CENT_MICRO_TICKS') {
        // e.g. basePrice 0.0000085
        const microStep = 0.00000005;
        close = i % 2 === 0 ? open + microStep : open - microStep;
        high = Math.max(open, close) + microStep;
        low = Math.min(open, close) - microStep;
        volume = 50000000;
        current = close;
      }

      candles.push({ time, open, high, low, close, volume });
    }

    // Apply specialized pattern modifications to the final candles
    const n = candles.length;
    if (pattern === 'ICT_BEARISH_DISPLACEMENT_FVG' && n >= 10) {
      // Candle n-3: High base
      // Candle n-2: Massive displacement down with FVG (low of n-3 > high of n-1)
      const prevHigh = candles[n - 4].high;
      candles[n - 3].high = prevHigh * 1.02; // BSL Sweep!
      candles[n - 3].close = prevHigh * 1.005;

      const c1 = candles[n - 3];
      const c2 = candles[n - 2];
      const c3 = candles[n - 1];

      // c2 = Large Bearish Displacement
      c2.open = c1.close;
      c2.close = c2.open * 0.96; // 4% displacement dump
      c2.high = c2.open * 1.002;
      c2.low = c2.close * 0.998;
      c2.volume = 5000; // High volume displacement

      // c3 = Revisit/mitigate into FVG
      c3.open = c2.close;
      c3.high = c1.low * 0.999; // Stays below c1.low to preserve FVG gap!
      c3.low = c2.close * 0.995;
      c3.close = c3.open * 1.005; // Pullback into FVG
    } else if (pattern === 'ICT_EXPANDING_GREEN_CANDLE_TRAP' && n >= 5) {
      // Massive expanding green candle at resistance (Anti-Trap rule test)
      const last = candles[n - 1];
      last.open = current;
      last.close = current * 1.035; // +3.5% huge green expansion
      last.high = last.close * 1.002;
      last.low = last.open * 0.998;
      last.volume = 8000; // Large green expansion volume
    } else if (pattern === 'WYCKOFF_SPRING_PHASE_C' && n >= 25) {
      // Support level established at candles[n-10..n-5]
      const support = Math.min(...candles.slice(n - 15, n - 5).map(c => c.low));
      // Candle n-2: Spring shakeout below support with high volume
      const spring = candles[n - 2];
      spring.open = support * 1.002;
      spring.low = support * 0.985; // Shakeout 1.5% below support
      spring.close = support * 1.001; // Closes BACK ABOVE support
      spring.high = support * 1.005;
      spring.volume = 3500; // RVOL >= 1.30

      // Candle n-1: Confirmation mark-up
      const curr = candles[n - 1];
      curr.open = spring.close;
      curr.close = curr.open * 1.01;
      curr.high = curr.close * 1.004;
      curr.low = curr.open;
      curr.volume = 2000;
    } else if (pattern === 'WYCKOFF_UTAD_PHASE_C' && n >= 25) {
      // Resistance established
      const resistance = Math.max(...candles.slice(n - 15, n - 5).map(c => c.high));
      // Candle n-2: UTAD Upthrust shakeout above resistance
      const utad = candles[n - 2];
      utad.open = resistance * 0.998;
      utad.high = resistance * 1.02; // Sweeps 2% above resistance
      utad.close = resistance * 0.995; // Closes BACK BELOW resistance
      utad.low = resistance * 0.99;
      utad.volume = 4000; // High volume distribution

      const curr = candles[n - 1];
      curr.open = utad.close;
      curr.close = curr.open * 0.99;
      curr.high = curr.open;
      curr.low = curr.close * 0.995;
      curr.volume = 2500;
    }

    return candles;
  }
}
