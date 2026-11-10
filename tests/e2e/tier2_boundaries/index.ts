/**
 * Tier 2 Boundaries Test Suite Aggregator
 */

import { TestCase } from '../harness/assertionUtils';
import { boundary01Tests } from './b01_rogue_teardown_boundaries.test';
import { boundary02Tests } from './b02_log_cleanup_boundaries.test';
import { boundary03Tests } from './b03_state_cache_boundaries.test';
import { boundary04Tests } from './b04_external_price_boundaries.test';
import { boundary05Tests } from './b05_delta_rest_boundaries.test';

export function getTier2Tests(): TestCase[] {
  return [
    ...boundary01Tests,
    ...boundary02Tests,
    ...boundary03Tests,
    ...boundary04Tests,
    ...boundary05Tests,
  ];
}
