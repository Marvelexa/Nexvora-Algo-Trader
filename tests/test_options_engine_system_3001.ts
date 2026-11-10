import 'dotenv/config';
import { deltaOptionsTrader } from '../lib/strategies/deltaOptionsTraderEngine';
import { DeltaAutoTraderEngine } from '../lib/deltaAutoTraderEngine';
import { DeltaPosition } from '../src/types';

console.log('========================================================================');
console.log('🪙 VERIFICATION SUITE: SYSTEM 3001 DELTA OPTIONS TRADING ENGINE');
console.log('   OTM Option Writing, Theta Decay Harvesting & Option Risk Controls');
console.log('========================================================================\n');

let passed = 0;
let failed = 0;

function assert(desc: string, condition: boolean) {
  if (condition) {
    console.log(`  ✅ [PASS] ${desc}`);
    passed++;
  } else {
    console.error(`  ❌ [FAIL] ${desc}`);
    failed++;
  }
}

async function runTests() {
  // 1. Fetch Option Tickers
  const btcTickers = await deltaOptionsTrader.fetchOptionsTickers('BTC');
  assert('Fetches BTC options from Delta Exchange', Array.isArray(btcTickers) && btcTickers.length > 0);

  // 2. Select Best Option for BUY bias (OTM Put)
  const buyCandidate = await deltaOptionsTrader.selectBestOption('BTC', 'BUY', 85, 'Zero-Lag Bullish Test');
  assert('Bullish bias selects PUT option for writing (Theta capture)', buyCandidate !== null && buyCandidate.optionType === 'PUT');
  assert('Option candidate has valid strike and mark price', buyCandidate !== null && buyCandidate.strike > 0 && buyCandidate.markPrice > 0);
  assert('Option candidate side is SELL (Option Writer)', buyCandidate !== null && buyCandidate.side === 'SELL');

  // 3. Select Best Option for SELL bias (OTM Call)
  const sellCandidate = await deltaOptionsTrader.selectBestOption('BTC', 'SELL', 85, 'Zero-Lag Bearish Test');
  assert('Bearish bias selects CALL option for writing (Theta capture)', sellCandidate !== null && sellCandidate.optionType === 'CALL');
  assert('Option candidate has valid strike and mark price', sellCandidate !== null && sellCandidate.strike > 0 && sellCandidate.markPrice > 0);

  // 4. Execute Option Order Simulation
  if (buyCandidate) {
    const pos = await deltaOptionsTrader.executeOptionOrder(buyCandidate, true);
    assert('Option order execution returns valid position', pos !== null);
    assert('Option position instrumentType === OPTION', pos?.instrumentType === 'OPTION');
    assert('Option position symbol matches contract symbol', pos?.symbol === buyCandidate.symbol);
    assert('Option position has take profit and stop loss set', (pos?.takeProfitPrice || 0) > 0 && (pos?.stopLossPrice || 0) > 0);
  }

  // 5. Test Option Evaluation in DeltaAutoTraderEngine
  const engine = new DeltaAutoTraderEngine(3001);
  const dummyOptPos: DeltaPosition = {
    id: 'test-opt-1',
    symbol: 'P-BTC-76000-011126',
    side: 'SELL',
    entryPrice: 15.0,
    currentPrice: 15.0,
    quantity: 10,
    marginUSD: 35.0,
    notionalUSD: 150.0,
    leverage: 10,
    takeProfitPrice: 0.10,
    stopLossPrice: 33.0,
    initialStopLossPrice: 33.0,
    atr: 1.5,
    isBreakevenLocked: false,
    pnlUSD: 0,
    pnlPercent: 0,
    entryTime: Date.now(),
    strategyName: 'Marwadi Option Writer [SELL PUT | Theta Decay]',
    shadowConfirmedSeconds: 0,
    executionMode: 'DIRECT',
    instrumentType: 'OPTION',
    optionType: 'PUT',
    strike: 76000,
    expiry: '011126'
  };

  // Evaluate tick with decayed price (Price drops from 15.0 to 5.0 -> Profit!)
  await engine.evaluatePositionSLTP(dummyOptPos, 5.0, 0);
  assert('Option seller profit increases when mark price decays', dummyOptPos.pnlUSD > 0);
  assert('Option currentPrice reflects live price', dummyOptPos.currentPrice === 5.0);

  console.log('\n========================================================================');
  console.log(`📊 RESULTS: ${passed} PASSED, ${failed} FAILED (Total: ${passed + failed})`);
  console.log('========================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(e => {
  console.error(e);
  process.exit(1);
});
