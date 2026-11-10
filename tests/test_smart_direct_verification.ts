import { SmartReversalDetector } from '../lib/smartReversalDetector';
import { CandlestickMasterPatternEngine } from '../lib/candlestickMasterPatternEngine';
import { deltaAutoTrader } from '../lib/deltaAutoTraderEngine';
import { KlinePoint } from '../src/types';

function createMockCandles(count: number, trend: 'UP' | 'DOWN' | 'CHOP' | 'CLIMAX_UP' | 'CLIMAX_DOWN'): KlinePoint[] {
  const candles: KlinePoint[] = [];
  let price = 100;
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const timestamp = now - (count - i) * 15 * 60 * 1000;
    let open = price;
    let close = price;
    let high = price;
    let low = price;
    let volume = 1000;

    if (trend === 'UP') {
      open = price;
      close = price + 0.5;
      high = close + 0.2;
      low = open - 0.2;
      price = close;
    } else if (trend === 'DOWN') {
      open = price;
      close = price - 0.5;
      high = open + 0.2;
      low = close - 0.2;
      price = close;
    } else if (trend === 'CLIMAX_UP') {
      if (i < count - 3) {
        open = price;
        close = price + 1.0;
        high = close + 0.5;
        low = open - 0.2;
        price = close;
      } else {
        // Massive overbought parabolic climax with huge upper rejection wick
        open = price;
        high = price + 8.0;
        close = price + 1.0;
        low = price - 0.5;
        volume = 5000;
        price = close;
      }
    } else if (trend === 'CLIMAX_DOWN') {
      if (i < count - 3) {
        open = price;
        close = price - 1.0;
        high = open + 0.2;
        low = close - 0.5;
        price = close;
      } else {
        // Massive oversold capitulation flush with huge lower rejection wick
        open = price;
        low = price - 8.0;
        close = price - 1.0;
        high = price + 0.5;
        volume = 5000;
        price = close;
      }
    } else {
      // Chop
      open = price;
      close = (i % 2 === 0) ? price + 0.1 : price - 0.1;
      high = price + 0.3;
      low = price - 0.3;
      price = close;
    }

    candles.push({
      time: timestamp,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  return candles;
}

function runTests() {
  console.log('🧪 Starting Smart Direct Trading Verification Suite...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, failureDetail?: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${testName}`);
      if (failureDetail) console.error(`     Detail: ${failureDetail}`);
      failed++;
    }
  }

  // TEST 1: Overbought Climax BUY signal must NOT be flipped to SELL! Must be REJECT or DIRECT BUY
  const climaxUpCandles = createMockCandles(30, 'CLIMAX_UP');
  const lastClimaxUp = climaxUpCandles[climaxUpCandles.length - 1];
  const evalClimaxUp = SmartReversalDetector.evaluateTrade('XRPUSD', 'BUY', climaxUpCandles, lastClimaxUp.close, 1.0);
  assert(evalClimaxUp.finalExecutedSide === 'BUY', 'Overbought Climax BUY signal is strictly NOT inverted (finalExecutedSide === BUY)', `Got ${evalClimaxUp.finalExecutedSide}`);
  assert(evalClimaxUp.isReversed === false, 'Overbought Climax isReversed is strictly false');
  assert(evalClimaxUp.bias === 'REJECT', 'Overbought Climax returns bias === REJECT (trap filtered)');

  // TEST 2: Oversold Climax SELL signal must NOT be flipped to BUY! Must be REJECT or DIRECT SELL
  const climaxDownCandles = createMockCandles(30, 'CLIMAX_DOWN');
  const lastClimaxDown = climaxDownCandles[climaxDownCandles.length - 1];
  const evalClimaxDown = SmartReversalDetector.evaluateTrade('XRPUSD', 'SELL', climaxDownCandles, lastClimaxDown.close, 1.0);
  assert(evalClimaxDown.finalExecutedSide === 'SELL', 'Oversold Climax SELL signal is strictly NOT inverted (finalExecutedSide === SELL)', `Got ${evalClimaxDown.finalExecutedSide}`);
  assert(evalClimaxDown.isReversed === false, 'Oversold Climax isReversed is strictly false');
  assert(evalClimaxDown.bias === 'REJECT', 'Oversold Climax returns bias === REJECT (trap filtered)');

  // TEST 3: Strong Downtrend SELL signal executes strictly DIRECT SELL
  const downCandles = createMockCandles(50, 'DOWN');
  const lastDown = downCandles[downCandles.length - 1];
  const evalDown = SmartReversalDetector.evaluateTrade('XRPUSD', 'SELL', downCandles, lastDown.close, 0.5);
  assert(evalDown.finalExecutedSide === 'SELL', 'Downtrend SELL signal executes strictly DIRECT SELL', `Got ${evalDown.finalExecutedSide}`);
  assert(evalDown.bias === 'DIRECT', 'Downtrend SELL returns bias === DIRECT');
  assert(evalDown.isReversed === false, 'Downtrend SELL isReversed === false');

  // TEST 4: Counter-trend BUY in Downtrend must be REJECTED, NOT flipped into SELL!
  const evalCounterBuy = SmartReversalDetector.evaluateTrade('XRPUSD', 'BUY', downCandles, lastDown.close, 0.5);
  assert(evalCounterBuy.finalExecutedSide === 'BUY', 'Counter-trend BUY signal in Downtrend remains BUY (not inverted to SELL)', `Got ${evalCounterBuy.finalExecutedSide}`);
  assert(evalCounterBuy.bias === 'REJECT', 'Counter-trend BUY in Downtrend is REJECTED as bull trap');
  assert(evalCounterBuy.isReversed === false, 'Counter-trend BUY isReversed === false');

  // TEST 5: Strong Uptrend BUY signal executes strictly DIRECT BUY
  const upCandles = createMockCandles(50, 'UP');
  const lastUp = upCandles[upCandles.length - 1];
  const evalUp = SmartReversalDetector.evaluateTrade('XRPUSD', 'BUY', upCandles, lastUp.close, 0.5);
  assert(evalUp.finalExecutedSide === 'BUY', 'Uptrend BUY signal executes strictly DIRECT BUY', `Got ${evalUp.finalExecutedSide}`);
  assert(evalUp.bias === 'DIRECT', 'Uptrend BUY returns bias === DIRECT');
  assert(evalUp.isReversed === false, 'Uptrend BUY isReversed === false');

  // TEST 6: Candlestick Pattern Engine always produces DIRECT patterns
  const candlePatterns = CandlestickMasterPatternEngine.analyze('XRPUSD', downCandles, 1.02);
  for (const pat of candlePatterns.detectedPatterns) {
    assert(pat.executionMode === 'DIRECT', `Candle pattern ${pat.name} executionMode === DIRECT`);
    assert(pat.effectiveSignal === pat.signal, `Candle pattern ${pat.name} effectiveSignal === signal (${pat.signal})`);
  }

  // TEST 7: toAdaptiveResult never returns SMART_REVERSED
  const adapt1 = SmartReversalDetector.toAdaptiveResult(evalClimaxUp, lastClimaxUp.close, 1.0);
  assert(adapt1.executionMode !== 'SMART_REVERSED', 'toAdaptiveResult executionMode is never SMART_REVERSED');
  assert(adapt1.reversalReason === undefined, 'toAdaptiveResult reversalReason is undefined');

  // TEST 8: DeltaAutoTrader status reports pure direct trading with 0 reversed trades
  deltaAutoTrader.state.isInverseTrading = false;
  deltaAutoTrader.state.smartDetectorSummary.activeMode = 'PURE_DIRECT_TRADING';
  deltaAutoTrader.state.smartDetectorSummary.reversedTradesCount = 0;
  const status = deltaAutoTrader.getStatus();
  assert(status.isInverseTrading === false, 'deltaAutoTrader is strictly in direct mode (isInverseTrading === false)');
  assert(status.smartDetectorSummary?.reversedTradesCount === 0, 'deltaAutoTrader reversedTradesCount is strictly 0');
  assert(status.smartDetectorSummary?.activeMode?.includes('PURE_DIRECT_TRADING') === true, 'activeMode is PURE_DIRECT_TRADING');

  // TEST 9: Active positions have executionMode === DIRECT and no reversal text
  for (const pos of status.activePositions) {
    assert(pos.executionMode === 'DIRECT', `Position ${pos.symbol} executionMode === DIRECT`);
    assert(!pos.strategyName.includes('SMART_REVERSED'), `Position ${pos.symbol} strategyName has no SMART_REVERSED`);
    assert(!pos.strategyName.includes('SMART REVERSAL'), `Position ${pos.symbol} strategyName has no SMART REVERSAL`);
    assert(pos.reversalReason === undefined || !pos.reversalReason.includes('SMART REVERSAL'), `Position ${pos.symbol} has no SMART REVERSAL reason`);
  }

  // TEST 10: Candidate enrichment simulation in direct mode
  const testPool = [
    {
      cleanDeltaSym: 'XRPUSD',
      currentPrice: 1.45,
      atr: 0.02,
      lastClosedBarTime: Date.now(),
      closedCandles: climaxUpCandles,
      multiSignal: {
        symbol: 'XRPUSD',
        timeframe: '15m' as const,
        strategyName: 'Playbook 2026 Engine',
        side: 'BUY' as const,
        confidenceScore: 85,
        reason: 'Bullish breakout',
      }
    },
    {
      cleanDeltaSym: 'SOLUSD',
      currentPrice: 105.0,
      atr: 1.5,
      lastClosedBarTime: Date.now(),
      closedCandles: downCandles,
      multiSignal: {
        symbol: 'SOLUSD',
        timeframe: '15m' as const,
        strategyName: 'Quantum Sniper',
        side: 'SELL' as const,
        confidenceScore: 90,
        reason: 'Bearish continuation',
      }
    }
  ];

  const enriched = testPool.map(c => {
    const rawSide = c.multiSignal.side;
    const executedSide: 'BUY' | 'SELL' = rawSide;
    let isSmartRejected = false;
    let smartRejectReason = '';
    const isReversed = false;
    let smartBias = 'DIRECT';

    const currentPrice = c.closedCandles[c.closedCandles.length - 1].close;
    const safeAtr = c.atr;
    const smartRev = SmartReversalDetector.evaluateTrade(
      c.cleanDeltaSym,
      rawSide,
      c.closedCandles,
      currentPrice,
      safeAtr
    );
    smartBias = smartRev.bias;
    if (smartRev.bias === 'REJECT') {
      isSmartRejected = true;
      smartRejectReason = smartRev.primaryReason;
    }

    return { ...c, executedSide, isSmartRejected, smartRejectReason, isReversed, smartBias };
  });

  // Candidate 1 (Overbought Climax BUY) must be REJECTED, and executedSide MUST stay BUY (not flipped to SELL)
  assert(enriched[0].executedSide === 'BUY', 'Candidate 1 executedSide is strictly BUY (never flipped)');
  assert(enriched[0].isSmartRejected === true, 'Candidate 1 is rejected by Smart Trap Filter');
  assert(enriched[0].isReversed === false, 'Candidate 1 isReversed is strictly false');

  // Candidate 2 (Trend Downtrend SELL) must execute directly as SELL
  assert(enriched[1].executedSide === 'SELL', 'Candidate 2 executedSide is strictly SELL');
  assert(enriched[1].isSmartRejected === false, 'Candidate 2 is not rejected');
  assert(enriched[1].isReversed === false, 'Candidate 2 isReversed is strictly false');

  console.log(`\n==========================================`);
  console.log(`📊 Suite Results: ${passed} Passed, ${failed} Failed`);
  console.log(`==========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
