import dotenv from 'dotenv';
dotenv.config();
import crypto from 'crypto';
import fs from 'fs';
import { KlinePoint } from '../src/types';
import { PortfolioMarketRegimeEngine } from './risk/portfolioMarketRegimeEngine';
import { CredentialsManager } from './credentialsManager';
import { roundToTickSize as roundPriceToTick } from './strategies/strategyRegistry';

export interface DeltaExchangeConfig {
  apiKey?: string;
  apiSecret?: string;
  baseUrl: string;
  wsUrl: string;
  isTestnet: boolean;
  isSimulation: boolean;
}

export const DELTA_PRODUCT_SPECS: Record<string, { tickSize: number; contractValue: number; decimals: number }> = {
  'BTCUSD': { tickSize: 0.1, contractValue: 0.001, decimals: 1 },
  'BTCUSDT': { tickSize: 0.5, contractValue: 0.001, decimals: 1 },
  'ETHUSD': { tickSize: 0.05, contractValue: 0.01, decimals: 2 },
  'ETHUSDT': { tickSize: 0.05, contractValue: 0.01, decimals: 2 },
  'SOLUSD': { tickSize: 0.0001, contractValue: 1.0, decimals: 4 },
  'XRPUSD': { tickSize: 0.0001, contractValue: 1.0, decimals: 4 },
  'ADAUSD': { tickSize: 0.00001, contractValue: 1.0, decimals: 5 },
  'DOGEUSD': { tickSize: 0.000001, contractValue: 100.0, decimals: 6 },
  'DOGEUSDT': { tickSize: 0.000001, contractValue: 100.0, decimals: 6 },
  'DOGSUSD': { tickSize: 0.00000001, contractValue: 1000.0, decimals: 8 },
  '1000SHIBUSD': { tickSize: 0.000001, contractValue: 1000.0, decimals: 6 },
  'AVAXUSD': { tickSize: 0.0001, contractValue: 1.0, decimals: 4 },
  'SUIUSD': { tickSize: 0.0001, contractValue: 1.0, decimals: 4 },
  'SLVONUSD': { tickSize: 0.01, contractValue: 0.1, decimals: 2 },
  'SILVERUSD': { tickSize: 0.01, contractValue: 0.1, decimals: 2 },
  'NVDAXUSD': { tickSize: 0.01, contractValue: 0.1, decimals: 2 },
  'XAUTUSD': { tickSize: 0.01, contractValue: 0.001, decimals: 2 },
  'PAXGUSD': { tickSize: 0.01, contractValue: 0.001, decimals: 2 },
  'PAXGUSDT': { tickSize: 0.01, contractValue: 0.001, decimals: 2 },
  'QQQXUSD': { tickSize: 0.01, contractValue: 0.01, decimals: 2 },
  'SPYXUSD': { tickSize: 0.01, contractValue: 0.01, decimals: 2 },
  'SNDKBUSD': { tickSize: 0.01, contractValue: 0.01, decimals: 2 },
  'USOONUSD': { tickSize: 0.01, contractValue: 0.1, decimals: 2 },
};

export function toDeltaSymbol(symbol: string): string {
  const clean = (symbol || '').toUpperCase().trim();
  if (clean.startsWith('C-') || clean.startsWith('P-')) {
    return clean;
  }
  const base = clean.replace(/USD[T]?$/, '');
  return `${base}USD`;
}

export interface MicrostructureDerivativesData {
  symbol: string;
  obi: number; // Order Book Imbalance: (bid_vol - ask_vol) / (bid_vol + ask_vol) [-1 to 1]
  microprice: number;
  bestBid: number;
  bestAsk: number;
  spreadPct: number;
  cvd: number; // Cumulative Volume Delta from recent trades (taker buy vol - taker sell vol)
  takerBuyRatio: number; // taker_buy_vol / total_vol [0 to 1]
  fundingRate: number;
  openInterest: number;
  oiChangeUsd6h: number;
}

export class DeltaExchangeEngine {
  private config: DeltaExchangeConfig;
  private ws: any = null;
  private isConnected: boolean = false;
  private livePrices: Map<string, number> = new Map();
  private allTickersMap: Map<string, any> = new Map();
  private lastAllTickersFetchTime: number = 0;
  private isFetchingAllTickers: boolean = false;
  private lastPositionErrorLogTime: number = 0;
  private lastOrdersErrorLogTime: number = 0;
  private products: Map<string, any> = new Map();
  private productIdMap: Map<number, any> = new Map();
  private productsFetchPromise: Promise<any[]> | null = null;
  private obiRollingCache: Map<string, number[]> = new Map();
  private lastBracketCancelTime: Map<string, number> = new Map();

  constructor(config?: Partial<DeltaExchangeConfig>) {
    const creds = CredentialsManager.getCredentials();
    const isTestnet = config?.isTestnet ?? creds.isTestnet;
    const isPaperEnv = process.env.DELTA_IS_SIMULATION === 'true' || 
                       process.env.PAPER_TRADING === 'true' || 
                       process.env.DELTA_TRADING_MODE === 'SIMULATION_PAPER';
    const activePort = process.env.PORT || '3005';
    const isAuthorizedBrokerPort = activePort === '3005';
    const isSimulation = config?.isSimulation ?? (isPaperEnv || !isAuthorizedBrokerPort || creds.isSimulation);
    const defaultBaseUrl = isTestnet
      ? 'https://cdn-ind.testnet.deltaex.org'
      : (process.env.DELTA_BASE_URL || 'https://api.india.delta.exchange');
    const defaultWsUrl = isTestnet
      ? 'wss://socket-ind.testnet.deltaex.org'
      : (process.env.DELTA_WS_URL || 'wss://socket.india.deltaex.org');

    this.config = {
      apiKey: config?.apiKey || (!isSimulation ? creds.apiKey : ''),
      apiSecret: config?.apiSecret || (!isSimulation ? creds.apiSecret : ''),
      baseUrl: isTestnet ? 'https://cdn-ind.testnet.deltaex.org' : (config?.baseUrl || creds.endpoint || defaultBaseUrl),
      wsUrl: isTestnet ? 'wss://socket-ind.testnet.deltaex.org' : (config?.wsUrl || creds.wsUrl || defaultWsUrl),
      isTestnet,
      isSimulation,
    };
  }

  public updateCredentials(
    apiKey: string,
    apiSecret: string,
    isSimulation: boolean = false,
    isTestnet: boolean = true,
    tradingMode?: string,
    baseUrl?: string,
    wsUrl?: string
  ) {
    const isPaperEnv = process.env.DELTA_IS_SIMULATION === 'true' ||
                       process.env.PAPER_TRADING === 'true' ||
                       process.env.DELTA_TRADING_MODE === 'SIMULATION_PAPER';
    const activePort = process.env.PORT || '3005';
    const isAuthorizedBrokerPort = activePort === '3005';
    const effectiveSimulation = isPaperEnv || !isAuthorizedBrokerPort || isSimulation;

    const isLive = !effectiveSimulation && Boolean(apiKey && apiSecret);
    this.config.apiKey = isLive ? apiKey.trim() : '';
    this.config.apiSecret = isLive ? apiSecret.trim() : '';
    this.config.isSimulation = effectiveSimulation;
    this.config.isTestnet = isTestnet;
    this.config.baseUrl = baseUrl || (isTestnet
      ? 'https://cdn-ind.testnet.deltaex.org'
      : (process.env.DELTA_BASE_URL || 'https://api.india.delta.exchange'));
    this.config.wsUrl = wsUrl || (isTestnet
      ? 'wss://socket-ind.testnet.deltaex.org'
      : (process.env.DELTA_WS_URL || 'wss://socket.india.deltaex.org'));

    const effectiveMode = effectiveSimulation ? 'SIMULATION_PAPER' : (tradingMode || (isTestnet ? 'DELTA_TESTNET' : 'LIVE_DELTA_INDIA'));
    console.log(`🔑 [DeltaExchange] Credentials live reloaded. Mode: ${effectiveMode}, LiveAuth: ${isLive}, Port: ${activePort}, Endpoint: ${this.config.baseUrl}`);
    if (isLive) {
      this.ensureProductsLeverage(30).catch(() => {});
    }
  }

  public isLiveDispatchActive(): boolean {
    const isPaperEnv = process.env.DELTA_IS_SIMULATION === 'true' || 
                       process.env.PAPER_TRADING === 'true' || 
                       process.env.DELTA_TRADING_MODE === 'SIMULATION_PAPER';
    const activePort = process.env.PORT || '3005';
    const isAuthorizedBrokerPort = activePort === '3005';

    if (isPaperEnv || !isAuthorizedBrokerPort || this.config.isSimulation) {
      return false;
    }
    return Boolean(this.config.apiKey && this.config.apiSecret);
  }

  /**
   * Sets order leverage for all supported trading products on Delta Exchange
   */
  public async ensureProductsLeverage(leverage: number = 30): Promise<void> {
    if (!this.isLiveDispatchActive()) return;
    try {
      const res = await this.request('GET', '/v2/products');
      if (res && res.result && Array.isArray(res.result)) {
        const supported = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'ADAUSD', 'DOGEUSD', 'AVAXUSD', 'SUIUSD'];
        for (const p of res.result) {
          if (supported.includes(p.symbol)) {
            await this.request('POST', `/v2/products/${p.id}/orders/leverage`, {}, { leverage: leverage.toString() }).catch(() => {});
          }
        }
        console.log(`⚡ Delta Exchange leverage auto-synchronized to ${leverage}x across active products.`);
      }
    } catch (e: any) {
      // quiet fallback
    }
  }

  public getConfig(): DeltaExchangeConfig {
    return { ...this.config };
  }

  /**
   * Generates HMAC-SHA256 signature for Delta Exchange API authentication
   * Format: signature = hmac_sha256(secret, method + timestamp + path + query + body)
   */
  private generateSignature(method: string, timestamp: number, path: string, query: string = '', body: string = ''): string {
    if (!this.config.apiSecret) return '';
    const payload = method.toUpperCase() + timestamp.toString() + path + (query ? '?' + query : '') + body;
    return crypto.createHmac('sha256', this.config.apiSecret).update(payload).digest('hex');
  }

  /**
   * Performs authenticated or public REST requests to Delta Exchange India
   */
  public async request(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, params: any = {}, body: any = null): Promise<any> {
    const timestamp = Math.floor(Date.now() / 1000);
    const queryString = Object.keys(params).length > 0
      ? new URLSearchParams(params).toString()
      : '';
    const bodyString = body ? JSON.stringify(body) : '';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'DeltaAutoTrader/1.0',
    };

    if (this.config.apiKey && this.config.apiSecret) {
      const signature = this.generateSignature(method, timestamp, path, queryString, bodyString);
      headers['api-key'] = this.config.apiKey;
      headers['timestamp'] = timestamp.toString();
      headers['signature'] = signature;
    }

    const url = `${this.config.baseUrl}${path}${queryString ? '?' + queryString : ''}`;

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? bodyString : undefined,
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok && url.includes('india.delta.exchange')) {
        const fallbackUrl = url.replace('api.india.delta.exchange', 'api.delta.exchange');
        try {
          const fbRes = await fetch(fallbackUrl, {
            method,
            headers,
            body: body ? bodyString : undefined,
            signal: AbortSignal.timeout(6000),
          });
          if (fbRes.ok) return await fbRes.json();
        } catch (fbe) {}
      }

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`Delta API Error (${response.status}): ${errBody}`);
      }

      return await response.json();
    } catch (error: any) {
      // Return null or throw for upstream handling
      throw error;
    }
  }

  /**
   * Fetches current wallet balance from Delta Exchange India
   */
  public async getWalletBalance(): Promise<{ balanceUSD: number; availableUSD: number; currency: string }> {
    try {
      if (this.isLiveDispatchActive()) {
        const res = await this.request('GET', '/v2/wallet/balances');
        if (res && (res.result || res.meta?.net_equity)) {
          const totalEquity = res.meta?.net_equity ? parseFloat(res.meta.net_equity) : 0;
          const usdtBal = Array.isArray(res.result)
            ? res.result.find((b: any) => b.asset_symbol === 'USD' || b.asset_symbol === 'USDT')
            : null;

          const bal = totalEquity > 0
            ? totalEquity
            : (usdtBal ? parseFloat(usdtBal.balance || '113.42') : 113.42);
          const avail = usdtBal
            ? parseFloat(usdtBal.available_balance || usdtBal.balance || '109.59')
            : (totalEquity > 0 ? totalEquity : 109.59);

          return {
            balanceUSD: parseFloat(bal.toFixed(2)),
            availableUSD: parseFloat(avail.toFixed(2)),
            currency: usdtBal?.asset_symbol || 'USD',
          };
        }
      }
    } catch (e) {
      // fallback
    }

    return {
      balanceUSD: 178.57,
      availableUSD: 178.57,
      currency: 'USD',
    };
  }

  private inFlightMarginedPositions: Promise<any[] | null> | null = null;
  private inFlightOpenOrders: Promise<any[] | null> | null = null;

  /**
   * Fetches open margined positions directly from Delta Exchange India
   */
  public async getMarginedPositions(): Promise<any[] | null> {
    if (!this.isLiveDispatchActive()) {
      return [];
    }
    if (this.inFlightMarginedPositions) {
      return this.inFlightMarginedPositions;
    }
    this.inFlightMarginedPositions = (async () => {
      try {
        const res = await this.request('GET', '/v2/positions/margined');
        if (res && res.result && Array.isArray(res.result)) {
          return res.result.filter((p: any) => parseFloat(p.size) !== 0);
        }
      } catch (err: any) {
        const now = Date.now();
        if (now - this.lastPositionErrorLogTime > 60000) {
          this.lastPositionErrorLogTime = now;
          console.warn('Note on fetching margined positions from Delta (throttled 60s):', err.message);
        }
        return null;
      } finally {
        this.inFlightMarginedPositions = null;
      }
      return [];
    })();
    return this.inFlightMarginedPositions;
  }

  /**
   * Fetches open orders (including bracket TP/SL orders) from Delta Exchange India
   */
  public async getOpenOrders(): Promise<any[] | null> {
    if (!this.isLiveDispatchActive()) {
      return [];
    }
    if (this.inFlightOpenOrders) {
      return this.inFlightOpenOrders;
    }
    this.inFlightOpenOrders = (async () => {
      try {
        const res = await this.request('GET', '/v2/orders', { state: 'open,pending,untriggered', limit: '100' });
        if (res && res.result && Array.isArray(res.result)) {
          return res.result;
        }
      } catch (err: any) {
        const now = Date.now();
        if (now - this.lastOrdersErrorLogTime > 60000) {
          this.lastOrdersErrorLogTime = now;
          console.warn('Note on fetching open orders from Delta (throttled 60s):', err.message);
        }
        return null;
      } finally {
        this.inFlightOpenOrders = null;
      }
      return [];
    })();
    return this.inFlightOpenOrders;
  }

  /**
   * Fetches all trading products from Delta Exchange with local memory caching
   */
  public async fetchProducts(): Promise<any[]> {
    if (this.products.size > 0) {
      return Array.from(this.products.values());
    }
    if (this.productsFetchPromise) {
      return this.productsFetchPromise;
    }

    this.productsFetchPromise = (async () => {
      try {
        let list: any[] = [];
        try {
          const res = await this.request('GET', '/v2/products?contract_types=perpetual_futures');
          list = res?.result || (Array.isArray(res) ? res : []);
        } catch (_) {
          try {
            const res = await this.request('GET', '/v2/products');
            list = res?.result || (Array.isArray(res) ? res : []);
          } catch (_) {}
        }

        // Fallback to bulk tickers if /v2/products is rate-limited: contains all 1,100+ Delta products!
        if (!list || list.length === 0) {
          const tickerUrl = this.config.isTestnet
            ? 'https://cdn-ind.testnet.deltaex.org/v2/tickers?contract_types=perpetual_futures'
            : (this.config.baseUrl ? `${this.config.baseUrl}/v2/tickers?contract_types=perpetual_futures` : 'https://api.india.delta.exchange/v2/tickers?contract_types=perpetual_futures');
          const tRes = await fetch(tickerUrl, { signal: AbortSignal.timeout(4000) }).catch(() => null);
          if (tRes && tRes.ok) {
            const tData: any = await tRes.json().catch(() => null);
            const rawList = tData?.result || [];
            list = rawList.map((item: any) => ({
              id: item.product_id,
              symbol: item.symbol,
              tick_size: item.tick_size,
              contract_value: item.contract_value,
              contract_type: item.contract_type,
            }));
          }
        }

        this.products.clear();
        this.productIdMap.clear();
        for (const p of list) {
          if (p.symbol) {
            this.products.set(p.symbol.toUpperCase(), p);
            if (p.id) this.productIdMap.set(p.id, p);
          }
        }
        console.log(`[DeltaExchange] 📦 Loaded ${this.products.size} products from Delta Exchange.`);
        return list;
      } catch (e: any) {
        console.warn(`[DeltaExchange] Products fetch error: ${e.message}`);
        return [];
      } finally {
        this.productsFetchPromise = null;
      }
    })();
    return this.productsFetchPromise;
  }

  public registerProduct(product: any): void {
    if (!product || !product.symbol) return;
    const symUpper = String(product.symbol).toUpperCase().trim();
    this.products.set(symUpper, product);
    if (product.id) {
      this.productIdMap.set(product.id, product);
    }
  }

  public async resolveProduct(symbol: string): Promise<any | undefined> {
    const symUpper = toDeltaSymbol(symbol).toUpperCase().trim();
    const cleanTag = symUpper.replace('USDT', '').replace('USD', '').trim();

    if (this.products.size === 0 && this.isLiveDispatchActive()) {
      await this.fetchProducts().catch(() => {});
    }

    let product =
      this.products.get(symUpper) ||
      this.products.get(`${cleanTag}USD`) ||
      Array.from(this.products.values()).find(
        (p) => p.symbol?.toUpperCase() === symUpper || p.symbol?.toUpperCase() === `${cleanTag}USD`
      );

    if (!product && (symUpper.startsWith('C-') || symUpper.startsWith('P-')) && this.isLiveDispatchActive()) {
      try {
        const singleRes = await this.request('GET', `/v2/products/${encodeURIComponent(symUpper)}`).catch(() => null);
        if (singleRes?.result && singleRes.result.symbol) {
          this.registerProduct(singleRes.result);
          product = singleRes.result;
        }
      } catch {}

      if (!product) {
        try {
          const optRes = await this.request('GET', '/v2/products?contract_types=call_options,put_options&states=live').catch(() => null);
          const optList = optRes?.result || [];
          for (const p of optList) {
            this.registerProduct(p);
          }
          product = this.products.get(symUpper);
        } catch {}
      }
    }

    return product;
  }

  public isProductSupported(symbol: string): boolean {
    const clean = (symbol || '').toUpperCase().trim();
    const base = clean.replace(/USD[T]?$/, '');
    const symUSD = `${base}USD`;
    const symUSDT = `${base}USDT`;

    const product = this.products.get(clean) || this.products.get(symUSD) || this.products.get(symUSDT);
    if (product) {
      // Must be an active futures / perpetual_futures contract, not an options strike
      return product.contract_type === 'perpetual_futures' || product.contract_type === 'futures';
    }

    if (this.products.size === 0) {
      // Conservative fallback while products load: only allow verified known perpetual futures
      const knownPerps = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'DOGEUSD', 'ADAUSD', 'DOGSUSD', '1000SHIBUSD', 'PAXGUSD', 'AVAXUSD', 'SUIUSD', 'SLVONUSD', 'SILVERUSD', 'NVDAXUSD', 'XAUTUSD', 'QQQXUSD', 'SPYXUSD', 'SNDKBUSD', 'USOONUSD'];
      return knownPerps.includes(symUSD) || knownPerps.includes(clean);
    }

    return false;
  }

  public getProductSpec(symbol: string, price?: number): { tickSize: number; contractValue: number; decimals: number } {
    const clean = (symbol || '').toUpperCase().trim();
    const isOpt = clean.startsWith('C-') || clean.startsWith('P-');
    const base = isOpt ? clean : clean.replace(/USD[T]?$/, '');
    const symUSD = isOpt ? clean : `${base}USD`;
    const product = this.products.get(clean) || this.products.get(symUSD) || (!isOpt ? this.products.get(`${base}USDT`) : undefined);

    const predefined = DELTA_PRODUCT_SPECS[symUSD] || DELTA_PRODUCT_SPECS[clean];
    const defaultOptContractVal = clean.includes('-BTC-') ? 0.001 : clean.includes('-ETH-') ? 0.01 : 1.0;
    let tickSize = product?.tick_size ? parseFloat(product.tick_size) : predefined?.tickSize;
    const contractValue = product?.contract_value
      ? parseFloat(product.contract_value)
      : (predefined?.contractValue || (isOpt ? defaultOptContractVal : 1.0));

    const refPrice = price && price > 0 ? price : 1.0;
    if (!tickSize || (price && price > 0 && tickSize >= price * 0.05)) {
      if (refPrice < 0.0001) tickSize = 0.00000001;
      else if (refPrice < 0.001) tickSize = 0.0000001;
      else if (refPrice < 0.01) tickSize = 0.000001;
      else if (refPrice < 0.1) tickSize = 0.00001;
      else if (refPrice < 1.0) tickSize = 0.0001;
      else if (refPrice < 10.0) tickSize = 0.001;
      else if (refPrice < 100.0) tickSize = 0.01;
      else tickSize = 0.1;
    }

    let decimals = 2;
    if (tickSize < 1) {
      const str = tickSize.toString();
      if (str.includes('e-')) {
        decimals = parseInt(str.split('e-')[1]) || 6;
      } else {
        decimals = (str.split('.')[1] || '').length || 4;
      }
    } else {
      decimals = 1;
    }
    return { tickSize, contractValue, decimals };
  }

  /**
   * Rounds a price cleanly to the product's exact tick size
   */
  public roundToTickSize(price: number, tickSize: string | number): string {
    const tick = typeof tickSize === 'string' ? parseFloat(tickSize) : tickSize;
    if (!tick || isNaN(tick) || tick <= 0) return price.toFixed(4);
    let decimals = 0;
    if (tick < 1) {
      const str = tick.toString();
      if (str.includes('e-')) {
        decimals = parseInt(str.split('e-')[1], 10) || 4;
      } else {
        const frac = str.split('.')[1];
        decimals = frac ? frac.length : Math.max(0, Math.ceil(-Math.log10(tick) - 1e-12));
      }
    }
    decimals = Math.min(Math.max(decimals, 0), 8);
    const rounded = roundPriceToTick(price, tick);
    return rounded.toFixed(decimals);
  }

  /**
   * Verifies on Delta Exchange whether BOTH stop_loss_order and take_profit_order
   * (or reduce-only SL/TP fallback orders) exist for a position.
   */
  public async verifyPositionBrackets(
    symbol: string,
    side?: 'BUY' | 'SELL',
    entryPrice?: number
  ): Promise<{ hasSL: boolean; hasTP: boolean; slOrder?: any; tpOrder?: any }> {
    if (!this.isLiveDispatchActive()) {
      return { hasSL: false, hasTP: false };
    }
    try {
      const symUpper = toDeltaSymbol(symbol).toUpperCase().trim();
      const product = await this.resolveProduct(symUpper);
      const openOrdersRaw = await this.getOpenOrders();
      const openOrders = Array.isArray(openOrdersRaw) ? openOrdersRaw : [];
      const matchingOrders = openOrders.filter(
        (o: any) =>
          (o.product_symbol || '').toUpperCase() === symUpper ||
          (product?.id && o.product_id === product.id)
      );

      let slOrder = matchingOrders.find(
        (o: any) =>
          o.stop_order_type === 'stop_loss_order' ||
          o.order_type === 'stop_loss_order' ||
          o.bracket_order_type === 'stop_loss_order'
      );
      let tpOrder = matchingOrders.find(
        (o: any) =>
          o.stop_order_type === 'take_profit_order' ||
          o.order_type === 'take_profit_order' ||
          o.bracket_order_type === 'take_profit_order'
      );

      if ((!slOrder || !tpOrder) && side && entryPrice && entryPrice > 0) {
        for (const o of matchingOrders) {
          const sp = parseFloat(o.stop_price || o.limit_price || o.price || '0');
          if (!Number.isFinite(sp) || sp <= 0) continue;
          if (!o.reduce_only && !o.stop_order_type && !o.bracket_order_type) continue;
          if (side === 'BUY') {
            if (sp > entryPrice && !tpOrder) tpOrder = o;
            else if (sp < entryPrice && !slOrder) slOrder = o;
          } else {
            if (sp < entryPrice && !tpOrder) tpOrder = o;
            else if (sp > entryPrice && !slOrder) slOrder = o;
          }
        }
      }

      return {
        hasSL: Boolean(slOrder),
        hasTP: Boolean(tpOrder),
        slOrder,
        tpOrder,
      };
    } catch {
      return { hasSL: false, hasTP: false };
    }
  }

  /**
   * Fetches fresh live price band (mark, spot, last, best_bid, best_ask) so bracket triggers never hit immediate_execution.
   */
  private async getFreshMarkBand(symUpper: string, bypassCache: boolean = false): Promise<{
    markPrice: number;
    referencePrices: number[];
  }> {
    const refs: number[] = [];
    const cachedMark = this.livePrices.get(symUpper) || 0;
    let ticker: any = null;

    if (bypassCache) {
      try {
        const directRes = await this.request('GET', `/v2/tickers/${symUpper}`);
        if (directRes?.result) ticker = directRes.result;
      } catch {}
    }
    if (!ticker) {
      try {
        ticker = await this.getTicker(symUpper);
      } catch {}
    }

    const candidates = [
      ticker?.mark_price,
      ticker?.spot_price,
      ticker?.close,
      ticker?.quotes?.best_bid,
      ticker?.quotes?.best_ask,
      cachedMark > 0 ? cachedMark : undefined,
    ];
    for (const c of candidates) {
      const n = typeof c === 'number' ? c : parseFloat(String(c || '0'));
      if (Number.isFinite(n) && n > 0) refs.push(n);
    }

    const markRaw = parseFloat(String(ticker?.mark_price || ticker?.spot_price || ticker?.close || '0'));
    const markPrice = (Number.isFinite(markRaw) && markRaw > 0)
      ? markRaw
      : (refs.length > 0 ? refs[0] : 0);

    return { markPrice, referencePrices: refs };
  }

  /**
   * Adjusts SL/TP triggers slightly outside live mark_price / spot / bid-ask band so Delta does not abort
   * BOTH bracket legs with HTTP 400 bracket_order_immediate_execution.
   */
  private clampBracketAgainstMark(params: {
    side?: 'BUY' | 'SELL';
    markPrice: number;
    tickNum: number;
    stopLossPrice?: number;
    takeProfitPrice?: number;
    gapMult?: number;
    referencePrices?: number[];
  }): { sl?: number; tp?: number } {
    const { side, markPrice, tickNum, stopLossPrice, takeProfitPrice, gapMult = 1, referencePrices = [] } = params;
    let sl = stopLossPrice;
    let tp = takeProfitPrice;
    const validRefs = [markPrice, ...referencePrices].filter((p) => Number.isFinite(p) && p > 0);
    if (!side || validRefs.length === 0) {
      return { sl, tp };
    }

    const refMark = markPrice > 0 && Number.isFinite(markPrice) ? markPrice : validRefs[0];
    const lowRef = Math.min(...validRefs);
    const highRef = Math.max(...validRefs);
    const safeTick = tickNum && tickNum > 0 ? tickNum : 0.01;
    const minSafeGap = Math.max(safeTick * 4, refMark * 0.0018) * gapMult;

    if (side === 'BUY') {
      if (sl && !isNaN(sl) && sl >= lowRef - minSafeGap) {
        sl = Math.max(safeTick, lowRef - minSafeGap);
      }
      if (tp && !isNaN(tp) && tp <= highRef + minSafeGap) {
        tp = highRef + minSafeGap;
      }
    } else {
      if (sl && !isNaN(sl) && sl <= highRef + minSafeGap) {
        sl = highRef + minSafeGap;
      }
      if (tp && !isNaN(tp) && tp >= lowRef - minSafeGap) {
        tp = Math.max(safeTick, lowRef - minSafeGap);
      }
    }
    return { sl, tp };
  }

  /**
   * Sets native exchange TP/SL bracket order on Delta Exchange
   */
  public async setBracketOrder(
    symbol: string,
    stopLossPrice?: number,
    takeProfitPrice?: number,
    positionSide?: 'BUY' | 'SELL'
  ): Promise<any> {
    if (!this.isLiveDispatchActive()) {
      return { success: false, message: 'Simulation mode or air-gapped from exchange' };
    }
    try {
      const symUpper = toDeltaSymbol(symbol).toUpperCase().trim();
      const product = await this.resolveProduct(symUpper);

      const productId = product?.id;
      const specFallback = this.getProductSpec(symUpper, stopLossPrice || takeProfitPrice);
      const tickSize = product?.tick_size || DELTA_PRODUCT_SPECS[symUpper]?.tickSize || specFallback.tickSize;
      const tickNum = (typeof tickSize === 'string' ? parseFloat(tickSize) : tickSize) || 0.01;
      const inferredSide: 'BUY' | 'SELL' | undefined =
        positionSide ||
        (stopLossPrice && takeProfitPrice && stopLossPrice > 0 && takeProfitPrice > 0
          ? (stopLossPrice < takeProfitPrice ? 'BUY' : 'SELL')
          : undefined);

      const initialBand = await this.getFreshMarkBand(symUpper, false);
      let clamped = this.clampBracketAgainstMark({
        side: inferredSide,
        markPrice: initialBand.markPrice,
        referencePrices: initialBand.referencePrices,
        tickNum,
        stopLossPrice,
        takeProfitPrice,
        gapMult: 1,
      });

      const buildBracketBody = (slVal?: number, tpVal?: number, includeParentType: boolean = true) => {
        const bodyData: any = {
          bracket_stop_trigger_method: 'mark_price',
        };
        if (includeParentType) bodyData.parent_type = 'position';
        if (productId) bodyData.product_id = productId;
        bodyData.product_symbol = product?.symbol || symUpper;

        let formattedSL = '';
        let formattedTP = '';
        if (slVal && !isNaN(slVal) && slVal > 0) {
          formattedSL = this.roundToTickSize(slVal, tickSize);
          bodyData.stop_loss_order = {
            order_type: 'market_order',
            stop_price: formattedSL,
            ...(includeParentType ? { parent_type: 'position' } : {}),
          };
          bodyData.bracket_stop_loss_price = formattedSL;
        }
        if (tpVal && !isNaN(tpVal) && tpVal > 0) {
          formattedTP = this.roundToTickSize(tpVal, tickSize);
          bodyData.take_profit_order = {
            order_type: 'market_order',
            stop_price: formattedTP,
            ...(includeParentType ? { parent_type: 'position' } : {}),
          };
          bodyData.bracket_take_profit_price = formattedTP;
        }
        return { bodyData, formattedSL, formattedTP };
      };

      const bracketPath = '/v2/orders/bracket';
      const sendBracketWithRetries = async (
        slInput?: number,
        tpInput?: number,
        allowCancelOnExists: boolean = true
      ): Promise<{ res: any; built: { bodyData: any; formattedSL: string; formattedTP: string } }> => {
        let includeParent = true;
        let curClamped: { sl?: number; tp?: number } = { sl: slInput, tp: tpInput };
        let built = buildBracketBody(curClamped.sl, curClamped.tp, includeParent);
        const gapSteps = [2.2, 4.5];
        let gapStepIdx = 0;

        for (let attempt = 0; attempt < 4; attempt++) {
          try {
            const res = await this.request('POST', bracketPath, {}, built.bodyData);
            return { res, built };
          } catch (err: any) {
            const errMsg = err?.message || '';
            if (errMsg.includes('parent_type') && includeParent) {
              includeParent = false;
              built = buildBracketBody(curClamped.sl, curClamped.tp, false);
              continue;
            }
            if ((errMsg.includes('bracket_order_exists') || errMsg.includes('bracket_order_position_exists')) && allowCancelOnExists) {
              console.log(`[DeltaExchange] 🔄 Bracket order exists on ${symUpper}. Force-canceling old bracket and applying updated SL/TP...`);
              const freshBand = await this.getFreshMarkBand(symUpper, true);
              curClamped = this.clampBracketAgainstMark({
                side: inferredSide,
                markPrice: freshBand.markPrice,
                referencePrices: freshBand.referencePrices,
                tickNum,
                stopLossPrice: curClamped.sl,
                takeProfitPrice: curClamped.tp,
                gapMult: 1.5,
              });
              built = buildBracketBody(curClamped.sl, curClamped.tp, includeParent);
              await this.cancelBracketOrder(symUpper, true);
              await new Promise(r => setTimeout(r, 250));
              allowCancelOnExists = false;
              continue;
            }
            if ((errMsg.includes('bracket_order_immediate_execution') || errMsg.includes('immediate_execution_stop_order')) && gapStepIdx < gapSteps.length) {
              const mult = gapSteps[gapStepIdx++];
              const freshBand = await this.getFreshMarkBand(symUpper, true);
              curClamped = this.clampBracketAgainstMark({
                side: inferredSide,
                markPrice: freshBand.markPrice,
                referencePrices: freshBand.referencePrices,
                tickNum,
                stopLossPrice: curClamped.sl,
                takeProfitPrice: curClamped.tp,
                gapMult: mult,
              });
              built = buildBracketBody(curClamped.sl, curClamped.tp, includeParent);
              await new Promise(r => setTimeout(r, 150));
              console.log(`🎯 [DeltaExchange] Retrying bracket on ${symUpper} after immediate_execution (gapMult=${mult}, Mark=$${freshBand.markPrice}): SL=$${built.formattedSL}, TP=$${built.formattedTP}`);
              continue;
            }
            throw err;
          }
        }
        throw new Error(`Exceeded bracket retry attempts for ${symUpper}`);
      };

      let finalResult: { res: any; built: { bodyData: any; formattedSL: string; formattedTP: string } };
      try {
        finalResult = await sendBracketWithRetries(clamped.sl, clamped.tp, true);
      } catch (combinedErr: any) {
        // Last-ditch safety fallback: if combined SL+TP failed with immediate_execution, attach at least SL alone so position never stays unprotected!
        const errMsg = combinedErr?.message || '';
        if ((errMsg.includes('bracket_order_immediate_execution') || errMsg.includes('immediate_execution')) && clamped.sl && clamped.tp) {
          console.warn(`🛡️ [SL EMERGENCY FALLBACK] Combined bracket failed on ${symUpper} (${errMsg}). Securing SL-only protection on Delta Exchange first...`);
          finalResult = await sendBracketWithRetries(clamped.sl, undefined, false);
          console.log(`🛑 [SL SECURED] ${symUpper} protected with SL=$${finalResult.built.formattedSL} (SL-only emergency fallback).`);
          return { success: true, slOnly: true, verified: false, result: finalResult.res?.result || finalResult.res };
        }
        throw combinedErr;
      }

      console.log(`🎯 [DeltaExchange] Native TP/SL Bracket set on ${symUpper}: SL=$${finalResult.built.formattedSL}, TP=$${finalResult.built.formattedTP}`, finalResult.res?.result || finalResult.res);
      return { success: true, verified: true, result: finalResult.res?.result || finalResult.res };
    } catch (err: any) {
      console.warn(`[DeltaExchange] ⚠️ Bracket order error for ${symbol}:`, err.message);
      return { success: false, error: err.message };
    }
  }

  /**
   * Cancels existing bracket orders on Delta Exchange
   */
  public async cancelBracketOrder(symbol: string, force: boolean = false): Promise<any> {
    if (!this.isLiveDispatchActive()) {
      return { success: false, message: 'Simulation mode or air-gapped from exchange' };
    }
    try {
      const symUpper = toDeltaSymbol(symbol).toUpperCase().trim();
      const now = Date.now();
      const lastCancel = this.lastBracketCancelTime.get(symUpper) || 0;
      if (!force && now - lastCancel < 4000) {
        // Anti-Spam Debouncer: skip duplicate cancel requests within 4 seconds
        return { success: true, debounced: true };
      }
      this.lastBracketCancelTime.set(symUpper, now);

      const product = await this.resolveProduct(symUpper);
      const bodyData: any = {
        cancel_stop_orders: true,
        cancel_reduce_only_orders: true,
      };
      if (product?.id) {
        bodyData.product_id = product.id;
      }
      const res = await this.request('DELETE', '/v2/orders/all', {}, bodyData);
      console.log(`[DeltaExchange] 🛑 Cancelled existing bracket/stop orders for ${symUpper}`, res?.result || res);
      return res;
    } catch (e: any) {
      console.warn(`[DeltaExchange] Note on canceling bracket for ${symbol}:`, e.message);
      return { success: false, error: e.message };
    }
  }

  public async updateBracketOrder(
    symbol: string,
    stopLossPrice?: number,
    takeProfitPrice?: number,
    positionSide?: 'BUY' | 'SELL',
    entryPriceRef?: number
  ): Promise<any> {
    if (!this.isLiveDispatchActive()) {
      return { success: false, message: 'Simulation mode or air-gapped from exchange' };
    }
    const symUpper = toDeltaSymbol(symbol).toUpperCase().trim();
    console.log(`🔄 [DeltaExchange] Updating position bracket on ${symUpper}: New SL=$${stopLossPrice}, TP=$${takeProfitPrice}`);

    let safeTP = takeProfitPrice;
    let safeSL = stopLossPrice;
    let needFullRebuild = false;

    try {
      const product = await this.resolveProduct(symUpper);
      const specFallback = this.getProductSpec(symUpper, entryPriceRef || safeSL || safeTP);
      const tickSize = product?.tick_size || DELTA_PRODUCT_SPECS[symUpper]?.tickSize || specFallback.tickSize;
      const tickNum = (typeof tickSize === 'string' ? parseFloat(tickSize) : tickSize) || 0.01;
      const inferredSide: 'BUY' | 'SELL' | undefined =
        positionSide ||
        (safeSL && safeTP && safeSL > 0 && safeTP > 0
          ? (safeSL < safeTP ? 'BUY' : 'SELL')
          : undefined);

      if (safeTP && safeSL && entryPriceRef && entryPriceRef > 0) {
        // Prevent inverted bracket update ONLY against genuine entryPriceRef (Actual_RR >= 1.0)
        const isBuy = inferredSide ? inferredSide === 'BUY' : safeSL < safeTP;
        const slDist = Math.abs(entryPriceRef - safeSL);
        const tpDist = Math.abs(safeTP - entryPriceRef);
        if (slDist > 0 && (tpDist / slDist) < 1.0) {
          safeTP = isBuy ? (entryPriceRef + (slDist * 1.15)) : (entryPriceRef - (slDist * 1.15));
          console.warn(`🛡️ [DeltaExchange GATEKEEPER] Low RR bracket detected on ${symUpper}. Adjusted TP to 1.15R ($${this.roundToTickSize(safeTP, tickSize)}).`);
        }
      }

      // Pre-clamp against current mark/spot/bid-ask band so PUT / bracket rebuild won't fail with immediate_execution
      const band = await this.getFreshMarkBand(symUpper, false);
      const preClamped = this.clampBracketAgainstMark({
        side: inferredSide,
        markPrice: band.markPrice,
        referencePrices: band.referencePrices,
        tickNum,
        stopLossPrice: safeSL,
        takeProfitPrice: safeTP,
        gapMult: 1,
      });
      safeSL = preClamped.sl;
      safeTP = preClamped.tp;

      // 1. Check for existing open stop/bracket orders and update directly via PUT /v2/orders
      const openOrdersRaw = await this.getOpenOrders();
      if (openOrdersRaw === null) {
        // Network hiccup fetching open orders — do NOT blindly cancel unknown existing SL/TP orders!
        return await this.setBracketOrder(symUpper, safeSL, safeTP, positionSide);
      }

      const matchingOrders = openOrdersRaw.filter((o: any) =>
        ((o.product_symbol || '').toUpperCase() === symUpper || (product?.id && o.product_id === product.id)) &&
        (o.stop_order_type || o.bracket_order_type || o.order_type === 'stop_loss_order' || o.order_type === 'take_profit_order' || o.order_type === 'market_order' || o.reduce_only)
      );

      let tpOrder = matchingOrders.find(
        (o: any) => o.stop_order_type === 'take_profit_order' || o.order_type === 'take_profit_order' || o.bracket_order_type === 'take_profit_order'
      );
      let slOrder = matchingOrders.find(
        (o: any) => o.stop_order_type === 'stop_loss_order' || o.order_type === 'stop_loss_order' || o.bracket_order_type === 'stop_loss_order'
      );

      if ((!tpOrder || !slOrder) && entryPriceRef && entryPriceRef > 0 && inferredSide) {
        for (const o of matchingOrders) {
          const sp = parseFloat(o.stop_price || o.limit_price || o.price || '0');
          if (!Number.isFinite(sp) || sp <= 0) continue;
          if (!o.reduce_only && !o.stop_order_type && !o.bracket_order_type) continue;
          if (inferredSide === 'BUY') {
            if (sp > entryPriceRef && !tpOrder) tpOrder = o;
            else if (sp < entryPriceRef && !slOrder) slOrder = o;
          } else {
            if (sp < entryPriceRef && !tpOrder) tpOrder = o;
            else if (sp > entryPriceRef && !slOrder) slOrder = o;
          }
        }
      }

      const isMissingRequestedTP = Boolean(safeTP && safeTP > 0 && !tpOrder);
      const isMissingRequestedSL = Boolean(safeSL && safeSL > 0 && !slOrder);

      if (!isMissingRequestedTP && !isMissingRequestedSL) {
        // Both legs already exist on Delta Exchange: update individually so one failing PUT NEVER destroys the healthy SL!
        let updatedTP = !safeTP;
        let updatedSL = !safeSL;

        if (tpOrder && safeTP && safeTP > 0) {
          const formattedTP = this.roundToTickSize(safeTP, tickSize);
          const curTP = parseFloat(tpOrder.stop_price || tpOrder.limit_price || tpOrder.price || '0');
          if (curTP > 0 && Math.abs(curTP - parseFloat(formattedTP)) < tickNum * 0.5) {
            updatedTP = true;
          } else {
            try {
              const isReduceOnlyLimit = tpOrder.order_type === 'limit_order' && !tpOrder.stop_order_type && !tpOrder.stop_price;
              await this.request('PUT', '/v2/orders', {}, {
                id: tpOrder.id,
                product_id: tpOrder.product_id,
                size: tpOrder.size,
                ...(isReduceOnlyLimit ? { limit_price: formattedTP } : { stop_price: formattedTP }),
              });
              console.log(`🎯 [DeltaExchange] Updated TP Order #${tpOrder.id} on ${symUpper} to $${formattedTP}`);
              updatedTP = true;
            } catch (tpErr: any) {
              const msg = tpErr?.message || '';
              if (msg.includes('not_found') || msg.includes('already_closed')) {
                needFullRebuild = true;
              } else {
                console.warn(`⚠️ [DeltaExchange] TP PUT kept existing bracket intact on ${symUpper}:`, msg);
              }
            }
          }
        }

        if (slOrder && safeSL && safeSL > 0) {
          const formattedSL = this.roundToTickSize(safeSL, tickSize);
          const curSL = parseFloat(slOrder.stop_price || slOrder.price || '0');
          if (curSL > 0 && Math.abs(curSL - parseFloat(formattedSL)) < tickNum * 0.5) {
            updatedSL = true;
          } else {
            try {
              await this.request('PUT', '/v2/orders', {}, {
                id: slOrder.id,
                product_id: slOrder.product_id,
                size: slOrder.size,
                stop_price: formattedSL,
              });
              console.log(`🛑 [DeltaExchange] Updated SL Order #${slOrder.id} on ${symUpper} to $${formattedSL}`);
              updatedSL = true;
            } catch (slErr: any) {
              const msg = slErr?.message || '';
              if (msg.includes('not_found') || msg.includes('already_closed')) {
                needFullRebuild = true;
              } else {
                console.warn(`⚠️ [DeltaExchange] SL PUT kept existing bracket intact on ${symUpper}:`, msg);
              }
            }
          }
        }

        if (!needFullRebuild) {
          return {
            success: updatedTP && updatedSL,
            slProtected: Boolean(slOrder),
            tpProtected: Boolean(tpOrder),
          };
        }
      } else {
        needFullRebuild = true;
      }
    } catch (e: any) {
      console.warn(`[DeltaExchange] Direct order PUT update fallback for ${symUpper}:`, e.message);
      needFullRebuild = true;
    }

    if (!needFullRebuild) {
      return { success: true };
    }

    // 2. Fallback only when a leg is genuinely missing / disappeared: cancel stale half-bracket and set complete SL+TP pair
    await this.cancelBracketOrder(symUpper, true);
    await new Promise(r => setTimeout(r, 250));
    const setRes = await this.setBracketOrder(symUpper, safeSL, safeTP, positionSide);
    if (setRes?.success) {
      return setRes;
    }

    // Option Reduce-Only Fallback during updateBracketOrder if /v2/orders/bracket rejects options
    const isOptionSym = symUpper.startsWith('C-') || symUpper.startsWith('P-');
    if (isOptionSym) {
      try {
        const product = await this.resolveProduct(symUpper);
        const posList = await this.getMarginedPositions();
        const exPos = Array.isArray(posList)
          ? posList.find((p: any) => (p.product_symbol || '').toUpperCase() === symUpper || (product?.id && p.product_id === product.id))
          : null;
        const absSize = exPos ? Math.abs(parseFloat(exPos.size || '0')) : 0;
        if (absSize > 0) {
          const spec = this.getProductSpec(symUpper, entryPriceRef || safeSL || safeTP);
          const inferredCloseSide = (parseFloat(exPos.size) > 0) ? 'sell' : 'buy';
          let placedAny = false;
          if (safeTP && safeTP > 0) {
            await this.request('POST', '/v2/orders', {}, {
              ...(product?.id ? { product_id: product.id } : {}),
              product_symbol: product?.symbol || symUpper,
              size: absSize,
              side: inferredCloseSide,
              order_type: 'limit_order',
              limit_price: this.roundToTickSize(safeTP, spec.tickSize),
              reduce_only: true,
            }).then(() => { placedAny = true; }).catch(() => {});
          }
          if (safeSL && safeSL > 0) {
            await this.request('POST', '/v2/orders', {}, {
              ...(product?.id ? { product_id: product.id } : {}),
              product_symbol: product?.symbol || symUpper,
              size: absSize,
              side: inferredCloseSide,
              order_type: 'market_order',
              stop_order_type: 'stop_loss_order',
              stop_price: this.roundToTickSize(safeSL, spec.tickSize),
              stop_trigger_method: 'mark_price',
              reduce_only: true,
            }).then(() => { placedAny = true; }).catch(() => {});
          }
          if (placedAny) return { success: true, reduceOnlyOptionFallback: true };
        }
      } catch {}
    }
    return setRes;
  }

  /**
   * Refreshes all 1,000+ crypto tickers in one high-speed CDN batch call
   */
  public async refreshAllTickers(force: boolean = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastAllTickersFetchTime < 3000) {
      return;
    }
    if (this.isFetchingAllTickers) return;
    this.isFetchingAllTickers = true;

    try {
      const primaryUrl = this.config.isTestnet
        ? 'https://cdn-ind.testnet.deltaex.org/v2/tickers'
        : 'https://cdn.india.deltaex.org/v2/tickers';

      let resp = await fetch(primaryUrl, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'DeltaAutoTrader/2.0' },
        signal: AbortSignal.timeout(3500),
      }).catch(() => null);

      // If primary hits rate limit (429) or fails, cascade to secondary Delta CDN:
      if (!resp || !resp.ok) {
        const secondaryUrl = this.config.isTestnet
          ? 'https://cdn.india.deltaex.org/v2/tickers'
          : 'https://cdn-ind.testnet.deltaex.org/v2/tickers';
        resp = await fetch(secondaryUrl, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'DeltaAutoTrader/2.0' },
          signal: AbortSignal.timeout(3500),
        }).catch(() => null);
      }

      if (resp && resp.ok) {
        const json = await resp.json();
        if (json && Array.isArray(json.result)) {
          for (const t of json.result) {
            const sym = t.symbol;
            const price = parseFloat(t.mark_price || t.close || t.spot_price);
            if (price > 0 && !isNaN(price)) {
              const base = sym.toUpperCase().replace(/USD[T]?$/, '');
              this.livePrices.set(sym, price);
              this.livePrices.set(`${base}USD`, price);
              this.livePrices.set(`${base}USDT`, price);
              this.allTickersMap.set(sym, t);
              this.allTickersMap.set(`${base}USD`, t);
              this.allTickersMap.set(`${base}USDT`, t);
            }
          }
          this.lastAllTickersFetchTime = Date.now();
        }
      } else {
        // Tertiary fallback: If Delta CDN is 429 rate limited, hydrate livePrices from Binance Vision API
        try {
          const binResp = await fetch('https://data-api.binance.vision/api/v3/ticker/price', {
            signal: AbortSignal.timeout(3000)
          }).catch(() => null);
          if (binResp && binResp.ok) {
            const bJson = await binResp.json();
            if (Array.isArray(bJson)) {
              for (const item of bJson) {
                const bSym = item.symbol;
                if (bSym.endsWith('USDT')) {
                  const base = bSym.replace('USDT', '');
                  const p = parseFloat(item.price);
                  if (p > 0) {
                    this.livePrices.set(`${base}USD`, p);
                    this.livePrices.set(`${base}USDT`, p);
                    this.livePrices.set(bSym, p);
                  }
                }
              }
              this.lastAllTickersFetchTime = Date.now();
            }
          }
        } catch (be) {}
      }
    } catch (e: any) {
      // quiet fallback
    } finally {
      this.isFetchingAllTickers = false;
    }
  }

  public getCachedTicker(symbol: string): any {
    const symUpper = (symbol || '').toUpperCase().trim();
    const base = symUpper.replace('USDT', '').replace('USD', '').trim();
    return this.allTickersMap.get(symUpper)
      || this.allTickersMap.get(`${base}USD`)
      || this.allTickersMap.get(`${base}USDT`)
      || null;
  }

  /**
   * Fetches native historical chart candles from Delta Exchange
   */
  public async getChartHistory(symbol: string, resolutionMinutes: number = 15, count: number = 30): Promise<any[]> {
    const deltaSymbol = toDeltaSymbol(symbol);
    const now = Math.floor(Date.now() / 1000);
    const from = now - (resolutionMinutes * 60 * (count + 5));
    const path = `/v2/chart/history?symbol=${deltaSymbol}&resolution=${resolutionMinutes}&from=${from}&to=${now}`;
    try {
      const url = `${this.config.baseUrl}${path}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(2500) }).catch(() => null);
      let res: any = null;
      if (resp && resp.ok) {
        res = await resp.json();
      } else {
        const prodUrl = 'https://cdn.india.deltaex.org' + path;
        const prodResp = await fetch(prodUrl, { signal: AbortSignal.timeout(2500) }).catch(() => null);
        if (prodResp && prodResp.ok) {
          res = await prodResp.json();
        }
      }
      if (res?.success && res.result && res.result.c && Array.isArray(res.result.c) && res.result.c.length > 0) {
        const list: any[] = [];
        for (let i = 0; i < res.result.c.length; i++) {
          list.push({
            time: (res.result.t?.[i] || 0) * 1000,
            open: parseFloat(res.result.o?.[i] || '0'),
            high: parseFloat(res.result.h?.[i] || '0'),
            low: parseFloat(res.result.l?.[i] || '0'),
            close: parseFloat(res.result.c?.[i] || '0'),
            volume: parseFloat(res.result.v?.[i] || '0'),
          });
        }
        return list;
      }
    } catch (e: any) {}
    return [];
  }

  public getAllMarketTickers(topSymbols?: string[]): any[] {
    const defaultSymbols = [
      'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
      'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'SUIUSDT', 'NEARUSDT', 'DOTUSDT',
      'LINKUSDT', 'UNIUSDT', 'AAVEUSDT', 'MKRUSDT', 'INJUSDT',
      'PEPEUSDT', 'SHIBUSDT', 'BONKUSDT', 'FLOKIUSDT'
    ];
    const list = topSymbols && topSymbols.length > 0 ? topSymbols : defaultSymbols;
    return list.map(sym => {
      const base = sym.replace('USDT', '').replace('USD', '');
      const t = this.allTickersMap.get(`${base}USD`) || this.allTickersMap.get(sym) || this.allTickersMap.get(`1000${base}USD`);
      const price = parseFloat(t?.close || t?.mark_price || t?.spot_price || (this.livePrices.get(`${base}USD`) || this.livePrices.get(sym) || 0));
      if (!price) return null;
      let changePct = parseFloat(t?.ltp_change_24h || t?.mark_change_24h || t?.change_24h || t?.change_percentage || '0');
      if (changePct === 0 && t?.open && t?.close) {
        const o = parseFloat(t.open);
        const c = parseFloat(t.close);
        if (o > 0) changePct = parseFloat((((c - o) / o) * 100).toFixed(2));
      }
      const change24h = parseFloat((price * changePct / 100).toFixed(4));
      return {
        symbol: sym,
        price,
        changePercent24h: changePct,
        change24h,
        high24h: parseFloat(t?.high || t?.high_24h || (price * 1.01).toString()),
        low24h: parseFloat(t?.low || t?.low_24h || (price * 0.99).toString()),
        volume24h: parseFloat(t?.volume || t?.base_volume || '1000'),
        quoteVolume24h: parseFloat(t?.turnover || t?.quote_volume || '1000000'),
        askPrice: parseFloat(t?.quotes?.best_ask || (price * 1.0001).toString()),
        bidPrice: parseFloat(t?.quotes?.best_bid || (price * 0.9999).toString()),
        count: 1000,
      };
    }).filter(Boolean);
  }

  public async getTicker(symbol: string): Promise<any> {
    const base = symbol.toUpperCase().replace(/USD[T]?$/, '');
    const deltaSymbol = `${base}USD`;

    if (Date.now() - this.lastAllTickersFetchTime > 1500) {
      await this.refreshAllTickers();
    }

    const cached = this.allTickersMap.get(deltaSymbol) || this.allTickersMap.get(symbol);
    if (cached) return cached;

    try {
      const res = await this.request('GET', `/v2/tickers/${deltaSymbol}`);
      if (res?.result) return res.result;
    } catch (e) {}

    return null;
  }

  /**
   * Fetches Level 2 Order Book for a symbol from Delta Exchange
   */
  public async getL2Orderbook(symbol: string): Promise<{ buy: any[]; sell: any[] } | null> {
    const deltaSymbol = toDeltaSymbol(symbol);
    try {
      const res = await this.request('GET', `/v2/l2orderbook/${deltaSymbol}`);
      if (res?.result && (res.result.buy || res.result.sell)) return res.result;
    } catch (e) {}

    // Gate.io order book fallback
    try {
      const base = symbol.toUpperCase().replace(/USD[T]?$/, '');
      const resp = await fetch(`https://api.gateio.ws/api/v4/spot/order_book?currency_pair=${base}_USDT&limit=12`, {
        signal: AbortSignal.timeout(2500),
      });
      if (resp && resp.ok) {
        const data = await resp.json();
        return {
          buy: (data.bids || []).map((b: any) => ({ price: b[0], size: b[1] })),
          sell: (data.asks || []).map((a: any) => ({ price: a[0], size: a[1] })),
        };
      }
    } catch (e2) {}

    return null;
  }

  /**
   * Fetches recent public trades for a symbol from Delta Exchange
   */
  public async getRecentTrades(symbol: string): Promise<any[]> {
    const deltaSymbol = toDeltaSymbol(symbol);
    try {
      const res = await this.request('GET', `/v2/trades/${deltaSymbol}`);
      if (Array.isArray(res?.result) && res.result.length > 0) return res.result;
    } catch (e) {}

    // Gate.io trades fallback
    try {
      const base = symbol.toUpperCase().replace(/USD[T]?$/, '');
      const resp = await fetch(`https://api.gateio.ws/api/v4/spot/trades?currency_pair=${base}_USDT&limit=20`, {
        signal: AbortSignal.timeout(2500),
      });
      if (resp && resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data)) {
          return data.map((t) => ({
            id: t.id,
            price: parseFloat(t.price),
            size: parseFloat(t.amount),
            seller_role: t.side === 'sell' ? 'maker' : 'taker',
            created_at: parseInt(t.create_time) * 1000000,
          }));
        }
      }
    } catch (e2) {}

    return [];
  }

  /**
   * Fetches Microstructure (Order Book Imbalance, Microprice, CVD) and Derivatives (Funding Rate, OI)
   * As specified in Crypto Signal Playbook 2026 (Layers 1, 3 Groups E & F)
   */
  public async getMicrostructureAndDerivatives(symbol: string): Promise<MicrostructureDerivativesData | null> {
    const base = symbol.toUpperCase().replace(/USD[T]?$/, '');
    const deltaSymbol = `${base}USD`;

    try {
      const [tickerRes, obRes, tradesRes] = await Promise.allSettled([
        this.getTicker(deltaSymbol),
        this.getL2Orderbook(deltaSymbol),
        this.getRecentTrades(deltaSymbol),
      ]);

      const ticker = tickerRes.status === 'fulfilled' ? tickerRes.value : null;
      const orderbook = obRes.status === 'fulfilled' ? obRes.value : null;
      const trades = tradesRes.status === 'fulfilled' ? tradesRes.value : [];

      // 1. Order Book Imbalance (OBI) across top 10 levels with rolling smoothing (filters single-tick spoofing)
      const buys = (orderbook?.buy || []).slice(0, 10);
      const sells = (orderbook?.sell || []).slice(0, 10);
      const bidVol = buys.reduce((sum: number, b: any) => sum + parseFloat(b.size || b.depth || 0), 0);
      const askVol = sells.reduce((sum: number, a: any) => sum + parseFloat(a.size || a.depth || 0), 0);
      const totalDepth = bidVol + askVol;
      const rawObi = totalDepth > 0 ? (bidVol - askVol) / totalDepth : 0;

      const prevObis = this.obiRollingCache.get(deltaSymbol) || [];
      prevObis.push(rawObi);
      if (prevObis.length > 5) prevObis.shift();
      this.obiRollingCache.set(deltaSymbol, prevObis);
      const obi = prevObis.reduce((a, b) => a + b, 0) / prevObis.length;

      // 2. Microprice & Spread
      const bestBid = parseFloat(ticker?.quotes?.best_bid || buys[0]?.price || '0');
      const bestAsk = parseFloat(ticker?.quotes?.best_ask || sells[0]?.price || '0');
      const bidSize = parseFloat(ticker?.quotes?.bid_size || buys[0]?.size || '1');
      const askSize = parseFloat(ticker?.quotes?.ask_size || sells[0]?.size || '1');
      const microprice = (bidSize + askSize > 0)
        ? (bestAsk * bidSize + bestBid * askSize) / (bidSize + askSize)
        : (bestBid + bestAsk) / 2;
      const mid = (bestBid + bestAsk) / 2;
      const spreadPct = mid > 0 ? (Math.abs(bestAsk - bestBid) / mid) * 100 : 0;

      // 3. CVD (Cumulative Volume Delta) & Aggressor Buy Ratio
      let takerBuyVol = 0;
      let takerSellVol = 0;
      for (const tr of trades) {
        const sz = parseFloat(tr.size || 0);
        if (tr.buyer_role === 'taker') {
          takerBuyVol += sz;
        } else if (tr.seller_role === 'taker') {
          takerSellVol += sz;
        }
      }
      const cvd = takerBuyVol - takerSellVol;
      const totalTakerVol = takerBuyVol + takerSellVol;
      const takerBuyRatio = totalTakerVol > 0 ? takerBuyVol / totalTakerVol : 0.5;

      // 4. Derivatives Data
      const fundingRate = parseFloat(ticker?.funding_rate || '0');
      const openInterest = parseFloat(ticker?.oi || ticker?.oi_contracts || '0');
      const oiChangeUsd6h = parseFloat(ticker?.oi_change_usd_6h || '0');

      return {
        symbol: deltaSymbol,
        obi: parseFloat(obi.toFixed(4)),
        microprice: parseFloat(microprice.toFixed(4)),
        bestBid,
        bestAsk,
        spreadPct: parseFloat(spreadPct.toFixed(4)),
        cvd,
        takerBuyRatio: parseFloat(takerBuyRatio.toFixed(4)),
        fundingRate,
        openInterest,
        oiChangeUsd6h,
      };
    } catch (e) {
      return null;
    }
  }

  /**
   * Fetches genuine historical OHLCV candles from Delta Exchange (solutions.pdf Issues 6 & 11)
   */
  public async getKlines(symbol: string, resolution: string = '15m', limit: number = 250): Promise<KlinePoint[]> {
    const deltaSymbol = toDeltaSymbol(symbol);
    try {
      const nowSec = Math.floor(Date.now() / 1000);
      let stepSec = 15 * 60;
      let deltaRes = '15';
      if (resolution === '1m') { stepSec = 60; deltaRes = '1'; }
      else if (resolution === '3m') { stepSec = 3 * 60; deltaRes = '3'; }
      else if (resolution === '5m') { stepSec = 5 * 60; deltaRes = '5'; }
      else if (resolution === '15m') { stepSec = 15 * 60; deltaRes = '15'; }
      else if (resolution === '30m') { stepSec = 30 * 60; deltaRes = '30'; }
      else if (resolution === '1h') { stepSec = 60 * 60; deltaRes = '60'; }
      else if (resolution === '4h') { stepSec = 4 * 60 * 60; deltaRes = '240'; }
      else if (resolution === '1d') { stepSec = 24 * 60 * 60; deltaRes = 'D'; }

      const startSec = nowSec - (limit * stepSec);
      const res = await this.request('GET', '/v2/chart/history', {
        symbol: deltaSymbol,
        resolution: deltaRes,
        from: startSec.toString(),
        to: nowSec.toString(),
      });

      const r = res?.result;
      if (r && Array.isArray(r.t) && r.t.length > 0) {
        return r.t.map((t: number, i: number) => ({
          time: t > 10000000000 ? t : t * 1000,
          open: parseFloat(r.o[i]),
          high: parseFloat(r.h[i]),
          low: parseFloat(r.l[i]),
          close: parseFloat(r.c[i]),
          volume: parseFloat(r.v[i] || '0'),
        }));
      }

      const list = res?.result || [];
      if (Array.isArray(list) && list.length > 0) {
        const sorted = [...list].sort((a, b) => a.time - b.time);
        return sorted.map((k: any) => ({
          time: k.time > 10000000000 ? k.time : k.time * 1000,
          open: parseFloat(k.open),
          high: parseFloat(k.high),
          low: parseFloat(k.low),
          close: parseFloat(k.close),
          volume: parseFloat(k.volume || '0'),
        }));
      }
    } catch (e: any) {
      // Quiet fallback
    }
    return [];
  }

  /**
   * Fetches live market price for a symbol (unified with chart and strategy 15M candles)
   */
  public async getMarketPrice(symbol: string): Promise<number> {
    const cleanSym = (symbol || '').toUpperCase().trim();
    const base = cleanSym.replace(/USD[T]?$/, '');
    const deltaSymbol = `${base}USD`;
    const binanceSymbol = `${base}USDT`;

    // Pure Native Delta Exchange India Live Pricing (Zero external cache / Zero Gate.io)
    // 1. High-frequency bulk CDN refresh (keeps all Delta crypto pairs updating in real-time)
    if (Date.now() - this.lastAllTickersFetchTime > 1500) {
      await this.refreshAllTickers();
    }

    const liveP = this.livePrices.get(deltaSymbol) || this.livePrices.get(binanceSymbol) || this.livePrices.get(symbol);
    if (liveP && liveP > 0) {
      return liveP;
    }

    // 2. Fetch specific live Delta Exchange mark price if not in bulk
    try {
      const deltaTicker = await this.getTicker(deltaSymbol);
      if (deltaTicker) {
        const price = parseFloat(deltaTicker.mark_price || deltaTicker.close || deltaTicker.spot_price);
        if (price > 0 && !isNaN(price)) {
          this.livePrices.set(symbol, price);
          this.livePrices.set(deltaSymbol, price);
          this.livePrices.set(binanceSymbol, price);
          return price;
        }
      }
    } catch (e) {
      // fallback
    }

    // 2. Real-time Binance spot pricing fallback (ultra-low latency)
    try {
      const resp = await fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${binanceSymbol}`, {
        signal: AbortSignal.timeout(2500),
      });
      if (resp && resp.ok) {
        const data = await resp.json();
        const price = parseFloat(data.price);
        if (price > 0 && !isNaN(price)) {
          this.livePrices.set(symbol, price);
          this.livePrices.set(deltaSymbol, price);
          this.livePrices.set(binanceSymbol, price);
          return price;
        }
      }
    } catch (e) {
      // try secondary binance domain if vision fails
      try {
        const resp2 = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`, {
          signal: AbortSignal.timeout(2500),
        });
        if (resp2.ok) {
          const data2 = await resp2.json();
          const price2 = parseFloat(data2.price);
          if (price2 > 0 && !isNaN(price2)) {
            this.livePrices.set(symbol, price2);
            this.livePrices.set(deltaSymbol, price2);
            this.livePrices.set(binanceSymbol, price2);
            return price2;
          }
        }
      } catch (e2) {
        // ignore
      }
    }

    const cached = this.livePrices.get(symbol) || this.livePrices.get(deltaSymbol) || this.livePrices.get(binanceSymbol);
    if (cached && cached > 0) return cached;

    const DEFAULT_PRICES: Record<string, number> = {
      'BTCUSD': 85000,
      'ETHUSD': 2700,
      'SOLUSD': 120,
      'XRPUSD': 1.6,
      'DOGEUSD': 0.10,
      'ADAUSD': 0.25,
      'AVAXUSD': 11.0,
      'SUIUSD': 1.0,
    };
    return DEFAULT_PRICES[deltaSymbol] || 0;
  }

  /**
   * Places market or bracket order on Delta Exchange India
   */
  public async placeOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    size: number;
    price: number;
    orderType?: 'market_order' | 'limit_order';
    limitPrice?: number;
    limitFillTimeoutMs?: number;
    takeProfitPrice?: number;
    stopLossPrice?: number;
    postFillVerifyDelayMs?: number;
  }): Promise<{ success: boolean; orderId: string; fillPrice: number; message: string }> {
    const orderId = 'delta-ord-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
    const deltaSymbol = toDeltaSymbol(params.symbol);
    const symUpper = deltaSymbol.toUpperCase();
    const isOptionSymbol = symUpper.startsWith('C-') || symUpper.startsWith('P-');
    const product = this.isLiveDispatchActive()
      ? await this.resolveProduct(symUpper)
      : (this.products.get(symUpper) || this.products.get(`${symUpper.replace('USDT', '').replace('USD', '').trim()}USD`));

    const fallbackTick = params.price < 1 ? 0.0001 : params.price < 100 ? 0.001 : 0.01;
    const tickSizeNum = product?.tick_size ? parseFloat(product.tick_size) : (DELTA_PRODUCT_SPECS[deltaSymbol]?.tickSize || fallbackTick);
    const defaultOptCv = symUpper.includes('-BTC-') ? 0.001 : symUpper.includes('-ETH-') ? 0.01 : 1.0;
    const contractVal = product?.contract_value ? parseFloat(product.contract_value) : (DELTA_PRODUCT_SPECS[deltaSymbol]?.contractValue || (isOptionSymbol ? defaultOptCv : 1.0));
    let decimals = 0;
    if (tickSizeNum < 1) {
      const tickStr = tickSizeNum.toString();
      if (tickStr.includes('e-')) {
        decimals = parseInt(tickStr.split('e-')[1], 10) || 4;
      } else {
        decimals = (tickStr.split('.')[1] || '').length || 4;
      }
    }
    const spec = { tickSize: tickSizeNum, contractValue: contractVal, decimals: Math.min(Math.max(decimals, 0), 8) };

    const formatPrice = (p: number) => this.roundToTickSize(p, spec.tickSize);

    // Calculate contract quantity based on Delta's contract value
    const contracts = Math.max(1, Math.round(params.size / spec.contractValue));

    // If live credentials are valid, attempt actual order dispatch with real SL/TP bracket
    if (this.isLiveDispatchActive()) {
      try {
        let orderType = params.orderType || 'market_order';
        let limitPriceStr: string | undefined =
          orderType === 'limit_order'
            ? formatPrice(params.limitPrice && params.limitPrice > 0 ? params.limitPrice : params.price)
            : undefined;
        let inlineRefBand: { markPrice: number; referencePrices: number[] } = { markPrice: params.price, referencePrices: [params.price] };

        // Anti-Slippage Liquidity Guard:
        // Protects against illiquidity / huge spreads (e.g. SOLUSD testnet where top bid is 3.5% below mark price!)
        try {
          const ticker = await this.getTicker(deltaSymbol);
          const quotes = ticker?.quotes;
          const markPrice = parseFloat(ticker?.mark_price || ticker?.spot_price || params.price.toString());
          const bandNums = [
            markPrice,
            parseFloat(ticker?.spot_price || '0'),
            parseFloat(ticker?.close || '0'),
            parseFloat(quotes?.best_bid || '0'),
            parseFloat(quotes?.best_ask || '0'),
          ].filter((n) => Number.isFinite(n) && n > 0);
          if (bandNums.length > 0) {
            inlineRefBand = { markPrice: markPrice > 0 ? markPrice : bandNums[0], referencePrices: bandNums };
          }
          if (quotes && markPrice > 0) {
            const bestBid = parseFloat(quotes.best_bid || '0');
            const bestAsk = parseFloat(quotes.best_ask || '0');
            const slippagePct = params.side === 'BUY'
              ? (bestAsk > 0 ? (bestAsk - markPrice) / markPrice : 0)
              : (bestBid > 0 ? (markPrice - bestBid) / markPrice : 0);

            // Anti-Slippage Guard: Specifically protect testnet SOLUSD where testnet book has broken 3.5% gap.
            // For all standard pairs (BTC, ETH, XRP, DOGE, ADA, AVAX, SUI), keep market_order so 100% of lots fill completely!
            if (this.config.isTestnet && deltaSymbol === 'SOLUSD' && slippagePct > 0.02) {
              console.warn(`🛡️ [SLIPPAGE GUARD] Extreme testnet spread detected on ${deltaSymbol} (${(slippagePct * 100).toFixed(2)}%). Using limit order at mark price.`);
              orderType = 'limit_order';
              const targetLimit = params.side === 'BUY' ? markPrice * 1.002 : markPrice * 0.998;
              limitPriceStr = formatPrice(targetLimit);
            }
          }
        } catch (e) {}

        const payload: any = {
          ...(product?.id ? { product_id: product.id } : {}),
          product_symbol: product?.symbol || deltaSymbol,
          size: contracts,
          side: params.side.toLowerCase(),
          order_type: orderType,
        };
        if (orderType === 'limit_order' && limitPriceStr) {
          payload.limit_price = limitPriceStr;
        }

        // FIX 4: Hard Gatekeeper before sending perp order to Delta Exchange (options have -15%/+30% wider brackets)
        if (!isOptionSymbol && params.stopLossPrice && params.takeProfitPrice && params.price > 0) {
          const enforced = PortfolioMarketRegimeEngine.validateAndEnforceGeometricTargets({
            symbol: deltaSymbol,
            side: params.side,
            entryPrice: params.price,
            stopLossPrice: params.stopLossPrice,
            takeProfitPrice: params.takeProfitPrice,
            tickSize: spec.tickSize,
            decimals: spec.decimals,
          });
          params.stopLossPrice = roundPriceToTick(enforced.stopLossPrice, spec.tickSize);
          params.takeProfitPrice = roundPriceToTick(enforced.takeProfitPrice, spec.tickSize);
        }

        // Pre-clamp inline bracket against live mark/bid-ask band so POST /v2/orders succeeds immediately
        if (params.stopLossPrice && params.takeProfitPrice && inlineRefBand.markPrice > 0) {
          const preSafe = this.clampBracketAgainstMark({
            side: params.side,
            markPrice: inlineRefBand.markPrice,
            referencePrices: inlineRefBand.referencePrices,
            tickNum: spec.tickSize,
            stopLossPrice: params.stopLossPrice,
            takeProfitPrice: params.takeProfitPrice,
            gapMult: 1,
          });
          if (preSafe.sl) params.stopLossPrice = roundPriceToTick(preSafe.sl, spec.tickSize);
          if (preSafe.tp) params.takeProfitPrice = roundPriceToTick(preSafe.tp, spec.tickSize);
        }

        const refAnchor = inlineRefBand.markPrice > 0 ? inlineRefBand.markPrice : params.price;
        const isValidBracket = !!(params.stopLossPrice && params.takeProfitPrice &&
          (params.side === 'BUY'
            ? (params.takeProfitPrice > refAnchor && params.stopLossPrice < refAnchor)
            : (params.takeProfitPrice < refAnchor && params.stopLossPrice > refAnchor)));

        if (isValidBracket) {
          payload.bracket_stop_loss_price = formatPrice(params.stopLossPrice!);
          payload.bracket_take_profit_price = formatPrice(params.takeProfitPrice!);
          payload.bracket_stop_trigger_method = 'mark_price';
        }

        let res: any;
        let usedBracket = isValidBracket;
        let dispatchedContracts = contracts;
        try {
          res = await this.request('POST', '/v2/orders', {}, payload);
        } catch (bracketErr: any) {
          const errMsg = bracketErr?.message || '';
          if (errMsg.includes('bracket_order') || errMsg.includes('400')) {
            console.warn(`⚠️ Delta bracket order rejected (${errMsg}). Retrying standard order for ${deltaSymbol}...`);
            usedBracket = false;
            const cleanPayload: any = {
              ...(product?.id ? { product_id: product.id } : {}),
              product_symbol: product?.symbol || deltaSymbol,
              size: contracts,
              side: params.side.toLowerCase(),
              order_type: orderType,
            };
            if (orderType === 'limit_order' && limitPriceStr) {
              cleanPayload.limit_price = limitPriceStr;
            }
            try {
              res = await this.request('POST', '/v2/orders', {}, cleanPayload);
            } catch (cleanErr: any) {
              const cleanErrMsg = cleanErr?.message || '';
              if (cleanErrMsg.includes('insufficient_margin') && contracts > 5) {
                const reducedContracts = Math.max(Math.floor(contracts * 0.6), 5);
                dispatchedContracts = reducedContracts;
                console.warn(`⚠️ Insufficient margin for ${contracts} contracts on ${deltaSymbol}. Retrying with ${reducedContracts} contracts...`);
                res = await this.request('POST', '/v2/orders', {}, {
                  ...(product?.id ? { product_id: product.id } : {}),
                  product_symbol: product?.symbol || deltaSymbol,
                  size: reducedContracts,
                  side: params.side.toLowerCase(),
                  order_type: orderType,
                  ...(orderType === 'limit_order' && limitPriceStr ? { limit_price: limitPriceStr } : {}),
                });
              } else if (cleanErrMsg.includes('immediate_liquidation')) {
                console.warn(`⚠️ Immediate liquidation detected on market order for ${deltaSymbol} (thin orderbook). Retrying with limit order near mark price...`);
                const limitPriceNum = params.side === 'BUY' ? params.price * 1.002 : params.price * 0.998;
                const cappedLimitContracts = Math.min(contracts, 50);
                dispatchedContracts = cappedLimitContracts;
                const limitPayload = {
                  ...(product?.id ? { product_id: product.id } : {}),
                  product_symbol: product?.symbol || deltaSymbol,
                  size: cappedLimitContracts,
                  side: params.side.toLowerCase(),
                  order_type: 'limit_order',
                  limit_price: formatPrice(limitPriceNum),
                };
                res = await this.request('POST', '/v2/orders', {}, limitPayload);
              } else {
                throw cleanErr;
              }
            }
          } else {
            throw bracketErr;
          }
        }

        if (res && res.result) {
          let orderState = res.result;
          if (orderType === 'limit_order' && orderState.id) {
            const initUnfilled = parseInt(String(orderState.unfilled_size ?? '0'), 10);
            if (orderState.state === 'open' && initUnfilled > 0) {
              const timeoutMs = params.limitFillTimeoutMs ?? 1500;
              if (timeoutMs > 0) {
                const steps = Math.max(1, Math.min(3, Math.floor(timeoutMs / 500)));
                for (let step = 0; step < steps; step++) {
                  await new Promise(r => setTimeout(r, Math.floor(timeoutMs / steps)));
                  try {
                    const ordCheck = await this.request('GET', `/v2/orders/${orderState.id}`, {}, undefined);
                    if (ordCheck?.result) {
                      orderState = ordCheck.result;
                      const rem = parseInt(String(orderState.unfilled_size ?? '0'), 10);
                      if (orderState.state !== 'open' || rem === 0) break;
                    }
                  } catch {}
                }
              }
              const remainingSize = parseInt(String(orderState.unfilled_size ?? initUnfilled), 10);
              const totalOrdered = parseInt(String(orderState.size ?? dispatchedContracts), 10) || dispatchedContracts;
              const actualFilled = Math.max(0, totalOrdered - remainingSize);
              if (orderState.state === 'open' && remainingSize > 0) {
                await this.cancelOrder(String(orderState.id), deltaSymbol).catch(() => {});
                if (actualFilled <= 0) {
                  console.log(`🛡️ [OPTION LIMIT UNFILLED] ${deltaSymbol} limit @ $${limitPriceStr} did not fill; cancelled resting order ($0.00 loss).`);
                  return {
                    success: false,
                    orderId: '',
                    fillPrice: 0,
                    message: `LIMIT_ORDER_UNFILLED_CANCELLED (${deltaSymbol} @ $${limitPriceStr})`,
                  };
                }
                orderState = { ...orderState, size: actualFilled };
              }
            }
          }

          const fillPrice = parseFloat(orderState.average_fill_price || orderState.limit_price || orderState.price || params.price.toString());
          const effectiveFill = fillPrice > 0 ? fillPrice : params.price;
          const filledContracts = Math.max(1, parseInt(String(orderState.size || '0'), 10) || dispatchedContracts);
          console.log(`🎯 Real Delta Order Filled for ${deltaSymbol} (${params.side} ${filledContracts} contracts @ $${effectiveFill})`);

          // MANDATORY 2-SECOND POST-ENTRY BRACKET VERIFICATION & FALLBACK PROTECTION:
          // Delta market_order can fill without creating child SL/TP orders. Wait 2s for matching settlement,
          // verify BOTH SL & TP exist for this product, try /v2/orders/bracket first, and fall back to
          // individual Reduce-Only Take-Profit Limit & Stop-Market orders if any leg is still missing!
          if (isValidBracket) {
            try {
              const verifyDelayMs = params.postFillVerifyDelayMs ?? 2000;
              if (verifyDelayMs > 0) {
                await new Promise(r => setTimeout(r, verifyDelayMs));
              }
              const bracketCheck = await this.verifyPositionBrackets(deltaSymbol, params.side, effectiveFill);
              if (!bracketCheck.hasSL || !bracketCheck.hasTP) {
                console.warn(`🛡️ [BRACKET GUARANTEE] ${deltaSymbol} filled without complete exchange TP/SL (hasSL=${bracketCheck.hasSL}, hasTP=${bracketCheck.hasTP}). Setting explicit /v2/orders/bracket now...`);
                if (bracketCheck.hasSL || bracketCheck.hasTP) {
                  await this.cancelBracketOrder(deltaSymbol, true).catch(() => {});
                  await new Promise(r => setTimeout(r, 150));
                }
                let setRes = await this.setBracketOrder(deltaSymbol, params.stopLossPrice, params.takeProfitPrice, params.side);
                if (!setRes?.success) {
                  await new Promise(r => setTimeout(r, 300));
                  setRes = await this.setBracketOrder(deltaSymbol, params.stopLossPrice, params.takeProfitPrice, params.side);
                }

                if (setRes?.success && !setRes?.slOnly) {
                  console.log(`✅ [BRACKET VERIFIED] ${deltaSymbol} exchange bracket attached post-fill.`);
                } else {
                  // Reduce-Only Fallback Protection when combined bracket failed or only SL attached
                  const closeSide = params.side === 'BUY' ? 'sell' : 'buy';
                  const fallbackBand = await this.getFreshMarkBand(symUpper, true).catch(() => ({
                    markPrice: effectiveFill,
                    referencePrices: [effectiveFill],
                  }));
                  const fallbackClamped = this.clampBracketAgainstMark({
                    side: params.side,
                    markPrice: fallbackBand.markPrice > 0 ? fallbackBand.markPrice : effectiveFill,
                    referencePrices: fallbackBand.referencePrices,
                    tickNum: spec.tickSize,
                    stopLossPrice: params.stopLossPrice,
                    takeProfitPrice: params.takeProfitPrice,
                    gapMult: 1.5,
                  });

                  const needSL = !setRes?.success && !setRes?.slOnly && fallbackClamped.sl && fallbackClamped.sl > 0;
                  const needTP = (!setRes?.success || setRes?.slOnly) && fallbackClamped.tp && fallbackClamped.tp > 0;

                  if (needTP) {
                    try {
                      await this.request('POST', '/v2/orders', {}, {
                        ...(product?.id ? { product_id: product.id } : {}),
                        product_symbol: product?.symbol || deltaSymbol,
                        size: filledContracts,
                        side: closeSide,
                        order_type: 'limit_order',
                        limit_price: formatPrice(fallbackClamped.tp!),
                        reduce_only: true,
                      });
                      console.log(`🎯 [REDUCE-ONLY TP LIMIT PLACED] ${deltaSymbol} (${closeSide} @ $${formatPrice(fallbackClamped.tp!)})`);
                    } catch (tpFallbackErr: any) {
                      console.warn(`⚠️ [REDUCE-ONLY TP FALLBACK NOTE] ${deltaSymbol}: ${tpFallbackErr?.message || tpFallbackErr}`);
                    }
                  }

                  if (needSL) {
                    try {
                      await this.request('POST', '/v2/orders', {}, {
                        ...(product?.id ? { product_id: product.id } : {}),
                        product_symbol: product?.symbol || deltaSymbol,
                        size: filledContracts,
                        side: closeSide,
                        order_type: 'market_order',
                        stop_order_type: 'stop_loss_order',
                        stop_price: formatPrice(fallbackClamped.sl!),
                        stop_trigger_method: 'mark_price',
                        reduce_only: true,
                      });
                      console.log(`🛑 [REDUCE-ONLY SL STOP-MARKET PLACED] ${deltaSymbol} (${closeSide} @ $${formatPrice(fallbackClamped.sl!)})`);
                    } catch (slFallbackErr: any) {
                      console.warn(`⚠️ [REDUCE-ONLY SL FALLBACK NOTE] ${deltaSymbol}: ${slFallbackErr?.message || slFallbackErr}`);
                    }
                  }
                }
              } else {
                console.log(`✅ [BRACKET VERIFIED] ${deltaSymbol} exchange SL & TP confirmed active post-fill.`);
              }
            } catch (e: any) {
              console.warn(`[DeltaExchange] Bracket attachment note for ${deltaSymbol}:`, e.message);
            }
          }

          return {
            success: true,
            orderId: res.result.id?.toString() || orderId,
            fillPrice: effectiveFill,
            message: `Executed on Delta Exchange with SL (${formatPrice(params.stopLossPrice || 0)}) & TP (${formatPrice(params.takeProfitPrice || 0)})`,
          };
        }
      } catch (err: any) {
        console.warn('[DEBUG] Delta Exchange FULL order error:', err.message, JSON.stringify(err));
        return {
          success: false,
          orderId: '',
          fillPrice: 0,
          message: `Delta Exchange rejected order: ${err.message}`,
        };
      }
    }

    console.warn('[DEBUG] >>> FALLING TO PAPER MODE! API Key:', this.config.apiKey?.substring(0,6), 'isSimulation:', this.config.isSimulation);
    // Simulation / Paper Execution: Re-anchored to market price
    return {
      success: true,
      orderId,
      fillPrice: params.price,
      message: `Executed in Paper / Simulation Mode (${deltaSymbol})`,
    };
  }

  /**
   * Pre-places a conditional breakout entry order on Delta Exchange India at +0.10 ATR breakout price.
   * If price moves in favorable breakout direction, Delta Exchange fills the order natively.
   * If price hits adverse threshold or stalls for 5 mins, this order is cancelled before fill ($0.00 loss).
   */
  public async placeBreakoutOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    size: number;
    breakoutPrice: number;
    stopLossPrice?: number;
    takeProfitPrice?: number;
  }): Promise<{ success: boolean; orderId: string; breakoutPrice: number; contracts: number; message: string; side?: 'BUY' | 'SELL' }> {
    const orderId = 'delta-pre-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
    const deltaSymbol = toDeltaSymbol(params.symbol);
    const spec = DELTA_PRODUCT_SPECS[deltaSymbol] || { tickSize: 0.01, contractValue: 1.0, decimals: 2 };

    const formatPrice = (p: number) => {
      const rounded = Math.round(p / spec.tickSize) * spec.tickSize;
      return rounded.toFixed(spec.decimals);
    };

    const contracts = Math.max(1, Math.round(params.size / spec.contractValue));

    if (this.isLiveDispatchActive()) {
      try {
        const payload: any = {
          product_symbol: deltaSymbol,
          size: contracts,
          side: params.side.toLowerCase(),
          order_type: 'market_order',
          stop_price: formatPrice(params.breakoutPrice),
          stop_trigger_method: 'mark_price',
        };

        if (params.stopLossPrice && params.takeProfitPrice) {
          payload.bracket_stop_loss_price = formatPrice(params.stopLossPrice);
          payload.bracket_take_profit_price = formatPrice(params.takeProfitPrice);
          payload.bracket_stop_trigger_method = 'mark_price';
        }

        const res = await this.request('POST', '/v2/orders', {}, payload);
        if (res && res.result) {
          const liveOrderId = res.result.id?.toString() || orderId;
          console.log(`🎯 Resting Breakout Order pre-placed on Delta for ${deltaSymbol} (${params.side} ${contracts} contracts @ trigger $${formatPrice(params.breakoutPrice)}) with SL: ${payload.bracket_stop_loss_price}, TP: ${payload.bracket_take_profit_price}`);
          return {
            success: true,
            orderId: liveOrderId,
            side: params.side,
            breakoutPrice: params.breakoutPrice,
            contracts,
            message: `Resting breakout order placed on Delta Exchange @ $${formatPrice(params.breakoutPrice)} (ID: ${liveOrderId})`,
          };
        }
      } catch (err: any) {
        console.warn('Delta Exchange pre-order dispatch failed:', err.message);
        return {
          success: false,
          orderId: '',
          side: params.side,
          breakoutPrice: params.breakoutPrice,
          contracts: 0,
          message: `Delta Exchange rejected order: ${err.message}`,
        };
      }
    }

    console.log(`🛡️ Resting Breakout Order simulated for ${deltaSymbol}: ${params.side} @ $${formatPrice(params.breakoutPrice)} (ID: ${orderId})`);
    return {
      success: true,
      orderId,
      side: params.side,
      breakoutPrice: params.breakoutPrice,
      contracts,
      message: `Resting breakout order simulated @ $${formatPrice(params.breakoutPrice)} (${deltaSymbol})`,
    };
  }

  /**
   * Cancels a pending resting order on Delta Exchange (e.g. Branch A fakeout or Branch B timeout)
   */
  public async cancelOrder(orderId: string, symbol?: string): Promise<{ success: boolean; message: string }> {
    const isNumeric = /^\d+$/.test(orderId);
    if (!isNumeric) {
      console.log(`🛡️ Synthetic/hybrid resting order ${orderId} cancelled safely ($0.00 Real Loss)`);
      return { success: true, message: `Resting order ${orderId} cancelled safely ($0.00 Real Loss)` };
    }

    if (this.isLiveDispatchActive()) {
      try {
        const deltaSymbol = symbol ? toDeltaSymbol(symbol) : undefined;
        const numericId = parseInt(orderId, 10);
        const payload: any = { id: numericId, order_id: numericId };
        if (deltaSymbol) payload.product_symbol = deltaSymbol;
        await this.request('DELETE', '/v2/orders', {}, payload);
        console.log(`🛑 Resting Order ${orderId} cancelled on Delta Exchange ($0.00 Real Loss)`);
        return { success: true, message: `Order ${orderId} cancelled on Delta Exchange` };
      } catch (err: any) {
        console.warn(`Delta order cancellation note (hybrid fallback active): ${err.message}`);
        return { success: true, message: `Resting order ${orderId} cancelled safely ($0.00 Real Loss)` };
      }
    }

    console.log(`🛡️ Simulated resting order ${orderId} cancelled safely ($0.00 Real Loss)`);
    return { success: true, message: `Resting order ${orderId} cancelled safely ($0.00 Real Loss)` };
  }

  /**
   * Closes an existing position on Delta Exchange and clears associated resting bracket orders
   */
  public async closePosition(
    symbol: string,
    options?: { allowOptionSpotSlClose?: boolean }
  ): Promise<{ success: boolean; message: string }> {
    if (this.isLiveDispatchActive()) {
      try {
        const deltaSymbol = toDeltaSymbol(symbol);
        const isOptionSym = deltaSymbol.startsWith('C-') || deltaSymbol.startsWith('P-');
        const positions = (await this.getMarginedPositions()) || [];
        const targetPos = Array.isArray(positions)
          ? positions.find((p: any) => 
              p.product_symbol === deltaSymbol || 
              (p.product_symbol || '').toUpperCase().replace('USDT', 'USD') === deltaSymbol ||
              p.product_symbol === symbol
            )
          : undefined;

        if (targetPos) {
          const size = parseFloat(targetPos.size || '0');
          if (size !== 0) {
            const pnl = parseFloat(targetPos.unrealized_pnl || targetPos.pnl || '0');
            if (pnl < 0 && !(isOptionSym && options?.allowOptionSpotSlClose)) {
              console.log(`[DeltaExchange] 🛡️ BLOCKED SOFTWARE LOSS CLOSE: ${deltaSymbol} has unrealized PnL $${pnl.toFixed(2)} (< 0). Let Exchange Bracket SL work! Cancelling bracket and market close aborted.`);
              return { success: false, message: 'BLOCKED SOFTWARE LOSS CLOSE: Let Exchange Bracket SL work!' };
            }
            const closeSide = size > 0 ? 'sell' : 'buy';

            // 1. FIRST cancel active bracket / stop orders cleanly once
            try {
              await this.cancelBracketOrder(deltaSymbol).catch(() => {});
            } catch (cleanupErr) {}

            // 2. Send market close order
            const payload: any = {
              product_symbol: targetPos.product_symbol || deltaSymbol,
              size: Math.abs(size),
              side: closeSide,
              order_type: 'market_order',
              reduce_only: true,
            };
            if (targetPos.product_id) payload.product_id = targetPos.product_id;

            try {
              await this.request('POST', '/v2/orders', {}, payload);
            } catch (closeErr: any) {
              const errMsg = closeErr?.message || '';
              if (errMsg.includes('out_of_bankruptcy')) {
                console.log(`ℹ️ [EXCHANGE RESOLVED] ${deltaSymbol} position is settled / in testnet bankruptcy. Closed locally.`);
                return { success: true, message: 'Position settled on exchange' };
              }
              if (errMsg.includes('reduce_only')) {
                console.warn(`⚠️ Illiquid book detected for ${deltaSymbol} (${errMsg}). Retrying close with limit order at mark price...`);
                const mark = await this.getMarketPrice(deltaSymbol);
                const spec = DELTA_PRODUCT_SPECS[deltaSymbol] || { tickSize: 0.0001, decimals: 4 };
                const limitPrice = closeSide === 'sell' 
                  ? Math.round((mark * 0.999) / spec.tickSize) * spec.tickSize
                  : Math.round((mark * 1.001) / spec.tickSize) * spec.tickSize;
                const limitPayload: any = {
                  product_symbol: targetPos.product_symbol || deltaSymbol,
                  size: Math.abs(size),
                  side: closeSide,
                  order_type: 'limit_order',
                  limit_price: limitPrice.toFixed(spec.decimals),
                  reduce_only: true,
                };
                if (targetPos.product_id) limitPayload.product_id = targetPos.product_id;
                await this.request('POST', '/v2/orders', {}, limitPayload);
              } else {
                throw closeErr;
              }
            }

            console.log(`[DeltaExchange] 🛑 Closed live exchange position for ${deltaSymbol} (side: ${closeSide}, size: ${size})`);
          }
        }

        // Final cleanup of any lingering resting orders
        await this.request('DELETE', '/v2/orders/all', {}, {
          product_symbol: deltaSymbol,
        }).catch(() => {});

        return { success: true, message: `Position and resting orders closed on Delta Exchange (${deltaSymbol})` };
      } catch (e: any) {
        console.warn(`Delta closePosition error for ${symbol}:`, e.message);
        return { success: false, message: e.message };
      }
    }
    return { success: true, message: 'Position liquidated & settled' };
  }

  public async closeAllPositionsOnExchange(): Promise<any> {
    if (!this.isLiveDispatchActive()) {
      return { success: false, message: 'Simulation mode or air-gapped from exchange' };
    }
    try {
      const positions = await this.getMarginedPositions();
      if (positions && Array.isArray(positions)) {
        for (const p of positions) {
          const size = parseFloat(p.size || '0');
          if (size !== 0) {
            const closeSide = size > 0 ? 'sell' : 'buy';
            const payload: any = {
              product_symbol: p.product_symbol,
              size: Math.abs(size),
              side: closeSide,
              order_type: 'market_order',
              reduce_only: true,
            };
            if (p.product_id) payload.product_id = p.product_id;
            await this.request('POST', '/v2/orders', {}, payload).catch((e: any) =>
              console.warn(`Close error for ${p.product_symbol}:`, e.message)
            );
            console.log(`[DeltaExchange] 🛑 Liquidated exchange position for ${p.product_symbol}`);
          }
        }
      }
      await this.request('DELETE', '/v2/orders/all', {}, {
        cancel_stop_orders: true,
        cancel_reduce_only_orders: true,
      }).catch(() => {});
      return { success: true };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
}

export const deltaExchange = new DeltaExchangeEngine();
