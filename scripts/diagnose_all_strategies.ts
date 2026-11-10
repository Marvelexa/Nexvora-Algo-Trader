import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry.js';
import { deltaExchange } from '../lib/deltaExchangeEngine.js';
import { PRIME_LIQUID_WATCHLIST } from '../lib/deltaAutoTraderEngine.js';

async function diagnoseAll() {
  const ports = ['3002', '3003', '3004', '3005', '3006', '3007', '3025'];
  
  // Fetch candles for each symbol
  const candleMap: Record<string, any[]> = {};
  for (const sym of PRIME_LIQUID_WATCHLIST) {
    const raw = await deltaExchange.getChartHistory(sym, 15, 60);
    candleMap[sym] = raw.map(c => ({
      time: c.time * 1000,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume
    }));
  }

  for (const port of ports) {
    console.log(`\n=== PORT ${port} ===`);
    let found = 0;
    for (const sym of PRIME_LIQUID_WATCHLIST) {
      const candles = candleMap[sym];
      if (!candles || candles.length < 30) continue;
      const res = evaluateStrategyForPort(port, sym, candles);
      if (res && res.signal) {
        found++;
        console.log(`  [${sym}] ${res.signal} (Score: ${res.confidenceScore}) => Reason: ${res.reasons ? res.reasons[0] : ''}`);
      }
    }
    if (found === 0) {
      console.log('  No signals triggered yet on current 15M candles');
    }
  }
}

diagnoseAll();
