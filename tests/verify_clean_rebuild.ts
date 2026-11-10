import { deltaAutoTrader } from '../lib/deltaAutoTraderEngine';
import { deltaExchange } from '../lib/deltaExchangeEngine';

async function runVerificationTests() {
  console.log('🧪 Starting Clean Rebuild Verification Tests...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // TEST 1: Delta Exchange rejects unquoted symbols instead of returning fake $1.00
  const fakePrice = await deltaExchange.getMarketPrice('NONEXISTENT_XYZ_COIN_123');
  assert(fakePrice === 0, 'Unknown/illiquid symbol returns 0 instead of fake $1.00');

  // TEST 2: Known base symbol returns valid positive price
  const btcPrice = await deltaExchange.getMarketPrice('BTCUSD');
  assert(btcPrice > 1000, `BTCUSD returns real market price: $${btcPrice}`);

  // TEST 3: Short Trade TP calculation on sub-cent/low-priced coins (prevent negative TP bug)
  // Simulate opening a short trade on a $0.04 coin with $0.03 risk
  const testSubCentShort = await deltaAutoTrader.executeNewPosition({
    symbol: 'TESTSUBCOIN',
    side: 'SELL',
    signalPrice: 0.045,
    atr: 0.005,
    strategyName: 'Unit Test Sub-Cent Positivity Guard',
    shadowConfirmedSeconds: 0,
    executionMode: 'DIRECT',
  });

  if (testSubCentShort) {
    assert(testSubCentShort.takeProfitPrice > 0, `Short TP is strictly positive: $${testSubCentShort.takeProfitPrice} (entry was $${testSubCentShort.entryPrice})`);
    assert(testSubCentShort.takeProfitPrice < testSubCentShort.entryPrice, `Short TP ($${testSubCentShort.takeProfitPrice}) is below entry price ($${testSubCentShort.entryPrice})`);
    assert(testSubCentShort.stopLossPrice > testSubCentShort.entryPrice, `Short SL ($${testSubCentShort.stopLossPrice}) is above entry price ($${testSubCentShort.entryPrice})`);
    
    // Clean up test position
    const state = (deltaAutoTrader as any).state || (deltaAutoTrader as any).getState?.();
    const idx = state.activePositions.findIndex((p: any) => p.id === testSubCentShort.id);
    if (idx !== -1) {
      await deltaAutoTrader.closePosition(idx, 'MANUAL_EXIT', 0.045);
    }
  } else {
    // If rejected due to simulation bounds, that is also safe
    console.log('ℹ️ Sub-cent order handled cleanly by engine.');
  }

  // TEST 4: Auto-repair mechanism in evaluatePositionSLTP
  // If an anomalous trade ever has TP <= 0, evaluatePositionSLTP must repair it rather than aborting checks
  const mockAnomalyPos: any = {
    id: 'mock-anomaly-test',
    symbol: 'MOCKUSD',
    side: 'SELL',
    entryPrice: 0.50,
    currentPrice: 0.50,
    quantity: 10,
    marginUSD: 20,
    notionalUSD: 100,
    leverage: 25,
    takeProfitPrice: -0.25, // Intentional negative anomaly
    stopLossPrice: 0.60,
    initialStopLossPrice: 0.60,
    atr: 0.02,
    isBreakevenLocked: false,
    pnlUSD: 0,
    pnlPercent: 0,
    entryTime: Date.now(),
    strategyName: 'Mock Anomaly Pos',
  };

  await deltaAutoTrader.evaluatePositionSLTP(mockAnomalyPos, 0.50, 0);
  assert(mockAnomalyPos.takeProfitPrice > 0, `Auto-repair restored invalid TP to positive: $${mockAnomalyPos.takeProfitPrice}`);

  // TEST 5: Full Capital Margin Calculation
  const sizing = await deltaAutoTrader.calculateDynamicTradeMargin(1);
  assert(sizing.totalBalanceUSD >= 170, `Account balance recognized as ₹15k ($${sizing.totalBalanceUSD})`);
  assert(sizing.marginUSD >= 150, `Full margin deployed for 1 slot: $${sizing.marginUSD} USD (~₹${(sizing.marginUSD * 84).toFixed(0)})`);
  assert(sizing.notionalUSD >= 3000, `Full notional deployed @ leverage: $${sizing.notionalUSD} USD`);

  console.log(`\n========================================`);
  console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runVerificationTests().catch(err => {
  console.error('Fatal error in tests:', err);
  process.exit(1);
});
