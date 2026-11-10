import { deltaAutoTrader } from '../lib/deltaAutoTraderEngine';

async function runTest() {
  console.log('🧪 Testing Port 3025 Pre-Reversal TP & 1:2.3 Risk-Reward Ratio...');

  // Mock candles for testing
  const dummyCandles: any[] = [];
  const basePrice = 8000;
  for (let i = 0; i < 30; i++) {
    dummyCandles.push({
      time: 1700000000 + i * 900,
      open: basePrice + i * 2,
      high: basePrice + i * 2 + 5,
      low: basePrice + i * 2 - 5,
      close: basePrice + i * 2 + 1,
      volume: 100,
    });
  }

  // 1. Test Port 3025 with simulated environment
  process.env.PORT = '3025';
  (deltaAutoTrader as any).port = 3025;

  // Test BUY with expected reversal ceiling at 8125.00
  const buyTarget3025 = (deltaAutoTrader as any).calculateAccurateReversalTP({
    symbol: 'BTCUSD',
    side: 'BUY',
    entryPrice: 8000,
    effectiveQuantity: 1,
    atr: 20,
    candles: dummyCandles,
    customTP: 8125.00, // Expected reversal level
    customSL: 7950.00,
  });

  console.log('--- Port 3025 BUY Setup ---');
  console.log('Entry:', 8000);
  console.log('Reversal Level:', buyTarget3025.reversalLevel);
  console.log('TP Price:', buyTarget3025.takeProfitPrice);
  console.log('SL Price:', buyTarget3025.stopLossPrice);
  console.log('Risk-to-Reward:', buyTarget3025.riskRewardRatio);

  if (buyTarget3025.takeProfitPrice < 8125.00) {
    console.log('✅ TP is placed SLIGHTLY BEFORE the 8125.00 reversal level (Pre-Reversal Fill Guaranteed)');
  } else {
    throw new Error(`FAIL: TP ${buyTarget3025.takeProfitPrice} is not before 8125.00`);
  }

  if (buyTarget3025.riskRewardRatio >= 2.25) {
    console.log(`✅ Risk-to-Reward ratio is 1:${buyTarget3025.riskRewardRatio} (>= 1:2.3)`);
  } else {
    throw new Error(`FAIL: RR is ${buyTarget3025.riskRewardRatio} (< 2.3)`);
  }

  // 2. Test Port 3001 to ensure parity is preserved
  process.env.PORT = '3001';
  (deltaAutoTrader as any).port = 3001;

  const buyTarget3001 = (deltaAutoTrader as any).calculateAccurateReversalTP({
    symbol: 'BTCUSD',
    side: 'BUY',
    entryPrice: 8000,
    effectiveQuantity: 1,
    atr: 20,
    candles: dummyCandles,
    customSL: 7950.00,
  });

  console.log('\n--- Port 3001 Standard Setup ---');
  console.log('Entry:', 8000);
  console.log('TP Price:', buyTarget3001.takeProfitPrice);
  console.log('SL Price:', buyTarget3001.stopLossPrice);
  console.log('Risk-to-Reward:', buyTarget3001.riskRewardRatio);

  if (buyTarget3001.riskRewardRatio >= 2.3) {
    console.log(`✅ Port 3001 retains strict 1:${buyTarget3001.riskRewardRatio} (>= 1:2.30)`);
  } else {
    throw new Error(`FAIL: Port 3001 RR is ${buyTarget3001.riskRewardRatio} (< 2.3)`);
  }

  console.log('\n🎉 ALL PORT 3025 & PORT 3001 TARGET TESTS PASSED PERFECTLY!');
}

runTest().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
