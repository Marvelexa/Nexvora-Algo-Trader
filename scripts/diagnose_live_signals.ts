import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { deltaExchange } from '../lib/deltaExchangeEngine';

async function diagnose() {
  const coins = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'DOGEUSD', 'ADAUSD', 'AVAXUSD', 'SUIUSD', 'LINKUSD'];
  const ports = [3001, 3002, 3003, 3004, 3005, 3006, 3007, 3025];
  
  console.log(`Starting real-time signal diagnostics at ${new Date().toISOString()}`);
  
  for (const c of coins) {
    try {
      const candles = await deltaExchange.getKlines(c, 15, 60);
      if (!candles || candles.length < 20) {
        console.log(`Coin ${c}: Insufficient candle data (${candles?.length || 0})`);
        continue;
      }
      
      const lastCandle = candles[candles.length - 1];
      console.log(`\n================== ${c} [Price: ${lastCandle.close}] ==================`);
      
      for (const port of ports) {
        const res = evaluateStrategyForPort(port, c, candles);
        if (res && res.signal) {
          console.log(`  [PORT ${port}] -> ${res.signal} | ${res.strategyName} | Confidence: ${res.confidenceScore}% | SL: ${res.customSL?.toFixed(4)} | TP: ${res.customTP?.toFixed(4)}`);
          if (res.reasons && res.reasons.length) {
            console.log(`     Reasons: ${res.reasons.slice(0, 2).join('; ')}`);
          }
        } else {
          console.log(`  [PORT ${port}] -> NO SIGNAL (Confidence: ${res?.confidenceScore || 0}% / ${res?.strategyName || 'None'})`);
        }
      }
    } catch (err: any) {
      console.log(`Error evaluating ${c}: ${err.message}`);
    }
  }
}

diagnose().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
