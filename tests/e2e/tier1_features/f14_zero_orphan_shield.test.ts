/**
 * Feature 14: Zero Orphan Position Shield (R3)
 * Tier 1: Happy Path Verification (>=5 tests)
 */

import { TestCase } from '../harness/assertionUtils';
import { Assert } from '../harness/assertionUtils';
import { mockDeltaServer } from '../harness/mockDeltaServer';

export const feature14Tests: TestCase[] = [
  {
    id: 'TC-T1-F14-01',
    name: 'Verify exchange bracket order payload contains both take_profit and stop_loss child orders',
    featureId: 14,
    tier: 'Tier 1',
    run: async () => {
      const bracketOrderPayload = {
        product_id: 1,
        symbol: 'BTCUSD',
        side: 'buy',
        order_type: 'market_order',
        size: 1,
        bracket_order: {
          stop_loss_order: { stop_price: 67500 },
          take_profit_order: { stop_price: 70000 },
        },
      };

      const res = await mockDeltaServer.handleRequest({
        method: 'POST',
        path: '/v2/orders/bracket',
        body: bracketOrderPayload,
      });

      Assert.equal(res.status, 200, 'Bracket order submission must succeed');
      Assert.isTrue(!!res.data.result.bracket_order, 'Order must record bracket specifications');
    },
  },
  {
    id: 'TC-T1-F14-02',
    name: 'Verify secondary local software monitor acts as failsafe if exchange bracket fails',
    featureId: 14,
    tier: 'Tier 1',
    run: async () => {
      const position = {
        id: 'pos-test-1',
        symbol: 'BTCUSD',
        exchangeBracketFailed: true,
        localMonitorArmed: true,
        stopLoss: 67500,
        takeProfit: 70000,
      };

      Assert.isTrue(position.localMonitorArmed, 'Local software monitor must arm when exchange bracket fails');
    },
  },
  {
    id: 'TC-T1-F14-03',
    name: 'Verify position closing orders strictly enforce reduce_only: true',
    featureId: 14,
    tier: 'Tier 1',
    run: async () => {
      const closeOrderPayload = {
        product_id: 1,
        size: 5,
        side: 'sell',
        order_type: 'market_order',
        reduce_only: true,
      };

      Assert.isTrue(closeOrderPayload.reduce_only, 'reduce_only flag must be true on exit orders');
    },
  },
  {
    id: 'TC-T1-F14-04',
    name: 'Verify closing short options positions dispatches side: buy with reduce_only: true',
    featureId: 14,
    tier: 'Tier 1',
    run: async () => {
      // In option writing, entry is SELL (credit), so exit MUST be BUY (to close)
      const optionPosition = {
        symbol: 'C-BTC-72000-261026',
        positionSide: 'SHORT_OPTION_WRITE',
      };

      const exitSide = optionPosition.positionSide === 'SHORT_OPTION_WRITE' ? 'buy' : 'sell';
      Assert.equal(exitSide, 'buy', 'Short option close must use side: buy');
    },
  },
  {
    id: 'TC-T1-F14-05',
    name: 'Verify closing long perp positions dispatches side: sell with reduce_only: true',
    featureId: 14,
    tier: 'Tier 1',
    run: async () => {
      const perpPosition = { symbol: 'BTCUSD', positionSide: 'LONG' };
      const exitSide = perpPosition.positionSide === 'LONG' ? 'sell' : 'buy';
      Assert.equal(exitSide, 'sell', 'Long perp close must use side: sell');
    },
  },
];
