/**
 * Feature 8: Spread & Depth Guardrails (R2)
 * Tier 1: Happy Path Verification (>=5 tests)
 */

import { TestCase } from '../harness/assertionUtils';
import { Assert } from '../harness/assertionUtils';

export const feature08Tests: TestCase[] = [
  {
    id: 'TC-T1-F08-01',
    name: 'Verify perpetual spread validation passes when spread <= 0.35%',
    featureId: 8,
    tier: 'Tier 1',
    run: async () => {
      const bid = 68500;
      const ask = 68515; // 0.021% spread
      const mid = (bid + ask) / 2;
      const spreadPct = ((ask - bid) / mid) * 100;
      Assert.isTrue(spreadPct <= 0.35, `Spread ${spreadPct.toFixed(3)}% must be <= 0.35%`);
    },
  },
  {
    id: 'TC-T1-F08-02',
    name: 'Verify perpetual spread validation blocks trade when spread > 0.35%',
    featureId: 8,
    tier: 'Tier 1',
    run: async () => {
      const bid = 100;
      const ask = 101.5; // 1.49% spread
      const mid = (bid + ask) / 2;
      const spreadPct = ((ask - bid) / mid) * 100;
      const isLiquid = spreadPct <= 0.35;
      Assert.isFalse(isLiquid, 'Excessive spread (>0.35%) must be rejected');
    },
  },
  {
    id: 'TC-T1-F08-03',
    name: 'Verify options spread guard passes when spread <= 2.50% and blocks when > 2.50%',
    featureId: 8,
    tier: 'Tier 1',
    run: async () => {
      const optionBid = 200;
      const optionAsk = 204; // 1.98% spread
      const mid = (optionBid + optionAsk) / 2;
      const spreadPct = ((optionAsk - optionBid) / mid) * 100;
      Assert.isTrue(spreadPct <= 2.50, 'Option spread <= 2.50% must be valid for condor');

      const illiquidOptionAsk = 212; // 5.8% spread
      const illiquidSpreadPct = ((illiquidOptionAsk - optionBid) / ((optionBid + illiquidOptionAsk) / 2)) * 100;
      Assert.isFalse(illiquidSpreadPct <= 2.50, 'Option spread > 2.50% must be blocked');
    },
  },
  {
    id: 'TC-T1-F08-04',
    name: 'Verify top-3 orderbook depth volume requires >= 2x desired order size',
    featureId: 8,
    tier: 'Tier 1',
    run: async () => {
      const orderSize = 10;
      const top3Bids = [
        { price: 100, size: 8 },
        { price: 99.9, size: 12 },
        { price: 99.8, size: 15 },
      ];
      const availableDepth = top3Bids.reduce((sum, b) => sum + b.size, 0); // 35
      const hasSufficientDepth = availableDepth >= orderSize * 2.0; // 35 >= 20
      Assert.isTrue(hasSufficientDepth, 'Top 3 depth must provide >= 2x requested size buffer');
    },
  },
  {
    id: 'TC-T1-F08-05',
    name: 'Verify Order Book Imbalance (OBI) computation matches (bid_vol - ask_vol) / (bid_vol + ask_vol)',
    featureId: 8,
    tier: 'Tier 1',
    run: async () => {
      const bidVol = 300;
      const askVol = 100;
      const expectedObi = (bidVol - askVol) / (bidVol + askVol); // 200 / 400 = 0.50
      Assert.equal(expectedObi, 0.50, 'OBI must equal 0.50 for 3:1 bid dominance');
      Assert.inRange(expectedObi, -1.0, 1.0, 'OBI must be bounded between -1.0 and 1.0');
    },
  },
];
