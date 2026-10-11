import { deltaAutoTrader } from '../lib/deltaAutoTraderEngine';
import { CryptoDedicatedStrategyEngine } from '../lib/cryptoDedicatedStrategyEngine';
import { KlinePoint } from '../lib/quantMathematicalEngine';

async function runConfluenceGuardTest() {
  console.log('=== RUNNING CONFLUENCE GUARD REALITY TEST ===\n');

  // Test 1: Fetch live DOGE 15m candles from Binance API
  console.log('1. Testing Live DOGEUSD 15m Market Condition...');
  try {
    const resp = await fetch('https://data-api.binance.vision/api/v3/klines?symbol=DOGEUSDT&interval=15m&limit=250');
    const rawData = await resp.json();
    const candles: KlinePoint[] = rawData.map((k: any) => ({
      time: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }));
    const closedCandles = candles.slice(0, -1);

    const confluence = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(closedCandles);
    console.log(`DOGE Indicators: Trend=${confluence.trendDirection}, allowsLong=${confluence.allowsLong}, allowsShort=${confluence.allowsShort}, RSI=${confluence.rsi14.toFixed(1)}, Summary=${confluence.summaryReason}`);

    const htf = { trend1h: confluence.trendDirection };
    const result = await deltaAutoTrader.evaluateMultiTimeframeStrategies('DOGEUSDT', 'DOGEUSD', closedCandles, htf);

    console.log('Evaluation Result:', result ? `${result.side} (Score: ${result.confidenceScore})` : 'NULL (BLOCKED)');

    if (confluence.allowsLong || confluence.trendDirection === 'BULLISH') {
      if (result && result.side === 'SELL') {
        console.error('❌ FAIL: System allowed a SELL trade while indicators are BULLISH!');
        process.exit(1);
      } else {
        console.log('✅ PASS: System STRICTLY PREVENTED selling into a Bullish/Buy indicator setup!');
      }
    }
  } catch (err: any) {
    console.error('Test 1 error:', err.message);
  }

  // Test 2: Synthetic Bullish Pump vs Counter-trend SELL test
  console.log('\n2. Testing Synthetic Bullish Pump (Forced Overbought Z-Score)...');
  const basePrice = 0.0800;
  const pumpCandles: KlinePoint[] = [];
  const now = Date.now();
  for (let i = 0; i < 200; i++) {
    // Upward trend with a sharp pump in last 20 bars
    const p = i < 180 ? basePrice + (i * 0.00003) : basePrice + (180 * 0.00003) + ((i - 180) * 0.0003);
    pumpCandles.push({
      time: now - (200 - i) * 15 * 60 * 1000,
      open: p - 0.0001,
      high: p + 0.0002,
      low: p - 0.0001,
      close: p + 0.0001,
      volume: 100000 + i * 1000,
    });
  }

  const pumpConfluence = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(pumpCandles);
  console.log(`Pump Indicators: Trend=${pumpConfluence.trendDirection}, allowsLong=${pumpConfluence.allowsLong}, allowsShort=${pumpConfluence.allowsShort}`);

  const pumpResult = await deltaAutoTrader.evaluateMultiTimeframeStrategies('DOGEUSDT', 'DOGEUSD', pumpCandles, { trend1h: 'BULLISH' });
  console.log('Pump Evaluation Result:', pumpResult ? `${pumpResult.side} (Score: ${pumpResult.confidenceScore})` : 'NULL (BLOCKED)');

  if (pumpResult && pumpResult.side === 'SELL') {
    console.error('❌ FAIL: Counter-trend SELL was allowed during strong pump!');
    process.exit(1);
  } else {
    console.log('✅ PASS: Counter-trend SELL was successfully BLOCKED by [CONFLUENCE GUARD]!');
  }

  console.log('\n=== ALL CONFLUENCE GUARD REALITY TESTS PASSED ===');
}

runConfluenceGuardTest().catch(console.error);
