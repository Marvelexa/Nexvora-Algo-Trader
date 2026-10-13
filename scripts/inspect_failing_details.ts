import fs from 'fs';
import path from 'path';
import { CryptoDedicatedStrategyEngine } from '../lib/cryptoDedicatedStrategyEngine';

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache_candles');

function inspectBar(symbol: string, targetTime: string) {
  const filePath = path.join(CACHE_DIR, `${symbol}_15m_2500.json`);
  const bars: any[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const targetMs = new Date(targetTime).getTime();
  const idx = bars.findIndex(b => Math.abs(b.time - targetMs) < 60000);
  if (idx === -1) {
    console.log(`Could not find bar for ${symbol} at ${targetTime}`);
    return;
  }

  console.log(`\n======================================================`);
  console.log(`INSPECTING ${symbol} AT ${targetTime} (idx=${idx})`);
  console.log(`======================================================`);

  const windowBars = bars.slice(Math.max(0, idx - 30), idx + 1);
  const closes = windowBars.map(c => c.close);
  const ema9 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 9).slice(-1)[0];
  const ema20 = CryptoDedicatedStrategyEngine.calculateEMA(closes, 20).slice(-1)[0];
  const ema50 = CryptoDedicatedStrategyEngine.calculateEMA(closes, Math.min(50, closes.length)).slice(-1)[0];

  const sigBar = bars[idx];
  const isSigGreen = sigBar.close > sigBar.open;
  console.log(`SIGNAL BAR [idx=${idx}]:`);
  console.log(`  Time: ${new Date(sigBar.time).toISOString()}`);
  console.log(`  O=${sigBar.open} H=${sigBar.high} L=${sigBar.low} C=${sigBar.close} (${isSigGreen ? 'GREEN 🟩' : 'RED 🟥'})`);
  console.log(`  EMA9=${ema9.toFixed(4)} EMA20=${ema20.toFixed(4)} EMA50=${ema50.toFixed(4)}`);
  console.log(`  Price vs EMA20: ${sigBar.close > ema20 ? 'ABOVE EMA20 ⬆️' : 'BELOW EMA20 ⬇️'}`);
  console.log(`  Price vs EMA50: ${sigBar.close > ema50 ? 'ABOVE EMA50 ⬆️' : 'BELOW EMA50 ⬇️'}`);

  console.log(`FORWARD 5 BARS:`);
  for (let f = 1; f <= 5; f++) {
    const fb = bars[idx + f];
    if (!fb) break;
    const isGreen = fb.close > fb.open;
    const chg = (((fb.close - sigBar.close) / sigBar.close) * 100).toFixed(2);
    console.log(`  +${f} [${new Date(fb.time).toISOString().slice(11, 16)}] O=${fb.open} H=${fb.high} L=${fb.low} C=${fb.close} (${chg}%) ${isGreen ? 'GREEN 🟩' : 'RED 🟥'}`);
  }
}

inspectBar('DOGEUSD', '2026-09-27T13:30:00.000Z');
inspectBar('DOGEUSD', '2026-09-29T06:30:00.000Z');
inspectBar('AVAXUSD', '2026-09-12T11:45:00.000Z');
