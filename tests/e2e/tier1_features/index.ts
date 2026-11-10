/**
 * Tier 1 Features Test Suite Aggregator
 * 22 Features * 5 tests = 110 Test Cases
 */

import { TestCase } from '../harness/assertionUtils';
import { feature01Tests } from './f01_rogue_teardown.test';
import { feature02Tests } from './f02_log_cleanup.test';
import { feature03Tests } from './f03_state_cache.test';
import { feature04Tests } from './f04_external_price_cache.test';
import { feature05Tests } from './f05_delta_rest_client.test';
import { feature06Tests } from './f06_delta_websocket.test';
import { feature07Tests } from './f07_zero_price_fallback.test';
import { feature08Tests } from './f08_spread_depth_guardrails.test';
import { feature09Tests } from './f09_dynamic_product_metadata.test';
import { feature10Tests } from './f10_geometric_tpsl.test';
import { feature11Tests } from './f11_dynamic_atr_buffers.test';
import { feature12Tests } from './f12_active_position_monitor.test';
import { feature13Tests } from './f13_contract_multipliers_pnl.test';
import { feature14Tests } from './f14_zero_orphan_shield.test';
import { feature15Tests } from './f15_marwadi_options_writing.test';
import { feature16Tests } from './f16_ict_smc_anti_trap.test';
import { feature17Tests } from './f17_charuka_wyckoff_vsa.test';
import { feature18Tests } from './f18_macro_channels_purge.test';
import { feature19Tests } from './f19_single_pane_dashboard.test';
import { feature20Tests } from './f20_live_strategy_analytics.test';
import { feature21Tests } from './f21_tradingview_candlestick.test';
import { feature22Tests } from './f22_low_resource_runtime.test';

export function getTier1Tests(): TestCase[] {
  return [
    ...feature01Tests,
    ...feature02Tests,
    ...feature03Tests,
    ...feature04Tests,
    ...feature05Tests,
    ...feature06Tests,
    ...feature07Tests,
    ...feature08Tests,
    ...feature09Tests,
    ...feature10Tests,
    ...feature11Tests,
    ...feature12Tests,
    ...feature13Tests,
    ...feature14Tests,
    ...feature15Tests,
    ...feature16Tests,
    ...feature17Tests,
    ...feature18Tests,
    ...feature19Tests,
    ...feature20Tests,
    ...feature21Tests,
    ...feature22Tests,
  ];
}
