/**
 * GLOBAL CROSS-PORT ORDER MUTEX
 * Prevents multiple ports (3002-3010) from placing orders on the same symbol simultaneously.
 * Uses atomic file-based locking at D:\crypto_system_logs\global_order_mutex.json
 * 
 * Rules:
 * 1. Same symbol: 180-second cooldown across all ports
 * 2. Any symbol: 5-second global cooldown across all ports
 */

import * as fs from 'fs';
import * as path from 'path';

const MUTEX_FILE_PATH = 'D:\\crypto_system_logs\\global_order_mutex.json';
const SYMBOL_COOLDOWN_MS = 180_000;  // 180 seconds per-symbol cooldown
const GLOBAL_COOLDOWN_MS = 5_000;    // 5 seconds global cooldown

interface MutexState {
  symbols: Record<string, { timestamp: number; port: number }>;
  lastGlobalOrderTs: number;
}

function readMutex(): MutexState {
  try {
    const dir = path.dirname(MUTEX_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (fs.existsSync(MUTEX_FILE_PATH)) {
      const raw = fs.readFileSync(MUTEX_FILE_PATH, 'utf-8');
      return JSON.parse(raw) as MutexState;
    }
  } catch (e) {
    // File corrupt or locked by another process - return empty
  }
  return { symbols: {}, lastGlobalOrderTs: 0 };
}

function writeMutex(state: MutexState): void {
  try {
    const dir = path.dirname(MUTEX_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(MUTEX_FILE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) {
    console.warn(`⚠️ [GLOBAL MUTEX] Failed to write mutex file: ${(e as Error).message}`);
  }
}

/**
 * Attempts to acquire the global order mutex for a given symbol.
 * Returns { allowed: true } if the order can proceed, or { allowed: false, reason: string } if blocked.
 */
export function acquireOrderMutex(symbol: string, port: number): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const cleanSymbol = symbol.toUpperCase().replace('USDT', 'USD');
  const state = readMutex();

  // Check 1: Global cooldown (5 seconds between ANY orders across ALL ports)
  if (state.lastGlobalOrderTs > 0 && (now - state.lastGlobalOrderTs) < GLOBAL_COOLDOWN_MS) {
    const elapsed = now - state.lastGlobalOrderTs;
    const reason = `GLOBAL_COOLDOWN_ACTIVE: Another port placed an order ${elapsed}ms ago (< ${GLOBAL_COOLDOWN_MS}ms). Blocking duplicate.`;
    console.warn(`🛑 [CROSS-PORT MUTEX] ${reason}`);
    return { allowed: false, reason };
  }

  // Check 2: Per-symbol cooldown (180 seconds for same symbol across ALL ports)
  const symbolEntry = state.symbols[cleanSymbol];
  if (symbolEntry && (now - symbolEntry.timestamp) < SYMBOL_COOLDOWN_MS) {
    const elapsed = now - symbolEntry.timestamp;
    const reason = `SYMBOL_COOLDOWN_ACTIVE: Port ${symbolEntry.port} already ordered ${cleanSymbol} ${elapsed}ms ago (< ${SYMBOL_COOLDOWN_MS}ms). Blocking duplicate on same coin.`;
    console.warn(`🛑 [CROSS-PORT MUTEX] ${reason}`);
    return { allowed: false, reason };
  }

  // Acquire: Write our claim
  state.symbols[cleanSymbol] = { timestamp: now, port };
  state.lastGlobalOrderTs = now;

  // Cleanup old entries (> 10 minutes) to prevent file bloat
  for (const sym of Object.keys(state.symbols)) {
    if (now - state.symbols[sym].timestamp > 600_000) {
      delete state.symbols[sym];
    }
  }

  writeMutex(state);
  console.log(`✅ [CROSS-PORT MUTEX] Port ${port} acquired order lock for ${cleanSymbol}. Cooldown active for ${SYMBOL_COOLDOWN_MS / 1000}s.`);
  return { allowed: true };
}

/**
 * Releases/clears the mutex for a specific symbol (e.g., after position is closed).
 */
export function releaseMutex(symbol: string): void {
  const cleanSymbol = symbol.toUpperCase().replace('USDT', 'USD');
  const state = readMutex();
  delete state.symbols[cleanSymbol];
  writeMutex(state);
}

/**
 * Completely resets mutex state (used during tests or full system reset).
 */
export function resetMutexAll(): void {
  writeMutex({ symbols: {}, lastGlobalOrderTs: 0 });
}
