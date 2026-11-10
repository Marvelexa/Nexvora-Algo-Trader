/**
 * Feature 13: Contract Multipliers & Options PnL Core (R3)
 * Tier 1: Happy Path Verification (>=5 tests)
 */

import { TestCase } from '../harness/assertionUtils';
import { Assert } from '../harness/assertionUtils';
import { TestHarness } from '../harness/testHarness';

export const feature13Tests: TestCase[] = [
  {
    id: 'TC-T1-F13-01',
    name: 'Verify BTC options PnL calculation applies 0.001 multiplier',
    featureId: 13,
    tier: 'Tier 1',
    run: async () => {
      // Sold 10 contracts of BTC option at $300, current price $100 (decay profit)
      const res = TestHarness.calculateContractPnL({
        symbol: 'C-BTC-72000-261026',
        action: 'SELL',
        entryPrice: 300,
        exitPrice: 100,
        contracts: 10,
        contractValue: 0.001,
      });
      // (300 - 100) * 10 * 0.001 = 200 * 0.01 = $2.00
      Assert.equal(res.pnlUSD, 2.0, 'BTC option PnL with 0.001 multiplier must be $2.00');
    },
  },
  {
    id: 'TC-T1-F13-02',
    name: 'Verify ETH options PnL calculation applies 0.01 multiplier',
    featureId: 13,
    tier: 'Tier 1',
    run: async () => {
      // Sold 5 contracts of ETH option at $30, current price $10
      const res = TestHarness.calculateContractPnL({
        symbol: 'P-ETH-2400-261026',
        action: 'SELL',
        entryPrice: 30,
        exitPrice: 10,
        contracts: 5,
        contractValue: 0.01,
      });
      // (30 - 10) * 5 * 0.01 = 20 * 0.05 = $1.00
      Assert.equal(res.pnlUSD, 1.0, 'ETH option PnL with 0.01 multiplier must be $1.00');
    },
  },
  {
    id: 'TC-T1-F13-03',
    name: 'Verify Option Writing yields positive PnL as premium decays toward zero',
    featureId: 13,
    tier: 'Tier 1',
    run: async () => {
      const res = TestHarness.calculateContractPnL({
        symbol: 'C-BTC-72000-261026',
        action: 'SELL',
        entryPrice: 250,
        exitPrice: 25, // 90% decay
        contracts: 20,
        contractValue: 0.001,
      });
      Assert.isPositive(res.pnlUSD, 'Written option PnL must be positive as premium decays');
      Assert.equal(res.pnlPercent, 90.0, 'PnL percentage must equal 90% capture');
    },
  },
  {
    id: 'TC-T1-F13-04',
    name: 'Verify Upstream signed PnL fix: short positions generate positive PnL when price drops',
    featureId: 13,
    tier: 'Tier 1',
    run: async () => {
      const res = TestHarness.calculateContractPnL({
        symbol: 'SOLUSD',
        action: 'SELL',
        entryPrice: 180,
        exitPrice: 175,
        contracts: 2,
        contractValue: 1.0,
      });
      // (180 - 175) * 2 * 1.0 = +$10.00
      Assert.isPositive(res.pnlUSD, 'Short perp PnL must be positive when exit < entry');
      Assert.equal(res.pnlUSD, 10.0, 'Short PnL must equal $10.00');
    },
  },
  {
    id: 'TC-T1-F13-05',
    name: 'Verify DOGE perpetual PnL applies 100.0 contract multiplier',
    featureId: 13,
    tier: 'Tier 1',
    run: async () => {
      // Long 10 DOGE contracts from 0.1400 to 0.1500 (100 coins/contract)
      const res = TestHarness.calculateContractPnL({
        symbol: 'DOGEUSD',
        action: 'BUY',
        entryPrice: 0.14,
        exitPrice: 0.15,
        contracts: 10,
        contractValue: 100.0,
      });
      // (0.15 - 0.14) * 10 * 100 = 0.01 * 1000 = $10.00
      Assert.equal(res.pnlUSD, 10.0, 'DOGE perpetual PnL must be $10.00');
    },
  },
];
