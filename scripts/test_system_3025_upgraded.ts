import { whiteboardCryptoDeFiEngine } from '../lib/strategies/whiteboardCryptoDeFiEngine';
import { autonomousMultiIndicatorEngine } from '../lib/strategies/autonomousMultiIndicatorEngine';
import { sidhantEngine } from '../lib/strategies/sidhantWorldChampionEngine';
import { deltaExchange } from '../lib/deltaExchangeEngine';

async function testUpgrade() {
  const coins = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD', 'DOGEUSD', 'ADAUSD', 'AVAXUSD', 'SUIUSD'];
  console.log('Testing System 3025 Multi-Strategy Cascade...');
  
  for (const c of coins) {
    const candles = await deltaExchange.getKlines(c, 15, 60);
    const closed = candles.slice(0, -1);
    
    // 1. Primary Whiteboard AMM
    let res = whiteboardCryptoDeFiEngine.evaluateSetup(c, closed);
    let chosenStrategy = 'Whiteboard AMM';
    
    // 2. Secondary Zero-Lag Price Action FVG
    if (!res.recommendedSide) {
      const autoRes = autonomousMultiIndicatorEngine.evaluateSetup(c, closed);
      if (autoRes.recommendedSide && autoRes.confidenceScore >= 75) {
        res = {
          recommendedSide: autoRes.recommendedSide,
          confidenceScore: autoRes.confidenceScore,
          setupType: autoRes.setupType,
          reasons: autoRes.reasons,
          customSL: autoRes.customSL,
          customTP: autoRes.customTP,
          marketRegime: 'PRICE_ACTION_FVG'
        };
        chosenStrategy = 'Zero-Lag Price Action FVG';
      }
    }
    
    // 3. Tertiary Sidhant 3-Step Golden Pocket
    if (!res.recommendedSide) {
      const sidRes = sidhantEngine.evaluateSetup(c, closed);
      if (sidRes.recommendedSide && sidRes.confidenceScore >= 75) {
        res = {
          recommendedSide: sidRes.recommendedSide,
          confidenceScore: sidRes.confidenceScore,
          setupType: sidRes.setupType,
          reasons: sidRes.reasons,
          customSL: sidRes.customSL,
          customTP: sidRes.customTP,
          marketRegime: 'SIDHANT_3STEP'
        };
        chosenStrategy = 'Sidhant 3-Step Reversal';
      }
    }
    
    if (res.recommendedSide) {
      console.log(`✅ MATCH FOUND for ${c}: ${chosenStrategy} -> ${res.recommendedSide} (Score: ${res.confidenceScore}%) | SL: ${res.customSL} | TP: ${res.customTP}`);
    } else {
      console.log(`⏳ Waiting for ${c}: No high-probability setup on closed 15M bar.`);
    }
  }
}

testUpgrade().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
