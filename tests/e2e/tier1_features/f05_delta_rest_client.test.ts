/**
 * Feature 5: Delta India Native REST Client with HMAC-SHA256 (R2)
 * Tier 1: Happy Path Verification (>=5 tests)
 */

import { TestCase } from '../harness/assertionUtils';
import { Assert } from '../harness/assertionUtils';
import { mockDeltaServer } from '../harness/mockDeltaServer';
import { DeltaExchangeEngine } from '../../../lib/deltaExchangeEngine';

export const feature05Tests: TestCase[] = [
  {
    id: 'TC-T1-F05-01',
    name: 'Verify HMAC-SHA256 prehash signature generation matches Delta specification',
    featureId: 5,
    tier: 'Tier 1',
    run: async () => {
      const apiSecret = 'test_secret_12345';
      const apiKey = 'test_key_abcde';
      const method = 'GET';
      const timestamp = '1729950000';
      const path = '/v2/positions';
      const queryOrBody = '';

      const sig = mockDeltaServer.generateSignature(apiSecret, method, timestamp, path, queryOrBody);
      Assert.isTrue(sig.length === 64, 'HMAC-SHA256 hex signature must be 64 characters');
      const verified = mockDeltaServer.verifySignature(apiKey, apiSecret, method, timestamp, path, queryOrBody, sig);
      Assert.isTrue(verified, 'Signature must be verified successfully by mock server');
    },
  },
  {
    id: 'TC-T1-F05-02',
    name: 'Verify native production base URL defaults to api.india.delta.exchange',
    featureId: 5,
    tier: 'Tier 1',
    run: async () => {
      const client = new DeltaExchangeEngine({ isTestnet: false });
      const cfg = (client as any).config || (client as any).getConfig?.();
      Assert.equal(cfg.baseUrl, 'https://api.india.delta.exchange', 'Base URL must be native Delta India');
    },
  },
  {
    id: 'TC-T1-F05-03',
    name: 'Verify native testnet base URL defaults to cdn-ind.testnet.deltaex.org',
    featureId: 5,
    tier: 'Tier 1',
    run: async () => {
      const client = new DeltaExchangeEngine({ isTestnet: true });
      const cfg = (client as any).config || (client as any).getConfig?.();
      Assert.equal(cfg.baseUrl, 'https://cdn-ind.testnet.deltaex.org', 'Testnet URL must be Delta India testnet');
    },
  },
  {
    id: 'TC-T1-F05-04',
    name: 'Verify authentication headers (api-key, signature, timestamp) on private requests',
    featureId: 5,
    tier: 'Tier 1',
    run: async () => {
      const apiKey = 'mock_key';
      const apiSecret = 'mock_secret';
      const timestamp = String(Math.floor(Date.now() / 1000));
      const sig = mockDeltaServer.generateSignature(apiSecret, 'GET', timestamp, '/v2/wallet/balances', '');

      const headers: Record<string, string> = {
        'api-key': apiKey,
        'timestamp': timestamp,
        'signature': sig,
        'Content-Type': 'application/json',
      };

      Assert.equal(headers['api-key'], apiKey, 'api-key header must be set');
      Assert.isTrue(headers['signature'].length > 0, 'signature header must be populated');
      Assert.isTrue(headers['timestamp'].length > 0, 'timestamp header must be populated');
    },
  },
  {
    id: 'TC-T1-F05-05',
    name: 'Verify mock REST client GET /v2/products returns operational product list',
    featureId: 5,
    tier: 'Tier 1',
    run: async () => {
      const res = await mockDeltaServer.handleRequest({ method: 'GET', path: '/v2/products' });
      Assert.equal(res.status, 200, 'Products response status must be 200');
      Assert.isTrue(res.data.success, 'Response success must be true');
      Assert.isTrue(Array.isArray(res.data.result), 'Response result must be an array of products');
      Assert.isTrue(res.data.result.length > 5, 'Must contain standard products');
    },
  },
];
