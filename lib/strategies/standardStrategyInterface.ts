import { KlinePoint } from '../../src/types';

/**
 * ============================================================================
 * STANDARD STRATEGY VERDICT CONTRACT
 * Mandatory interface across Ports 3002 through 3010 for the Master
 * Architecture Overhaul. Ensures full compatibility with the 4-Slot Rolling
 * Risk Shield, 75% TP1 partial exit, 25% TP2 runner, and +0.75R early breakeven.
 * Conforms to PROJECT.md §Interface Contracts.
 * ============================================================================
 */

export interface StandardStrategyVerdict {
  symbol: string;
  recommendedSide: 'BUY' | 'SELL' | null;
  confidenceScore: number;
  strategyName: string;
  setupType: string;
  entryPrice: number;
  stopLossPrice: number;
  tp1Price: number;
  tp2Price: number;
  tp1Ratio: number; // Strictly 0.75 (75% close)
  tp2Ratio: number; // Strictly 0.25 (25% close)
  earlyBreakevenPrice: number; // +0.75R price level
  riskDistance: number;
  minSlDistancePct: number; // Strictly >= 0.0045 (0.45%)
  reasons: string[];
  auditLog?: Record<string, any>;

  // Backward compatibility fields
  customSL?: number;
  customTP?: number;
  riskResult?: any;
}

export interface StandardStrategyEngine {
  evaluateSetup(
    symbol: string,
    candles: KlinePoint[],
    accountEquity?: number,
    microData?: any
  ): StandardStrategyVerdict;
}

/**
 * Helper to construct an empty/neutral verdict
 */
export function createEmptyStandardVerdict(
  symbol: string,
  strategyName: string,
  entryPrice: number = 0,
  reasons: string[] = []
): StandardStrategyVerdict {
  return {
    symbol,
    recommendedSide: null,
    confidenceScore: 0,
    strategyName,
    setupType: 'NONE',
    entryPrice,
    stopLossPrice: 0,
    tp1Price: 0,
    tp2Price: 0,
    tp1Ratio: 0.75,
    tp2Ratio: 0.25,
    earlyBreakevenPrice: 0,
    riskDistance: 0,
    minSlDistancePct: 0.0045,
    reasons,
    customSL: 0,
    customTP: 0,
  };
}
