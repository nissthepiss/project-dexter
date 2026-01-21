/**
 * MVP Calculator Module
 * Tracks per-second momentum data and calculates MVP scores for tokens
 */

// View-specific weights for MVP scoring
const VIEW_WEIGHTS = {
  '5m':       { volume: 0.50, mc: 0.35, peak: 0.15 },
  '30m':      { volume: 0.40, mc: 0.35, peak: 0.25 },
  '1h':       { volume: 0.30, mc: 0.30, peak: 0.40 },
  '4h':       { volume: 0.25, mc: 0.25, peak: 0.50 },
  'all-time': { volume: 0.20, mc: 0.20, peak: 0.60 }
};

class MVPCalculator {
  constructor() {
    // Map of address -> { mcHistory: [], volumeHistory: [] }
    // Each history entry: { timestamp: number, value: number }
    this.buffers = new Map();
    this.BUFFER_SIZE = 30; // 30 seconds of history
    this.HEALTH_THRESHOLD = 0.8; // Must be >= 80% of peak MC
  }

  /**
   * Record a snapshot of MC and volume for a token
   * Called on every SSE price update
   */
  recordSnapshot(address, mc, volume) {
    if (!address || mc === null || mc === undefined) return;

    const now = Date.now();

    if (!this.buffers.has(address)) {
      this.buffers.set(address, {
        mcHistory: [],
        volumeHistory: []
      });
    }

    const buffer = this.buffers.get(address);

    // Add new snapshot
    buffer.mcHistory.push({ timestamp: now, value: mc });
    buffer.volumeHistory.push({ timestamp: now, value: volume || 0 });

    // Trim old entries (keep last BUFFER_SIZE seconds)
    const cutoff = now - (this.BUFFER_SIZE * 1000);
    buffer.mcHistory = buffer.mcHistory.filter(entry => entry.timestamp >= cutoff);
    buffer.volumeHistory = buffer.volumeHistory.filter(entry => entry.timestamp >= cutoff);
  }

  /**
   * Get momentum metrics for a token
   * Returns % change over the specified window
   */
  getMomentum(address, windowSeconds = 10) {
    const buffer = this.buffers.get(address);

    if (!buffer || buffer.mcHistory.length < 2) {
      return { volumeMomentum: 0, mcMomentum: 0, hasData: false };
    }

    const now = Date.now();
    const windowStart = now - (windowSeconds * 1000);

    // Find the oldest entry within window or the first entry
    const findOldestInWindow = (history) => {
      const inWindow = history.filter(e => e.timestamp >= windowStart);
      if (inWindow.length > 0) {
        return inWindow[0];
      }
      // If no entries in window, use oldest available
      return history[0];
    };

    const oldestMc = findOldestInWindow(buffer.mcHistory);
    const latestMc = buffer.mcHistory[buffer.mcHistory.length - 1];

    const oldestVol = findOldestInWindow(buffer.volumeHistory);
    const latestVol = buffer.volumeHistory[buffer.volumeHistory.length - 1];

    // Calculate % change
    let mcMomentum = 0;
    if (oldestMc && oldestMc.value > 0 && latestMc) {
      mcMomentum = (latestMc.value - oldestMc.value) / oldestMc.value;
    }

    let volumeMomentum = 0;
    if (oldestVol && oldestVol.value > 0 && latestVol) {
      volumeMomentum = (latestVol.value - oldestVol.value) / oldestVol.value;
    }

    return {
      volumeMomentum,
      mcMomentum,
      hasData: true,
      dataPoints: buffer.mcHistory.length
    };
  }

  /**
   * Get acceleration - is momentum increasing or decreasing?
   * Compares last 5s momentum vs previous 5s momentum
   */
  getAcceleration(address) {
    const buffer = this.buffers.get(address);

    if (!buffer || buffer.mcHistory.length < 10) {
      return { mcAcceleration: 0, volumeAcceleration: 0, hasData: false };
    }

    const now = Date.now();

    // Recent 5 seconds
    const recent5sStart = now - 5000;
    const prev5sStart = now - 10000;

    const getMomentumForWindow = (history, startTime, endTime) => {
      const inWindow = history.filter(e => e.timestamp >= startTime && e.timestamp < endTime);
      if (inWindow.length < 2) return 0;
      const first = inWindow[0].value;
      const last = inWindow[inWindow.length - 1].value;
      if (first === 0) return 0;
      return (last - first) / first;
    };

    const recentMcMomentum = getMomentumForWindow(buffer.mcHistory, recent5sStart, now);
    const prevMcMomentum = getMomentumForWindow(buffer.mcHistory, prev5sStart, recent5sStart);

    const recentVolMomentum = getMomentumForWindow(buffer.volumeHistory, recent5sStart, now);
    const prevVolMomentum = getMomentumForWindow(buffer.volumeHistory, prev5sStart, recent5sStart);

    return {
      mcAcceleration: recentMcMomentum - prevMcMomentum,
      volumeAcceleration: recentVolMomentum - prevVolMomentum,
      hasData: true
    };
  }

  /**
   * Calculate MVP score for a single token
   */
  calculateMVPScore(token, viewMode) {
    const momentum = this.getMomentum(token.contractAddress);
    const weights = VIEW_WEIGHTS[viewMode] || VIEW_WEIGHTS['all-time'];

    // Normalize values to comparable scales
    // Volume momentum as % (e.g., 0.25 = 25% increase)
    const volScore = momentum.volumeMomentum * 100;

    // MC momentum as % (e.g., 0.15 = 15% increase)
    const mcScore = momentum.mcMomentum * 100;

    // Peak multiplier scaled (1.5x -> 15)
    const peakScore = (token.peakMultiplier || 1) * 10;

    const score = (volScore * weights.volume) +
                  (mcScore * weights.mc) +
                  (peakScore * weights.peak);

    return {
      total: score,
      components: {
        volumeMomentum: {
          raw: momentum.volumeMomentum,
          weighted: volScore * weights.volume,
          weight: weights.volume
        },
        mcMomentum: {
          raw: momentum.mcMomentum,
          weighted: mcScore * weights.mc,
          weight: weights.mc
        },
        peakMultiplier: {
          raw: token.peakMultiplier || 1,
          weighted: peakScore * weights.peak,
          weight: weights.peak
        }
      },
      hasData: momentum.hasData,
      dataPoints: momentum.dataPoints
    };
  }

  /**
   * Get the MVP token from a list of tokens
   * Returns null if no tokens pass health check
   */
  getMVP(tokens, viewMode) {
    if (!tokens || tokens.length === 0) {
      return null;
    }

    // Filter by health check: current MC >= 80% of peak MC
    const eligible = tokens.filter(t => {
      if (!t.currentMc || !t.peakMc) return false;
      return t.currentMc >= (t.peakMc * this.HEALTH_THRESHOLD);
    });

    if (eligible.length === 0) {
      return null;
    }

    // Score all eligible tokens
    const scored = eligible.map(t => ({
      token: t,
      scoreData: this.calculateMVPScore(t, viewMode)
    }));

    // Sort by score (descending), tie-break by volume (descending)
    scored.sort((a, b) => {
      const scoreDiff = b.scoreData.total - a.scoreData.total;
      if (Math.abs(scoreDiff) > 0.001) return scoreDiff;
      return (b.token.volume24h || 0) - (a.token.volume24h || 0);
    });

    const winner = scored[0];
    const acceleration = this.getAcceleration(winner.token.contractAddress);

    return {
      address: winner.token.contractAddress,
      token: winner.token,
      score: winner.scoreData.total,
      components: winner.scoreData.components,
      acceleration: acceleration,
      health: winner.token.currentMc / winner.token.peakMc,
      hasData: winner.scoreData.hasData,
      dataPoints: winner.scoreData.dataPoints
    };
  }

  /**
   * Clean up buffers for tokens no longer being tracked
   */
  cleanupStaleBuffers(activeAddresses) {
    const activeSet = new Set(activeAddresses);
    for (const address of this.buffers.keys()) {
      if (!activeSet.has(address)) {
        this.buffers.delete(address);
      }
    }
  }

  /**
   * Get buffer stats for debugging
   */
  getBufferStats() {
    const stats = {
      totalBuffers: this.buffers.size,
      bufferDetails: []
    };

    for (const [address, buffer] of this.buffers.entries()) {
      stats.bufferDetails.push({
        address: address.substring(0, 8) + '...',
        mcPoints: buffer.mcHistory.length,
        volPoints: buffer.volumeHistory.length
      });
    }

    return stats;
  }
}

// Export singleton instance
const mvpCalculator = new MVPCalculator();
export default mvpCalculator;
export { MVPCalculator, VIEW_WEIGHTS };
