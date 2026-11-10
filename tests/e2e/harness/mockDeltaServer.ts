/**
 * High-Fidelity Delta Exchange India In-Memory Mock Server & Network Simulator
 * Supports deterministic testing without network latency or burning live trading capital.
 */

import crypto from 'crypto';

export interface MockProduct {
  id: number;
  symbol: string;
  contract_type: 'perpetual_futures' | 'futures' | 'call_options' | 'put_options';
  strike_price?: string;
  settlement_time?: string;
  tick_size: string;
  contract_value: string;
  decimals: number;
  trading_status: 'operational' | 'suspended' | 'delisted';
  notional_type: 'vanilla' | 'inverse';
}

export interface MockOrderBookLevel {
  price: number;
  size: number;
}

export interface MockOrderBook {
  bids: MockOrderBookLevel[];
  asks: MockOrderBookLevel[];
}

export interface MockTicker {
  symbol: string;
  mark_price: number;
  spot_price: number;
  best_bid: number;
  best_ask: number;
  volume_24h: number;
  open_interest: number;
  funding_rate: number;
  timestamp: number;
}

export interface MockOrder {
  id: string;
  product_id: number;
  symbol: string;
  side: 'buy' | 'sell';
  order_type: 'market_order' | 'limit_order' | 'stop_market_order';
  size: number;
  limit_price?: number;
  stop_price?: number;
  reduce_only: boolean;
  bracket_order?: {
    stop_loss_order?: { stop_price: number };
    take_profit_order?: { stop_price: number };
  };
  status: 'open' | 'filled' | 'cancelled' | 'rejected';
  filled_size: number;
  average_fill_price?: number;
  created_at: number;
}

export class MockDeltaServer {
  private products: Map<string, MockProduct> = new Map();
  private tickers: Map<string, MockTicker> = new Map();
  private orderBooks: Map<string, MockOrderBook> = new Map();
  private orders: Map<string, MockOrder> = new Map();
  private orderCounter: number = 1000;
  
  // Failure simulation flags
  public simulateNetworkTimeout: boolean = false;
  public simulateHttp502: boolean = false;
  public simulateHttp429: boolean = false;
  public simulateCorruptJson: boolean = false;

  constructor() {
    this.seedDefaultProducts();
    this.seedDefaultMarketData();
  }

  public reset(): void {
    this.products.clear();
    this.tickers.clear();
    this.orderBooks.clear();
    this.orders.clear();
    this.orderCounter = 1000;
    this.simulateNetworkTimeout = false;
    this.simulateHttp502 = false;
    this.simulateHttp429 = false;
    this.simulateCorruptJson = false;
    this.seedDefaultProducts();
    this.seedDefaultMarketData();
  }

  private seedDefaultProducts(): void {
    const defaultList: MockProduct[] = [
      { id: 1, symbol: 'BTCUSD', contract_type: 'perpetual_futures', tick_size: '0.5', contract_value: '0.001', decimals: 1, trading_status: 'operational', notional_type: 'vanilla' },
      { id: 2, symbol: 'ETHUSD', contract_type: 'perpetual_futures', tick_size: '0.05', contract_value: '0.01', decimals: 2, trading_status: 'operational', notional_type: 'vanilla' },
      { id: 3, symbol: 'SOLUSD', contract_type: 'perpetual_futures', tick_size: '0.0001', contract_value: '1.0', decimals: 4, trading_status: 'operational', notional_type: 'vanilla' },
      { id: 4, symbol: 'XRPUSD', contract_type: 'perpetual_futures', tick_size: '0.0001', contract_value: '1.0', decimals: 4, trading_status: 'operational', notional_type: 'vanilla' },
      { id: 5, symbol: 'DOGEUSD', contract_type: 'perpetual_futures', tick_size: '0.000001', contract_value: '100.0', decimals: 6, trading_status: 'operational', notional_type: 'vanilla' },
      { id: 6, symbol: '1000PEPEUSD', contract_type: 'perpetual_futures', tick_size: '0.00000001', contract_value: '1000.0', decimals: 8, trading_status: 'operational', notional_type: 'vanilla' },
      { id: 7, symbol: 'AVAXUSD', contract_type: 'perpetual_futures', tick_size: '0.0001', contract_value: '1.0', decimals: 4, trading_status: 'operational', notional_type: 'vanilla' },
      { id: 8, symbol: 'SUIUSD', contract_type: 'perpetual_futures', tick_size: '0.0001', contract_value: '1.0', decimals: 4, trading_status: 'operational', notional_type: 'vanilla' },
      // Marwadi 5:30 PM IST Daily Options Contracts
      { id: 101, symbol: 'C-BTC-72000-261026', contract_type: 'call_options', strike_price: '72000', settlement_time: '2026-10-26T12:00:00Z', tick_size: '1.0', contract_value: '0.001', decimals: 1, trading_status: 'operational', notional_type: 'vanilla' },
      { id: 102, symbol: 'P-BTC-66000-261026', contract_type: 'put_options', strike_price: '66000', settlement_time: '2026-10-26T12:00:00Z', tick_size: '1.0', contract_value: '0.001', decimals: 1, trading_status: 'operational', notional_type: 'vanilla' },
      { id: 103, symbol: 'C-ETH-2800-261026', contract_type: 'call_options', strike_price: '2800', settlement_time: '2026-10-26T12:00:00Z', tick_size: '0.1', contract_value: '0.01', decimals: 2, trading_status: 'operational', notional_type: 'vanilla' },
      { id: 104, symbol: 'P-ETH-2400-261026', contract_type: 'put_options', strike_price: '2400', settlement_time: '2026-10-26T12:00:00Z', tick_size: '0.1', contract_value: '0.01', decimals: 2, trading_status: 'operational', notional_type: 'vanilla' },
      // Delisted coin for boundary testing
      { id: 999, symbol: 'DELISTEDUSD', contract_type: 'perpetual_futures', tick_size: '0.01', contract_value: '1.0', decimals: 2, trading_status: 'delisted', notional_type: 'vanilla' },
    ];

    for (const p of defaultList) {
      this.products.set(p.symbol, p);
    }
  }

  private seedDefaultMarketData(): void {
    const now = Date.now();
    // Default prices
    this.setTicker('BTCUSD', { mark_price: 68500, spot_price: 68495, best_bid: 68498, best_ask: 68502, volume_24h: 150000000, open_interest: 45000, funding_rate: 0.0001, timestamp: now });
    this.setTicker('ETHUSD', { mark_price: 2620, spot_price: 2619, best_bid: 2619.5, best_ask: 2620.5, volume_24h: 85000000, open_interest: 120000, funding_rate: 0.00008, timestamp: now });
    this.setTicker('SOLUSD', { mark_price: 178.5, spot_price: 178.48, best_bid: 178.45, best_ask: 178.55, volume_24h: 42000000, open_interest: 650000, funding_rate: 0.00012, timestamp: now });
    this.setTicker('XRPUSD', { mark_price: 0.5420, spot_price: 0.5419, best_bid: 0.5419, best_ask: 0.5421, volume_24h: 30000000, open_interest: 8500000, funding_rate: 0.00005, timestamp: now });
    this.setTicker('DOGEUSD', { mark_price: 0.142500, spot_price: 0.142490, best_bid: 0.142480, best_ask: 0.142520, volume_24h: 22000000, open_interest: 15000000, funding_rate: 0.0001, timestamp: now });
    this.setTicker('1000PEPEUSD', { mark_price: 0.00945200, spot_price: 0.00945100, best_bid: 0.00945100, best_ask: 0.00945300, volume_24h: 18000000, open_interest: 9000000, funding_rate: 0.00015, timestamp: now });
    // Options tickers
    this.setTicker('C-BTC-72000-261026', { mark_price: 245.0, spot_price: 245.0, best_bid: 240.0, best_ask: 250.0, volume_24h: 500000, open_interest: 1200, funding_rate: 0, timestamp: now });
    this.setTicker('P-BTC-66000-261026', { mark_price: 210.0, spot_price: 210.0, best_bid: 205.0, best_ask: 215.0, volume_24h: 480000, open_interest: 1100, funding_rate: 0, timestamp: now });
    this.setTicker('C-ETH-2800-261026', { mark_price: 18.5, spot_price: 18.5, best_bid: 18.0, best_ask: 19.0, volume_24h: 250000, open_interest: 4500, funding_rate: 0, timestamp: now });
    this.setTicker('P-ETH-2400-261026', { mark_price: 16.0, spot_price: 16.0, best_bid: 15.5, best_ask: 16.5, volume_24h: 220000, open_interest: 4100, funding_rate: 0, timestamp: now });

    // Seed default liquid orderbooks
    this.setOrderBook('BTCUSD', {
      bids: [{ price: 68498, size: 5.5 }, { price: 68495, size: 10.2 }, { price: 68490, size: 25.0 }],
      asks: [{ price: 68502, size: 4.8 }, { price: 68505, size: 12.0 }, { price: 68510, size: 28.5 }],
    });
    this.setOrderBook('ETHUSD', {
      bids: [{ price: 2619.5, size: 45.0 }, { price: 2619.0, size: 85.0 }, { price: 2618.0, size: 120.0 }],
      asks: [{ price: 2620.5, size: 40.0 }, { price: 2621.0, size: 75.0 }, { price: 2622.0, size: 130.0 }],
    });
    this.setOrderBook('1000PEPEUSD', {
      bids: [{ price: 0.00945100, size: 500000 }, { price: 0.00945000, size: 1200000 }, { price: 0.00944800, size: 2500000 }],
      asks: [{ price: 0.00945300, size: 480000 }, { price: 0.00945500, size: 1100000 }, { price: 0.00945800, size: 2800000 }],
    });
  }

  public setTicker(symbol: string, ticker: Partial<MockTicker> & { mark_price: number }): void {
    const existing = this.tickers.get(symbol);
    const full: MockTicker = {
      symbol,
      mark_price: ticker.mark_price,
      spot_price: ticker.spot_price ?? ticker.mark_price,
      best_bid: ticker.best_bid ?? ticker.mark_price * 0.9999,
      best_ask: ticker.best_ask ?? ticker.mark_price * 1.0001,
      volume_24h: ticker.volume_24h ?? 1000000,
      open_interest: ticker.open_interest ?? 50000,
      funding_rate: ticker.funding_rate ?? 0.0001,
      timestamp: ticker.timestamp ?? Date.now(),
    };
    this.tickers.set(symbol, full);
  }

  public setOrderBook(symbol: string, ob: MockOrderBook): void {
    this.orderBooks.set(symbol, ob);
  }

  public addProduct(p: MockProduct): void {
    this.products.set(p.symbol, p);
  }

  // Delta India HMAC-SHA256 signature verifier
  public verifySignature(apiKey: string, apiSecret: string, method: string, timestamp: string, path: string, queryOrBody: string, signature: string): boolean {
    if (!apiKey || !apiSecret || !signature || !timestamp) return false;
    const prehash = method.toUpperCase() + timestamp + path + (queryOrBody || '');
    const expected = crypto.createHmac('sha256', apiSecret).update(prehash).digest('hex');
    return expected === signature;
  }

  public generateSignature(apiSecret: string, method: string, timestamp: string, path: string, queryOrBody: string): string {
    const prehash = method.toUpperCase() + timestamp + path + (queryOrBody || '');
    return crypto.createHmac('sha256', apiSecret).update(prehash).digest('hex');
  }

  // REST Dispatch Simulator
  public async handleRequest(params: {
    method: 'GET' | 'POST' | 'DELETE' | 'PUT';
    path: string;
    headers?: Record<string, string>;
    query?: Record<string, any>;
    body?: any;
  }): Promise<{ status: number; data: any }> {
    if (this.simulateNetworkTimeout) {
      throw new Error('ETIMEDOUT: Connection to api.india.delta.exchange timed out');
    }
    if (this.simulateHttp502) {
      return { status: 502, data: { error: 'Bad Gateway: Delta India Edge Proxy' } };
    }
    if (this.simulateHttp429) {
      return { status: 429, data: { error: 'Too Many Requests', retry_after: 2 } };
    }
    if (this.simulateCorruptJson) {
      return { status: 200, data: '<html><body>Internal Server Error 500</body></html>' };
    }

    const { method, path: reqPath, body, query } = params;

    // 1. GET /v2/products
    if (method === 'GET' && reqPath === '/v2/products') {
      const result = Array.from(this.products.values());
      return { status: 200, data: { success: true, result } };
    }

    // 2. GET /v2/tickers
    if (method === 'GET' && reqPath === '/v2/tickers') {
      const sym = query?.symbol;
      if (sym) {
        const t = this.tickers.get(sym);
        if (!t) return { status: 404, data: { success: false, error: 'Product not found' } };
        return { status: 200, data: { success: true, result: t } };
      }
      return { status: 200, data: { success: true, result: Array.from(this.tickers.values()) } };
    }

    // 3. GET /v2/orderbook
    if (method === 'GET' && reqPath === '/v2/orderbook') {
      const sym = query?.symbol;
      const ob = this.orderBooks.get(sym);
      if (!ob) {
        return { status: 200, data: { success: true, result: { symbol: sym, bids: [], asks: [] } } };
      }
      return { status: 200, data: { success: true, result: { symbol: sym, ...ob } } };
    }

    // 4. POST /v2/orders (or bracket orders)
    if (method === 'POST' && (reqPath === '/v2/orders' || reqPath === '/v2/orders/bracket')) {
      const product = Array.from(this.products.values()).find(p => p.id === body?.product_id || p.symbol === body?.symbol);
      if (!product) {
        return { status: 400, data: { success: false, error: 'Invalid product_id' } };
      }
      if (product.trading_status !== 'operational') {
        return { status: 400, data: { success: false, error: `Product ${product.symbol} is not operational (${product.trading_status})` } };
      }

      const orderId = `ORD-${++this.orderCounter}`;
      const newOrder: MockOrder = {
        id: orderId,
        product_id: product.id,
        symbol: product.symbol,
        side: body.side,
        order_type: body.order_type || 'market_order',
        size: body.size,
        limit_price: body.limit_price,
        stop_price: body.stop_price,
        reduce_only: !!body.reduce_only,
        bracket_order: body.bracket_order,
        status: 'filled', // Instant simulated fill
        filled_size: body.size,
        average_fill_price: this.tickers.get(product.symbol)?.mark_price || 100,
        created_at: Date.now(),
      };
      this.orders.set(orderId, newOrder);
      return { status: 200, data: { success: true, result: newOrder } };
    }

    // 5. GET /v2/wallet/balances
    if (method === 'GET' && reqPath === '/v2/wallet/balances') {
      return {
        status: 200,
        data: {
          success: true,
          result: [
            { asset_symbol: 'USDT', balance: '1000.00', available_balance: '850.00' },
            { asset_symbol: 'USD', balance: '1000.00', available_balance: '850.00' },
          ],
        },
      };
    }

    return { status: 404, data: { success: false, error: `Unknown endpoint: ${reqPath}` } };
  }

  public getOrders(): MockOrder[] {
    return Array.from(this.orders.values());
  }

  public getOrder(orderId: string): MockOrder | undefined {
    return this.orders.get(orderId);
  }
}

export const mockDeltaServer = new MockDeltaServer();
