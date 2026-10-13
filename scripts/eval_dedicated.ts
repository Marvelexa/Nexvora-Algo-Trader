import fs from 'fs';
import path from 'path';
import { strategyEngine } from '../lib/cryptoDedicatedStrategyEngine';
import { QuantMathematicalEngine } from '../lib/quantMathematicalEngine';

const SYMBOLS = ['ADAUSD', 'SOLUSD', 'DOGEUSD', 'XRPUSD', 'AVAXUSD', 'SUIUSD', 'ETHUSD', 'BTCUSD'];
const CACHE_DIR = path.join(process.cwd(), 'data', 'cache_candles');

function loadCandles(symbol: string): any[] {
  const file = path.join(CACHE_DIR, `${symbol}_15m_2500.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

async function evaluateDedicatedStrategies() {
  console.log(`========================================================================`);
  console.log(`🔬 TESTING NATIVE DEDICATED STRATEGIES vs HISTORICAL CANDLES`);
  console.log(`========================================================================\n`);

  for (const sym of SYMBOLS) {
    const bars = loadCandles(sym);
    if (bars.length < 100) continue;

    let dedicatedSignals = 0;
    let dedicatedWins = 0;
    let mathSignals = 0;
    let mathWins = 0;

    for (let i = 60; i < bars.length - 12; i++) {
      const window15m = bars.slice(i - 60, i + 1);
      const current = window15m[window15m.length - 1];
      const forwardBars = bars.slice(i + 1, i + 13); // next 3 hours

      // 1. Dedicated Strategy Engine
      const ded = strategyEngine.evaluateSymbol(sym, window15m);
      if (ded.signal) {
        dedicatedSignals++;
        const targetGain = 1.0; // 1.0% favorable
        const maxLoss = 0.7; // 0.7% adverse

        let won = false;
        for (const fb of forwardBars) {
          const favorable = ded.signal === 'BUY'
            ? ((fb.high - current.close) / current.close) * 100
            : ((current.close - fb.low) / current.close) * 100;
          const adverse = ded.signal === 'BUY'
            ? ((current.close - fb.low) / current.close) * 100
            : ((fb.high - current.close) / current.close) * 100;

          if (favorable >= targetGain && adverse < maxLoss) {
            won = true;
            break;
          }
          if (adverse >= maxLoss) {
            won = false;
            break;
          }
        }
        if (won) dedicatedWins++;
      }

      // 2. Math Engine
      const math = QuantMathematicalEngine.evaluateMarketMath(sym, window15m);
      if (math.recommendedSide && math.quantScore >= 55) {
        mathSignals++;
        const targetGain = 1.0;
        const maxLoss = 0.7;

        let won = false;
        for (const fb of forwardBars) {
          const favorable = math.recommendedSide === 'BUY'
            ? ((fb.high - current.close) / current.close) * 100
            : ((current.close - fb.low) / current.close) * 100;
          const adverse = math.recommendedSide === 'BUY'
            ? ((current.close - fb.low) / current.close) * 100
            : ((fb.high - current.close) / current.close) * 100;

          if (favorable >= targetGain && adverse < maxLoss) {
            won = true;
            break;
          }
          if (adverse >= maxLoss) {
            won = false;
            break;
          }
        }
        if (won) mathWins++;
      }
    }

    const dedWr = dedicatedSignals > 0 ? ((dedicatedWins / dedicatedSignals) * 100).toFixed(1) : '0';
    const mathWr = mathSignals > 0 ? ((mathWins / mathSignals) * 100).toFixed(1) : '0';
    console.log(`${sym.padEnd(8)} | Dedicated: ${dedicatedSignals} sigs (${dedWr}% Win) | Math: ${mathSignals} sigs (${mathWr}% Win)`);
  }
}

evaluateDedicatedStrategies().catch(console.error);
