import { DeltaAutoTraderEngine } from '../lib/deltaAutoTraderEngine';
import { KlinePoint } from '../src/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✅ PASS: ${message}`);
}

async function testSystemNormalDirect(port: number, name: string) {
  console.log(`\n--- Testing ${name} on Port ${port} (NORMAL DIRECT MODE) ---`);
  const engine = new DeltaAutoTraderEngine(port);
  
  // Verify engine state configuration
  assert(engine.state.isInverseTrading === false, `Port ${port}: isInverseTrading is strictly false`);
  assert(engine.state.smartDetectorSummary.activeMode.includes('PURE_DIRECT_TRADING'), `Port ${port}: activeMode is PURE_DIRECT_TRADING`);
  assert(engine.state.smartDetectorSummary.reversedTradesCount === 0, `Port ${port}: reversedTradesCount is strictly 0`);

  // Mock candidates: BUY and SELL
  const dummyCandles: KlinePoint[] = Array.from({ length: 30 }, (_, i) => ({
    time: Date.now() - (30 - i) * 60000,
    open: 78000 + i * 10,
    high: 78050 + i * 10,
    low: 77950 + i * 10,
    close: 78020 + i * 10,
    volume: 100
  }));

  // Direct BUY Setup Calculation
  const buyTarget = engine.calculateAccurateReversalTP({
    symbol: 'BTCUSD',
    side: 'BUY',
    entryPrice: 78000,
    effectiveQuantity: 0.012,
    atr: 120,
    candles: dummyCandles,
  });

  assert(buyTarget.isValidSetup === true, `Port ${port}: Direct BUY setup is valid`);
  assert(buyTarget.takeProfitPrice > 78000, `Port ${port}: Direct BUY TakeProfit ($${buyTarget.takeProfitPrice}) is ABOVE entry ($78000)`);
  assert(buyTarget.stopLossPrice < 78000, `Port ${port}: Direct BUY StopLoss ($${buyTarget.stopLossPrice}) is BELOW entry ($78000)`);
  assert(buyTarget.riskRewardRatio >= 2.30, `Port ${port}: Direct BUY Risk-to-Reward is 1:${buyTarget.riskRewardRatio} (>= 1:2.30)`);
  const btcSlDistPct = Math.abs(78000 - buyTarget.stopLossPrice) / 78000 * 100;
  assert(btcSlDistPct >= 0.85, `Port ${port}: Direct BUY StopLoss respects BTC breathing room floor (${btcSlDistPct.toFixed(2)}% >= 0.85%)`);

  // Direct SELL Setup Calculation
  const altDummyCandles: KlinePoint[] = Array.from({ length: 30 }, (_, i) => ({
    time: Date.now() - (30 - i) * 60000,
    open: 0.0760 + Math.sin(i) * 0.0005,
    high: 0.0765 + Math.sin(i) * 0.0005,
    low: 0.0755 + Math.sin(i) * 0.0005,
    close: 0.0760 + Math.sin(i) * 0.0005,
    volume: 50000
  }));

  const sellTarget = engine.calculateAccurateReversalTP({
    symbol: 'DOGEUSD',
    side: 'SELL',
    entryPrice: 0.0760,
    effectiveQuantity: 12200,
    atr: 0.0005,
    candles: altDummyCandles,
  });

  assert(sellTarget.isValidSetup === true, `Port ${port}: Direct SELL setup is valid`);
  assert(sellTarget.takeProfitPrice < 0.0760, `Port ${port}: Direct SELL TakeProfit ($${sellTarget.takeProfitPrice}) is BELOW entry ($0.0760)`);
  assert(sellTarget.stopLossPrice > 0.0760, `Port ${port}: Direct SELL StopLoss ($${sellTarget.stopLossPrice}) is ABOVE entry ($0.0760)`);
  assert(sellTarget.riskRewardRatio >= 2.30, `Port ${port}: Direct SELL Risk-to-Reward is 1:${sellTarget.riskRewardRatio} (>= 1:2.30)`);
  const altSlDistPct = Math.abs(sellTarget.stopLossPrice - 0.0760) / 0.0760 * 100;
  assert(altSlDistPct >= 1.20, `Port ${port}: Direct SELL StopLoss respects Altcoin breathing room floor (${altSlDistPct.toFixed(2)}% >= 1.20%)`);
}

async function run() {
  console.log('========================================================================');
  console.log('🧪 TESTING NORMAL DIRECT TRADING MODE (BUY ➔ BUY, SELL ➔ SELL) ACROSS ALL SYSTEMS');
  console.log('========================================================================');

  const systems = [
    { port: 3001, name: 'System 3001 (Zero-Lag / Options)' },
    { port: 3002, name: 'System 3002 (Whiteboard AMM)' },
    { port: 3003, name: 'System 3003 (HBA Breakout)' },
    { port: 3004, name: 'System 3004 (HBA Candlesticks & Trendlines)' },
    { port: 3005, name: 'System 3005 (HBA Fibonacci Golden Pocket)' },
    { port: 3006, name: 'System 3006 (Craig Percoco SMC / FVG)' },
    { port: 3007, name: 'System 3007 (Marwadi Delta Trap)' },
    { port: 3025, name: 'System 3025 (Delta Testnet Live Broker Gateway)' },
  ];

  for (const s of systems) {
    await testSystemNormalDirect(s.port, s.name);
  }

  console.log('\n========================================================================');
  console.log('🌟 ALL 8 SYSTEMS VERIFIED: 100% SUCCESSFUL NORMAL DIRECT TRADING (BUY ➔ BUY, SELL ➔ SELL)');
  console.log('========================================================================');
}

run().catch((e) => {
  console.error('Test Suite Failed:', e);
  process.exit(1);
});
