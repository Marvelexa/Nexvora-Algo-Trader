import 'dotenv/config';
import { deltaExchange } from '../lib/deltaExchangeEngine';

async function testRealDelta() {
  console.log('Testing live Delta Exchange API with configured credentials...');
  (deltaExchange as any).config.isSimulation = false;

  try {
    const p = await deltaExchange.request('GET', '/v2/positions/margined');
    console.log('GET /v2/positions/margined: SUCCESS!', p?.result ? p.result.length : 0);
  } catch (e: any) {
    console.log('GET /v2/positions/margined FAILED:', e.message);
  }

  try {
    const h = await deltaExchange.request('GET', '/v2/orders/history');
    console.log('GET /v2/orders/history: SUCCESS!', h?.result ? h.result.length : 0);
  } catch (e: any) {
    console.log('GET /v2/orders/history FAILED:', e.message);
  }

  try {
    const f = await deltaExchange.request('GET', '/v2/fills');
    console.log('GET /v2/fills: SUCCESS!', f?.result ? f.result.length : 0);
  } catch (e: any) {
    console.log('GET /v2/fills FAILED:', e.message);
  }
}
testRealDelta();
