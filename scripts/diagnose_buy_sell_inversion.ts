import fs from 'fs';
import path from 'path';
import { CryptoDedicatedStrategyEngine } from '../lib/cryptoDedicatedStrategyEngine';
import { QuantMathematicalEngine } from '../lib/quantMathematicalEngine';

const CACHE_DIR = path.join(process.cwd(), 'data', 'cache_candles');
const symbols = ['SUIUSD', 'SOLUSD', 'DOGEUSD', 'AVAXUSD'];

for (const sym of symbols) {
  const filePath = path.join(CACHE_DIR, `${sym}_15m_2500.json`);
  if (!fs.existsSync(filePath)) continue;
  const bars: any[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

  console.log(`\n================================================================`);
  console.log(`🔍 AUDITING SIGNALS VS FORWARD CANDLES ON ${sym} (${bars.length} bars)`);
  console.log(`================================================================`);

  let totalBuySignals = 0;
  let buyNextBarGreen = 0;
  let buyNextBarRed = 0;
  let buyTargetReached = 0;
  let buyStopHit = 0;

  let totalSellSignals = 0;
  let sellNextBarRed = 0;
  let sellNextBarGreen = 0;
  let sellTargetReached = 0;
  let sellStopHit = 0;

  const failingBuys: any[] = [];
  const failingSells: any[] = [];

  for (let i = 60; i < bars.length - 10; i++) {
    const win = bars.slice(i - 60, i + 1);
    const curr = win[win.length - 1];
    const next1 = bars[i + 1];
    const forwardBars = bars.slice(i + 1, i + 10);

    const math = QuantMathematicalEngine.evaluateMarketMath(sym, win);
    const conf = CryptoDedicatedStrategyEngine.evaluateInstitutionalConfluence(win);
    const atr = conf.atr || (curr.close * 0.015);

    // Filter by threshold >= 70
    if (math.recommendedSide === 'BUY' && math.quantScore >= 70) {
      totalBuySignals++;
      const isNextGreen = next1.close > next1.open;
      if (isNextGreen) buyNextBarGreen++;
      else buyNextBarRed++;

      // Check TP (+1.8 ATR) vs SL (-0.8 ATR)
      const targetPrice = curr.close + 1.8 * atr;
      const stopPrice = curr.close - 0.8 * atr;
      let outcome = 'TIMEOUT';
      for (const fb of forwardBars) {
        if (fb.low <= stopPrice) { outcome = 'STOP_LOSS'; break; }
        if (fb.high >= targetPrice) { outcome = 'TARGET_HIT'; break; }
      }
      if (outcome === 'TARGET_HIT') buyTargetReached++;
      else if (outcome === 'STOP_LOSS') {
        buyStopHit++;
        if (failingBuys.length < 3) {
          failingBuys.push({
            time: new Date(curr.time).toISOString(),
            price: curr.close,
            score: math.quantScore,
            isNextGreen,
            reasons: math.reasons,
            next1Change: (((next1.close - curr.close) / curr.close) * 100).toFixed(2) + '%',
          });
        }
      }
    }

    if (math.recommendedSide === 'SELL' && math.quantScore >= 70) {
      totalSellSignals++;
      const isNextRed = next1.close < next1.open;
      if (isNextRed) sellNextBarRed++;
      else sellNextBarGreen++;

      // Check TP (-1.8 ATR) vs SL (+0.8 ATR)
      const targetPrice = curr.close - 1.8 * atr;
      const stopPrice = curr.close + 0.8 * atr;
      let outcome = 'TIMEOUT';
      for (const fb of forwardBars) {
        if (fb.high >= stopPrice) { outcome = 'STOP_LOSS'; break; }
        if (fb.low <= targetPrice) { outcome = 'TARGET_HIT'; break; }
      }
      if (outcome === 'TARGET_HIT') sellTargetReached++;
      else if (outcome === 'STOP_LOSS') {
        sellStopHit++;
        if (failingSells.length < 3) {
          failingSells.push({
            time: new Date(curr.time).toISOString(),
            price: curr.close,
            score: math.quantScore,
            isNextRed,
            reasons: math.reasons,
            next1Change: (((next1.close - curr.close) / curr.close) * 100).toFixed(2) + '%',
          });
        }
      }
    }
  }

  console.log(`BUY Signals: Total=${totalBuySignals}`);
  console.log(`  Next Bar Green (Follow-through): ${buyNextBarGreen} (${totalBuySignals ? ((buyNextBarGreen/totalBuySignals)*100).toFixed(1) : 0}%)`);
  console.log(`  Next Bar Red (Immediate Inversion): ${buyNextBarRed} (${totalBuySignals ? ((buyNextBarRed/totalBuySignals)*100).toFixed(1) : 0}%)`);
  console.log(`  Target Hit: ${buyTargetReached} | Stop Hit: ${buyStopHit} | WinRate: ${(buyTargetReached + buyStopHit) ? ((buyTargetReached / (buyTargetReached + buyStopHit))*100).toFixed(1) : 0}%`);

  console.log(`SELL Signals: Total=${totalSellSignals}`);
  console.log(`  Next Bar Red (Follow-through): ${sellNextBarRed} (${totalSellSignals ? ((sellNextBarRed/totalSellSignals)*100).toFixed(1) : 0}%)`);
  console.log(`  Next Bar Green (Immediate Inversion): ${sellNextBarGreen} (${totalSellSignals ? ((sellNextBarGreen/totalSellSignals)*100).toFixed(1) : 0}%)`);
  console.log(`  Target Hit: ${sellTargetReached} | Stop Hit: ${sellStopHit} | WinRate: ${(sellTargetReached + sellStopHit) ? ((sellTargetReached / (sellTargetReached + sellStopHit))*100).toFixed(1) : 0}%`);

  if (failingBuys.length > 0) {
    console.log(`\nSample Failing BUYs:`);
    console.log(JSON.stringify(failingBuys, null, 2));
  }
  if (failingSells.length > 0) {
    console.log(`\nSample Failing SELLs:`);
    console.log(JSON.stringify(failingSells, null, 2));
  }
}
