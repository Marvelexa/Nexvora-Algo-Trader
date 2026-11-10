/**
 * Feature 11: Dynamic ATR + Spread Stop Loss Buffers (R3)
 * Tier 1: Happy Path Verification (>=5 tests)
 */

import { TestCase } from '../harness/assertionUtils';
import { Assert } from '../harness/assertionUtils';
import { TestHarness } from '../harness/testHarness';

export const feature11Tests: TestCase[] = [
  {
    id: 'TC-T1-F11-01',
    name: 'Verify dynamic buffer formula computes max(1.30 * ATR, 3.0 * Spread)',
    featureId: 11,
    tier: 'Tier 1',
    run: async () => {
      const atr = 100;
      const spread = 20;
      // 1.30 * 100 = 130; 3.0 * 20 = 60 -> buffer is 130
      const targets = TestHarness.calculateGeometricTargets({
        side: 'BUY',
        entryPrice: 50000,
        atr,
        spread,
      });
      Assert.equal(targets.buffer, 130, 'Buffer must be 130 (1.30 * ATR)');
    },
  },
  {
    id: 'TC-T1-F11-02',
    name: 'Verify wide-spread regime selects 3.0 * Spread component when dominant',
    featureId: 11,
    tier: 'Tier 1',
    run: async () => {
      const atr = 10;
      const spread = 25;
      // 1.30 * 10 = 13; 3.0 * 25 = 75 -> buffer is 75
      const targets = TestHarness.calculateGeometricTargets({
        side: 'BUY',
        entryPrice: 1000,
        atr,
        spread,
      });
      Assert.equal(targets.buffer, 75, 'Buffer must select 3.0 * Spread (75)');
    },
  },
  {
    id: 'TC-T1-F11-03',
    name: 'Verify high-volatility regime selects 1.30 * ATR when dominant',
    featureId: 11,
    tier: 'Tier 1',
    run: async () => {
      const atr = 500;
      const spread = 5;
      // 1.30 * 500 = 650; 3.0 * 5 = 15 -> buffer is 650
      const targets = TestHarness.calculateGeometricTargets({
        side: 'BUY',
        entryPrice: 68000,
        atr,
        spread,
      });
      Assert.equal(targets.buffer, 650, 'Buffer must select 1.30 * ATR (650)');
    },
  },
  {
    id: 'TC-T1-F11-04',
    name: 'Verify buffer scales accurately on sub-cent asset (1000PEPE)',
    featureId: 11,
    tier: 'Tier 1',
    run: async () => {
      const entry = 0.009450;
      const atr = 0.000150;
      const spread = 0.000010;
      // 1.30 * 0.000150 = 0.000195; 3.0 * 0.000010 = 0.000030 -> buffer is 0.000195
      const targets = TestHarness.calculateGeometricTargets({
        side: 'BUY',
        entryPrice: entry,
        atr,
        spread,
      });
      Assert.equal(Number(targets.buffer.toFixed(6)), 0.000195, 'Buffer must scale to sub-cent decimals');
      Assert.isStrictOrdering(targets.stopLoss, entry, targets.takeProfit, 'Sub-cent ordering preserved');
    },
  },
  {
    id: 'TC-T1-F11-05',
    name: 'Verify buffer prevents premature stop-out when price fluctuates within normal spread noise',
    featureId: 11,
    tier: 'Tier 1',
    run: async () => {
      const entry = 100;
      const atr = 1.0;
      const spread = 0.3; // 3.0 * 0.3 = 0.9; 1.3 * 1.0 = 1.3
      const targets = TestHarness.calculateGeometricTargets({
        side: 'BUY',
        entryPrice: entry,
        atr,
        spread,
      });
      // A noise dip of 1.0 * spread does NOT touch stop loss
      const noisePrice = entry - spread;
      Assert.isTrue(noisePrice > targets.stopLoss, 'Noise dip within spread must remain above stop loss');
    },
  },
];
