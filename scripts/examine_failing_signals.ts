import fs from 'fs';
import path from 'path';
import { CryptoDedicatedStrategyEngine } from '../lib/cryptoDedicatedStrategyEngine';
import { QuantMathematicalEngine } from '../lib/quantMathematicalEngine';

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache_candles');
const symbol = 'ADAUSD';

const f5k = path.join(CACHE_DIR, `${symbol}_15m_5000.json`);
const bars: any[] = JSON.parse(fs.readFileSync(f5k, 'utf-8'));

console.log(`Inspecting failing BUY and SELL signals on ${symbol}...`);

let buyFailCount = 0;
let sellFailCount = 0;

for (let i = 60; i < bars.length - 10; i++) {
  const win = bars.slice(i - 60, i + 1);
  const curr = win[win.length - 1];
  const next5 = bars.slice(i + 1, i + 6);

  const math = QuantMathematicalEngine.evaluateMarketMath(symbol, win);
  const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
  const closes = win.map(c => c.close);
  const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
  const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 50).slice(-1)[0];
  const adx = CryptoDedicatedStrategyEngine.calculateADX(win, 14);

  // If system said BUY
  if (math.recommendedSide === 'BUY' && math.quantScore >= 50 && buyFailCount < 5) {
    // Check if next 3 candles dumped (close[i+3] < curr.close - 1.0 * atr)
    const atr = conf.atr;
    if (next5[2].close < curr.close - 0.8 * atr) {
      buyFailCount++;
      console.log(`\n=======================================================`);
      console.log(`❌ FAILING BUY #${buyFailCount} at ${new Date(curr.time).toISOString()}`);
      console.log(`Signal Candle: O=${curr.open} H=${curr.high} L=${curr.low} C=${curr.close} | RSI=${conf.rsi14.toFixed(1)} ADX=${adx.toFixed(1)} Score=${math.quantScore}`);
      console.log(`EMA20=${ema20.toFixed(4)} EMA50=${ema50.toFixed(4)} | Reasons: ${math.reasons.slice(0, 3).join('; ')}`);
      console.log(`Forward 5 Candles:`);
      next5.forEach((fb, idx) => {
        const change = (((fb.close - curr.close) / curr.close) * 100).toFixed(2);
        console.log(`  +${idx+1} [${new Date(fb.time).toISOString().slice(11, 16)}] O=${fb.open} H=${fb.high} L=${fb.low} C=${fb.close} (${change}%) ${fb.close > fb.open ? '🟩' : '🟥'}`);
      });
    }
  }

  // If system said SELL
  if (math.recommendedSide === 'SELL' && math.quantScore >= 50 && sellFailCount < 5) {
    const atr = conf.atr;
    if (next5[2].close > curr.close + 0.8 * atr) {
      sellFailCount++;
      console.log(`\n=======================================================`);
      console.log(`❌ FAILING SELL #${sellFailCount} at ${new Date(curr.time).toISOString()}`);
      console.log(`Signal Candle: O=${curr.open} H=${curr.high} L=${curr.low} C=${curr.close} | RSI=${conf.rsi14.toFixed(1)} ADX=${adx.toFixed(1)} Score=${math.quantScore}`);
      console.log(`EMA20=${ema20.toFixed(4)} EMA50=${ema50.toFixed(4)} | Reasons: ${math.reasons.slice(0, 3).join('; ')}`);
      console.log(`Forward 5 Candles:`);
      next5.forEach((fb, idx) => {
        const change = (((fb.close - curr.close) / curr.close) * 100).toFixed(2);
        console.log(`  +${idx+1} [${new Date(fb.time).toISOString().slice(11, 16)}] O=${fb.open} H=${fb.high} L=${fb.low} C=${fb.close} (${change}%) ${fb.close > fb.open ? '🟩' : '🟥'}`);
      });
    }
  }

  if (buyFailCount >= 5 && sellFailCount >= 5) break;
}
