// System 3001: Zero-Lag Price Action & Institutional Liquidity Engine
// User Mandate: "3001 me laggy indicators hata ke bina without laggy indicators ka use karo"
// Completely removes all laggy indicators (No 20/50/200 EMA ribbons, No slow RSI 14, No MACD 12/26/9, No slow Stochastics, No ADX, No Choppiness Index)
// Deploys pure zero-lag institutional price action:
// 1. Fractal Market Structure (Swing Highs / Lows, BOS & ChoCh)
// 2. Liquidity Sweeps with Wick Absorption (Turtle Soup)
// 3. Institutional Displacement & Relative Volume (RVOL)
// 4. Fair Value Gap (FVG) Mitigation
// 5. Digital Signal Processing (DSP) Zero-Phase-Lag SuperSmoother & Kalman Filter velocity
// 6. Pre-Reversal Take Profit with strict 1:2.30 Risk-to-Reward ratio

export { 
  ZeroLagPriceActionEngine, 
  zeroLagPriceActionEngine, 
  autonomousMultiIndicatorEngine, 
  multiIndicatorEngine 
} from './zeroLagPriceActionEngine';

export type {
  StrategySetupResult,
  FractalPivot 
} from './zeroLagPriceActionEngine';
