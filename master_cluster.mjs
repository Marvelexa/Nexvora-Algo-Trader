// Master Cluster Supervisor (Isolated Trading Ports 3002 through 3010)
// Master Architecture Overhaul - Port 3001 remains strictly untouched.
//
// Topology:
// - System 3002: Brad Goh 5-Step Reversal Engine (PkAtVH6YVM8)
// - System 3003: TradingLab Liquidity Grab + 10-Candle Divergence Engine (4cT8WTyxhYY)
// - System 3004: Fractal Flow Volume Profile Engine (POC / VAH / VAL) (9eqDWJSvCx4 & BmtxLwvDE6U)
// - System 3005: Hybrid Master Crypto SMC (Neeraj Joshi & Solomon King - FAt3PiB8-cM)
// - System 3006: YT_PAT_ORB_ENGINE (Trade With Pat - E3McKlAp3qk)
// - System 3007: YT_CRT_SMC_ENGINE (Iqshant Ladha - KRl1JnWaOLU)
// - System 3008: YT_SOLANO_VWAP_ENGINE (Sean Solano - Ii1h78hBhZg)
// - System 3009: YT_SECRET_MACD_ENGINE (The Secret Mindset - S2HaCa0b-bY)
// - System 3010: YT_SIDEWAYS_RANGE_ENGINE (Best Strategies to Trade in a Sideways Market - OhXnH8FnTzc)
//
// Capital Allocation: ₹15,000 INR ($178.57 USD) across 4 rolling slots ($43.75 margin per slot, 30x leverage)

import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const CRYPTO_ROOT = 'c:\\Users\\Rajesh\\Downloads\\crypto-live-market-&-auto-sell';
const LOG_DIR = process.env.LOG_DIR || (fs.existsSync('D:\\') ? 'D:\\crypto_system_logs' : path.join(CRYPTO_ROOT, 'logs'));
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

let isShuttingDown = false;

const SYSTEMS = [
  { port: 3001, dir: CRYPTO_ROOT, name: 'System 3001 (Zero-Lag Trend Reclaim & SMC Master - Paper Mode)' },
  { port: 3002, dir: CRYPTO_ROOT, name: 'System 3002 (Brad Goh 5-Step Reversal - Paper Mode)' },
  { port: 3003, dir: CRYPTO_ROOT, name: 'System 3003 (TradingLab Liquidity Grab & Divergence - Paper Mode)' },
  { port: 3004, dir: CRYPTO_ROOT, name: 'System 3004 (Fractal Flow Volume Profile - Paper Mode)' },
  { port: 3005, dir: CRYPTO_ROOT, name: 'System 3005 (Hybrid Master Crypto SMC - Connected to Demo Delta Testnet)' },
  { port: 3006, dir: CRYPTO_ROOT, name: 'System 3006 (YT_PAT_ORB_ENGINE - Trade with Pat - Paper Mode)' },
  { port: 3007, dir: CRYPTO_ROOT, name: 'System 3007 (YT_CRT_SMC_ENGINE - Iqshant Ladha CRT - Paper Mode)' },
  { port: 3008, dir: CRYPTO_ROOT, name: 'System 3008 (YT_SOLANO_VWAP_ENGINE - Sean Solano VWAP - Paper Mode)' },
  { port: 3009, dir: CRYPTO_ROOT, name: 'System 3009 (YT_SECRET_MACD_ENGINE - Secret Mindset MACD - Paper Mode)' },
  { port: 3010, dir: CRYPTO_ROOT, name: 'System 3010 (YT_SIDEWAYS_RANGE_ENGINE - Best Strategies to Trade in a Sideways Market - Paper Mode)' },
];

const children = new Map();

function startSystem(sys) {
  const scriptName = 'dist/server.cjs';
  const runnerArgs = ['--max-old-space-size=256', path.join(sys.dir, scriptName)];

  const outLog = path.join(LOG_DIR, `system_${sys.port}.log`);
  const errLog = path.join(LOG_DIR, `system_${sys.port}_err.log`);

  const outStream = fs.openSync(outLog, 'a');
  const errStream = fs.openSync(errLog, 'a');

  console.log(`[Supervisor] 🚀 Starting ${sys.name} on Port ${sys.port}...`);

  // User Mandate: Connect ONLY System 3005 to Demo Delta Exchange (DELTA_TESTNET)
  // All other ports (3002-3004, 3006-3010) run in isolated Paper Mode!
  const isDemoDeltaPort = sys.port === 3005;
  const isRealBrokerExecution = isDemoDeltaPort; // Only System 3005 executes on Demo Delta!

  const realApiKey = process.env.DELTA_API_KEY || '';
  const realApiSecret = process.env.DELTA_API_SECRET || '';

  const deltaBaseUrlTestnet = 'https://cdn-ind.testnet.deltaex.org';
  const deltaWsUrlTestnet = 'wss://socket-ind.testnet.deltaex.org';
  const clusterTradingMode = isRealBrokerExecution ? 'DELTA_TESTNET' : 'SIMULATION_PAPER';
  const isSimulation = !isRealBrokerExecution;

  const customEnv = {
    ...process.env,
    PORT: sys.port.toString(),
    SYSTEM_NAME: sys.name,
    STATE_FILE: `.delta_auto_trader_state_${sys.port}.json`,
    NODE_ENV: 'production',
    TRADE_INSTRUMENT: 'PERPETUAL_FUTURES',
    DELTA_IS_TESTNET: 'true',
    DELTA_IS_SIMULATION: isSimulation ? 'true' : 'false',
    PAPER_TRADING: isSimulation ? 'true' : 'false',
    DELTA_TRADING_MODE: clusterTradingMode,
    IS_INVERSE_TRADING: 'false', // User Mandate: "make all of them normal system not reversal" (Normal Direct Trading: BUY -> BUY, SELL -> SELL)
    TOTAL_CAPITAL_INR: '15000',
    CAPITAL_INR: '15000',
    MAX_CONCURRENT_POSITIONS: '6', // 6-Slot Hybrid Engine: 4 Normal Perpetuals + 2 Options = 6 Total
    MARGIN_PER_SLOT_USD: '44.64', // 25% of capital ($178.57 * 0.25 = $44.64 USD margin)
    MARGIN_PERCENT_PER_TRADE: '25',
    LEVERAGE: '30',
    DELTA_API_KEY: isRealBrokerExecution ? realApiKey : '',
    DELTA_API_SECRET: isRealBrokerExecution ? realApiSecret : '',
    DELTA_EXCHANGE_API_KEY: isRealBrokerExecution ? realApiKey : '',
    DELTA_EXCHANGE_API_SECRET: isRealBrokerExecution ? realApiSecret : '',
    VITE_DELTA_EXCHANGE_API_KEY: isRealBrokerExecution ? realApiKey : '',
    VITE_DELTA_EXCHANGE_API_SECRET: isRealBrokerExecution ? realApiSecret : '',
    EXCHANGE_API_KEY: isRealBrokerExecution ? realApiKey : '',
    EXCHANGE_API_SECRET: isRealBrokerExecution ? realApiSecret : '',
    DELTA_BASE_URL: deltaBaseUrlTestnet,
    DELTA_WS_URL: deltaWsUrlTestnet
  };

  const child = spawn('node', runnerArgs, {
    cwd: sys.dir,
    env: customEnv,
    stdio: ['ignore', outStream, errStream],
    detached: true
  });
  child.unref();

  children.set(sys.port, child);
  console.log(`[Supervisor] ✅ ${sys.name} running (PID: ${child.pid}) on Port ${sys.port}`);

  child.on('exit', (code, signal) => {
    children.delete(sys.port);
    if (isShuttingDown) {
      console.log(`[Supervisor] Child on Port ${sys.port} exited during shutdown.`);
      return;
    }
    console.warn(`[Supervisor] ⚠️ ${sys.name} (Port ${sys.port}) exited (code: ${code}, signal: ${signal}). Restarting in 3s...`);
    setTimeout(() => {
      if (!isShuttingDown) {
        startSystem(sys);
      }
    }, 3000);
  });
}

// Supervisor Heartbeat Monitor (Runs every 30 seconds)
const keepAliveInterval = setInterval(() => {
  if (isShuttingDown) return;
  const activeCount = children.size;
  console.log(`[Supervisor Heartbeat] 💓 Active systems status: ${activeCount}/${SYSTEMS.length} running.`);
}, 30000);

for (let i = 0; i < SYSTEMS.length; i++) {
  setTimeout(() => {
    startSystem(SYSTEMS[i]);
  }, i * 600);
}

// Keep process alive indefinitely
process.on('uncaughtException', (err) => {
  console.error('[Supervisor UncaughtException]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Supervisor UnhandledRejection]', reason);
});

function shutdownCluster(signal) {
  console.log(`[Supervisor] ${signal} caught. Initiating graceful shutdown...`);
  isShuttingDown = true;
  clearInterval(keepAliveInterval);

  for (const [port, child] of children.entries()) {
    try {
      console.log(`[Supervisor] Terminating child on Port ${port} (PID: ${child.pid})...`);
      child.kill('SIGTERM');
    } catch (e) {
      // Ignore if already dead
    }
  }
  setTimeout(() => {
    process.exit(0);
  }, 1000);
}

process.on('SIGINT', () => shutdownCluster('SIGINT'));
process.on('SIGTERM', () => shutdownCluster('SIGTERM'));

console.log('🚀 Supervisor initialized for active systems.');
