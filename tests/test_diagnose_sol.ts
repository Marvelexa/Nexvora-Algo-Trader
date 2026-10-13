import { deltaExchange } from '../lib/deltaExchangeEngine';
import { QuantMathematicalEngine } from '../lib/quantMathematicalEngine';
import { strategyEngine } from '../lib/cryptoDedicatedStrategyEngine';

async function diagnose() {
  const candles = await deltaExchange.getKlines('SOLUSD', '15m', 100);
  console.log('Fetched candles count:', candles.length);
  const last5 = candles.slice(-5);
  console.log('Last 5 candles:');
  last5.forEach((c, idx) => {
    console.log(
      '[' + idx + '] time=' + new Date(c.time).toLocaleTimeString() +
      ' open=' + c.open + ' high=' + c.high + ' low=' + c.low + ' close=' + c.close +
      ' color=' + (c.close > c.open ? 'GREEN' : 'RED') +
      ' diff=' + (c.close - c.open).toFixed(3)
    );
  });

  const micro = await deltaExchange.getMicrostructureAndDerivatives('SOLUSD').catch(() => null);
  console.log('\nMicrostructure:', micro);

  const stratEval = strategyEngine.evaluateSymbol('SOLUSDT', candles);
  console.log('\nStrategy Engine Signal:');
  console.log('Signal:', stratEval?.signal);
  console.log('WaveTrend:', stratEval?.diagnostics?.waveTrend);
  console.log('SuperTrend:', stratEval?.diagnostics?.superTrend);

  const mathVerdict = QuantMathematicalEngine.evaluateMarketMath('SOLUSD', candles, micro, {
    side: stratEval?.signal,
    strategyName: stratEval?.strategyName,
    waveValue: stratEval?.diagnostics?.waveValue,
  });
  console.log('\nQuant Math Verdict:');
  console.log('Recommended Side:', mathVerdict.recommendedSide);
  console.log('Quant Score:', mathVerdict.quantScore);
  console.log('Market Regime:', mathVerdict.marketRegime);
  console.log('Group Scores:', JSON.stringify(mathVerdict.scores, null, 2));
  console.log('Reasons:', mathVerdict.reasons);
}

diagnose();
