import { spawnSync } from 'node:child_process';
import path from 'node:path';

const dirs = [
  'c:\\Users\\Rajesh\\Downloads\\crypto-live-market-&-auto-sell',
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

for (const dir of dirs) {
  const tsxCli = path.join(dir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const res = spawnSync('node', [tsxCli, '-e', `
    import { deltaAutoTrader } from './lib/deltaAutoTraderEngine.js';
    console.log('OK: ' + deltaAutoTrader.WATCHLIST.length + ' coins');
  `], { cwd: dir, encoding: 'utf8' });
  if (res.status === 0) {
    const lines = res.stdout.trim().split('\n');
    console.log(path.basename(dir) + ': SUCCESS (' + lines[lines.length - 1] + ')');
  } else {
    console.log(path.basename(dir) + ': FAIL -> ' + (res.stderr || res.stdout));
  }
}
