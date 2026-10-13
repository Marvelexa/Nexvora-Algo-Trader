import fs from 'fs';
import path from 'path';
import { CryptoDedicatedStrategyEngine } from '../lib/cryptoDedicatedStrategyEngine';
import { QuantMathematicalEngine } from '../lib/quantMathematicalEngine';

const SYMBOLS = ['ADAUSD', 'SOLUSD', 'DOGEUSD', 'XRPUSD', 'AVAXUSD', 'SUIUSD', 'ETHUSD'];
const CACHE_DIR = path.join(process.cwd(), 'data', 'cache_candles');

function loadCandles(symbol: string): any[] {
  const file = path.join(CACHE_DIR, `${symbol}_15m_2500.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

async function testConfirmationRule() {
  console.log(`========================================================================`);
  console.log(`🧪 TESTING 1-BAR FOLLOW-THROUGH CONFIRMATION RULE`);
  console.log(`========================================================================\n`);

  let unconfirmedSignals = 0;
  let unconfirmedWins = 0;
  let confirmedSignals = 0;
  let confirmedWins = 0;

  for (const sym of SYMBOLS) {
    const bars = loadCandles(sym);
    if (bars.length < 100) continue;

    for (let i = 50; i < bars.length - 13; i++) {
      const window15m = bars.slice(i - 50, i + 1);
      const math = QuantMathematicalEngine.evaluateMarketMath(sym, window15m);
      if (!math.recommendedSide || math.quantScore < 50) continue;

      const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(window15m);
      if (math.recommendedSide === 'BUY' && !conf.allowsLong) continue;
      if (math.recommendedSide === 'SELL' && !conf.allowsShort) continue;

      const side = math.recommendedSide;
      const bar0 = bars[i];
      const bar1 = bars[i + 1]; // Follow-through candle

      const atr = conf.atr;

      // 1. UNCONFIRMED (Enter immediately at close of bar0)
      unconfirmedSignals++;
      let wonUnconf = false;
      const forwardUnconf = bars.slice(i + 1, i + 13);
      for (const fb of forwardUnconf) {
        const fav = side === 'BUY' ? fb.high - bar0.close : bar0.close - fb.low;
        const adv = side === 'BUY' ? bar0.close - fb.low : fb.high - bar0.close;
        if (fav >= 1.5 * atr && adv < 0.9 * atr) { wonUnconf = true; break; }
        if (adv >= 0.9 * atr) { break; }
      }
      if (wonUnconf) unconfirmedWins++;

      // 2. CONFIRMED (Only enter if bar1 confirmed the move!)
      // For BUY: bar1 must be GREEN and high1 > high0
      // For SELL: bar1 must be RED and low1 < low0
      const isConfirmed = side === 'BUY'
        ? (bar1.close > bar1.open && bar1.high > bar0.high)
        : (bar1.close < bar1.open && bar1.low < bar0.low);

      if (isConfirmed) {
        confirmedSignals++;
        let wonConf = false;
        const forwardConf = bars.slice(i + 2, i + 14); // Next bars after confirmed entry
        for (const fb of forwardConf) {
          const fav = side === 'BUY' ? fb.high - bar1.close : bar1.close - fb.low;
          const adv = side === 'BUY' ? bar1.close - fb.low : fb.high - bar1.close;
          if (fav >= 1.5 * atr && adv < 0.9 * atr) { wonConf = true; break; }
          if (adv >= 0.9 * atr) { break; }
        }
        if (wonConf) confirmedWins++;
      }
    }
  }

  console.log(`UNCONFIRMED ENTRY:`);
  console.log(`  Signals: ${unconfirmedSignals} | Wins: ${unconfirmedWins} (${((unconfirmedWins / unconfirmedSignals) * 100).toFixed(1)}%)\n`);

  console.log(`1-BAR CONFIRMED ENTRY (Filtered out false breakouts):`);
  console.log(`  Signals: ${confirmedSignals} | Wins: ${confirmedWins} (${((confirmedWins / confirmedSignals) * 100).toFixed(1)}%)\n`);
}

testConfirmationRule().catch(console.error);
