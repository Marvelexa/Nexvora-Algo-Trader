import { bradGohEngine } from '../lib/strategies/bradGohReversalEngine';
import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { KlinePoint } from '../src/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✅ PASS: ${message}`);
}

function generateCandlesWithRange(params: {
  swingHigh: number;
  swingLow: number;
  type: 'BEARISH_SWEEP' | 'BULLISH_SWEEP' | 'TIGHT_RANGE_REJECT';
}): KlinePoint[] {
  const { swingHigh, swingLow, type } = params;
  const candles: KlinePoint[] = [];
  const now = Date.now();

  if (type === 'BEARISH_SWEEP') {
    for (let i = 0; i < 30; i++) {
      const cPrice = 78200 + (i * 25);
      candles.push({
        time: now - (35 - i) * 15 * 60000,
        open: cPrice - 20,
        high: i === 25 ? swingHigh : cPrice + 25,
        low: i === 5 ? swingLow : cPrice - 25,
        close: cPrice + 10,
        volume: 1000,
      });
    }
    candles.push({
      time: now - 30 * 60000,
      open: 78920,
      high: 79040,
      low: 78880,
      close: 78930,
      volume: 2500,
    });
    candles.push({
      time: now - 15 * 60000,
      open: 78920,
      high: 78930,
      low: 78820,
      close: 78840,
      volume: 3000,
    });
  } else if (type === 'BULLISH_SWEEP') {
    for (let i = 0; i < 30; i++) {
      const cPrice = 76800 - (i * 25);
      candles.push({
        time: now - (35 - i) * 15 * 60000,
        open: cPrice + 20,
        high: i === 5 ? swingHigh : cPrice + 25,
        low: i === 25 ? swingLow : cPrice - 25,
        close: cPrice - 10,
        volume: 1000,
      });
    }
    candles.push({
      time: now - 30 * 60000,
      open: 76080,
      high: 76120,
      low: 75960,
      close: 76070,
      volume: 2500,
    });
    candles.push({
      time: now - 15 * 60000,
      open: 76080,
      high: 76180,
      low: 76070,
      close: 76160,
      volume: 3000,
    });
  } else if (type === 'TIGHT_RANGE_REJECT') {
    const tightHigh = 78000;
    const tightLow = 77800; // only 200 points range
    for (let i = 0; i < 30; i++) {
      const cPrice = 77850 + (i * 4);
      candles.push({
        time: now - (35 - i) * 15 * 60000,
        open: cPrice - 10,
        high: i === 25 ? tightHigh : cPrice + 10,
        low: i === 5 ? tightLow : cPrice - 10,
        close: cPrice + 5,
        volume: 1000,
      });
    }
    candles.push({
      time: now - 30 * 60000,
      open: 77960,
      high: 78040,
      low: 77930,
      close: 77970,
      volume: 2500,
    });
    candles.push({
      time: now - 15 * 60000,
      open: 77960,
      high: 77970,
      low: 77890,
      close: 77910,
      volume: 3000,
    });
  }

  return candles;
}

async function run() {
  console.log('========================================================================');
  console.log('🧪 VERIFYING BRAD GOH REVERSAL ENGINE (PkAtVH6YVM8): EXACT REVERSAL TP');
  console.log('========================================================================');

  // TEST 1: Bearish Reversal (SHORT) - TP Must be EXACTLY at Opposing Reversal Support
  console.log('\n--- TEST 1: Bearish Reversal Sweep (SHORT) ---');
  const btcHigh = 79000;
  const btcLow = 76000; // Big range: 3000 points
  const shortCandles = generateCandlesWithRange({
    swingHigh: btcHigh,
    swingLow: btcLow,
    type: 'BEARISH_SWEEP',
  });

  const shortResult = bradGohEngine.evaluateSetup('BTCUSD', shortCandles);
  assert(shortResult.recommendedSide === 'SELL', 'Bearish sweep triggers SELL signal');
  assert(shortResult.setupType === 'BEARISH_SWEEP_MSS', 'Setup type is BEARISH_SWEEP_MSS');
  assert(shortResult.customSL! > shortResult.entryPrice, `Stop Loss ($${shortResult.customSL}) is ABOVE entry ($${shortResult.entryPrice})`);
  assert(shortResult.customTP! < shortResult.entryPrice, `Take Profit ($${shortResult.customTP}) is BELOW entry ($${shortResult.entryPrice})`);
  
  // Exact Reversal Check: TP must be placed AT the opposing swingLow (or 1-2 ticks inside it), NEVER beyond it
  assert(shortResult.customTP! >= btcLow, `Take Profit ($${shortResult.customTP}) is strictly AT OR ABOVE the exact reversal support level ($${btcLow})`);
  assert(shortResult.customTP! <= btcLow + 100, `Take Profit ($${shortResult.customTP}) is right at the reversal bounce boundary (within 0.05-0.15 ATR of $${btcLow})`);

  const shortLossDist = shortResult.customSL! - shortResult.entryPrice;
  const shortTargetDist = shortResult.entryPrice - shortResult.customTP!;
  const shortRR = shortTargetDist / shortLossDist;
  assert(shortRR >= 2.30, `Bearish Reversal Risk-to-Reward is 1:${shortRR.toFixed(2)} (>= 1:2.30)`);

  // TEST 2: Bullish Reversal (BUY) - TP Must be EXACTLY at Opposing Reversal Resistance
  console.log('\n--- TEST 2: Bullish Reversal Sweep (BUY) ---');
  const longCandles = generateCandlesWithRange({
    swingHigh: btcHigh,
    swingLow: btcLow,
    type: 'BULLISH_SWEEP',
  });

  const longResult = bradGohEngine.evaluateSetup('BTCUSD', longCandles);
  assert(longResult.recommendedSide === 'BUY', 'Bullish sweep triggers BUY signal');
  assert(longResult.setupType === 'BULLISH_SWEEP_MSS', 'Setup type is BULLISH_SWEEP_MSS');
  assert(longResult.customSL! < longResult.entryPrice, `Stop Loss ($${longResult.customSL}) is BELOW entry ($${longResult.entryPrice})`);
  assert(longResult.customTP! > longResult.entryPrice, `Take Profit ($${longResult.customTP}) is ABOVE entry ($${longResult.entryPrice})`);

  // Exact Reversal Check: TP must be placed AT the opposing swingHigh (or 1-2 ticks inside it), NEVER beyond it
  assert(longResult.customTP! <= btcHigh, `Take Profit ($${longResult.customTP}) is strictly AT OR BELOW the exact reversal resistance level ($${btcHigh})`);
  assert(longResult.customTP! >= btcHigh - 100, `Take Profit ($${longResult.customTP}) is right at the reversal dump boundary (within 0.05-0.15 ATR of $${btcHigh})`);

  const longLossDist = longResult.entryPrice - longResult.customSL!;
  const longTargetDist = longResult.customTP! - longResult.entryPrice;
  const longRR = longTargetDist / longLossDist;
  assert(longRR >= 2.30, `Bullish Reversal Risk-to-Reward is 1:${longRR.toFixed(2)} (>= 1:2.30)`);

  // TEST 3: Zero-Overextension Rule - Setup is REJECTED if room to reversal is < 1:2.30 RR
  console.log('\n--- TEST 3: Tight Range Rejection (Never Push TP Past Reversal) ---');
  // Tight range: swingHigh 78000, swingLow 77800 (only 200 points, cannot give 2.30 RR with realistic SL)
  const tightCandles = generateCandlesWithRange({
    swingHigh: 78000,
    swingLow: 77800,
    type: 'TIGHT_RANGE_REJECT',
  });

  const tightResult = bradGohEngine.evaluateSetup('BTCUSD', tightCandles);
  assert(tightResult.recommendedSide === null, 'Tight range sweep is strictly REJECTED (recommendedSide === null)');
  assert(tightResult.confidenceScore === 0, 'Confidence score is 0 when room to reversal is insufficient');
  assert(tightResult.reasons.some(r => r.includes('Opposing reversal floor') && r.includes('Cannot place TP past where reversal occurs')), 'Reason explicitly documents refusal to push TP past reversal point');

  // TEST 4: Port 3025 Strategy Registry Integration
  console.log('\n--- TEST 4: Port 3025 (Live Gateway) Priority 1 Evaluation ---');
  const port3025Output = evaluateStrategyForPort(3025, 'BTCUSD', shortCandles);
  assert(port3025Output.signal === 'SELL', 'Port 3025 evaluates Brad Goh Reversal and yields SELL');
  assert(port3025Output.strategyName.includes('Brad Goh Reversal'), `Strategy name identifies Brad Goh Reversal: ${port3025Output.strategyName}`);
  assert(port3025Output.strategyName.includes('PkAtVH6YVM8'), 'Strategy name cites official video ID PkAtVH6YVM8');
  assert(port3025Output.customTP! >= btcLow, `Port 3025 TP ($${port3025Output.customTP}) is at exact reversal level`);

  console.log('\n========================================================================');
  console.log('🌟 ALL BRAD GOH EXACT REVERSAL TP TESTS PASSED (100% SUCCESS)');
  console.log('========================================================================');
}

run().catch((e) => {
  console.error('Test Suite Failed:', e);
  process.exit(1);
});
