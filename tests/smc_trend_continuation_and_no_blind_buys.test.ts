import { describe, it } from 'node:test';
import assert from 'node:assert';
import { HybridMasterCryptoSMC3005Engine } from '../lib/strategies/hybridMasterCryptoSMC3005Engine';
import { KlinePoint } from '../src/types';

function generateDowntrendCandles(count: number = 40): KlinePoint[] {
  const candles: KlinePoint[] = [];
  let price = 100.0;
  const now = Date.now() - count * 15 * 60 * 1000;

  for (let i = 0; i < count; i++) {
    // Steady downward trend: lower highs, lower lows
    const open = price;
    price -= 0.5; // downward drift
    const close = price;
    const high = open + 0.2;
    const low = close - 0.2;
    candles.push({
      time: now + i * 15 * 60 * 1000,
      open,
      high,
      low,
      close,
      volume: 1000,
    });
  }

  // The last 2 candles:
  // n-2: small relief bounce into EMA9 (touches resistance)
  const prevOpen = candles[candles.length - 1].close;
  const prevClose = prevOpen + 0.3; // small green pullback
  const prevHigh = prevClose + 0.2;
  const prevLow = prevOpen - 0.1;
  candles.push({
    time: now + count * 15 * 60 * 1000,
    open: prevOpen,
    high: prevHigh,
    low: prevLow,
    close: prevClose,
    volume: 800,
  });

  // n-1 (current candle): Bearish rejection candle (closes red, rejecting EMA9)
  const curOpen = prevClose;
  const curClose = curOpen - 0.4; // red rejection close
  const curHigh = curOpen + 0.1;
  const curLow = curClose - 0.1;
  candles.push({
    time: now + (count + 1) * 15 * 60 * 1000,
    open: curOpen,
    high: curHigh,
    low: curLow,
    close: curClose,
    volume: 1200,
  });

  return candles;
}

describe('HybridMasterCryptoSMC3005Engine: Trend Continuation & Anti-Knife-Catching', () => {
  it('MUST generate BEARISH SMC SELL when coin is in a downtrend and rejects resistance', () => {
    const candles = generateDowntrendCandles(40);
    const verdict = HybridMasterCryptoSMC3005Engine.evaluateSetup('SOLUSD', candles, 1000);

    assert.strictEqual(verdict.recommendedSide, 'SELL', 'Must recommend SELL in a downtrend pullback rejection');
    assert.strictEqual(verdict.setupType, 'BEARISH_SMC_IDM_SWEEP_OB_RETEST', 'Setup type must be BEARISH_SMC');
    assert.ok(verdict.stopLossPrice > verdict.entryPrice, 'Stop loss must be above entry for a SELL');
    assert.ok(verdict.tp1Price < verdict.entryPrice, 'Take profit must be below entry for a SELL');
  });

  it('MUST NOT generate BUY on a routine green relief candle during a downtrend', () => {
    const candles = generateDowntrendCandles(40);
    // Replace the last candle with a routine small green candle
    const last = candles[candles.length - 1];
    last.open = 80.0;
    last.close = 80.1; // minor green candle, but still below 21 EMA in deep downtrend
    last.high = 80.2;
    last.low = 79.9;

    const verdict = HybridMasterCryptoSMC3005Engine.evaluateSetup('SOLUSD', candles, 1000);

    assert.notStrictEqual(verdict.recommendedSide, 'BUY', 'Must NEVER buy routine relief candles in a downtrend!');
  });
});
