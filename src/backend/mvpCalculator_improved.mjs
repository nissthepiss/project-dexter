/**
 * IMPROVED MVP Calculator Module
 * 
 * KEY IMPROVEMENTS:
 * 1. Tracks RATE OF CHANGE (velocity) instead of just absolute % change
 * 2. Uses shorter windows (3-5 seconds) for more responsive momentum
 * 3. Adds volume velocity score (how fast volume is growing)
 * 4. Better normalization so values actually change visibly
 */

// View-specific weights for MVP scoring
const VIEW_WEIGHTS = {
  '5m':       { volume: 0.50, mc: 0.35, peak: 0.15 },
  '30m':      { volume: 0.40, mc: 0.35, peak: 0.25 },
  '1h':       { volume: 0.30, mc: 0.30, peak: 0.40 },
  '4h':       { volume: 0.25, mc: 0.25, peak: 0.50 },
  'all-time': { volume: 0.20, mc: 0.20, peak: 0.60 }
};

class MVPCalculatorImproved {
  constructor() {
    // Map of address -> { mcHistory: [], volumeHistory: [] }
    // Each history entry: { timestamp: number, value: number }
    this.buffers = new Map();
    this.BUFFER_SIZE = 30; // 30 seconds of history
    this.HEALTH_THRESHOLD = 0.8; // Must be >= 80% of peak MC
    
    // IMPROVED: Shorter windows for more responsive momentum
    this.SHORT_WINDOW = 3; // 3 seconds for immediate momentum
    this.MEDIUM_WINDOW = 10; // 10 seconds for trend confirmation
  }

  /**
   * Record a snapshot of MC and volume for a token
   * Called on every SSE price update (~1s intervals)
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
   * IMPROVED: Get momentum metrics with better responsiveness
   * Returns both short-term and medium-term momentum
   */
  getMomentum(address) {
    const buffer = this.buffers.get(address);

    if (!buffer || buffer.mcHistory.length < 2) {
      return { 
        volumeMomentum: 0, 
        mcMomentum: 0, 
        volumeVelocity: 0,
        mcVelocity: 0,
        hasData: false 
      };
    }

    const now = Date.now();

    // Short-term momentum (3 seconds) - more responsive
    const shortMomentum = this.calculateMomentumForWindow(
      buffer, 
      now - (this.SHORT_WINDOW * 1000), 
      now
    );

    // Medium-term momentum (10 seconds) - trend confirmation
    const mediumMomentum = this.calculateMomentumForWindow(
      buffer, 
      now - (this.MEDIUM_WINDOW * 1000), 
      now
    );

    // IMPROVED: Calculate velocity (rate of change)
    // Velocity = (recent momentum - older momentum) / time
    // This shows if growth is accelerating or decelerating
    const velocity = this.calculateVelocity(buffer, now);

    return {
      // Use short-term for immediate response
      volumeMomentum: shortMomentum.volume,
      mcMomentum: shortMomentum.mc,
      
      // Add velocity scores
      volumeVelocity: velocity.volume,
      mcVelocity: velocity.mc,
      
      // Blend scores for final momentum (70% short-term, 30% medium-term)
      blendedVolumeMomentum: (shortMomentum.volume * 0.7) + (mediumMomentum.volume * 0.3),
      blendedMcMomentum: (shortMomentum.mc * 0.7) + (mediumMomentum.mc * 0.3),
      
      hasData: true,
      dataPoints: buffer.mcHistory.length
    };
  }

  /**
   * Calculate momentum for a specific time window
   */
  calculateMomentumForWindow(buffer, startTime, endTime) {
    const mcInWindow = buffer.mcHistory.filter(e => e.timestamp >= startTime && e.timestamp <= endTime);
    const volInWindow = buffer.volumeHistory.filter(e => e.timestamp >= startTime && e.timestamp <= endTime);

    if (mcInWindow.length < 2) {
      return { mc: 0, volume: 0 };
    }

    const oldestMc = mcInWindow[0].value;
    const latestMc = mcInWindow[mcInWindow.length - 1].value;

    const oldestVol = volInWindow[0]?.value || 0;
    const latestVol = volInWindow[volInWindow.length - 1]?.value || 0;

    // Calculate % change
    const mcMomentum = oldestMc > 0 ? (latestMc - oldestMc) / oldestMc : 0;
    const volumeMomentum = oldestVol > 0 ? (latestVol - oldestVol) / oldestVol : 0;

    return { mc: mcMomentum, volume: volumeMomentum };
  }

  /**
   * IMPROVED: Calculate velocity (acceleration of momentum)
   * Compares last 3 seconds vs previous 3 seconds
   */
  calculateVelocity(buffer, now) {
    if (buffer.mcHistory.length < 6) {
      return { mc: 0, volume: 0 };
    }

    // Recent 3 seconds
    const recentStart = now - (3 * 1000);
    const recentEnd = now;

    // Previous 3 seconds
    const prevStart = now - (6 * 1000);
    const prevEnd = now - (3 * 1000);

    const recentMomentum = this.calculateMomentumForWindow(buffer, recentStart, recentEnd);
    const prevMomentum = this.calculateMomentumForWindow(buffer, prevStart, prevEnd);

    // Velocity = change in momentum
    return {
      mc: recentMomentum.mc - prevMomentum.mc,
      volume: recentMomentum.volume - prevMomentum.volume
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

    const recentMomentum = this.calculateMomentumForWindow(buffer, recent5sStart, now);
    const prevMomentum = this.calculateMomentumForWindow(buffer, prev5sStart, recent5sStart);

    return {
      mcAcceleration: recentMomentum.mc - prevMomentum.mc,
      volumeAcceleration: recentMomentum.volume - prevMomentum.volume,
      hasData: true
    };
  }

  /**
   * IMPROVED: Calculate MVP score with better sensitivity
   */
  calculateMVPScore(token, viewMode) {
    const momentum = this.getMomentum(token.contractAddress);
    const weights = VIEW_WEIGHTS[viewMode] || VIEW_WEIGHTS['all-time'];

    // IMPROVED NORMALIZATION:
    // Instead of just multiplying by 100, we use a more sensitive scale
    
    // Volume momentum score (amplified for visibility)
    // Small changes (0.01 = 1%) now show up as meaningful scores
    // Formula: momentum * 1000 (so 1% = 10 points, 10% = 100 points)
    const volMomentumScore = momentum.blendedVolumeMomentum * 1000;
    
    // Add velocity bonus (up to 50% extra)
    const volVelocityBonus = momentum.volumeVelocity * 500;
    const volScore = volMomentumScore + volVelocityBonus;

    // MC momentum score (same amplification)
    const mcMomentumScore = momentum.blendedMcMomentum * 1000;
    const mcVelocityBonus = momentum.mcVelocity * 500;
    const mcScore = mcMomentumScore + mcVelocityBonus;

    // Peak multiplier scaled (1.5x -> 15)
    const peakScore = (token.peakMultiplier || 1) * 10;

    const score = (volScore * weights.volume) +
                  (mcScore * weights.mc) +
                  (peakScore * weights.peak);

    return {
      total: score,
      components: {
        volumeMomentum: {
          raw: momentum.blendedVolumeMomentum,
          velocity: momentum.volumeVelocity,
          weighted: volScore * weights.volume,
          weight: weights.volume
        },
        mcMomentum: {
          raw: momentum.blendedMcMomentum,
          velocity: momentum.mcVelocity,
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
      const momentum = this.getMomentum(address);
      stats.bufferDetails.push({
        address: address.substring(0, 8) + '...',
        mcPoints: buffer.mcHistory.length,
        volPoints: buffer.volumeHistory.length,
        volumeMomentum: momentum.volumeMomentum.toFixed(4),
        volumeVelocity: momentum.volumeVelocity.toFixed(4),
        mcMomentum: momentum.mcMomentum.toFixed(4),
        mcVelocity: momentum.mcVelocity.toFixed(4)
      });
    }

    return stats;
  }
}

// Export singleton instance
const mvpCalculator = new MVPCalculatorImproved();
export default mvpCalculator;
export { MVPCalculatorImproved, VIEW_WEIGHTS };
