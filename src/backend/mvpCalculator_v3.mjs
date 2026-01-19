/**
 * MVP Calculator V3 - Hybrid REST + SSE Scoring
 *
 * KEY FEATURES:
 * 1. Extends MVPCalculatorImproved for SSE-based velocity tracking
 * 2. Adds REST-based transaction metrics (buy pressure, net volume, txns velocity, price momentum)
 * 3. Combines both data sources for hybrid "upward likelihood" score
 * 4. Multi-timeframe support (5m primary, 15m secondary)
 * 5. View-mode-specific weight adjustment
 * 6. Graceful fallback when REST metrics missing/stale
 */

import { MVPCalculatorImproved } from './mvpCalculator_improved.mjs';

class MVPCalculatorV3 extends MVPCalculatorImproved {
  constructor() {
    super();
    this.PRIMARY_TIMEFRAME = '5m'; // Most responsive for degen trading
    this.METRICS_FRESHNESS_MS = 30000; // Metrics must be <30s old
  }

  /**
   * Calculate MVP score for a single token using hybrid metrics
   * Combines REST transaction metrics (5m) with SSE price momentum
   */
  calculateMVPScore(token, viewMode) {
    // Check if we have fresh transaction metrics
    const hasFreshMetrics = this.areMetricsFresh(token);

    // Get REST-based metrics (5m timeframe)
    const restMetrics = hasFreshMetrics
      ? this.getTransactionMetrics(token)
      : null;

    // Get SSE-based momentum (inherited from improved calculator)
    const sseMomentum = this.getMomentum(token.contractAddress);

    // Calculate component scores
    let buyPressureScore = 0;
    let netBuyVolumeScore = 0;
    let txnsVelocityScore = 0;
    let priceMomentumScore = 0;
    let sseMomentumScore = 0;

    if (hasFreshMetrics && restMetrics) {
      // REST-based scores
      buyPressureScore = this.calculateBuyPressureScore(restMetrics);
      netBuyVolumeScore = this.calculateNetBuyVolumeScore(restMetrics);
      txnsVelocityScore = this.calculateTxnsVelocityScore(restMetrics);
      priceMomentumScore = this.calculatePriceMomentumScore(restMetrics);
    }

    // SSE-based score (always available if we have history)
    if (sseMomentum.hasData) {
      // Use blended MC momentum from improved calculator
      sseMomentumScore = sseMomentum.blendedMcMomentum * 100;
    }

    // Weights tuned for pump detection
    // High buy pressure (35%) - accumulation is key signal
    // Moderate net volume (20%) - capital inflow matters
    // Moderate txns velocity (15%) - activity but not spam
    // High price momentum (20%) - trend confirmation
    // Low SSE momentum (10%) - immediate breaks only
    const weights = {
      buyPressure: 0.35,
      netBuyVolume: 0.20,
      txnsVelocity: 0.15,
      priceMomentum: 0.20,
      sseMomentum: 0.10
    };

    // Adjust weights based on view mode
    const viewModeWeights = this.adjustWeightsForViewMode(weights, viewMode);

    // Calculate total score
    const totalScore =
      (buyPressureScore * viewModeWeights.buyPressure) +
      (netBuyVolumeScore * viewModeWeights.netBuyVolume) +
      (txnsVelocityScore * viewModeWeights.txnsVelocity) +
      (priceMomentumScore * viewModeWeights.priceMomentum) +
      (sseMomentumScore * viewModeWeights.sseMomentum);

    return {
      total: totalScore,
      components: {
        buyPressure: {
          raw: restMetrics?.buyPressure || 0,
          weighted: buyPressureScore * viewModeWeights.buyPressure,
          weight: viewModeWeights.buyPressure
        },
        netBuyVolume: {
          raw: restMetrics?.netBuyVolume || 0,
          weighted: netBuyVolumeScore * viewModeWeights.netBuyVolume,
          weight: viewModeWeights.netBuyVolume
        },
        txnsVelocity: {
          raw: restMetrics?.txns || 0,
          weighted: txnsVelocityScore * viewModeWeights.txnsVelocity,
          weight: viewModeWeights.txnsVelocity
        },
        priceMomentum: {
          raw: restMetrics?.priceMomentum || 0,
          weighted: priceMomentumScore * viewModeWeights.priceMomentum,
          weight: viewModeWeights.priceMomentum
        },
        sseMomentum: {
          raw: sseMomentum.blendedMcMomentum || 0,
          weighted: sseMomentumScore * viewModeWeights.sseMomentum,
          weight: viewModeWeights.sseMomentum
        }
      },
      hasData: hasFreshMetrics || sseMomentum.hasData,
      dataPoints: sseMomentum.dataPoints || 0,
      metricsFresh: hasFreshMetrics
    };
  }

  /**
   * Extract REST-based transaction metrics for scoring
   */
  getTransactionMetrics(token) {
    if (!token.transactionMetrics) {
      return null;
    }

    const tf = token.transactionMetrics[this.PRIMARY_TIMEFRAME];
    if (!tf) {
      return null;
    }

    const buys = tf.buys || 0;
    const sells = tf.sells || 0;
    const totalTxns = buys + sells;

    // Handle edge case: no transactions
    if (totalTxns === 0) {
      return {
        buys: 0,
        sells: 0,
        txns: 0,
        buyPressure: 0.5, // Neutral when no data
        netBuyVolume: 0,
        priceMomentum: 0
      };
    }

    // Calculate buy pressure (0-1, where 0.5 is neutral)
    const buyPressure = buys / totalTxns;

    // Calculate net buy volume (USD)
    const netBuyVolume = (tf.buy_usd || 0) - (tf.sell_usd || 0);

    // Get price momentum (percentage)
    const priceMomentum = tf.price_change || 0;

    return {
      buys,
      sells,
      txns: totalTxns,
      buyPressure,
      netBuyVolume,
      priceMomentum
    };
  }

  /**
   * Calculate buy pressure score (0-1 ratio)
   * Normalizes to -10 to +10 scale where 0.5 is neutral
   */
  calculateBuyPressureScore(metrics) {
    if (!metrics) return 0;

    // Buy pressure: 0-1 range
    // 0.5 = neutral (equal buys/sells)
    // 1.0 = all buys (maximum bullishness)
    // 0.0 = all sells (maximum bearishness)

    // Normalize to -10 to +10 scale
    // 0.5 -> 0 (neutral)
    // 1.0 -> +10 (max bullish)
    // 0.0 -> -10 (max bearish)
    return (metrics.buyPressure - 0.5) * 20;
  }

  /**
   * Calculate net buy volume score (logarithmic scaling)
   * Uses logarithmic scale to handle wide range of volumes
   */
  calculateNetBuyVolumeScore(metrics) {
    if (!metrics) return 0;

    // Net buy volume: can be negative (more sells than buys)
    // Use logarithmic scaling to handle wide range
    // $100 net buy -> score ~4
    // $1,000 net buy -> score ~6
    // $10,000 net buy -> score ~8

    const volume = Math.abs(metrics.netBuyVolume);

    // Avoid log(0) by using max(volume, 1)
    // Multiply by sign to preserve direction
    const sign = metrics.netBuyVolume >= 0 ? 1 : -1;
    return sign * Math.log10(Math.max(volume, 1)) * 2;
  }

  /**
   * Calculate transaction velocity score (linear scaling)
   * More transactions = higher score (capped at 100 txns)
   */
  calculateTxnsVelocityScore(metrics) {
    if (!metrics) return 0;

    // Transaction velocity: count of txns in 5m
    // More transactions = more activity = higher score
    // Scale: 10 txns -> score 1, 50 txns -> score 5, 100+ txns -> score 10

    const txns = metrics.txns;

    // Linear scaling with cap at 100 txns
    return Math.min(txns / 10, 10);
  }

  /**
   * Calculate price momentum score (percentage)
   * Direct percentage multiplier
   */
  calculatePriceMomentumScore(metrics) {
    if (!metrics) return 0;

    // Price momentum: percentage change
    // +10% price change -> score 10
    // -10% price change -> score -10

    return metrics.priceMomentum * 2;
  }

  /**
   * Check if transaction metrics are fresh enough to use
   */
  areMetricsFresh(token) {
    if (!token.lastMetricsUpdate) {
      return false;
    }

    const age = Date.now() - token.lastMetricsUpdate;
    return age <= this.METRICS_FRESHNESS_MS;
  }

  /**
   * Adjust weights based on view mode
   * Short-term modes favor immediate signals (SSE, price momentum)
   * Long-term modes favor sustained signals (buy pressure, net volume)
   */
  adjustWeightsForViewMode(baseWeights, viewMode) {
    // Adjust weights based on view mode
    // Short-term modes favor immediate signals (SSE, price momentum)
    // Long-term modes favor sustained signals (buy pressure, net volume)

    switch (viewMode) {
      case '5m':
        return {
          ...baseWeights,
          sseMomentum: 0.20, // Increase immediate signal
          priceMomentum: 0.25,
          buyPressure: 0.25,
          netBuyVolume: 0.15,
          txnsVelocity: 0.15
        };

      case '30m':
        return {
          ...baseWeights,
          sseMomentum: 0.15,
          priceMomentum: 0.20,
          buyPressure: 0.30,
          netBuyVolume: 0.20,
          txnsVelocity: 0.15
        };

      case '1h':
        return baseWeights; // Use default

      case '4h':
        return {
          ...baseWeights,
          sseMomentum: 0.05, // Decrease immediate signal
          priceMomentum: 0.15,
          buyPressure: 0.40,
          netBuyVolume: 0.25,
          txnsVelocity: 0.15
        };

      case 'all-time':
      default:
        return {
          ...baseWeights,
          sseMomentum: 0.05,
          priceMomentum: 0.10,
          buyPressure: 0.45,
          netBuyVolume: 0.30,
          txnsVelocity: 0.10
        };
    }
  }
}

// Export singleton instance
const mvpCalculatorV3 = new MVPCalculatorV3();
export default mvpCalculatorV3;
export { MVPCalculatorV3 };
