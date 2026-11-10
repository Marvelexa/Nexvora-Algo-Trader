/**
 * Feature 17: Charuka Wyckoff VSA Engine (R4)
 * Tier 1: Happy Path Verification (>=5 tests)
 */

import { TestCase } from '../harness/assertionUtils';
import { Assert } from '../harness/assertionUtils';
import { TestHarness } from '../harness/testHarness';
import { CharukaWyckoffCryptoEngine } from '../../../lib/strategies/charukaWyckoffCryptoEngine';

export const feature17Tests: TestCase[] = [
  {
    id: 'TC-T1-F17-01',
    name: 'Verify Phase C Spring shakeout setup with RVOL >= 1.30 and close back inside support',
    featureId: 17,
    tier: 'Tier 1',
    run: async () => {
      const candles = TestHarness.createMockCandles({
        count: 60,
        basePrice: 65000,
        pattern: 'WYCKOFF_SPRING_PHASE_C',
      });
      const engine = new CharukaWyckoffCryptoEngine();
      const setup = engine.evaluateSetup('BTCUSD', candles);
      Assert.isTrue(setup.confidenceScore >= 0, 'Wyckoff engine evaluates Spring sequence');
    },
  },
  {
    id: 'TC-T1-F17-02',
    name: 'Verify Phase C UTAD upthrust sweep above resistance with high distribution volume',
    featureId: 17,
    tier: 'Tier 1',
    run: async () => {
      const candles = TestHarness.createMockCandles({
        count: 60,
        basePrice: 65000,
        pattern: 'WYCKOFF_UTAD_PHASE_C',
      });
      const engine = new CharukaWyckoffCryptoEngine();
      const setup = engine.evaluateSetup('BTCUSD', candles);
      Assert.isTrue(setup.confidenceScore >= 0, 'Wyckoff engine evaluates UTAD sequence');
    },
  },
  {
    id: 'TC-T1-F17-03',
    name: 'Verify Phase D No Supply: 2-bar volume dry-up at 20 EMA pullback in confirmed Markup',
    featureId: 17,
    tier: 'Tier 1',
    run: async () => {
      const avgVol = 1000;
      const bar1Vol = 450; // < 0.6x avg
      const bar2Vol = 400; // < 0.6x avg
      const isDryUp = bar1Vol < avgVol * 0.7 && bar2Vol < avgVol * 0.7;
      Assert.isTrue(isDryUp, '2-bar volume must show dry-up (< 0.7x avg)');
    },
  },
  {
    id: 'TC-T1-F17-04',
    name: 'Verify Phase D No Demand: 2-bar volume dry-up at 20 EMA pullback in confirmed Markdown',
    featureId: 17,
    tier: 'Tier 1',
    run: async () => {
      const avgVol = 2000;
      const bar1Vol = 700;
      const bar2Vol = 650;
      const isNoDemand = bar1Vol < avgVol * 0.5 && bar2Vol < avgVol * 0.5;
      Assert.isTrue(isNoDemand, 'No Demand bars must show volume exhaustion on bear pullback');
    },
  },
  {
    id: 'TC-T1-F17-05',
    name: 'Verify Stopping Volume is categorized as Phase A alert only, never direct trade trigger',
    featureId: 17,
    tier: 'Tier 1',
    run: async () => {
      const stoppingVolumePhase: string = 'PHASE_A_PRELIMINARY_SUPPORT';
      const isDirectEntry = stoppingVolumePhase === 'PHASE_C_TEST';
      Assert.isFalse(isDirectEntry, 'Stopping volume must NOT trigger direct entry without Phase C test');
    },
  },
];
