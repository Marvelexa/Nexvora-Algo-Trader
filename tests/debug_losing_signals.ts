import 'dotenv/config';
import { strategyEngine } from '../lib/cryptoDedicatedStrategyEngine';
import { quantMath } from '../lib/quantMathematicalEngine';
import { marketTraps } from '../lib/marketTrapsAndChopEngine';
import { SmartReversalDetector } from '../lib/smartReversalDetector';
import { KlinePoint } from '../src/types';

async function fetchCandles(symbol: string, limit: number = 500): Promise<KlinePoint[]> {
  const base = symbol.toUpperCase().replace(/USD[T]?$/, '');
  const binanceSym = `${base}USDT`;
  try {
    const res = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${binanceSym}&interval=15m&limit=${limit}`);
    if (res.ok) {
      const data = await res.json();
      return data.map((k: any) => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
    }
  } catch (e) {}
  return [];
}

async function debugTrades(sym: string) {
  console.log(`\n================ DEBUG TRADES FOR ${sym} ================`);
  const candles = await fetchCandles(sym, 500);
  if (!candles || candles.length < 100) return;

  for (let i = 50; i < candles.length - 1; i++) {
    const historySlice = candles.slice(0, i + 1);
    const closedHistory = historySlice.slice(0, -1);
    const lastClosed = closedHistory[closedHistory.length - 1];

    const evalResult = strategyEngine.evaluateSymbol(sym, closedHistory);
    const dedicatedSide = evalResult?.signal || (evalResult as any)?.readySignal || null;
    const dedicatedContext = dedicatedSide ? {
      side: dedicatedSide as 'BUY' | 'SELL',
      strategyName: evalResult?.strategyName || '',
      waveValue: evalResult?.diagnostics?.waveValue,
    } : null;

    const mathVerdict = quantMath.evaluateMarketMath(sym, closedHistory, null, dedicatedContext);

    if (mathVerdict.marketRegime === 'CHAOS_NO_TRADE') continue;
    if (!mathVerdict.recommendedSide) continue;

    const side = mathVerdict.recommendedSide;
    const score = mathVerdict.quantScore;

    if (score < 65) continue;

    const sr = quantMath.calculateSupportResistance(closedHistory);

    console.log(`[Bar ${i}] ${sym} ${side} Score=${score} Regime=${mathVerdict.marketRegime} MacroTrend=${sr.macroTrend} Price=$${lastClosed.close} (EMA50=$${sr.ema50.toFixed(2)}, EMA200=$${sr.ema200.toFixed(2)})`);
    console.log(`   Reasons: ${mathVerdict.reasons.slice(0, 3).join(' | ')}`);
  }
}

async function main() {
  await debugTrades('SUIUSD');
  await debugTrades('SOLUSD');
  await debugTrades('APTUSD');
}

main().catch(console.error);
