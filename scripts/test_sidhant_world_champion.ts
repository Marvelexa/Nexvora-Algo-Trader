import { deltaExchange } from '../lib/deltaExchangeEngine';
import { sidhantEngine } from '../lib/strategies/sidhantWorldChampionEngine';
import { KlinePoint } from '../src/types';

interface SimulatedTrade {
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  entryTime: number;
  takeProfit: number;
  stopLoss: number;
  exitPrice: number;
  exitTime: number;
  outcome: 'WIN' | 'LOSS';
  pnlPercent: number;
  riskReward: number;
  reason: string;
}

const TEST_SYMBOLS = [
  'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'DOGEUSD',
  'AVAXUSD', 'SUIUSD', 'LINKUSD', 'NEARUSD', 'ADAUSD'
];

async function runBacktest() {
  console.log('========================================================================');
  console.log('  SIDHANT KISS-HOR 3-STEP WORLD CHAMPION METHOD (https://youtu.be/-ygKPKj3uj8)');
  console.log('  Multi-Coin Historical Backtest on Genuine Delta Exchange India 15M Data');
  console.log('========================================================================\n');

  const allTrades: SimulatedTrade[] = [];

  for (const symbol of TEST_SYMBOLS) {
    console.log(`Analyzing ${symbol}...`);
    let candles: KlinePoint[] = [];
    try {
      candles = await deltaExchange.getKlines(symbol, '15m', 1000);
    } catch (e: any) {
      console.warn(`Could not fetch candles for ${symbol}: ${e.message}`);
      continue;
    }

    if (!candles || candles.length < 50) {
      console.warn(`Insufficient candle history for ${symbol} (got ${candles?.length || 0})`);
      continue;
    }

    console.log(`  Loaded ${candles.length} genuine 15M candles for ${symbol}. Simulating strategy...`);

    let activeTrade: SimulatedTrade | null = null;
    let symbolTrades = 0;
    let symbolWins = 0;

    // Slide through candles
    for (let i = 40; i < candles.length; i++) {
      const windowCandles = candles.slice(0, i + 1);
      const currentBar = candles[i];

      // If in trade, check exit
      if (activeTrade) {
        if (activeTrade.side === 'BUY') {
          // Check TP
          if (currentBar.high >= activeTrade.takeProfit) {
            activeTrade.exitPrice = activeTrade.takeProfit;
            activeTrade.exitTime = currentBar.time;
            activeTrade.outcome = 'WIN';
            activeTrade.pnlPercent = ((activeTrade.takeProfit - activeTrade.entryPrice) / activeTrade.entryPrice) * 100;
            allTrades.push(activeTrade);
            symbolTrades++;
            symbolWins++;
            activeTrade = null;
            continue;
          }
          // Check SL
          if (currentBar.low <= activeTrade.stopLoss) {
            activeTrade.exitPrice = activeTrade.stopLoss;
            activeTrade.exitTime = currentBar.time;
            activeTrade.outcome = 'LOSS';
            activeTrade.pnlPercent = ((activeTrade.stopLoss - activeTrade.entryPrice) / activeTrade.entryPrice) * 100;
            allTrades.push(activeTrade);
            symbolTrades++;
            activeTrade = null;
            continue;
          }
        } else { // SELL
          // Check TP
          if (currentBar.low <= activeTrade.takeProfit) {
            activeTrade.exitPrice = activeTrade.takeProfit;
            activeTrade.exitTime = currentBar.time;
            activeTrade.outcome = 'WIN';
            activeTrade.pnlPercent = ((activeTrade.entryPrice - activeTrade.takeProfit) / activeTrade.entryPrice) * 100;
            allTrades.push(activeTrade);
            symbolTrades++;
            symbolWins++;
            activeTrade = null;
            continue;
          }
          // Check SL
          if (currentBar.high >= activeTrade.stopLoss) {
            activeTrade.exitPrice = activeTrade.stopLoss;
            activeTrade.exitTime = currentBar.time;
            activeTrade.outcome = 'LOSS';
            activeTrade.pnlPercent = ((activeTrade.entryPrice - activeTrade.stopLoss) / activeTrade.entryPrice) * 100;
            allTrades.push(activeTrade);
            symbolTrades++;
            activeTrade = null;
            continue;
          }
        }
      } else {
        // Look for setup
        const setup = sidhantEngine.evaluateSetup(symbol, windowCandles);
        if (setup.recommendedSide && setup.customTP && setup.customSL) {
          activeTrade = {
            symbol,
            side: setup.recommendedSide,
            entryPrice: currentBar.close,
            entryTime: currentBar.time,
            takeProfit: setup.customTP,
            stopLoss: setup.customSL,
            exitPrice: 0,
            exitTime: 0,
            outcome: 'LOSS',
            pnlPercent: 0,
            riskReward: setup.riskReward || 2.0,
            reason: setup.setupType,
          };
        }
      }
    }

    const wr = symbolTrades > 0 ? ((symbolWins / symbolTrades) * 100).toFixed(1) : 'N/A';
    console.log(`  -> ${symbol}: ${symbolTrades} trades | ${symbolWins} Wins | Win Rate: ${wr}%\n`);
  }

  // Summary Metrics
  const totalTrades = allTrades.length;
  const wins = allTrades.filter(t => t.outcome === 'WIN');
  const losses = allTrades.filter(t => t.outcome === 'LOSS');
  const winRate = totalTrades > 0 ? ((wins.length / totalTrades) * 100).toFixed(1) : '0';

  const totalWinPnl = wins.reduce((acc, t) => acc + t.pnlPercent, 0);
  const totalLossPnl = Math.abs(losses.reduce((acc, t) => acc + t.pnlPercent, 0));
  const profitFactor = totalLossPnl > 0 ? (totalWinPnl / totalLossPnl).toFixed(2) : 'Infinity';
  const avgWin = wins.length > 0 ? (totalWinPnl / wins.length).toFixed(2) : '0';
  const avgLoss = losses.length > 0 ? (totalLossPnl / losses.length).toFixed(2) : '0';

  console.log('========================================================================');
  console.log('                   FINAL VERIFIED BACKTEST SUMMARY                      ');
  console.log('========================================================================');
  console.log(`Total Trades Executed:   ${totalTrades}`);
  console.log(`Winning Trades:          ${wins.length} (${winRate}%)`);
  console.log(`Losing Trades:           ${losses.length}`);
  console.log(`Average Win:             +${avgWin}%`);
  console.log(`Average Loss:            -${avgLoss}%`);
  console.log(`Profit Factor:           ${profitFactor}`);
  console.log('========================================================================\n');

  if (wins.length > 0) {
    console.log('Sample Recent Winning Setups:');
    wins.slice(-5).forEach(w => {
      console.log(`  [${w.symbol} ${w.side}] Entry: $${w.entryPrice.toFixed(4)} -> TP: $${w.takeProfit.toFixed(4)} | PnL: +${w.pnlPercent.toFixed(2)}% | R:R: 1:${w.riskReward}`);
    });
  }
}

runBacktest().catch(console.error);
