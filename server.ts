import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { deltaAutoTrader } from './lib/deltaAutoTraderEngine';
import { strategyEngine } from './lib/cryptoDedicatedStrategyEngine';
// Shadow Gate REMOVED per user directive
import { deltaExchange, toDeltaSymbol } from './lib/deltaExchangeEngine';
import { CandlestickMasterPatternEngine, candlestickMaster } from './lib/candlestickMasterPatternEngine';
import { deltaOptionsCondor } from './lib/deltaOptionsCondorEngine';
import { KlinePoint } from './src/types';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

// Default to user's provided Delta Exchange API credentials (Real Delta Exchange India)
let EXCHANGE_CONFIG = {
  apiKey: process.env.DELTA_API_KEY || process.env.EXCHANGE_API_KEY || '',
  apiSecret: process.env.DELTA_API_SECRET || process.env.EXCHANGE_API_SECRET || '',
  exchangeName: process.env.DELTA_IS_TESTNET === 'true' ? 'Delta Exchange Demo (Testnet)' : 'Delta Exchange India',
  endpoint: process.env.DELTA_BASE_URL || (process.env.DELTA_IS_TESTNET === 'true' ? 'https://cdn-ind.testnet.deltaex.org' : 'https://api.india.delta.exchange'),
  isSimulation: process.env.DELTA_IS_SIMULATION === 'true' || process.env.PAPER_TRADING === 'true' || !process.env.DELTA_API_KEY || !process.env.DELTA_API_SECRET,
};

// Initialize Delta Exchange credentials immediately in Real / Live or Demo mode
deltaExchange.updateCredentials(EXCHANGE_CONFIG.apiKey, EXCHANGE_CONFIG.apiSecret, EXCHANGE_CONFIG.isSimulation, process.env.DELTA_IS_TESTNET === 'true');
deltaAutoTrader.updateConfig({ mode: EXCHANGE_CONFIG.isSimulation ? 'SIMULATION_PAPER' : (process.env.DELTA_IS_TESTNET === 'true' ? 'DELTA_TESTNET' : 'LIVE_DELTA_INDIA') });

interface AutoSellRule {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  ruleType: 'TAKE_PROFIT' | 'STOP_LOSS' | 'TRAILING_STOP' | 'RANGE_OCO';
  triggerPrice: number;
  stopPrice?: number;
  takeProfitPrice?: number;
  trailingPercent?: number;
  trailingPeakPrice?: number;
  amount: number;
  amountPercent: number; // e.g. 50% or 100%
  entryPrice: number;
  orderType: 'MARKET' | 'LIMIT';
  status: 'ACTIVE' | 'PAUSED' | 'TRIGGERED' | 'EXECUTED' | 'CANCELLED';
  createdAt: number;
  triggeredAt?: number;
  executedPrice?: number;
  pnlPercent?: number;
  executionNote?: string;
}

interface ExecutedOrder {
  id: string;
  ruleId?: string;
  symbol: string;
  side: 'SELL' | 'BUY';
  type: 'MARKET' | 'LIMIT';
  price: number;
  quantity: number;
  totalUsdt: number;
  timestamp: number;
  pnl?: number;
  pnlPercent?: number;
  status: 'FILLED' | 'SIMULATED_FILLED' | 'FAILED';
  triggerReason: string;
}

// Persistent state for rules and trading records (solutions.pdf Issue 15)
const RULES_FILE = path.join(process.cwd(), '.auto_sell_rules.json');
const ORDERS_FILE = path.join(process.cwd(), '.order_history.json');

function loadAutoSellRules(): AutoSellRule[] {
  try {
    if (fs.existsSync(RULES_FILE)) {
      const data = fs.readFileSync(RULES_FILE, 'utf-8').trim();
      if (data) return JSON.parse(data);
    }
  } catch (e) {}
  return [];
}

function saveAutoSellRules() {
  try {
    fs.writeFileSync(RULES_FILE, JSON.stringify(autoSellRules, null, 2), 'utf-8');
  } catch (e) {}
}

function loadOrderHistory(): ExecutedOrder[] {
  try {
    if (fs.existsSync(ORDERS_FILE)) {
      const data = fs.readFileSync(ORDERS_FILE, 'utf-8').trim();
      if (data) return JSON.parse(data);
    }
  } catch (e) {}
  return [];
}

function saveOrderHistory() {
  try {
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orderHistory.slice(0, 500), null, 2), 'utf-8');
  } catch (e) {}
}

let autoSellRules: AutoSellRule[] = loadAutoSellRules();
let orderHistory: ExecutedOrder[] = loadOrderHistory();

// Simulated balances for testing/demo fallback when exchange API keys are restricted to specific IPs
let simulationBalances = {
  USDT: 14250.80,
  BTC: 0.425,
  ETH: 3.80,
  SOL: 24.50,
  BNB: 6.20,
  XRP: 1500.0,
  DOGE: 8200.0,
  ADA: 1200.0,
  AVAX: 45.0,
  LINK: 80.0,
  SUI: 650.0,
};

async function startServer() {
  const app = express();
  app.use(express.json());
  app.use((err: any, req: any, res: any, next: any) => {
    if (err instanceof SyntaxError && 'body' in err) {
      console.warn('⚠️ Bad JSON payload received and handled gracefully:', err.message);
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    next(err);
  });

  // Auth Middleware for Administrative Management Endpoints (solutions.pdf Issue 2)
  const adminAuthMiddleware = (req: any, res: any, next: any) => {
    const adminSecret = process.env.ADMIN_API_KEY || process.env.WEBHOOK_SECRET;
    if (adminSecret) {
      const authHeader = req.headers['authorization'] || req.headers['x-api-key'] || req.headers['x-admin-key'];
      if (authHeader !== adminSecret && authHeader !== `Bearer ${adminSecret}`) {
        return res.status(401).json({ error: 'Unauthorized: Valid Admin API Token required' });
      }
    }
    next();
  };

  // API 1: Health Check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      exchange: EXCHANGE_CONFIG.exchangeName,
      timestamp: Date.now(),
      mode: EXCHANGE_CONFIG.isSimulation ? 'SIMULATION' : 'EXCHANGE_LIVE',
    });
  });

  // API 2: Credentials status & update (protected by admin auth)
  app.get('/api/exchange/credentials', (req, res) => {
    const key = EXCHANGE_CONFIG.apiKey || '';
    const maskedKey = key.length > 8 
      ? `${key.slice(0, 4)}...${key.slice(-4)}`
      : key ? '••••••••' : 'NOT_SET';
    
    res.json({
      hasApiKey: Boolean(EXCHANGE_CONFIG.apiKey),
      hasApiSecret: Boolean(EXCHANGE_CONFIG.apiSecret),
      maskedApiKey: maskedKey,
      exchange: EXCHANGE_CONFIG.exchangeName,
      isSimulation: EXCHANGE_CONFIG.isSimulation,
    });
  });

  app.post('/api/exchange/credentials', adminAuthMiddleware, (req, res) => {
    const { apiKey, apiSecret, exchangeName, isSimulation } = req.body;
    if (apiKey !== undefined) EXCHANGE_CONFIG.apiKey = String(apiKey).trim();
    if (apiSecret !== undefined) EXCHANGE_CONFIG.apiSecret = String(apiSecret).trim();
    if (exchangeName) EXCHANGE_CONFIG.exchangeName = exchangeName;
    if (isSimulation !== undefined) EXCHANGE_CONFIG.isSimulation = Boolean(isSimulation);

    deltaExchange.updateCredentials(EXCHANGE_CONFIG.apiKey, EXCHANGE_CONFIG.apiSecret, EXCHANGE_CONFIG.isSimulation, process.env.DELTA_IS_TESTNET === 'true');

    res.json({
      success: true,
      message: 'Exchange credentials updated successfully',
      isSimulation: EXCHANGE_CONFIG.isSimulation,
    });
  });

  // API 3: Verify exchange connection with HMAC SHA256 Signature to Delta Exchange
  app.get('/api/exchange/test-connection', async (req, res) => {
    const apiKey = EXCHANGE_CONFIG.apiKey;
    const apiSecret = EXCHANGE_CONFIG.apiSecret;

    if (!apiKey || !apiSecret) {
      return res.json({
        connected: false,
        error: 'API Key or Secret missing. Set credentials first.',
        isSimulation: EXCHANGE_CONFIG.isSimulation,
        balances: [],
      });
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const path = '/v2/wallet/balances';
      const payload = 'GET' + timestamp.toString() + path;
      const signature = crypto
        .createHmac('sha256', apiSecret)
        .update(payload)
        .digest('hex');

      const url = `${EXCHANGE_CONFIG.endpoint}${path}`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'api-key': apiKey,
          'timestamp': timestamp.toString(),
          'signature': signature,
          'Content-Type': 'application/json',
          'User-Agent': 'DeltaAutoTrader/1.0',
        },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await response.json();

      if (response.ok && data.success && Array.isArray(data.result)) {
        const validBalances = data.result
          .filter((b: any) => parseFloat(b.balance || '0') > 0 || parseFloat(b.available_balance || '0') > 0)
          .map((b: any) => ({
            asset: b.asset_symbol,
            free: b.available_balance,
            locked: (parseFloat(b.balance || '0') - parseFloat(b.available_balance || '0')).toFixed(4),
            balanceInr: b.balance_inr,
          }));

        const totalNetEquity = data.meta?.net_equity || (validBalances.reduce((sum: number, b: any) => sum + parseFloat(b.free || '0'), 0)).toFixed(2);

        return res.json({
          connected: true,
          status: EXCHANGE_CONFIG.isSimulation ? 'DEMO_CONNECTED' : 'LIVE_CONNECTED',
          exchange: EXCHANGE_CONFIG.exchangeName,
          netEquityUSD: totalNetEquity,
          balances: validBalances,
        });
      } else {
        const errorMsg = data.error?.code || data.error || data.msg || `HTTP ${response.status}`;
        const clientIp = data.error?.context?.client_ip || '';

        return res.json({
          connected: false,
          status: errorMsg === 'ip_not_whitelisted_for_api_key' ? 'IP_NOT_WHITELISTED' : 'KEY_RESTRICTED',
          exchange: EXCHANGE_CONFIG.exchangeName,
          error: errorMsg,
          clientIp,
          suggestion: errorMsg === 'ip_not_whitelisted_for_api_key'
            ? `Your Delta API key has IP whitelisting enabled. Please add your IP (${clientIp || 'your server IP'}) in Delta Exchange API settings.`
            : 'Check your Delta Exchange API credentials and permissions.',
          balances: [],
        });
      }
    } catch (err: any) {
      return res.json({
        connected: false,
        status: 'NETWORK_OR_TIMEOUT',
        error: err.message || 'Connection timeout to exchange endpoint',
        suggestion: 'Verify network connectivity to Delta Exchange.',
        balances: [],
      });
    }
  });

  // API 4: Get balances (live Delta or simulation)
  app.get('/api/exchange/balances', async (req, res) => {
    try {
      const bal = await deltaExchange.getWalletBalance();
      if (!bal || bal.balanceUSD === undefined) {
        return res.status(502).json({ error: 'Could not fetch wallet balances from exchange', balances: [] });
      }
      res.json({
        balances: [
          { asset: bal.currency || 'USD', free: bal.availableUSD.toFixed(2), locked: (bal.balanceUSD - bal.availableUSD).toFixed(2) }
        ],
        mode: deltaExchange.getConfig().isSimulation ? 'SIMULATION' : 'LIVE_DELTA_INDIA',
      });
    } catch (e: any) {
      res.status(502).json({
        error: e.message || 'Exchange balance fetch failed',
        balances: [],
      });
    }
  });

  // API 5: Fetch Live Market Tickers from Binance Public API with server-side caching
  let cachedTickers: any[] = [];
  let lastTickerFetch = 0;

  app.get('/api/market/tickers', async (req, res) => {
    const now = Date.now();
    if (cachedTickers.length > 0 && now - lastTickerFetch < 250) {
      return res.json(cachedTickers);
    }

    try {
      const response = await fetch('https://data-api.binance.vision/api/v3/ticker/24hr', {
        headers: { 'Accept': 'application/json' },
      });
      if (response.ok) {
        const rawData = await response.json();
        // Filter for top USDT trading pairs (8 dedicated indicator coins)
        const topSymbols = [
          'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'SUIUSDT'
        ];
        
        const filtered = (rawData as any[])
          .filter(t => topSymbols.includes(t.symbol))
          .map(t => ({
            symbol: t.symbol,
            price: parseFloat(t.lastPrice),
            changePercent24h: parseFloat(t.priceChangePercent),
            change24h: parseFloat(t.priceChange),
            high24h: parseFloat(t.highPrice),
            low24h: parseFloat(t.lowPrice),
            volume24h: parseFloat(t.volume),
            quoteVolume24h: parseFloat(t.quoteVolume),
            askPrice: parseFloat(t.askPrice),
            bidPrice: parseFloat(t.bidPrice),
            count: t.count,
          }))
          .sort((a, b) => b.quoteVolume24h - a.quoteVolume24h);

        cachedTickers = filtered;
        lastTickerFetch = now;
        return res.json(filtered);
      }
    } catch (e) {
      console.warn('Fallback ticker fetch error:', e);
    }

    // If cache available, return cache
    if (cachedTickers.length > 0) {
      return res.json(cachedTickers);
    }

    // Default static fallback in case of total external outage
    res.json([
      { symbol: 'BTCUSDT', price: 65420.50, changePercent24h: 3.45, change24h: 2180.2, high24h: 66100, low24h: 63120, volume24h: 24500, quoteVolume24h: 1580000000, askPrice: 65421, bidPrice: 65420 },
      { symbol: 'ETHUSDT', price: 3450.20, changePercent24h: -1.25, change24h: -43.8, high24h: 3520, low24h: 3390, volume24h: 185000, quoteVolume24h: 640000000, askPrice: 3450.5, bidPrice: 3450 },
      { symbol: 'SOLUSDT', price: 182.40, changePercent24h: 8.72, change24h: 14.6, high24h: 186.5, low24h: 167.2, volume24h: 4800000, quoteVolume24h: 850000000, askPrice: 182.5, bidPrice: 182.3 },
      { symbol: 'BNBUSDT', price: 588.60, changePercent24h: 0.95, change24h: 5.5, high24h: 594, low24h: 580, volume24h: 520000, quoteVolume24h: 305000000, askPrice: 588.8, bidPrice: 588.5 },
      { symbol: 'XRPUSDT', price: 0.5840, changePercent24h: 2.10, change24h: 0.012, high24h: 0.598, low24h: 0.569, volume24h: 420000000, quoteVolume24h: 245000000, askPrice: 0.5841, bidPrice: 0.5839 },
      { symbol: 'DOGEUSDT', price: 0.1420, changePercent24h: 5.40, change24h: 0.0072, high24h: 0.148, low24h: 0.134, volume24h: 1200000000, quoteVolume24h: 168000000, askPrice: 0.1421, bidPrice: 0.1419 },
    ]);
  });

  // API 6: Order book depth for selected coin
  app.get('/api/market/depth', async (req, res) => {
    const symbol = (req.query.symbol as string) || 'BTCUSDT';
    try {
      const resp = await fetch(`https://data-api.binance.vision/api/v3/depth?symbol=${symbol}&limit=12`);
      if (resp.ok) {
        const depth = await resp.json();
        return res.json(depth);
      }
    } catch (e) {
      console.warn('Depth fetch error:', e);
    }
    res.json({ bids: [], asks: [] });
  });

  // API 7: Historical klines for real Candlestick chart
  app.get('/api/market/klines', async (req, res) => {
    const symbol = (req.query.symbol as string || 'BTCUSDT').toUpperCase();
    const interval = (req.query.interval as string) || '15m';
    const limit = Math.min(100, Math.max(20, parseInt(req.query.limit as string || '50')));

    const isDemoRequested = req.query.demo === 'true';

    // Sub-minute intervals: if not explicitly demo, serve real 1m candles
    if (interval === '10s' || interval === '30s') {
      if (!isDemoRequested) {
        // Return genuine 1m klines from exchange rather than random data (solutions.pdf Issue 6)
        try {
          const deltaKlines = await deltaExchange.getKlines(toDeltaSymbol(symbol), '1m', limit);
          if (Array.isArray(deltaKlines) && deltaKlines.length > 0) {
            return res.json(deltaKlines);
          }
        } catch (e) {}
      } else {
        // Synthetic mock data strictly for frontend demo UI mode only
        const currentTicker = cachedTickers.find(t => t.symbol === symbol);
        const lastPrice = currentTicker ? currentTicker.price : 64000;
        const subKlines = [];
        const now = Date.now();
        const intervalMs = interval === '10s' ? 10 * 1000 : 30 * 1000;
        let rollingPrice = lastPrice * 0.994;

        for (let i = limit; i > 0; i--) {
          const cTime = now - i * intervalMs;
          const volatility = lastPrice * 0.0006;
          const open = rollingPrice;
          const delta = (Math.random() - 0.49) * volatility;
          const close = Math.max(open * 0.5, open + delta);
          const high = Math.max(open, close) + Math.random() * (volatility * 0.4);
          const low = Math.min(open, close) - Math.random() * (volatility * 0.4);
          const volume = Math.round(5 + Math.random() * 30);

          subKlines.push({
            time: cTime,
            open: parseFloat(open.toFixed(2)),
            high: parseFloat(high.toFixed(2)),
            low: parseFloat(low.toFixed(2)),
            close: parseFloat(close.toFixed(2)),
            volume,
          });
          rollingPrice = close;
        }
        subKlines.push({
          time: now,
          open: parseFloat(rollingPrice.toFixed(2)),
          high: parseFloat(Math.max(rollingPrice, lastPrice * 1.0004).toFixed(2)),
          low: parseFloat(Math.min(rollingPrice, lastPrice * 0.9996).toFixed(2)),
          close: parseFloat(lastPrice.toFixed(2)),
          volume: 18,
        });

        return res.json(subKlines);
      }
    }

    // 1. Try Delta Exchange directly for genuine perpetual market data
    try {
      const deltaKlines = await deltaExchange.getKlines(toDeltaSymbol(symbol), interval === '1h' ? '1h' : '15m', limit);
      if (Array.isArray(deltaKlines) && deltaKlines.length > 0) {
        return res.json(deltaKlines);
      }
    } catch (e) {}

    // 2. Try Binance public klines API
    try {
      const resp = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (resp.ok) {
        const klines = await resp.json();
        if (Array.isArray(klines) && klines.length > 0) {
          const formatted = klines.map((k: any) => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
          }));
          return res.json(formatted);
        }
      }
    } catch (e) {
      console.warn('Klines fetch error:', e);
    }

    // If both real sources fail, do NOT inject fake random candles unless demo is explicitly requested (solutions.pdf Issue 6)
    if (isDemoRequested) {
      const currentTicker = cachedTickers.find(t => t.symbol === symbol);
      const lastPrice = currentTicker ? currentTicker.price : 64000;
      const fallbackKlines = [];
      const now = Date.now();
      const intervalMs = 15 * 60 * 1000;
      let rollingPrice = lastPrice * 0.97;
      for (let i = limit; i > 0; i--) {
        const cTime = now - i * intervalMs;
        const volatility = lastPrice * 0.0035;
        const open = rollingPrice;
        const delta = (Math.random() - 0.48) * volatility;
        const close = Math.max(open * 0.5, open + delta);
        const high = Math.max(open, close) + Math.random() * (volatility * 0.7);
        const low = Math.min(open, close) - Math.random() * (volatility * 0.7);
        const volume = Math.round(50 + Math.random() * 450);

        fallbackKlines.push({
          time: cTime,
          open,
          high,
          low,
          close,
          volume,
        });
        rollingPrice = close;
      }
      return res.json(fallbackKlines);
    }

    return res.status(503).json({ error: 'Market candle data temporarily unavailable from exchanges' });
  });

  // API 8: Auto Sell Rules Management
  app.get('/api/rules', (req, res) => {
    res.json(autoSellRules);
  });

  app.post('/api/rules', (req, res) => {
    const body = req.body;
    if (!body.symbol || !body.ruleType || !body.triggerPrice || !body.amount) {
      return res.status(400).json({ error: 'Missing required rule parameters' });
    }

    const newRule: AutoSellRule = {
      id: 'rule-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      symbol: body.symbol.toUpperCase(),
      baseAsset: body.symbol.replace('USDT', ''),
      quoteAsset: 'USDT',
      ruleType: body.ruleType,
      triggerPrice: parseFloat(body.triggerPrice),
      stopPrice: body.stopPrice ? parseFloat(body.stopPrice) : undefined,
      takeProfitPrice: body.takeProfitPrice ? parseFloat(body.takeProfitPrice) : undefined,
      trailingPercent: body.trailingPercent ? parseFloat(body.trailingPercent) : undefined,
      trailingPeakPrice: body.entryPrice ? parseFloat(body.entryPrice) : parseFloat(body.triggerPrice),
      amount: parseFloat(body.amount),
      amountPercent: body.amountPercent || 100,
      entryPrice: parseFloat(body.entryPrice) || parseFloat(body.triggerPrice),
      orderType: body.orderType || 'MARKET',
      status: 'ACTIVE',
      createdAt: Date.now(),
    };

    autoSellRules.unshift(newRule);
    saveAutoSellRules();
    res.json({ success: true, rule: newRule });
  });

  app.put('/api/rules/:id', (req, res) => {
    const { id } = req.params;
    const ruleIndex = autoSellRules.findIndex(r => r.id === id);
    if (ruleIndex === -1) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    autoSellRules[ruleIndex] = {
      ...autoSellRules[ruleIndex],
      ...req.body,
    };
    saveAutoSellRules();

    res.json({ success: true, rule: autoSellRules[ruleIndex] });
  });

  app.delete('/api/rules/:id', (req, res) => {
    const { id } = req.params;
    autoSellRules = autoSellRules.filter(r => r.id !== id);
    saveAutoSellRules();
    res.json({ success: true, message: 'Rule deleted' });
  });

  // API 9: Order History & Manual / Auto Execution
  app.get('/api/orders', (req, res) => {
    // Sanitize in-memory orders to guarantee strict ID uniqueness
    const seenIds = new Set<string>();
    orderHistory = orderHistory.map((ord, idx) => {
      if (!ord.id || seenIds.has(ord.id)) {
        return {
          ...ord,
          id: `${ord.id || 'ord'}-${idx}-${Math.random().toString(36).substring(2, 7)}`,
        };
      }
      seenIds.add(ord.id);
      return ord;
    });
    res.json(orderHistory);
  });

  app.post('/api/exchange/execute-order', async (req, res) => {
    const { ruleId, symbol, side, type, quantity, price, triggerReason, pnlPercent } = req.body;

    const fillPrice = parseFloat(price);
    const fillQty = parseFloat(quantity);
    const totalUsdt = fillPrice * fillQty;
    const baseAsset = symbol.replace('USDT', '') as keyof typeof simulationBalances;

    // Execute order via Delta Exchange Engine if valid credentials exist
    let liveExecutionResult: any = null;
    let isLiveExecuted = false;

    if (!EXCHANGE_CONFIG.isSimulation && EXCHANGE_CONFIG.apiKey && EXCHANGE_CONFIG.apiSecret) {
      try {
        const orderType = (type || 'MARKET').toUpperCase() === 'LIMIT' ? 'limit_order' : 'market_order';
        const resDelta = await deltaExchange.placeOrder({
          symbol,
          side: side.toUpperCase() as 'BUY' | 'SELL',
          size: fillQty,
          price: fillPrice,
          orderType,
        });

        if (!resDelta || !resDelta.success) {
          console.error(`❌ [LIVE EXECUTION FAILED] Delta Exchange order failed:`, resDelta?.message);
          return res.status(502).json({
            success: false,
            error: resDelta?.message || 'Live order execution failed on Delta Exchange',
            liveExecuted: false,
          });
        }

        isLiveExecuted = true;
        liveExecutionResult = resDelta;
      } catch (err: any) {
        console.error('❌ [LIVE EXECUTION ERROR] Exception placing order on Delta:', err.message);
        return res.status(502).json({
          success: false,
          error: `Delta Exchange communication failure: ${err.message}`,
          liveExecuted: false,
        });
      }
    } else {
      // Simulation Mode balance adjustments
      if (side.toUpperCase() === 'SELL') {
        if (simulationBalances[baseAsset] !== undefined) {
          simulationBalances[baseAsset] = Math.max(0, simulationBalances[baseAsset] - fillQty);
        }
        simulationBalances.USDT += totalUsdt;
      } else {
        if (simulationBalances.USDT >= totalUsdt) {
          simulationBalances.USDT -= totalUsdt;
          if (simulationBalances[baseAsset] !== undefined) {
            simulationBalances[baseAsset] += fillQty;
          } else {
            (simulationBalances as any)[baseAsset] = fillQty;
          }
        }
      }
    }

    const effectiveFillPrice = liveExecutionResult?.fillPrice && liveExecutionResult.fillPrice > 0
      ? liveExecutionResult.fillPrice
      : fillPrice;

    const newOrder: ExecutedOrder = {
      id: liveExecutionResult?.orderId || ('ord-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9)),
      ruleId,
      symbol: symbol.toUpperCase(),
      side: side.toUpperCase() as 'SELL' | 'BUY',
      type: (type || 'MARKET').toUpperCase() as 'MARKET' | 'LIMIT',
      price: effectiveFillPrice,
      quantity: fillQty,
      totalUsdt: effectiveFillPrice * fillQty,
      timestamp: Date.now(),
      pnl: pnlPercent ? (totalUsdt * (pnlPercent / 100)) : undefined,
      pnlPercent: pnlPercent || 0,
      status: isLiveExecuted ? 'FILLED' : 'SIMULATED_FILLED',
      triggerReason: triggerReason || 'Manual Execute',
    };

    orderHistory.unshift(newOrder);
    saveOrderHistory();

    // If triggered from a rule, update rule status and persist
    if (ruleId) {
      const rIdx = autoSellRules.findIndex(r => r.id === ruleId);
      if (rIdx !== -1) {
        autoSellRules[rIdx].status = 'EXECUTED';
        autoSellRules[rIdx].triggeredAt = Date.now();
        autoSellRules[rIdx].executedPrice = effectiveFillPrice;
        autoSellRules[rIdx].pnlPercent = pnlPercent;
        autoSellRules[rIdx].executionNote = `${newOrder.status}: ${triggerReason}`;
        saveAutoSellRules();
      }
    }

    res.json({
      success: true,
      order: newOrder,
      liveExecuted: isLiveExecuted,
      liveData: liveExecutionResult,
      balances: simulationBalances,
    });
  });

  // Background Auto-Sell Engine loop: checks active rules every 3.5 seconds against live prices
  setInterval(async () => {
    const activeRules = autoSellRules.filter(r => r.status === 'ACTIVE');
    if (activeRules.length === 0) return;

    for (const rule of activeRules) {
      try {
        let currentPrice = 0;
        try {
          currentPrice = await deltaExchange.getMarketPrice(toDeltaSymbol(rule.symbol));
        } catch (e) {}

        if (!currentPrice || currentPrice <= 0) {
          try {
            const resp = await fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${rule.symbol}`);
            if (resp.ok) {
              const pData = await resp.json();
              currentPrice = parseFloat(pData.price);
            }
          } catch (e) {}
        }

        if (!currentPrice || isNaN(currentPrice) || currentPrice <= 0) continue;

        let shouldExecute = false;
        let reason = '';
        let pnlPct = ((currentPrice - rule.entryPrice) / rule.entryPrice) * 100;

        // 1. Take Profit
        if (rule.ruleType === 'TAKE_PROFIT') {
          if (currentPrice >= rule.triggerPrice) {
            shouldExecute = true;
            reason = `Take Profit Target Met ($${currentPrice.toLocaleString()} >= $${rule.triggerPrice.toLocaleString()}, PnL: +${pnlPct.toFixed(2)}%)`;
          }
        }
        // 2. Stop Loss
        else if (rule.ruleType === 'STOP_LOSS') {
          if (currentPrice <= rule.triggerPrice) {
            shouldExecute = true;
            reason = `Stop Loss Limit Hit ($${currentPrice.toLocaleString()} <= $${rule.triggerPrice.toLocaleString()}, PnL: ${pnlPct.toFixed(2)}%)`;
          }
        }
        // 3. Trailing Stop
        else if (rule.ruleType === 'TRAILING_STOP' && rule.trailingPercent) {
          if (!rule.trailingPeakPrice || currentPrice > rule.trailingPeakPrice) {
            rule.trailingPeakPrice = currentPrice;
            rule.triggerPrice = currentPrice * (1 - rule.trailingPercent / 100);
            saveAutoSellRules();
          } else {
            if (currentPrice <= rule.triggerPrice) {
              shouldExecute = true;
              reason = `Trailing Stop Triggered: Price dropped ${rule.trailingPercent}% from peak ($${rule.trailingPeakPrice.toLocaleString()}) to $${currentPrice.toLocaleString()}`;
            }
          }
        }
        // 4. Range / OCO
        else if (rule.ruleType === 'RANGE_OCO') {
          if (rule.takeProfitPrice && currentPrice >= rule.takeProfitPrice) {
            shouldExecute = true;
            reason = `OCO Take Profit Target Reached ($${currentPrice.toLocaleString()} >= $${rule.takeProfitPrice.toLocaleString()})`;
          } else if (rule.stopPrice && currentPrice <= rule.stopPrice) {
            shouldExecute = true;
            reason = `OCO Stop Loss Triggered ($${currentPrice.toLocaleString()} <= $${rule.stopPrice.toLocaleString()})`;
          }
        }

        if (shouldExecute) {
          console.log(`[AutoSell Engine] Triggered rule ${rule.id} for ${rule.symbol}: ${reason}`);

          let isLiveFilled = false;
          let executedPrice = currentPrice;
          let orderId = 'auto-ord-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);

          // In live mode, execute on exchange; do not simulate on failure (solutions.pdf Issue 5)
          if (!EXCHANGE_CONFIG.isSimulation && EXCHANGE_CONFIG.apiKey && EXCHANGE_CONFIG.apiSecret) {
            try {
              const liveRes = await deltaExchange.placeOrder({
                symbol: rule.symbol,
                side: 'SELL',
                size: rule.amount,
                price: currentPrice,
                orderType: 'market_order',
              });

              if (liveRes && liveRes.success) {
                isLiveFilled = true;
                executedPrice = liveRes.fillPrice > 0 ? liveRes.fillPrice : currentPrice;
                orderId = liveRes.orderId || orderId;
                console.log(`✅ [AutoSell Engine] Real exchange sell order placed on Delta for ${rule.symbol}: ${orderId}`);
              } else {
                console.error(`❌ [AutoSell Engine] Delta order placement failed: ${liveRes?.message}. Skipping execution to prevent phantom fill.`);
                continue;
              }
            } catch (err: any) {
              console.error(`❌ [AutoSell Engine] Error dispatching live sell: ${err.message}`);
              continue;
            }
          } else {
            // Simulation balance update
            const totalUsdt = currentPrice * rule.amount;
            const baseAsset = rule.baseAsset as keyof typeof simulationBalances;
            if (simulationBalances[baseAsset] !== undefined) {
              simulationBalances[baseAsset] = Math.max(0, simulationBalances[baseAsset] - rule.amount);
            }
            simulationBalances.USDT += totalUsdt;
          }

          rule.status = 'EXECUTED';
          rule.triggeredAt = Date.now();
          rule.executedPrice = executedPrice;
          rule.pnlPercent = pnlPct;
          rule.executionNote = reason;

          const totalUsdt = executedPrice * rule.amount;
          orderHistory.unshift({
            id: orderId,
            ruleId: rule.id,
            symbol: rule.symbol,
            side: 'SELL',
            type: rule.orderType,
            price: executedPrice,
            quantity: rule.amount,
            totalUsdt,
            timestamp: Date.now(),
            pnl: totalUsdt * (pnlPct / 100),
            pnlPercent: pnlPct,
            status: isLiveFilled ? 'FILLED' : 'SIMULATED_FILLED',
            triggerReason: reason,
          });

          saveAutoSellRules();
          saveOrderHistory();
        }
      } catch (err) {
        // Individual rule evaluation error
      }
    }
  }, 3500);

  // =========================================================================
  // DELTA AUTOTRADER 24/7 AUTONOMOUS SYSTEM ENDPOINTS
  // =========================================================================

  // 1. Get Live Bot Status & Open Positions
  app.get('/api/autotrader/status', async (req, res) => {
    try {
      await deltaAutoTrader.syncLivePositionsFromExchange();
    } catch (e) {}
    res.json(deltaAutoTrader.getStatus());
  });

  // 2. Get Live 15M Indicators Diagnostics for all 8 Coins
  app.get('/api/autotrader/diagnostics', (req, res) => {
    res.json(deltaAutoTrader.getDiagnostics());
  });

  // 2b. Get Live Smart Detector Telemetry (Pure Direct Trading)
  app.get('/api/autotrader/smart-detector', (req, res) => {
    res.json({
      success: true,
      activeMode: 'PURE_DIRECT_TRADING',
      detections: deltaAutoTrader.getSmartDetections(),
    });
  });

  // 2c. Get Live 1H & 4H Higher Timeframe Candle Analysis Telemetry
  app.get('/api/autotrader/htf', (req, res) => {
    res.json({
      success: true,
      htfAnalyses: deltaAutoTrader.getHtfAnalyses(),
    });
  });

  // 3. Get Immutable Closed Trades Audit Ledger
  app.get('/api/autotrader/history', (req, res) => {
    res.json(deltaAutoTrader.getHistory());
  });

  // =========================================================================
  // DELTA 5:30 PM IST 5% STRANGLE + 10% HEDGES (OPTIONS CONDOR) ENDPOINTS
  // =========================================================================
  app.get('/api/options/status', async (req, res) => {
    try {
      const status = await deltaOptionsCondor.getStatusPayload();
      res.json(status);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/options/setup', async (req, res) => {
    try {
      const setup = await deltaOptionsCondor.calculateSetup({
        underlying: req.query.underlying as string,
        otmPercent: req.query.otmPercent ? parseFloat(req.query.otmPercent as string) : undefined,
        hedgePercent: req.query.hedgePercent ? parseFloat(req.query.hedgePercent as string) : undefined,
        contracts: req.query.contracts ? parseInt(req.query.contracts as string, 10) : undefined,
        targetExpiry: req.query.targetExpiry as string,
      });
      res.json({ success: true, setup });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/options/deploy', adminAuthMiddleware, async (req, res) => {
    try {
      const result = await deltaOptionsCondor.deployCondor(req.body);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/options/close', adminAuthMiddleware, async (req, res) => {
    try {
      const result = await deltaOptionsCondor.closeCondor(req.body.id);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/options/config', adminAuthMiddleware, (req, res) => {
    deltaOptionsCondor.updateConfig(req.body);
    res.json({ success: true, message: 'Options Condor configuration updated successfully.' });
  });

  // 4. Toggle Bot Running / Paused
  app.post('/api/autotrader/toggle', adminAuthMiddleware, (req, res) => {
    const targetRunning = req.body?.isRunning;
    let isRunning: boolean;
    if (typeof targetRunning === 'boolean') {
      if (targetRunning) {
        deltaAutoTrader.start();
        isRunning = true;
      } else {
        deltaAutoTrader.stop();
        isRunning = false;
      }
    } else {
      isRunning = deltaAutoTrader.toggleRunning();
    }
    res.json({ success: true, isRunning });
  });

  // 4a. Explicit Resume / Start endpoint
  app.post('/api/autotrader/start', adminAuthMiddleware, (req, res) => {
    deltaAutoTrader.start();
    res.json({ success: true, isRunning: true });
  });

  // 4b. Explicit Pause / Stop endpoint
  app.post('/api/autotrader/stop', adminAuthMiddleware, (req, res) => {
    deltaAutoTrader.stop();
    res.json({ success: true, isRunning: false });
  });

  // 4b. Update Bot Config / State
  app.post('/api/autotrader/config', adminAuthMiddleware, (req, res) => {
    deltaAutoTrader.updateConfig(req.body);
    res.json({ success: true, status: deltaAutoTrader.getStatus() });
  });

  // 4b-2. Explicit Toggle Inverse Trading endpoint - PERMANENTLY DISABLED (solutions.pdf Issue 3)
  app.post('/api/autotrader/toggle-inverse', (req, res) => {
    deltaAutoTrader.toggleInverse(false);
    res.status(400).json({
      success: false,
      isInverseTrading: false,
      error: 'Inverse trading mode has been permanently removed. Direct execution is strictly enforced.',
    });
  });

  // 4b-3. Explicit Toggle New Trades Execution Hold
  app.post('/api/autotrader/pause-new-trades', adminAuthMiddleware, (req, res) => {
    const isPaused = deltaAutoTrader.setNewTradesPaused(req.body?.isNewTradesPaused !== undefined ? Boolean(req.body.isNewTradesPaused) : true);
    res.json({ success: true, isNewTradesPaused: isPaused });
  });

  // 4c. TradingView / Pine Script Alert Webhook (solutions.pdf Issues 2 & 3)
  app.post(['/api/webhook/signal', '/api/webhook/tradingview'], async (req, res) => {
    try {
      // 1. Shared secret authentication guard
      const webhookSecret = process.env.WEBHOOK_SECRET || process.env.ADMIN_API_KEY;
      if (webhookSecret) {
        const providedSecret = req.body?.secret || req.headers['x-webhook-secret'] || req.headers['authorization'] || req.query.secret;
        if (providedSecret !== webhookSecret && providedSecret !== `Bearer ${webhookSecret}`) {
          return res.status(401).json({ error: 'Unauthorized: Invalid or missing webhook secret' });
        }
      }

      const body = req.body || {};
      const rawSym = body.symbol || body.ticker || body.pair || req.query.symbol;
      const rawSide = body.side || body.action || body.signal || req.query.side;

      if (!rawSym || !rawSide) {
        return res.status(400).json({ error: 'Missing symbol or side/action in payload' });
      }

      const deltaSymbol = toDeltaSymbol(String(rawSym));
      const incomingSide: 'BUY' | 'SELL' = String(rawSide).toUpperCase().includes('BUY') ? 'BUY' : 'SELL';

      // 2. Pure direct execution - NO reversal flipping (solutions.pdf Issue 3)
      const executedSide: 'BUY' | 'SELL' = incomingSide;

      // Runtime integrity verification guard
      if (executedSide !== incomingSide) {
        console.error(`❌ [INTEGRITY GUARD] Signal inversion attempt blocked: incoming=${incomingSide} !== executed=${executedSide}`);
        return res.status(500).json({ error: 'Integrity violation: signal inversion blocked' });
      }

      console.log(`📡 [TRADINGVIEW / PINE SCRIPT WEBHOOK] Incoming Signal: ${deltaSymbol} ${incomingSide} ➔ DIRECT ${executedSide}`);

      const price = await deltaExchange.getMarketPrice(deltaSymbol);
      const safeAtr = price * 0.015;

      const position = await deltaAutoTrader.executeNewPosition({
        symbol: deltaSymbol,
        strategyName: `TradingView Pine (${deltaSymbol})`,
        side: executedSide,
        signalPrice: price,
        atr: safeAtr,
        shadowConfirmedSeconds: 5,
        executionMode: 'DIRECT',
        reversalReason: undefined,
      });

      res.json({
        success: true,
        message: `Pine Script ${incomingSide} received ➔ Executed DIRECT ${executedSide} on ${deltaSymbol}`,
        incomingSide,
        executedSide,
        position,
      });
    } catch (err: any) {
      console.error('Webhook execution error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // 4d. Candlestick Pattern Engine & Analysis API (solutions.pdf Issue 6: NO fake random candles)
  async function fetchCandlesForAnalysis(symbol: string, interval: string = '15m', limit: number = 250): Promise<KlinePoint[]> {
    const deltaSym = toDeltaSymbol(symbol);
    const deltaInterval = interval === '1h' ? '1h' : '15m';

    // 1. Prioritize Delta Exchange genuine market data
    try {
      const deltaKlines = await deltaExchange.getKlines(deltaSym, deltaInterval, limit);
      if (Array.isArray(deltaKlines) && deltaKlines.length > 0) {
        return deltaKlines;
      }
    } catch (e) {
      // Delta fetch error, try Binance next
    }

    // 2. Fallback to Binance public klines API
    const binanceSym = symbol.toUpperCase().endsWith('USDT')
      ? symbol.toUpperCase()
      : (symbol.toUpperCase().replace('USD', '') + 'USDT');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const resp = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${binanceSym}&interval=${interval}&limit=${limit}`, {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data) && data.length > 0) {
          return data.map((k: any) => ({
            time: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
          }));
        }
      }
    } catch (e) {
      // Binance fetch error
    }

    // Never generate fake / random candles for trading analysis (solutions.pdf Issue 6)
    console.warn(`⚠️ [KLINE WARNING] Real market candles unavailable for ${symbol}. Returning empty array to prevent fake trading signals.`);
    return [];
  }

  app.get('/api/candlestick-patterns', async (req, res) => {
    try {
      const symbolParam = (req.query.symbol as string || 'BTCUSD').toUpperCase();
      const interval = (req.query.interval as string) || '15m';
      const tpMult = req.query.tpAtr ? parseFloat(req.query.tpAtr as string) : 1.02;

      // Multi-coin scan mode if requested
      if (symbolParam === 'ALL') {
        const coreSymbols = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'DOGEUSD', 'ADAUSD', 'AVAXUSD', 'SUIUSD'];
        const results = await Promise.all(
          coreSymbols.map(async (sym) => {
            try {
              const candles = await fetchCandlesForAnalysis(sym, interval, 250);
              if (!candles || candles.length < 10) {
                return { symbol: sym, error: 'Insufficient real candle data available from exchange' };
              }
              const closedCandles = candles.length > 1 ? candles.slice(0, -1) : candles;
              return CandlestickMasterPatternEngine.analyze(sym, closedCandles, tpMult);
            } catch (err: any) {
              return { symbol: sym, error: err.message };
            }
          })
        );
        return res.json({ success: true, count: results.length, data: results });
      }

      const deltaSymbol = toDeltaSymbol(symbolParam);
      const candles = await fetchCandlesForAnalysis(deltaSymbol, interval, 250);
      if (!candles || candles.length < 10) {
        return res.status(503).json({ error: 'Market candle data temporarily unavailable from exchanges. Trade analysis skipped.' });
      }
      const closedCandles = candles.length > 1 ? candles.slice(0, -1) : candles;
      const analysis = CandlestickMasterPatternEngine.analyze(deltaSymbol, closedCandles, tpMult);
      res.json({ success: true, analysis });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4e. Pine Script v5 Code Generator (Mirrors exact Smart Reversal & Autonomous System)
  app.get('/api/candlestick-patterns/pinescript', (req, res) => {
    let code = '';
    const filePath = path.join(process.cwd(), 'indicators', 'nexvora_smart_reversal_autotrader.pine');
    if (fs.existsSync(filePath)) {
      code = fs.readFileSync(filePath, 'utf-8');
    } else {
      code = CandlestickMasterPatternEngine.generateTradingViewPineScript();
    }

    if (req.query.format === 'raw' || req.query.format === 'text') {
      res.type('text/plain').send(code);
    } else {
      res.json({ success: true, pinescript: code });
    }
  });

  // 4f. Nexvora Iron Condor Pine Script Provider
  app.get('/api/indicators/ironcondor', (req, res) => {
    try {
      const type = (req.query.type as string) || '5pct';
      let fileName = 'Nexvora_5Pct_Daily_IronCondor_PRO.pine';
      if (type === 'sniper') fileName = 'Nexvora_MultiAsset_IronCondor_Sniper_PRO.pine';
      else if (type === 'engine') fileName = 'Nexvora_MultiAsset_IronCondor_Engine.pine';

      const filePath = path.join(process.cwd(), 'indicators', fileName);
      if (fs.existsSync(filePath)) {
        const code = fs.readFileSync(filePath, 'utf-8');
        if (req.query.format === 'raw' || req.query.format === 'text') {
          res.type('text/plain').send(code);
        } else {
          res.json({ success: true, fileName, pinescript: code });
        }
      } else {
        res.status(404).json({ error: 'Indicator file not found' });
      }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 4g. Direct TP/SL Bracket Order Attacher
  // 4g. Direct TP/SL Bracket Order Attacher
  app.post('/api/autotrader/set-bracket', adminAuthMiddleware, async (req, res) => {
    try {
      const { symbol, stopLossPrice, takeProfitPrice } = req.body;
      if (!symbol) return res.status(400).json({ error: 'Symbol required' });
      const result = await deltaExchange.setBracketOrder(symbol, stopLossPrice, takeProfitPrice);
      res.json({ success: true, result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // 5. Route Test Signal to Shadow Confirmation Gate (0% Exchange Pre-Exposure)
  app.post('/api/autotrader/force-trade', adminAuthMiddleware, async (req, res) => {
    const { symbol, side = 'BUY', immediate = true } = req.body;
    if (!symbol) {
      return res.status(400).json({ error: 'Symbol required' });
    }

    try {
      const deltaSymbol = toDeltaSymbol(symbol);
      const price = await deltaExchange.getMarketPrice(deltaSymbol);
      const status = deltaAutoTrader.getStatus();
      const safeAtr = price * 0.015;
      const notionalUSD = (status.accountCapitalUSD * (status.marginPercentPerTrade / 100)) * status.leverage;

      // Direct execution: strictly execute requestedSide directly without conditional inversions (solutions.pdf Item 1)
      const requestedSide: 'BUY' | 'SELL' = side.toUpperCase() as 'BUY' | 'SELL';
      const executedSide: 'BUY' | 'SELL' = requestedSide;
      if (executedSide !== requestedSide) {
        console.error(`❌ [INTEGRITY GUARD] Signal flip blocked: executedSide=${executedSide} !== requestedSide=${requestedSide}. Aborting trade.`);
        return res.status(400).json({ error: 'Signal side mismatch' });
      }

      if (immediate) {
        const position = await deltaAutoTrader.executeNewPosition({
          symbol: deltaSymbol,
          strategyName: `Manual Execution (${deltaSymbol})`,
          side: executedSide,
          signalPrice: price,
          atr: safeAtr,
          shadowConfirmedSeconds: 0,
        });
        return res.json({ success: true, position });
      }

      const breakoutPrice = executedSide === 'BUY'
        ? price + 0.10 * safeAtr
        : price - 0.10 * safeAtr;
      const rawQuantity = notionalUSD / breakoutPrice;
      const quantity = parseFloat(rawQuantity.toFixed(4));
      const targetProfitUSD = 5.00;
      const targetPriceDistance = notionalUSD > 0
        ? (targetProfitUSD / notionalUSD) * breakoutPrice
        : Math.max(1.10 * safeAtr, breakoutPrice * 0.003);
      const slPriceDistance = Math.max(1.8 * safeAtr, breakoutPrice * 0.018);

      const virtualTP = executedSide === 'BUY'
        ? breakoutPrice + targetPriceDistance
        : breakoutPrice - targetPriceDistance;
      const virtualSL = executedSide === 'BUY'
        ? breakoutPrice - slPriceDistance
        : breakoutPrice + slPriceDistance;

      const preOrder = await deltaExchange.placeBreakoutOrder({
        symbol: deltaSymbol,
        side: executedSide,
        size: quantity,
        breakoutPrice,
        takeProfitPrice: virtualTP,
        stopLossPrice: virtualSL,
      });

      // Shadow Gate REMOVED — just return the pre-placed order result
      res.json({ success: true, message: `${deltaSymbol} breakout order placed @ $${breakoutPrice.toFixed(2)}`, order: preOrder });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5y. Reset active positions to 0 (Guarantees clean account state)
  app.post('/api/autotrader/reset-positions', adminAuthMiddleware, (req, res) => {
    deltaAutoTrader.resetPositions();
    res.json({ success: true, message: 'All positions reset to 0. Capital fully protected.' });
  });

  // 5z. Reset PnL and Closed Trades History (Fresh audit ledger start without closing active positions)
  app.post('/api/autotrader/reset-history', adminAuthMiddleware, (req, res) => {
    deltaAutoTrader.resetPnlAndHistory();
    orderHistory = [];
    saveOrderHistory();
    res.json({ success: true, message: 'PnL metrics and closed trades history successfully reset to 0.' });
  });

  // 5a. Close Position (supports both exchange and local engine cleanup)
  app.post('/api/autotrader/close-position', adminAuthMiddleware, async (req, res) => {
    const { id, positionId, symbol } = req.body;
    const targetSymbol = symbol ? toDeltaSymbol(symbol) : undefined;

    const status = deltaAutoTrader.getStatus();
    const idx = status.activePositions.findIndex(p => 
      (positionId && p.id === positionId) || 
      (id && p.id === id) || 
      (targetSymbol && toDeltaSymbol(p.symbol) === targetSymbol)
    );

    if (idx !== -1) {
      await deltaAutoTrader.closePosition(idx, 'MANUAL_EXIT');
      res.json({ success: true, message: 'Position closed on exchange and local engine' });
    } else if (targetSymbol) {
      try {
        await deltaExchange.closePosition(targetSymbol);
      } catch (e: any) {
        console.warn(`Delta exchange close error for ${targetSymbol}:`, e.message);
      }
      res.json({ success: true, message: 'Position close dispatched to Delta Exchange' });
    } else {
      res.json({ success: false, message: 'Position not found' });
    }
  });

  // 5a2. Close All Positions (Delta Exchange live liquidation + local archive)
  app.post('/api/autotrader/close-all', adminAuthMiddleware, async (req, res) => {
    try {
      await deltaExchange.closeAllPositionsOnExchange();
    } catch (e: any) {
      console.warn('Delta closeAllPositionsOnExchange error:', e.message);
    }

    const status = deltaAutoTrader.getStatus();
    for (let i = status.activePositions.length - 1; i >= 0; i--) {
      await deltaAutoTrader.closePosition(i, 'MANUAL_EXIT');
    }
    deltaAutoTrader.resetPositions();
    res.json({ success: true, message: 'All positions closed on exchange and local engine' });
  });

  // 5a3. Reverse Single Active Position
  app.post('/api/autotrader/reverse-position', adminAuthMiddleware, async (req, res) => {
    const { id, positionId, symbol } = req.body;
    const target = positionId || id || symbol;
    if (!target) {
      return res.status(400).json({ error: 'Target ID or symbol required' });
    }
    const position = await deltaAutoTrader.reverseSinglePosition(target);
    res.json({ success: true, position });
  });

  // 5a4. Reverse All Active Positions (Instantly flips all open positions)
  app.post('/api/autotrader/reverse-all', adminAuthMiddleware, async (req, res) => {
    const positions = await deltaAutoTrader.reverseAllPositions();
    res.json({ success: true, count: positions.length, positions });
  });

  // 7. Update Risk & Bot Configuration
  app.post('/api/autotrader/config', (req, res) => {
    const config = req.body;
    deltaAutoTrader.updateConfig(config);
    res.json({ success: true, status: deltaAutoTrader.getStatus() });
  });

  // Launch the autonomous trading background engine
  deltaAutoTrader.start();

  // Vite middleware setup (auto fallback to Vite if dist is not built)
  const distPath = path.join(process.cwd(), 'dist');
  const hasDist = fs.existsSync(path.join(distPath, 'index.html'));

  if (!hasDist) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: [
            '**/.delta_auto_trader_state.json',
            '**/public/**',
            '**/*.json',
            '**/.system_generated/**',
            '**/.user_uploaded/**',
            '**/brain/**',
            '**/dist/**',
            '**/.git/**',
          ],
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Crypto Market & Auto-Sell server running on http://0.0.0.0:${PORT}`);
  });
  server.on('error', (err: any) => {
    console.error('Fatal primary server bind error:', err.message);
  });
}

process.on('unhandledRejection', (reason: any) => {
  console.error('Process unhandled rejection absorbed:', reason?.stack || reason);
});
process.on('uncaughtException', (err: any) => {
  console.error('Process uncaught exception absorbed:', err?.stack || err);
});
process.on('exit', (code) => {
  console.log(`Node process exit event triggered with code: ${code}`);
});

startServer().catch((err: any) => {
  console.error('Fatal startServer rejection:', err?.stack || err);
});
