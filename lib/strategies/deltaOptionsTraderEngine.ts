import { deltaExchange } from '../deltaExchangeEngine';
import { KlinePoint, DeltaPosition } from '../../src/types';

export interface OptionCandidate {
  symbol: string;
  underlying: 'BTC' | 'ETH';
  optionType: 'CALL' | 'PUT';
  strike: number;
  expiry: string;
  markPrice: number;
  delta: number;
  side: 'SELL'; // Strictly OPTION WRITING / SELLING to harvest Theta decay per Marwadi Trader
  targetProfitUSD: number;
  stopLossUSD: number;
  confidenceScore: number;
  reason: string;
  contractValue: number;
}

export class DeltaOptionsTraderEngine {
  private static instance: DeltaOptionsTraderEngine;
  private cachedTickers: Map<string, { data: any[]; timestamp: number }> = new Map();

  public static getInstance(): DeltaOptionsTraderEngine {
    if (!DeltaOptionsTraderEngine.instance) {
      DeltaOptionsTraderEngine.instance = new DeltaOptionsTraderEngine();
    }
    return DeltaOptionsTraderEngine.instance;
  }

  /**
   * Fetches real-time option chain tickers for BTC or ETH from Delta Exchange India
   */
  public async fetchOptionsTickers(underlying: 'BTC' | 'ETH'): Promise<any[]> {
    const cached = this.cachedTickers.get(underlying);
    const now = Date.now();
    if (cached && now - cached.timestamp < 3000) {
      return cached.data;
    }

    const config = deltaExchange.getConfig();
    const url = `${config.baseUrl}/v2/tickers?contract_types=call_options,put_options&underlying_asset_symbols=${underlying}`;

    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': 'DeltaOptionsTrader/2.0',
          'Accept': 'application/json',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (resp.ok) {
        const json = await resp.json();
        if (json.result && Array.isArray(json.result)) {
          this.cachedTickers.set(underlying, { data: json.result, timestamp: now });
          return json.result;
        }
      }
    } catch (e: any) {
      console.warn(`[OPTIONS TICKER ERROR] Failed to fetch ${underlying} options:`, e.message);
    }
    return cached?.data || [];
  }

  /**
   * Marwadi Trader Delta Options Strategy:
   * Strictly SELLS (WRITES) Out-of-the-Money (OTM) options to capture 5:30 PM IST daily Theta decay.
   * - Bullish Bias -> SELL OTM PUT (strike below spot, delta -0.10 to -0.25)
   * - Bearish Bias -> SELL OTM CALL (strike above spot, delta +0.10 to +0.25)
   */
  public async selectBestOption(
    underlying: 'BTC' | 'ETH',
    marketTrend: 'BUY' | 'SELL' | 'NEUTRAL',
    score: number,
    momentumReason: string
  ): Promise<OptionCandidate | null> {
    const tickers = await this.fetchOptionsTickers(underlying);
    if (!tickers || tickers.length === 0) return null;

    const spotPrice = parseFloat(tickers[0]?.greeks?.spot || (underlying === 'BTC' ? '82000' : '2400'));
    const contractValue = underlying === 'BTC' ? 0.001 : 0.01;

    // Group tickers by expiry date string (from symbol e.g. C-BTC-81800-261026)
    const byExpiry: Record<string, any[]> = {};
    for (const t of tickers) {
      const parts = (t.symbol || '').split('-');
      if (parts.length >= 4) {
        const exp = parts[3];
        if (!byExpiry[exp]) byExpiry[exp] = [];
        byExpiry[exp].push(t);
      }
    }

    const sortedExpiries = Object.keys(byExpiry).sort((a, b) => {
      const d1 = new Date(2000 + parseInt(a.slice(4, 6)), parseInt(a.slice(2, 4)) - 1, parseInt(a.slice(0, 2)));
      const d2 = new Date(2000 + parseInt(b.slice(4, 6)), parseInt(b.slice(2, 4)) - 1, parseInt(b.slice(0, 2)));
      return d1.getTime() - d2.getTime();
    });

    const now = Date.now();
    const nearestExp = sortedExpiries.find(exp => {
      const d = new Date(2000 + parseInt(exp.slice(4, 6)), parseInt(exp.slice(2, 4)) - 1, parseInt(exp.slice(0, 2)), 17, 30);
      return d.getTime() > now + 3600000; // at least 1 hour before expiry
    }) || sortedExpiries[0];

    if (!nearestExp) return null;
    const expTickers = byExpiry[nearestExp] || [];

    // Marwadi Trader Rule:
    // When Bullish: SELL OTM PUT (put_options with strike < spot)
    // When Bearish: SELL OTM CALL (call_options with strike > spot)
    // When Neutral: Default to selling whichever OTM side is safer with solid premium
    const writePut = marketTrend === 'BUY' || marketTrend === 'NEUTRAL';
    const targetContractType = writePut ? 'put_options' : 'call_options';

    const eligible = expTickers.filter(t => {
      if (t.contract_type !== targetContractType) return false;
      const strike = parseFloat(t.strike_price);
      const mark = parseFloat(t.mark_price || '0');
      if (isNaN(strike) || isNaN(mark) || mark <= 1.0) return false;

      // Ensure strike is truly Out-of-the-Money (OTM)
      if (writePut) {
        return strike < spotPrice * 0.985; // Put strike at least 1.5% below spot
      } else {
        return strike > spotPrice * 1.015; // Call strike at least 1.5% above spot
      }
    });

    if (eligible.length === 0) return null;

    // Pick optimal OTM strike: Delta magnitude between 0.10 and 0.25 (high probability of expiring worthless)
    eligible.sort((a, b) => {
      const deltaA = Math.abs(parseFloat(a.greeks?.delta || '0.20'));
      const deltaB = Math.abs(parseFloat(b.greeks?.delta || '0.20'));
      return Math.abs(deltaA - 0.18) - Math.abs(deltaB - 0.18);
    });

    const best = eligible[0];
    const strike = parseFloat(best.strike_price);
    const markPrice = parseFloat(best.mark_price);
    const delta = parseFloat(best.greeks?.delta || (writePut ? '-0.18' : '0.18'));

    if (isNaN(markPrice) || markPrice <= 0) return null;

    return {
      symbol: best.symbol,
      underlying,
      optionType: writePut ? 'PUT' : 'CALL',
      strike,
      expiry: nearestExp,
      markPrice,
      delta,
      side: 'SELL', // STRICTLY OPTION SELLER
      targetProfitUSD: 1.50,
      stopLossUSD: 1.50,
      confidenceScore: Math.min(score, 95),
      reason: `Marwadi Option Writer: SELL OTM ${writePut ? 'PUT' : 'CALL'} @ Strike $${strike} (Delta: ${delta.toFixed(2)}, Mark: $${markPrice.toFixed(2)}) | Target 5:30 PM Theta Melt | ${momentumReason}`,
      contractValue,
    };
  }

  /**
   * Executes an option sell order and registers it as an option writing position
   */
  public async executeOptionOrder(
    candidate: OptionCandidate,
    isSimulation: boolean = true
  ): Promise<DeltaPosition | null> {
    const config = deltaExchange.getConfig();
    const isLiveAuth = Boolean(config.apiKey && config.apiSecret && !isSimulation && !config.isSimulation);

    // Option Selling Sizing:
    // When selling options, profit is capped at the collected premium!
    // Sized so premium collected achieves target $1.00 - $1.50 USD
    const premiumUnitUSD = candidate.markPrice * candidate.contractValue;
    let contracts = Math.max(1, Math.round(candidate.targetProfitUSD / Math.max(premiumUnitUSD * 0.8, 0.05)));
    contracts = Math.min(contracts, 20); // reasonable cap

    const notionalUSD = parseFloat((contracts * premiumUnitUSD).toFixed(2));
    const marginUSD = 35.0; // Margin required to write option

    // Take Profit: Option premium melts near zero (e.g. $0.10)
    const tpPrice = 0.10;

    // Stop Loss: Capped at 2.2x entry premium (protects against sudden tail moves)
    const slPrice = parseFloat((candidate.markPrice * 2.2).toFixed(2));

    let fillPrice = candidate.markPrice;

    if (isLiveAuth) {
      try {
        console.log(`🚀 [MARWADI OPTION SELLER] Writing Option: SELL ${candidate.symbol} (${contracts} contracts @ mark $${candidate.markPrice})`);
        const res = await deltaExchange.request('POST', '/v2/orders', {}, {
          product_symbol: candidate.symbol,
          size: contracts,
          side: 'sell',
          order_type: 'market_order',
        });
        if (res && res.result && res.result.id) {
          console.log(`✅ [OPTION WRITE CONFIRMED] Order ID: ${res.result.id}`);
          if (res.result.average_fill_price) {
            fillPrice = parseFloat(res.result.average_fill_price);
          }
        }
      } catch (err: any) {
        console.error(`❌ [OPTION WRITE ERROR] ${candidate.symbol}:`, err.message);
        return null;
      }
    }

    const pos: DeltaPosition = {
      id: 'opt-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      symbol: candidate.symbol,
      side: 'SELL',
      entryPrice: fillPrice,
      currentPrice: fillPrice,
      quantity: contracts,
      marginUSD,
      notionalUSD,
      leverage: 10,
      takeProfitPrice: tpPrice,
      stopLossPrice: slPrice,
      initialStopLossPrice: slPrice,
      atr: candidate.markPrice * 0.1,
      isBreakevenLocked: false,
      pnlUSD: 0,
      pnlPercent: 0,
      entryTime: Date.now(),
      strategyName: `Marwadi Delta Option Writer [SELL ${candidate.optionType} | Strike: $${candidate.strike} | Theta Decay]`,
      shadowConfirmedSeconds: 0,
      executionMode: 'DIRECT',
      highestPnlUSD: 0,
      instrumentType: 'OPTION',
      optionType: candidate.optionType,
      strike: candidate.strike,
      expiry: candidate.expiry,
    };

    return pos;
  }
}

export const deltaOptionsTrader = DeltaOptionsTraderEngine.getInstance();
