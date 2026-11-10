import fs from 'fs';
import path from 'path';
import http from 'http';
import { execSync } from 'child_process';

interface CheckResult {
  category: string;
  name: string;
  expected: any;
  actual: any;
  passed: boolean;
  notes?: string;
}

const results: CheckResult[] = [];

function recordCheck(category: string, name: string, expected: any, actual: any, passed: boolean, notes: string = '') {
  results.push({ category, name, expected, actual, passed, notes });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${icon} [${category}] ${name}: Expected '${expected}', got '${actual}' ${notes ? `(${notes})` : ''}`);
}

async function runGate2ChallengerSuite() {
  console.log('========================================================================');
  console.log('  MILESTONE 1 GATE 2: EMPIRICAL CHALLENGER ADVERSARIAL VERIFICATION     ');
  console.log('========================================================================\n');

  // 1. RE-RUN TEST_PORT_3001_INTEGRITY_ADVERSARIAL.TS
  console.log('--- 1. Running Worker Adversarial Test Suite (test_port_3001_integrity_adversarial.ts) ---');
  try {
    const output = execSync('node ./node_modules/tsx/dist/cli.mjs tests/test_port_3001_integrity_adversarial.ts', {
      encoding: 'utf8',
      cwd: process.cwd()
    });
    const passedMatch = output.match(/(\d+)\s+PASSED/);
    const failedMatch = output.match(/(\d+)\s+FAILED/);
    const passCount = passedMatch ? parseInt(passedMatch[1], 10) : 0;
    const failCount = failedMatch ? parseInt(failedMatch[1], 10) : 0;
    
    recordCheck('Suite Re-run', '30 Assertions Executed', 30, passCount, passCount === 30 && failCount === 0, `30 passed, ${failCount} failed`);
  } catch (err: any) {
    recordCheck('Suite Re-run', '30 Assertions Executed', 30, 0, false, `Execution error: ${err.message}`);
  }

  // 2. CHECK PORT 3001 INTEGRITY & GIT STATUS / TIMESTAMPS
  console.log('\n--- 2. Checking Port 3001 Source Modification Timestamps Against M1 Window ---');
  const M1_START_UTC = new Date('2026-11-01T17:06:16Z').getTime();
  const protectedFiles = [
    'server.ts',
    'vite.config.ts',
    '.env',
    'src/App.tsx',
    'src/types.ts',
    'src/components/DeltaAutoTraderCard.tsx',
    'src/components/LiveTradeScoresSidebar.tsx',
    'src/components/MarketTickerList.tsx'
  ];

  for (const relPath of protectedFiles) {
    const fullPath = path.join(process.cwd(), relPath);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      const isPreM1 = stat.mtimeMs < M1_START_UTC;
      recordCheck(
        'Port 3001 Isolation',
        `File ${relPath} untouched during M1`,
        `< ${new Date(M1_START_UTC).toISOString()}`,
        stat.mtime.toISOString(),
        isPreM1,
        isPreM1 ? 'Untouched by M1' : 'MODIFIED DURING M1'
      );
    } else {
      recordCheck('Port 3001 Isolation', `File ${relPath} exists`, true, false, false, 'File missing');
    }
  }

  // 3. CHECK .delta_auto_trader_state_3001.json
  console.log('\n--- 3. Checking Port 3001 State File ---');
  const state3001Path = path.join(process.cwd(), '.delta_auto_trader_state_3001.json');
  if (fs.existsSync(state3001Path)) {
    try {
      const s3001 = JSON.parse(fs.readFileSync(state3001Path, 'utf8'));
      recordCheck('State 3001', 'Mode is DELTA_TESTNET', 'DELTA_TESTNET', s3001.mode, s3001.mode === 'DELTA_TESTNET');
      recordCheck('State 3001', 'Active positions empty', 0, (s3001.activePositions || []).length, (s3001.activePositions || []).length === 0);
      recordCheck('State 3001', 'Closed trades empty', 0, (s3001.closedTrades || []).length, (s3001.closedTrades || []).length === 0);
      recordCheck('State 3001', 'isRunning is true', true, s3001.isRunning, s3001.isRunning === true);
    } catch (e: any) {
      recordCheck('State 3001', 'Valid JSON format', true, false, false, e.message);
    }
  } else {
    recordCheck('State 3001', 'File exists', true, false, false, 'Missing .delta_auto_trader_state_3001.json');
  }

  // 4. CHECK TARGET STATE FILES 3002-3005 JSON SCHEMA & MODE
  console.log('\n--- 4. Validating Target State Files (3002-3005) Schema & Mode ---');
  for (const port of [3002, 3003, 3004, 3005]) {
    const filePath = path.join(process.cwd(), `.delta_auto_trader_state_${port}.json`);
    if (!fs.existsSync(filePath)) {
      recordCheck(`State ${port}`, 'File exists', true, false, false, `Missing .delta_auto_trader_state_${port}.json`);
      continue;
    }

    try {
      const state = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      // Mode check: MUST BE DELTA_TESTNET
      recordCheck(
        `State ${port}`,
        'Mode is DELTA_TESTNET',
        'DELTA_TESTNET',
        state.mode,
        state.mode === 'DELTA_TESTNET',
        state.mode !== 'DELTA_TESTNET' ? `Discrepancy: Expected DELTA_TESTNET, found ${state.mode}` : ''
      );

      // Active positions check: MUST BE 0
      const activeCount = Array.isArray(state.activePositions) ? state.activePositions.length : -1;
      recordCheck(`State ${port}`, '0 Active Positions', 0, activeCount, activeCount === 0);

      // Closed trades check: MUST BE 0
      const closedCount = Array.isArray(state.closedTrades) ? state.closedTrades.length : -1;
      recordCheck(`State ${port}`, '0 Closed Trades', 0, closedCount, closedCount === 0);

      // Total trades count check: MUST BE 0
      recordCheck(`State ${port}`, '0 Total Trades Count', 0, state.totalTradesCount, state.totalTradesCount === 0);

      // Account Capital check: Numeric > 0
      const capitalValid = typeof state.accountCapitalUSD === 'number' && state.accountCapitalUSD > 0;
      recordCheck(`State ${port}`, 'Valid Account Capital', '> 0', state.accountCapitalUSD, capitalValid);

      // isRunning check: MUST BE true
      recordCheck(`State ${port}`, 'isRunning is true', true, state.isRunning, state.isRunning === true);

    } catch (e: any) {
      recordCheck(`State ${port}`, 'Valid JSON schema', true, false, false, e.message);
    }
  }

  // 5. LIVE PORT 3001 HEALTH CHECK
  console.log('\n--- 5. Checking Port 3001 Live Health Endpoint ---');
  await new Promise<void>((resolve) => {
    const req = http.get('http://127.0.0.1:3001/api/health', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          recordCheck('Live 3001 Probe', 'Status code 200', 200, res.statusCode, res.statusCode === 200);
          recordCheck('Live 3001 Probe', 'Status is ok', 'ok', json.status, json.status === 'ok');
          recordCheck('Live 3001 Probe', 'Mode is EXCHANGE_LIVE', 'EXCHANGE_LIVE', json.mode, json.mode === 'EXCHANGE_LIVE');
        } catch (e: any) {
          recordCheck('Live 3001 Probe', 'Valid JSON response', true, false, false, e.message);
        }
        resolve();
      });
    });
    req.on('error', (err) => {
      recordCheck('Live 3001 Probe', 'HTTP Connect', true, false, false, err.message);
      resolve();
    });
    req.setTimeout(3000, () => {
      req.destroy();
      recordCheck('Live 3001 Probe', 'HTTP Timeout', '< 3000ms', 'TIMEOUT', false);
      resolve();
    });
  });

  // SUMMARY & VERDICT
  console.log('\n========================================================================');
  console.log('                          VERIFICATION SUMMARY                          ');
  console.log('========================================================================');
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`Total Checks:  ${total}`);
  console.log(`Passed Checks: ${passed}`);
  console.log(`Failed Checks: ${failed}`);

  if (failed > 0) {
    console.log('\n❌ ADVERSARIAL FAILURES IDENTIFIED:');
    results.filter(r => !r.passed).forEach(f => {
      console.log(` - [${f.category}] ${f.name}: expected '${f.expected}', got '${f.actual}' ${f.notes ? `(${f.notes})` : ''}`);
    });
  }

  const finalVerdict = failed === 0 ? 'APPROVE' : 'REQUEST_CHANGES';
  console.log(`\nFINAL GATE 2 VERDICT: ${finalVerdict}`);
  console.log('========================================================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

runGate2ChallengerSuite();
