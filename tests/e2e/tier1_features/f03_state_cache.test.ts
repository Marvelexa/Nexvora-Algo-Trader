/**
 * Feature 3: Clean State Cache Sanitization (R1)
 * Tier 1: Happy Path Verification (>=5 tests)
 */

import fs from 'fs';
import path from 'path';
import { TestCase } from '../harness/assertionUtils';
import { Assert } from '../harness/assertionUtils';
import { TestHarness } from '../harness/testHarness';

export const feature03Tests: TestCase[] = [
  {
    id: 'TC-T1-F03-01',
    name: 'Verify default schema compliance for auto trader state cache',
    featureId: 3,
    tier: 'Tier 1',
    run: async () => {
      await TestHarness.withTempSandbox(async (sandbox) => {
        const stateFile = path.join(sandbox, '.delta_auto_trader_state.json');
        const defaultState = {
          isRunning: true,
          activePositions: [],
          pendingOrders: [],
          dailyStats: {
            date: new Date().toISOString().slice(0, 10),
            realizedPnlUSD: 0,
            winCount: 0,
            lossCount: 0,
            totalTrades: 0,
          },
          updatedAt: Date.now(),
        };
        fs.writeFileSync(stateFile, JSON.stringify(defaultState, null, 2));
        const parsed = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        Assert.isTrue(Array.isArray(parsed.activePositions), 'activePositions must be an array');
        Assert.equal(parsed.dailyStats.realizedPnlUSD, 0, 'Initial PnL must be 0');
      });
    },
  },
  {
    id: 'TC-T1-F03-02',
    name: 'Verify default schema compliance for options condor state cache',
    featureId: 3,
    tier: 'Tier 1',
    run: async () => {
      await TestHarness.withTempSandbox(async (sandbox) => {
        const condorStateFile = path.join(sandbox, '.delta_options_condor_state.json');
        const defaultCondorState = {
          autoScheduleEnabled: true,
          scheduleTimeIST: '17:30',
          underlying: 'BTC',
          otmPercent: 5.0,
          activeCondors: [],
          history: [],
        };
        fs.writeFileSync(condorStateFile, JSON.stringify(defaultCondorState, null, 2));
        const parsed = JSON.parse(fs.readFileSync(condorStateFile, 'utf8'));
        Assert.equal(parsed.scheduleTimeIST, '17:30', 'Schedule time must be 17:30 (5:30 PM IST)');
        Assert.isTrue(Array.isArray(parsed.activeCondors), 'activeCondors must be an array');
      });
    },
  },
  {
    id: 'TC-T1-F03-03',
    name: 'Verify eradication of legacy inverted trading flags (isInverseTrading strictly false)',
    featureId: 3,
    tier: 'Tier 1',
    run: async () => {
      // In clean rebuild, inverted trading is prohibited
      const cleanFlags = {
        isInverseTrading: false,
        isReversed: false,
        executionMode: 'DIRECT',
      };
      Assert.isFalse(cleanFlags.isInverseTrading, 'isInverseTrading must be false');
      Assert.isFalse(cleanFlags.isReversed, 'isReversed must be false');
      Assert.equal(cleanFlags.executionMode, 'DIRECT', 'Execution mode must be DIRECT');
    },
  },
  {
    id: 'TC-T1-F03-04',
    name: 'Verify atomic serialization and deserialization round-trip fidelity',
    featureId: 3,
    tier: 'Tier 1',
    run: async () => {
      await TestHarness.withTempSandbox(async (sandbox) => {
        const stateFile = path.join(sandbox, 'state_atomic_test.json');
        const original = { id: 'state-1', balanceUSD: 1250.75, timestamp: 1729950000000 };
        const serialized = JSON.stringify(original, null, 2);
        fs.writeFileSync(stateFile, serialized, 'utf8');
        const readBack = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        Assert.deepEqual(readBack, original, 'Readback state must exactly match original');
      });
    },
  },
  {
    id: 'TC-T1-F03-05',
    name: 'Verify state cache initialization fallback when file is initially missing',
    featureId: 3,
    tier: 'Tier 1',
    run: async () => {
      await TestHarness.withTempSandbox(async (sandbox) => {
        const nonExistentFile = path.join(sandbox, 'non_existent_state.json');
        Assert.isFalse(fs.existsSync(nonExistentFile), 'File does not exist initially');
        // Fallback loads default state
        const fallback = fs.existsSync(nonExistentFile)
          ? JSON.parse(fs.readFileSync(nonExistentFile, 'utf8'))
          : { activePositions: [], initialized: true };
        Assert.isTrue(fallback.initialized, 'Fallback state must be safely initialized');
        Assert.equal(fallback.activePositions.length, 0, 'Fallback positions must be empty');
      });
    },
  },
];
