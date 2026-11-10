import { deltaExchange } from '../lib/deltaExchange.ts';
import { PRIME_LIQUID_WATCHLIST } from '../lib/deltaAutoTraderEngine.ts';

async function test() {
  await deltaExchange.loadProducts();
  console.log('Total products loaded on Delta:', deltaExchange.getProducts().length);
  for (const sym of PRIME_LIQUID_WATCHLIST) {
    console.log(sym, 'supported?', deltaExchange.isProductSupported(sym));
  }
}
test().catch(console.error);
