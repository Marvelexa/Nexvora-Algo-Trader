/**
 * Feature 10: Positive Geometric TP/SL Formulas (R3)
 * Tier 1: Happy Path Verification (>=5 tests)
 */

import { TestCase } from '../harness/assertionUtils';
import { Assert } from '../harness/assertionUtils';
import { TestHarness } from '../harness/testHarness';

export const feature10Tests: TestCase[] = [
  {
    id: 'TC-T1-F10-01',
    name: 'Verify BUY side strictly enforces 0 < SL < entryPrice < TP',
    featureId: 10,
    tier: 'Tier 1',
    run: async () => {
      const targets = TestHarness.calculateGeometricTargets({
        side: 'BUY',
        entryPrice: 68500,
        atr: 450,
        bestBid: 68498,
        bestAsk: 68502,
        riskReward: 2.0,
      });

      Assert.isStrictOrdering(targets.stopLoss, 68500, targets.takeProfit, 'BUY targets ordering');
      Assert.isPositive(targets.stopLoss, 'Stop Loss must be strictly positive');
      Assert.isPositive(targets.takeProfit, 'Take Profit must be strictly positive');
    },
  },
  {
    id: 'TC-T1-F10-02',
    name: 'Verify SELL side strictly enforces 0 < TP < entryPrice < SL',
    featureId: 10,
    tier: 'Tier 1',
    run: async () => {
      const targets = TestHarness.calculateGeometricTargets({
        side: 'SELL',
        entryPrice: 68500,
        atr: 450,
        bestBid: 68498,
        bestAsk: 68502,
        riskReward: 2.0,
      });

      Assert.isStrictOrdering(targets.takeProfit, 68500, targets.stopLoss, 'SELL targets ordering');
      Assert.isPositive(targets.takeProfit, 'Short Take Profit must be strictly positive');
      Assert.isPositive(targets.stopLoss, 'Short Stop Loss must be strictly positive');
    },
  },
  {
    id: 'TC-T1-F10-03',
    name: 'Verify zero negative TP/SL values across mid-cap coins (SOL at $180)',
    featureId: 10,
    tier: 'Tier 1',
    run: async () => {
      const targets = TestHarness.calculateGeometricTargets({
        side: 'SELL',
        entryPrice: 180,
        atr: 2.5,
        riskReward: 2.5,
      });
      Assert.isPositive(targets.takeProfit, 'SOL Short TP must be positive');
      Assert.isStrictOrdering(targets.takeProfit, 180, targets.stopLoss, 'SOL targets ordering');
    },
  },
  {
    id: 'TC-T1-F10-04',
    name: 'Verify strictly positive Short TP on low-priced assets (DOGE at $0.14)',
    featureId: 10,
    tier: 'Tier 1',
    run: async () => {
      const targets = TestHarness.calculateGeometricTargets({
        side: 'SELL',
        entryPrice: 0.1425,
        atr: 0.005,
        riskReward: 2.0,
      });
      Assert.isPositive(targets.takeProfit, 'DOGE Short TP must be strictly positive');
      Assert.isTrue(targets.takeProfit < 0.1425, 'DOGE Short TP must be below entry');
    },
  },
  {
    id: 'TC-T1-F10-05',
    name: 'Verify price quantization rounds price to exact tick size and precision',
    featureId: 10,
    tier: 'Tier 1',
    run: async () => {
      const rawPrice = 68523.472;
      const quantizedBtc = TestHarness.quantizePrice(rawPrice, 0.5, 1);
      Assert.equal(quantizedBtc, 68523.5, 'BTC price must be quantized to 0.5 increments');

      const rawEth = 2618.3491;
      const quantizedEth = TestHarness.quantizePrice(rawEth, 0.05, 2);
      Assert.equal(quantizedEth, 2618.35, 'ETH price must be quantized to 0.05 increments');
    },
  },
];
