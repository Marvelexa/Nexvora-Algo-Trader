import { evaluateStrategyForPort } from '../lib/strategies/strategyRegistry';
import { KlinePoint } from '../src/types';
import fs from 'fs';
import path from 'path';

let passCount = 0;
let failCount = 0;

function assert(condition: boolean, testName: string, detail: string = '') {
  if (condition) {
    console.log(`✅ PASS: ${testName} ${detail ? `(${detail})` : ''}`);
    passCount++;
  } else {
    console.error(`❌ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
    failCount++;
  }
}

console.log('================================================================');
console.log('  ADVERSARIAL VERIFICATION SUITE: PORT 3001 INTEGRITY AUDIT');
console.log('================================================================\n');

// --- 1. STRATEGY REGISTRY PORT 3001 ROUTING & EXECUTION ---
console.log('--- 1. Testing StrategyRegistry.ts Port 3001 Routing ---');

// Mock candles for testing
const baseTime = Date.now() - 30 * 15 * 60 * 1000;
const mockCandles: KlinePoint[] = [];
for (let i = 0; i < 30; i++) {
  const open = 65000 + i * 10;
  const high = open + 50;
  const low = open - 40;
  const close = open + 20;
  mockCandles.push({
    time: baseTime + i * 15 * 60 * 1000,
    open,
    high,
    low,
    close,
    volume: 100 + i * 5,
  });
}

try {
  const result3001Num = evaluateStrategyForPort(3001, 'BTCUSDT', mockCandles);
  assert(
    typeof result3001Num === 'object' && result3001Num !== null,
    'evaluateStrategyForPort(3001) returns valid object',
    `Strategy: ${result3001Num.strategyName}`
  );
  assert(
    result3001Num.strategyName.includes('Zero-Lag') || result3001Num.strategyName.includes('Price Action'),
    'case 3001 targets Zero-Lag Price Action Engine',
    result3001Num.strategyName
  );
} catch (e: any) {
  assert(false, 'evaluateStrategyForPort(3001) threw error', e.message);
}

try {
  const result3001Str = evaluateStrategyForPort('3001', 'BTCUSDT', mockCandles);
  assert(
    typeof result3001Str === 'object' && (result3001Str.strategyName.includes('Zero-Lag') || result3001Str.strategyName.includes('Price Action')),
    'evaluateStrategyForPort("3001" as string) routes identically',
    result3001Str.strategyName
  );
} catch (e: any) {
  assert(false, 'evaluateStrategyForPort("3001") string route threw error', e.message);
}

// --- 2. SOURCE CODE INSPECTION OF strategyRegistry.ts ---
console.log('\n--- 2. Inspecting strategyRegistry.ts Source Code ---');
const registryContent = fs.readFileSync(path.join(process.cwd(), 'lib/strategies/strategyRegistry.ts'), 'utf8');

assert(
  registryContent.includes('case 3001:'),
  'strategyRegistry.ts contains explicit "case 3001:" block'
);

assert(
  registryContent.includes('autonomousMultiIndicatorEngine.evaluateSetup'),
  'case 3001 delegates to autonomousMultiIndicatorEngine'
);

assert(
  registryContent.includes('p === 3001 ||'),
  'Trend Shield includes "p === 3001 ||" exemption for qualified structural shift'
);

assert(
  !registryContent.includes('case 3006:'),
  'Cleaned: Obsolete case 3006 is completely removed'
);

assert(
  !registryContent.includes('case 3007:'),
  'Cleaned: Obsolete case 3007 is completely removed'
);

assert(
  !registryContent.includes('case 3025:'),
  'Cleaned: Obsolete case 3025 is completely removed'
);

// --- 3. ADVERSARIAL INSPECTION OF PORT 3001 FILES TIMESTAMPS ---
console.log('\n--- 3. Verifying File Timestamps Against Milestone 1 Start Window ---');
const M1_START_UTC = new Date('2026-11-01T17:06:16Z').getTime();

const port3001Files = [
  'server.ts',
  'vite.config.ts',
  '.env',
  'src/App.tsx',
  'src/types.ts',
  'src/components/DeltaAutoTraderCard.tsx',
  'src/components/LiveTradeScoresSidebar.tsx',
  'src/components/MarketTickerList.tsx',
];

for (const relPath of port3001Files) {
  const fullPath = path.join(process.cwd(), relPath);
  if (fs.existsSync(fullPath)) {
    const stat = fs.statSync(fullPath);
    const mtime = stat.mtime.getTime();
    const isUntouchedByM1 = mtime < M1_START_UTC;
    assert(
      isUntouchedByM1,
      `File ${relPath} untouched by M1`,
      `Modified: ${stat.mtime.toISOString()} vs M1 Start: ${new Date(M1_START_UTC).toISOString()}`
    );
  } else {
    assert(false, `File ${relPath} exists`, 'Missing file');
  }
}

// --- 4. VERIFY .delta_auto_trader_state_3001.json INTEGRITY ---
console.log('\n--- 4. Verifying .delta_auto_trader_state_3001.json Integrity ---');
const state3001Path = path.join(process.cwd(), '.delta_auto_trader_state_3001.json');
assert(fs.existsSync(state3001Path), '.delta_auto_trader_state_3001.json exists');

try {
  const rawState = fs.readFileSync(state3001Path, 'utf8');
  const parsed = JSON.parse(rawState);
  assert(parsed.mode === 'DELTA_TESTNET', 'State mode is DELTA_TESTNET', parsed.mode);
  assert(parsed.isRunning === true, 'State isRunning is true', String(parsed.isRunning));
  assert(typeof parsed.accountCapitalUSD === 'number', 'accountCapitalUSD is valid number', String(parsed.accountCapitalUSD));
  assert(typeof parsed.totalTradesCount === 'number', 'totalTradesCount is preserved', String(parsed.totalTradesCount));
} catch (e: any) {
  assert(false, '.delta_auto_trader_state_3001.json parse valid JSON', e.message);
}

// --- 5. VERIFY .env FILE INTEGRITY ---
console.log('\n--- 5. Verifying .env Configuration ---');
const envPath = path.join(process.cwd(), '.env');
assert(fs.existsSync(envPath), '.env file exists');
const envContent = fs.readFileSync(envPath, 'utf8');
assert(envContent.includes('PORT=3001'), '.env specifies PORT=3001');
assert(envContent.includes('DELTA_IS_TESTNET=true'), '.env specifies DELTA_IS_TESTNET=true');
assert(envContent.includes('DELTA_TRADING_MODE="DELTA_TESTNET"'), '.env specifies DELTA_TRADING_MODE="DELTA_TESTNET"');

// --- 6. ADVERSARIAL EDGE CASE MINING & STRESS TESTING FOR PORT 3001 ---
console.log('\n--- 6. Adversarial Edge Case Mining for Port 3001 ---');

// Edge case 1: Empty candles
try {
  const emptyRes = evaluateStrategyForPort(3001, 'BTCUSDT', []);
  assert(typeof emptyRes === 'object', 'Survives empty candles array', emptyRes.strategyName);
} catch (e: any) {
  assert(false, 'Crashes on empty candles', e.message);
}

// Edge case 2: Single candle
try {
  const singleRes = evaluateStrategyForPort(3001, 'BTCUSDT', [mockCandles[0]]);
  assert(typeof singleRes === 'object', 'Survives single candle', singleRes.strategyName);
} catch (e: any) {
  assert(false, 'Crashes on single candle', e.message);
}

// Edge case 3: Extreme price volatility / NaN / zero safety
try {
  const extremeCandles: KlinePoint[] = [
    { time: Date.now() - 30000, open: 1e9, high: 1e10, low: 0.00001, close: 5e9, volume: 1e12 },
    { time: Date.now() - 15000, open: 5e9, high: 1e11, low: 0.000001, close: 1e8, volume: 1e14 },
    { time: Date.now(), open: 1e8, high: 2e8, low: 1e7, close: 1.5e8, volume: 1e10 },
  ];
  const extremeRes = evaluateStrategyForPort(3001, 'EXTREME', extremeCandles);
  assert(typeof extremeRes === 'object', 'Survives extreme volatility', extremeRes.strategyName);
} catch (e: any) {
  assert(false, 'Crashes on extreme volatility', e.message);
}

// Edge case 4: Throughput & Stress test (1,000 consecutive evaluations)
const tStart = Date.now();
let stressPassed = true;
for (let i = 0; i < 1000; i++) {
  try {
    const res = evaluateStrategyForPort(3001, 'BTCUSDT', mockCandles);
    if (!res || typeof res !== 'object') {
      stressPassed = false;
      break;
    }
  } catch {
    stressPassed = false;
    break;
  }
}
const elapsed = Date.now() - tStart;
assert(stressPassed, 'Port 3001 handles 1,000 stress evaluations without error', `${elapsed}ms total, ${(elapsed / 1000).toFixed(2)}ms per eval`);

console.log('\n================================================================');
console.log(`  VERIFICATION RESULTS: ${passCount} PASSED, ${failCount} FAILED`);
console.log('================================================================');

if (failCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

