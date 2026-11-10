/**
 * Feature 18: Purge Non-Trading Macro Channels (R4)
 * Tier 1: Happy Path Verification (>=5 tests)
 */

import { TestCase } from '../harness/assertionUtils';
import { Assert } from '../harness/assertionUtils';
import { evaluateStrategyForPort } from '../../../lib/strategies/strategyRegistry';

export const feature18Tests: TestCase[] = [
  {
    id: 'TC-T1-F18-01',
    name: 'Verify Coin Bureau valuation engine is excluded from 15m scalping loops',
    featureId: 18,
    tier: 'Tier 1',
    run: async () => {
      // In unified scalping loop (port 3001), macro fundamental valuation is bypassed
      const res = evaluateStrategyForPort(3001, 'BTCUSD', []);
      Assert.notIncludes(res.strategyName, 'Coin Bureau', 'Main execution must not run Coin Bureau macro');
    },
  },
  {
    id: 'TC-T1-F18-02',
    name: 'Verify Benjamin Cowen multi-year cycles engine is excluded from 15m scalping loops',
    featureId: 18,
    tier: 'Tier 1',
    run: async () => {
      const res = evaluateStrategyForPort(3001, 'BTCUSD', []);
      Assert.notIncludes(res.strategyName, 'Benjamin Cowen', 'Main execution must not run Cowen multi-year cycles');
    },
  },
  {
    id: 'TC-T1-F18-03',
    name: 'Verify DataDash macro liquidity engine is excluded from 15m scalping loops',
    featureId: 18,
    tier: 'Tier 1',
    run: async () => {
      const res = evaluateStrategyForPort(3001, 'BTCUSD', []);
      Assert.notIncludes(res.strategyName, 'DataDash', 'Main execution must not run DataDash macro flow');
    },
  },
  {
    id: 'TC-T1-F18-04',
    name: 'Verify Whiteboard Crypto DeFi educational engine is excluded from 15m scalping loops',
    featureId: 18,
    tier: 'Tier 1',
    run: async () => {
      const res = evaluateStrategyForPort(3001, 'BTCUSD', []);
      Assert.notIncludes(res.strategyName, 'Whiteboard', 'Main execution must not run Whiteboard Crypto educational');
    },
  },
  {
    id: 'TC-T1-F18-05',
    name: 'Verify Miles Deutscher narrative momentum is excluded from 15m scalping loops',
    featureId: 18,
    tier: 'Tier 1',
    run: async () => {
      const res = evaluateStrategyForPort(3001, 'BTCUSD', []);
      Assert.notIncludes(res.strategyName, 'Miles Deutscher', 'Main execution must not run narrative momentum');
    },
  },
];
