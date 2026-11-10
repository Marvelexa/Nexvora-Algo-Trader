import fs from 'fs';
import path from 'path';
import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { KlinePoint } from '../src/types';

const cacheDir = path.join(process.cwd(), 'data', 'cache_candles');
const filePath = path.join(cacheDir, 'BTCUSD_15m_1000.json');
const allCandles: KlinePoint[] = JSON.parse(fs.readFileSync(filePath, 'utf8'));

for (let i = 35; i < 150; i++) {
  const historySlice = allCandles.slice(0, i + 1);
  const closedHistory = historySlice.slice(0, -1);
  const stratRes = evaluateStrategyForPort(3025, 'BTCUSD', closedHistory);
  if (stratRes && stratRes.signal) {
    const entry = allCandles[i + 1].open;
    console.log(`Bar ${i}: ${stratRes.signal} @ ${entry} | SL: ${stratRes.customSL} | TP: ${stratRes.customTP} | RR: ${((Math.abs(stratRes.customTP - entry) / Math.abs(entry - stratRes.customSL))).toFixed(2)} | Strategy: ${stratRes.strategyName}`);
  }
}
