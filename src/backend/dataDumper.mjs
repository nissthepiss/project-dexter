/**
 * Data Dumper - Tracks tokens that hit 2x+ multiplier and dumps their data
 *
 * Features:
 * - Tracks both "degen" and "holder" tokens separately
 * - Records price path snapshots (1.25x, 1.5x, 1.75x)
 * - Dumps comprehensive data when token hits 2x
 * - Only records first 2x cross per token
 * - Exports to JSON for analysis
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.mjs';
import mvpCalculator from './mvpCalculator_v3.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Paths for runner data (go up two levels from src/backend to project root)
const RUNNERS_DIR = path.join(path.dirname(path.dirname(__dirname)), 'runners');
const RUNNERS_FILE = path.join(RUNNERS_DIR, 'runners.json');

// Price path milestones to track
const PRICE_MILESTONES = [1.25, 1.5, 1.75];

class DataDumper {
  constructor() {
    // Track tokens that have already hit 2x (to avoid duplicates)
    this.twoxCrossed = new Set();

    // Track price path snapshots for each token
    // address -> { 1.25: { mc, timestamp }, 1.5: { mc, timestamp }, ... }
    this.priceSnapshots = new Map();

    // Initialize directory and file
    this.initializeStorage();
  }

  /**
   * Initialize runners directory and JSON file
   */
  initializeStorage() {
    try {
      // Create runners directory if it doesn't exist
      if (!fs.existsSync(RUNNERS_DIR)) {
        fs.mkdirSync(RUNNERS_DIR, { recursive: true });
        logger.info(`Created runners directory: ${RUNNERS_DIR}`);
      }

      // Initialize runners.json if it doesn't exist
      if (!fs.existsSync(RUNNERS_FILE)) {
        const initialData = {
          metadata: {
            version: '1.0',
            createdAt: new Date().toISOString(),
            description: 'Tokens that have hit 2x+ multiplier from spotted market cap'
          },
          degen: [],
          holder: []
        };
        fs.writeFileSync(RUNNERS_FILE, JSON.stringify(initialData, null, 2));
        logger.success(`✅ DataDumper initialized: ${RUNNERS_FILE}`);
      } else {
        logger.info(`DataDumper ready: ${RUNNERS_FILE}`);
      }
    } catch (error) {
      logger.error('Failed to initialize runners storage', error);
    }
  }

  /**
   * Check and record price path milestones
   * Called whenever a token's multiplier updates
   */
  checkPriceMilestones(token, currentMultiplier) {
    const address = token.contractAddress;

    // Initialize snapshots map for this token
    if (!this.priceSnapshots.has(address)) {
      this.priceSnapshots.set(address, {});
    }

    const snapshots = this.priceSnapshots.get(address);
    const now = Date.now();

    // Check each milestone
    for (const milestone of PRICE_MILESTONES) {
      // Record if we just crossed this milestone (from below to at/above)
      if (currentMultiplier >= milestone && !snapshots[milestone]) {
        snapshots[milestone] = {
          marketCap: token.currentMc,
          timestamp: now,
          isoTime: new Date(now).toISOString(),
          multiplier: currentMultiplier
        };
        logger.debug(`📍 Price milestone ${milestone}x recorded for ${token.symbol || address.slice(0, 8)}...`);
      }
    }
  }

  /**
   * Check if token has hit 2x and dump data if so
   * Returns true if 2x was detected and dumped (first time only)
   */
  checkAndDumpTwoX(token) {
    const address = token.contractAddress;

    // Skip if already recorded
    if (this.twoxCrossed.has(address)) {
      return false;
    }

    const currentMultiplier = token.currentMc / token.spottedMc;

    // Debug: Log high multipliers (1.5x+) to see what's happening
    if (currentMultiplier >= 1.5) {
      logger.debug(`🔍 Multiplier check: ${token.symbol || address.slice(0,8)} @ ${currentMultiplier.toFixed(2)}x (spottedMc: $${token.spottedMc?.toFixed(0)}, currentMc: $${token.currentMc?.toFixed(0)})`);
    }

    // Check if we just hit 2x
    if (currentMultiplier >= 2.0) {
      this.twoxCrossed.add(address);
      logger.info(`🚀 2x DETECTED: ${token.symbol || token.name} @ ${currentMultiplier.toFixed(2)}x - dumping data...`);

      // Dump the data
      this.dumpTokenData(token, currentMultiplier);

      return true;
    }

    return false;
  }

  /**
   * Dump comprehensive token data to runners.json
   */
  dumpTokenData(token, currentMultiplier) {
    try {
      // Read existing data
      const rawData = fs.readFileSync(RUNNERS_FILE, 'utf8');
      const runnersData = JSON.parse(rawData);

      // Determine source type (degen or holder)
      const sourceType = (token.source === 'holder' || token.source === 'ex-holder') ? 'holder' : 'degen';

      // Get MVP score components
      const mvpScore = mvpCalculator.calculateMVPScore(token, 'all-time');

      // Get price snapshots for this token
      const snapshots = this.priceSnapshots.get(token.contractAddress) || {};

      // Build comprehensive data record
      const record = {
        // Basic token info
        contractAddress: token.contractAddress,
        name: token.name,
        symbol: token.symbol,
        chain: token.chainShort || 'solana',
        logoUrl: token.logoUrl,

        // Source info
        source: token.source,
        holderRank: token.holderRank || null,

        // 2x event info
        twoxTimestamp: Date.now(),
        twoxIsoTime: new Date().toISOString(),
        twoxMultiplier: currentMultiplier,

        // Market cap data
        spottedMc: token.spottedMc,
        spottedAt: token.spottedMc > 0 ? token.spottedAt : null,
        spottedIsoTime: token.spottedMc > 0 ? new Date(token.spottedAt).toISOString() : null,
        currentMc: token.currentMc,
        peakMc: token.peakMc,
        peakMultiplier: token.peakMultiplier,

        // Holder-specific data (if applicable)
        holderSpottedMc: token.holderSpottedMc || null,
        holderSpottedAt: token.holderSpottedAt || null,
        holderSpottedIsoTime: token.holderSpottedAt ? new Date(token.holderSpottedAt).toISOString() : null,
        holderPeakMc: token.holderPeakMc || null,
        holderPeakMultiplier: token.holderPeakMultiplier || null,

        // Volume data
        volume24h: token.volume24h || 0,
        previousVolume24h: token.previousVolume24h || null,

        // Liquidity
        liquidity: token.liquidity || 0,
        pools: token.pools || 0,

        // Price data
        priceUsd: token.priceUsd || 0,
        totalSupply: token.totalSupply || 0,

        // Time to 2x (in seconds)
        timeToTwoXSeconds: token.spottedAt > 0 ? Math.round((Date.now() - token.spottedAt) / 1000) : null,

        // Day of week and hour (for pattern analysis)
        dayOfWeek: new Date().getDay(), // 0=Sunday, 6=Saturday
        hourOfDay: new Date().getHours(),

        // Price path snapshots
        pricePath: {
          '1.25x': snapshots['1.25'] || null,
          '1.5x': snapshots['1.5'] || null,
          '1.75x': snapshots['1.75'] || null
        },

        // Transaction metrics (all timeframes)
        transactionMetrics: token.transactionMetrics || null,

        // MVP scoring components
        mvpScore: mvpScore.total || 0,
        mvpComponents: {
          buyPressure: mvpScore.components?.buyPressure || null,
          netBuyVolume: mvpScore.components?.netBuyVolume || null,
          txnsVelocity: mvpScore.components?.txnsVelocity || null,
          priceMomentum: mvpScore.components?.priceMomentum || null,
          sseMomentum: mvpScore.components?.sseMomentum || null
        },
        mvpHasData: mvpScore.hasData || false,
        mvpDataPoints: mvpScore.dataPoints || 0,

        // Timestamp of record
        recordedAt: Date.now(),
        recordedIso: new Date().toISOString()
      };

      // Add to appropriate array
      runnersData[sourceType].push(record);

      // Sort by timestamp (newest first)
      runnersData[sourceType].sort((a, b) => b.twoxTimestamp - a.twoxTimestamp);

      // Write back to file
      fs.writeFileSync(RUNNERS_FILE, JSON.stringify(runnersData, null, 2));

      logger.success(`✅ Dumped 2x data for ${token.symbol || token.name} to ${RUNNERS_FILE}`);

      // Clean up price snapshots for this token (save memory)
      this.priceSnapshots.delete(token.contractAddress);

    } catch (error) {
      logger.error(`Failed to dump 2x data for ${token.contractAddress}:`, error);
    }
  }

  /**
   * Get stats about dumped runners
   */
  getStats() {
    try {
      const rawData = fs.readFileSync(RUNNERS_FILE, 'utf8');
      const runnersData = JSON.parse(rawData);

      return {
        totalDegen: runnersData.degen.length,
        totalHolder: runnersData.holder.length,
        total: runnersData.degen.length + runnersData.holder.length,
        filePath: RUNNERS_FILE
      };
    } catch (error) {
      return {
        totalDegen: 0,
        totalHolder: 0,
        total: 0,
        filePath: RUNNERS_FILE,
        error: error.message
      };
    }
  }

  /**
   * Reset tracking (useful for testing or starting fresh)
   */
  reset() {
    this.twoxCrossed.clear();
    this.priceSnapshots.clear();
    logger.info('Data dumper tracking reset');
  }
}

// Export singleton instance
export const dataDumper = new DataDumper();
export default dataDumper;
