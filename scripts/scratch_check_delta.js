const crypto = require('crypto');
const https = require('https');

const apiKey = process.env.DELTA_API_KEY || '';
const apiSecret = process.env.DELTA_API_SECRET || '';
const isTestnet = true; // Delta India testnet
const host = isTestnet ? 'cdn-ind.testnet.deltaex.org' : 'api.india.delta.exchange';

async function request(method, path, query = {}, body = {}) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const queryString = Object.keys(query).length > 0 ? '?' + new URLSearchParams(query).toString() : '';
  const bodyString = Object.keys(body).length > 0 ? JSON.stringify(body) : '';
  const payload = method + timestamp + path + queryString + bodyString;
  const signature = crypto.createHmac('sha256', apiSecret).update(payload).digest('hex');

  const headers = {
    'api-key': apiKey,
    'signature': signature,
    'timestamp': timestamp,
    'User-Agent': 'Delta-Client',
    'Content-Type': 'application/json'
  };

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host,
      path: path + queryString,
      method: method,
      headers: headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    if (bodyString) req.write(bodyString);
    req.end();
  });
}

export { request };
(async () => {
  const p = await request('GET', '/v2/positions/margined');
  console.log('POS:', p?.result?.map(x => ({ sym: x.product_symbol, size: x.size, mark: x.mark_price, pnl: x.unrealized_pnl })));
  const o = await request('GET', '/v2/orders', { state: 'open' });
  console.log('OPEN:', o?.result?.map(x => ({ sym: x.product_symbol, type: x.stop_order_type, stop: x.stop_price })));
})();
