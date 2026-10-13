import fs from 'fs';
import path from 'path';
import { QuantMathematicalEngine } from '../lib/quantMathematicalEngine';
import { CryptoDedicatedStrategyEngine } from '../lib/cryptoDedicatedStrategyEngine';

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache_candles');

function loadCandles(symbol: string): CandleData[] {
  const file = path.join(CACHE_DIR, `${symbol}_15m_1000.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

async function inspectLosingTrades() {
  console.log(`========================================================================`);
  console.log(`🔍 DETAILED POST-MORTEM OF LOSING TRADES (BAR-BY-BAR ANALYSIS)`);
  console.log(`========================================================================\n`);

  // Target pairs: ADAUSD, SOLUSD, XRPUSD, DOGEUSD, AVAXUSD, ETHUSD, BTCUSD
  const symbols = ['ADAUSD', 'SOLUSD', 'ETHUSD', 'BTCUSD', 'AVAXUSD'];

  for (const sym of symbols) {
    const bars = loadCandles(sym);
    if (bars.length < 100) continue;

    console.log(`\n=================== ${sym} LOSS DIAGNOSIS ===================`);

    for (let i = 50; i < bars.length - 8; i++) {
      const window15m = bars.slice(i - 50, i + 1);
      const entryBar = window15m[window15m.length - 1];

      const math = QuantMathematicalEngine.evaluateMarketMath(sym, window15m);
      if (!math.recommendedSide || math.quantScore < 60) continue;

      const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(window15m);
      const indSide = conf.allowsLong && conf.trendDirection === 'BULLISH' ? 'BUY' : (conf.allowsShort && conf.trendDirection === 'BEARISH' ? 'SELL' : null);
      if (indSide !== math.recommendedSide) continue;

      const side = math.recommendedSide;
      const entryPrice = entryBar.close;

      // Look at next 4 bars (next 1 hour)
      const next4 = bars.slice(i + 1, i + 5);
      const lowestNext = Math.min(...next4.map(b => b.low));
      const highestNext = Math.max(...next4.map(b => b.high));
      const endPrice = next4[next4.length - 1].close;

      const isLoss = side === 'BUY'
        ? (lowestNext < entryPrice - (conf.atr * 0.9) || endPrice < entryPrice)
        : (highestNext > entryPrice + (conf.atr * 0.9) || endPrice > entryPrice);

      if (isLoss) {
        // Detailed bar metrics
        const prevBar = window15m[window15m.length - 2];
        const isEntryGreen = entryBar.close > entryBar.open;
        const entryBody = Math.abs(entryBar.close - entryBar.open);
        const entryRange = entryBar.high - entryBar.low;
        const upperWick = entryBar.high - Math.max(entryBar.open, entryBar.close);
        const lowerWick = Math.min(entryBar.open, entryBar.close) - entryBar.low;

        const closes = window15m.map(b => b.close);
        const ema20Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20);
        const ema50Arr = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50);
        const ema20 = ema20Arr[ema20Arr.length - 1];
        const ema50 = ema50Arr[ema50Arr.length - 1];
        const adx = CryptoDedicatedStrategyEngine.calculateADX(window15m, 14);

        console.log(`🚨 FAILED ${side} on ${new Date(entryBar.time).toISOString()} at $${entryPrice}:`);
        console.log(`   - Math Score: ${math.quantScore} | Conf Score: ${conf.confluenceScore} | ADX: ${adx.toFixed(1)} | RSI: ${conf.rsi14.toFixed(1)}`);
        console.log(`   - Entry Candle: ${isEntryGreen ? 'GREEN' : 'RED'} | Body: $${entryBody.toFixed(4)} | UpperWick: $${upperWick.toFixed(4)} | LowerWick: $${lowerWick.toFixed(4)}`);
        console.log(`   - EMA Alignment: Price=$${entryPrice.toFixed(4)}, EMA20=$${ema20.toFixed(4)}, EMA50=$${ema50.toFixed(4)}`);
        console.log(`   - Next 4 Bars Action: [${next4.map(b => (b.close > b.open ? '🟩' : '🟥') + ` $${b.close.toFixed(4)}`).join(', ')}]`);

        // Check why it failed
        const flaws: string[] = [];
        if (side === 'BUY' && !isEntryGreen) flaws.push('Bought on a RED candle (Catching a falling knife)');
        if (side === 'SELL' && isEntryGreen) flaws.push('Shorted on a GREEN candle (Standing in front of a green truck)');
        if (side === 'BUY' && upperWick > entryBody) flaws.push('Upper rejection wick (Bearish pin bar rejection at resistance)');
        if (side === 'SELL' && lowerWick > entryBody) flaws.push('Lower rejection wick (Bullish hammer rejection at support)');
        if (adx < 22) flaws.push(`Dead market chop (ADX ${adx.toFixed(1)} < 22)`);
        if (side === 'BUY' && entryPrice < ema20) flaws.push('Price below EMA 20 (Weak short-term momentum)');
        if (side === 'SELL' && entryPrice > ema20) flaws.push('Price above EMA 20 (Strong short-term counter-momentum)');
        if (side === 'BUY' && conf.rsi14 > 65) flaws.push(`RSI Overbought (${conf.rsi14.toFixed(1)})`);
        if (side === 'SELL' && conf.rsi14 < 35) flaws.push(`RSI Oversold (${conf.rsi14.toFixed(1)})`);

        console.log(`   ⚠️ SYSTEM FLAWS DETECTED: ${flaws.join(' | ') || 'Volatility whipsaw'}\n`);
      }
    }
  }
}

inspectLosingTrades().catch(console.error);
