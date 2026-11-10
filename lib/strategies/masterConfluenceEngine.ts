import { KlinePoint } from '../../src/types';
import { bradGohMindMathMoney3002Engine, BradGoh3002Verdict } from './bradGohMindMathMoney3002Engine';
import { tradingLabDivergence3003Engine, TradingLab3003Verdict } from './tradingLabDivergence3003Engine';
import { fractalFlowVolumeProfile3004Engine, FractalFlow3004Verdict } from './fractalFlowVolumeProfile3004Engine';
import { hybridMasterCryptoSMC3005Engine, HybridSMC3005Verdict } from './hybridMasterCryptoSMC3005Engine';
import { PkAtVH6YVM8RiskResult } from '../risk/pkAtVH6YVM8RiskManager';

/**
 * ============================================================================
 * MASTER CONFLUENCE ENGINE (3002 + 3003 + 3004 + 3005)
 * 
 * High-Conviction Institutional Confluence:
 * Evaluates when:
 * 1. Port 3002 (Brad Goh & Mind Math Money 5-Step Reversal)
 * 2. Port 3003 (TradingLab Liquidity Grab + 10-Candle Divergence)
 * 3. Port 3004 (Fractal Flow Volume Profile & Order Flow)
 * 4. Port 3005 (Hybrid Master Crypto SMC)
 * 
 * Align unanimously or reach supermajority consensus (≥ 3 engines agreeing)
 * on BUY or SELL direction.
 * ============================================================================
 */

export interface MasterConfluenceVerdict {
  symbol: string;
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: 'UNANIMOUS_4ENGINE_CONFLUENCE' | 'SUPERMAJORITY_CONFLUENCE' | 'NONE';
  entryPrice: number;
  customSL?: number;
  customTP?: number;
  agreeingEngines: number[];
  riskResult?: PkAtVH6YVM8RiskResult;
  subEngineVerdicts: {
    engine3002: BradGoh3002Verdict;
    engine3003: TradingLab3003Verdict;
    engine3004: FractalFlow3004Verdict;
    engine3005: HybridSMC3005Verdict;
  };
  reasons: string[];
}

export class MasterConfluenceEngine {
  public static readonly NAME = 'Master Institutional Confluence Engine (3002 + 3003 + 3004 + 3005)';

  public evaluateConfluence(
    symbol: string,
    candles: KlinePoint[],
    accountEquity: number = 10000,
    tpMode: 'MODE_A' | 'MODE_B' = 'MODE_B'
  ): MasterConfluenceVerdict {
    const v3002 = bradGohMindMathMoney3002Engine.evaluateSetup(symbol, candles, accountEquity, tpMode);
    const v3003 = tradingLabDivergence3003Engine.evaluateSetup(symbol, candles, accountEquity, tpMode);
    const v3004 = fractalFlowVolumeProfile3004Engine.evaluateSetup(symbol, candles, accountEquity, tpMode);
    const v3005 = hybridMasterCryptoSMC3005Engine.evaluateSetup(symbol, candles, accountEquity, tpMode);

    const verdicts = [
      { port: 3002, v: v3002 },
      { port: 3003, v: v3003 },
      { port: 3004, v: v3004 },
      { port: 3005, v: v3005 },
    ];

    const buyEngines = verdicts.filter(e => e.v.recommendedSide === 'BUY');
    const sellEngines = verdicts.filter(e => e.v.recommendedSide === 'SELL');

    const currentPrice = candles[candles.length - 1].close;

    // FIX 1: Strict Multi-Engine Voting (Engine 3005 OR 3002 + at least one from 3004 OR 3003)
    const has3005Buy = buyEngines.some(e => e.port === 3005);
    const has3002Buy = buyEngines.some(e => e.port === 3002);
    const has3004Buy = buyEngines.some(e => e.port === 3004);
    const has3003Buy = buyEngines.some(e => e.port === 3003);

    const has3005Sell = sellEngines.some(e => e.port === 3005);
    const has3002Sell = sellEngines.some(e => e.port === 3002);
    const has3004Sell = sellEngines.some(e => e.port === 3004);
    const has3003Sell = sellEngines.some(e => e.port === 3003);

    // BUY Confluence: Top institutional anchors (3002 OR 3005) + (3004 OR 3003) with zero opposition
    if ((has3002Buy || has3005Buy) && (has3004Buy || (has3002Buy && has3003Buy) || (has3005Buy && has3003Buy)) && sellEngines.length === 0) {
      const bestRisk = v3002.riskResult || v3005.riskResult || buyEngines[0].v.riskResult;
      const agreeing = buyEngines.map(e => e.port);
      return {
        symbol,
        recommendedSide: 'BUY',
        confidenceScore: agreeing.length >= 3 ? 95 : 90,
        setupType: agreeing.length >= 4 ? 'UNANIMOUS_4ENGINE_CONFLUENCE' : 'SUPERMAJORITY_CONFLUENCE',
        entryPrice: currentPrice,
        customSL: bestRisk?.stopLossPrice,
        customTP: bestRisk?.takeProfitPrice,
        agreeingEngines: agreeing,
        riskResult: bestRisk,
        subEngineVerdicts: { engine3002: v3002, engine3003: v3003, engine3004: v3004, engine3005: v3005 },
        reasons: [`STRICT CONFLUENCE PASS: Primary (${has3005Buy ? '3005' : '3002'}) + Secondary (${has3004Buy ? '3004' : '3003'}) agreed on BUY with zero opposition`],
      };
    }

    // SELL Confluence: Top institutional anchors (3002 OR 3005) + (3004 OR 3003) with zero opposition
    if ((has3002Sell || has3005Sell) && (has3004Sell || (has3002Sell && has3003Sell) || (has3005Sell && has3003Sell)) && buyEngines.length === 0) {
      const bestRisk = v3002.riskResult || v3005.riskResult || sellEngines[0].v.riskResult;
      const agreeing = sellEngines.map(e => e.port);
      return {
        symbol,
        recommendedSide: 'SELL',
        confidenceScore: agreeing.length >= 3 ? 95 : 90,
        setupType: agreeing.length >= 4 ? 'UNANIMOUS_4ENGINE_CONFLUENCE' : 'SUPERMAJORITY_CONFLUENCE',
        entryPrice: currentPrice,
        customSL: bestRisk?.stopLossPrice,
        customTP: bestRisk?.takeProfitPrice,
        agreeingEngines: agreeing,
        riskResult: bestRisk,
        subEngineVerdicts: { engine3002: v3002, engine3003: v3003, engine3004: v3004, engine3005: v3005 },
        reasons: [`STRICT CONFLUENCE PASS: Primary (${has3005Sell ? '3005' : '3002'}) + Secondary (${has3004Sell ? '3004' : '3003'}) agreed on SELL with zero opposition`],
      };
    }

    return {
      symbol,
      recommendedSide: null,
      confidenceScore: 0,
      setupType: 'NONE',
      entryPrice: 0,
      agreeingEngines: [],
      subEngineVerdicts: { engine3002: v3002, engine3003: v3003, engine3004: v3004, engine3005: v3005 },
      reasons: ['No multi-engine confluence agreement on current bar'],
    };
  }
}

export const masterConfluenceEngine = new MasterConfluenceEngine();
