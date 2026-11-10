import { KlinePoint } from '../../src/types';
import { DynamicTP2Engine, DynamicTP2Result } from '../risk/dynamicTP2Engine';
import { bradGohMindMathMoney3002Engine } from './bradGohMindMathMoney3002Engine';
import { tradingLabDivergence3003Engine } from './tradingLabDivergence3003Engine';
import { fractalFlowVolumeProfile3004Engine } from './fractalFlowVolumeProfile3004Engine';
import { hybridMasterCryptoSMC3005Engine } from './hybridMasterCryptoSMC3005Engine';
import { masterConfluenceEngine } from './masterConfluenceEngine';

/**
 * ============================================================================
 * NEW SYSTEM STRATEGY WRAPPER (Upgraded with Dynamic TP2 & Big-Move Engine)
 * 
 * Takes the raw institutional setups from 3002, 3003, 3004, 3005, and Master Confluence,
 * and attaches the Dynamic TP1 vs TP2 Decision Engine without modifying any entry or SL rules.
 * ============================================================================
 */

export interface UpgradedStrategyOutput {
  strategyId: number;
  symbol: string;
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  setupType: string;
  entryPrice: number;
  stopLossPrice: number;
  // Dynamic TP2 Extensions:
  dynamicTP2: DynamicTP2Result | null;
  tp1Price?: number;
  tp2Price?: number;
  tp2Enabled: boolean;
  tp1AllocationPct: number;
  tp2AllocationPct: number;
  breakevenPrice?: number;
  reasons: string[];
}

export class DynamicTP2_NewSystemWrapper {
  /**
   * Evaluate a strategy for a specific port using the upgraded Dynamic TP2 architecture
   */
  public static evaluateUpgradedStrategy(
    strategyId: number,
    symbol: string,
    candles15m: KlinePoint[],
    accountEquity: number = 1000
  ): UpgradedStrategyOutput {
    let baseResult: any = null;

    switch (strategyId) {
      case 3002:
        baseResult = bradGohMindMathMoney3002Engine.evaluateSetup(symbol, candles15m, accountEquity, 'MODE_B');
        break;
      case 3003:
        baseResult = tradingLabDivergence3003Engine.evaluateSetup(symbol, candles15m, accountEquity, 'MODE_B');
        break;
      case 3004:
        baseResult = fractalFlowVolumeProfile3004Engine.evaluateSetup(symbol, candles15m, accountEquity, 'MODE_B');
        break;
      case 3005:
        baseResult = hybridMasterCryptoSMC3005Engine.evaluateSetup(symbol, candles15m, accountEquity, 'MODE_B');
        break;
      case 3000:
        baseResult = masterConfluenceEngine.evaluateConfluence(symbol, candles15m, accountEquity, 'MODE_B');
        break;
      default:
        baseResult = { recommendedSide: null, confidenceScore: 0, setupType: 'NONE', entryPrice: 0, reasons: [] };
    }

    if (!baseResult.recommendedSide || !baseResult.customSL || !baseResult.customTP) {
      return {
        strategyId,
        symbol,
        recommendedSide: null,
        confidenceScore: 0,
        setupType: baseResult.setupType || 'NONE',
        entryPrice: 0,
        stopLossPrice: 0,
        dynamicTP2: null,
        tp2Enabled: false,
        tp1AllocationPct: 1.0,
        tp2AllocationPct: 0.0,
        reasons: baseResult.reasons || [],
      };
    }

    const curPrice = baseResult.entryPrice || candles15m[candles15m.length - 1].close;
    const sweepExtreme = baseResult.riskResult?.audit?.sweepExtreme ||
      (baseResult.recommendedSide === 'BUY'
        ? candles15m[candles15m.length - 1].low
        : candles15m[candles15m.length - 1].high);

    // Attach Dynamic TP1 vs. TP2 Engine
    const dynamicTP2 = DynamicTP2Engine.evaluateDynamicExits({
      symbol,
      side: baseResult.recommendedSide,
      entryPrice: curPrice,
      sweepExtremePrice: sweepExtreme,
      opposingZonePrice: baseResult.customTP,
      candles: candles15m,
      accountEquity,
      tickSize: 0.1,
    });

    return {
      strategyId,
      symbol,
      recommendedSide: baseResult.recommendedSide,
      confidenceScore: baseResult.confidenceScore,
      setupType: baseResult.setupType,
      entryPrice: curPrice,
      stopLossPrice: dynamicTP2.stopLossPrice,
      dynamicTP2,
      tp1Price: dynamicTP2.tp1Price,
      tp2Price: dynamicTP2.tp2Price,
      tp2Enabled: dynamicTP2.tp2Enabled,
      tp1AllocationPct: dynamicTP2.tp1AllocationPct,
      tp2AllocationPct: dynamicTP2.tp2AllocationPct,
      breakevenPrice: dynamicTP2.breakevenPrice,
      reasons: [...baseResult.reasons, ...dynamicTP2.reasons],
    };
  }
}
