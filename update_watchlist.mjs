import fs from 'node:fs';
import path from 'node:path';

const dirs = [
  'D:\\crypto-live-market-&-auto-sell-v3',
  'D:\\crypto-live-market-&-auto-sell-v5',
  'D:\\crypto-live-market-&-auto-sell-v8',
  'D:\\crypto-live-market-&-auto-sell-v9',
  'D:\\crypto-live-market-&-auto-sell-v10',
  'D:\\crypto-live-market-&-auto-sell-v12',
  'D:\\crypto-live-market-&-auto-sell-v13',
  'D:\\crypto-live-market-&-auto-sell-v14',
  'D:\\crypto-live-market-&-auto-sell-v15',
  'D:\\crypto-live-market-&-auto-sell-v16',
  'D:\\crypto-live-market-&-auto-sell-v17'
];

const liquidCoinsStr = `  public WATCHLIST: string[] = [
    'BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'DOGEUSD', 'AVAXUSD', 'SUIUSD', 'ADAUSD',
    'LINKUSD', 'BNBUSD', 'NEARUSD', 'APTUSD', 'LTCUSD', 'BCHUSD', 'AAVEUSD', 'UNIUSD',
    'WIFUSD', '1000PEPEUSD', '1000BONKUSD', 'HYPEUSD', 'ETHFIUSD', 'ONDOUSD', 'PENDLEUSD',
    'TIAUSD', 'SEIUSD', 'FETUSD', 'INJUSD', 'RENDERUSD', 'ATOMUSD', 'DOTUSD', 'ARUSD',
    'ENAUSD', 'JUPUSD', 'TRUMPUSD', 'POLUSD', 'KASUSD', 'FTMUSD', 'TAOUSD', 'ICPUSD',
    'TRXUSD', 'XLMUSD', 'FILUSD', 'OPUSD', 'ARBUSD', 'MKRUSD', 'CRVUSD'
  ];`;

const watchlistRegex = /public\s+WATCHLIST:\s*string\[\]\s*=\s*\[[\s\S]*?\];/;

for (const dir of dirs) {
  const filePath = path.join(dir, 'lib', 'deltaAutoTraderEngine.ts');
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    if (watchlistRegex.test(content)) {
      content = content.replace(watchlistRegex, liquidCoinsStr);
      fs.writeFileSync(filePath, content, 'utf8');
      console.log('Updated WATCHLIST to 46 liquid coins in ' + path.basename(dir));
    } else {
      console.log('WATCHLIST regex did not match in ' + path.basename(dir));
    }
  }
}
