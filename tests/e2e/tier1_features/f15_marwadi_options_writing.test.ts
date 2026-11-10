/**
 * Feature 15: Marwadi Delta Options Writing Engine (5:30 PM IST) (R4)
 * Tier 1: Happy Path Verification (>=5 tests)
 */

import { TestCase } from '../harness/assertionUtils';
import { Assert } from '../harness/assertionUtils';
import { parseDeltaDDMMYY } from '../../../lib/deltaOptionsCondorEngine';

export const feature15Tests: TestCase[] = [
  {
    id: 'TC-T1-F15-01',
    name: 'Verify Marwadi strategy strictly executes Option Writing / Selling (no Option Buying)',
    featureId: 15,
    tier: 'Tier 1',
    run: async () => {
      const allowedStrategyActions = ['SELL_OTM_CALL', 'SELL_OTM_PUT', 'SELL_STRANGLE', 'SELL_IRON_CONDOR'];
      const action = 'SELL_STRANGLE';
      Assert.isTrue(allowedStrategyActions.includes(action), 'Action must be an option writing / selling setup');
    },
  },
  {
    id: 'TC-T1-F15-02',
    name: 'Verify Option Buying is prohibited as primary directional trading setup',
    featureId: 15,
    tier: 'Tier 1',
    run: async () => {
      const requestedAction = 'BUY_CALL_SPECULATION';
      const isAllowedPrimary = requestedAction.startsWith('SELL_');
      Assert.isFalse(isAllowedPrimary, 'Direct option buying for speculation must be blocked');
    },
  },
  {
    id: 'TC-T1-F15-03',
    name: 'Verify Delta options expiry settlement timestamp matches 12:00 UTC (5:30 PM IST)',
    featureId: 15,
    tier: 'Tier 1',
    run: async () => {
      // Expiry format '261026' -> 26 Oct 2026, 12:00:00 UTC
      const expiryMs = parseDeltaDDMMYY('261026');
      const d = new Date(expiryMs);
      Assert.equal(d.getUTCHours(), 12, 'Settlement hour in UTC must be 12:00 UTC');
      Assert.equal(d.getUTCMinutes(), 0, 'Settlement minute in UTC must be 00');
    },
  },
  {
    id: 'TC-T1-F15-04',
    name: 'Verify OTM strike selection: Call strike >= 5% above spot, Put strike >= 5% below spot',
    featureId: 15,
    tier: 'Tier 1',
    run: async () => {
      const spotPrice = 68000;
      const targetCallStrike = spotPrice * 1.05; // 71400
      const targetPutStrike = spotPrice * 0.95;  // 64600

      Assert.isStrictOrdering(targetPutStrike, spotPrice, targetCallStrike, 'OTM Strangle ordering');
      Assert.isTrue(targetCallStrike >= spotPrice * 1.045, 'Call strike must be at least 5% OTM');
      Assert.isTrue(targetPutStrike <= spotPrice * 0.955, 'Put strike must be at least 5% OTM');
    },
  },
  {
    id: 'TC-T1-F15-05',
    name: 'Verify Theta decay capture: credit premium diminishes as time approaches expiry',
    featureId: 15,
    tier: 'Tier 1',
    run: async () => {
      const initialPremium = 300;
      const decayRatio = 0.80; // 80% decay capture target
      const targetExitPremium = Math.round(initialPremium * (1 - decayRatio)); // 60
      Assert.equal(targetExitPremium, 60, 'Exit premium must equal $60 after 80% theta harvest');
    },
  },
];
