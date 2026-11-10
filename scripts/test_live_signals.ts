import { deltaExchange } from '../lib/deltaExchangeEngine';
import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { UniversalTradeGuard } from '../lib/risk/universalTradeGuard';
import { PortfolioMarketRegimeEngine } from '../lib/risk/portfolioMarketRegimeEngine';

async function test() {
  const symbols = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'DOGEUSD', 'ADAUSD', 'BNBUSD', 'LINKUSD', 'AVAXUSD', 'SUIUSD'];
  console.log('Fetching live candles from Delta for symbols...');
  for (const sym of symbols) {
    try {
      const candles = await deltaExchange.getChartHistory(sym, 15, 60);
      if (!candles || candles.length < 30) {
        console.log(`${sym}: candles missing or < 30 (got ${candles ? candles.length : 0})`);
        continue;
      }
      const cur = candles[candles.length - 1];
      const prev = candles[candles.length - 2];
      const closes = candles.map(c => c.close);
      
      console.log(`\n======================================================`);
      console.log(`SYMBOL: ${sym} | Current Price: ${cur.close} | Prev Close: ${prev.close}`);
      console.log(`Cur Candle: O=${cur.open}, H=${cur.high}, L=${cur.low}, C=${cur.close} (IsGreen: ${cur.close > cur.open})`);
      
      for (const port of ['3002', '3003', '3004', '3005', '3006', '3007', '3008', '3009', '3010']) {
        const res = evaluateStrategyForPort(port, sym, candles);
        if (res && res.signal) {
          console.log(`  -> [TRIGGERED] Port ${port}: ${res.signal} (${res.confidenceScore}%) | Setup: ${res.setupType || res.strategyName} | SL: ${res.customSL || res.stopLossPrice} | TP: ${res.customTP || res.tp1Price}`);
          
          const regimeCheck = PortfolioMarketRegimeEngine.evaluateRegimeGate({
            symbol: sym,
            side: res.signal,
            candles,
          });
          console.log(`     Regime Gate: allowed=${regimeCheck.allowed}, reason=${regimeCheck.reason}`);

          const preTradeGate = UniversalTradeGuard.evaluatePreTradeGate({
            symbol: sym,
            signal: res.signal,
            entryPrice: cur.close,
            stopLossPrice: res.customSL || res.stopLossPrice,
            takeProfitPrice: res.customTP || res.tp1Price,
            candles,
            confidenceScore: res.confidenceScore,
            isFastScalpSlot: true,
          });
          console.log(`     Pre-Trade Gate: allowed=${preTradeGate.allowed}, reason=${preTradeGate.reason}`);
        } else if (port === '3005') {
          console.log(`  Port 3005 (Hybrid Master Crypto SMC): No signal on current 15m candle.`);
        }
      }
    } catch (e: any) {
      console.error(`${sym} error:`, e.message);
    }
  }
}

test();
