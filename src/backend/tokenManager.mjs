import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import logger from './logger.mjs';
import * as db from './database/db.mjs';
import * as dexscreener from './apis/dexscreener.mjs';
import * as bitquery from './apis/bitquery.mjs';
import * as dexpaprika from './apis/dexpaprika.mjs';
import { dexscreenerLimiter } from './rateLimit.mjs';
import mvpCalculator from './mvpCalculator_v3.mjs';

class TokenManager {
  constructor() {
    this.trackedTokens = new Map(); // contractAddress -> token object

    // Alert tiers (hardcoded)
    this.alertTiers = {
      tier1: 1.1,
      tier2: 1.2,  // Changed: Lowered from 1.25x to 1.2x
      tier3: 1.3   // Changed: Lowered from 1.4x to 1.3x
    };

    // Telegram service reference (injected)
    this.telegramService = null;
    this.telegramAutoAlert = true; // Default enabled

    // Tracking windows
    this.monitoringWindow = 2 * 60 * 60 * 1000; // 2 hours

    // Current view mode for filtering updates
    this.currentViewMode = 'all-time';

    // Intervals
    this.discoveryInterval = null;
    this.topUpdateInterval = null;
    this.backgroundUpdateInterval = null;
    this.dexpaprikaBackgroundInterval = null;

    // DexPaprika SSE state
    this.sseConnectedTokens = new Set(); // Track which tokens have SSE
    this.lastTop10Addresses = []; // Track last top 10 for rotation

    // Track tokens that failed discovery (to avoid spam)
    this.failedDiscoveryTokens = new Map(); // address -> { failedAt, reason }
  }

  setTelegramService(telegramService) {
    this.telegramService = telegramService;
  }

  setTelegramAutoAlert(enabled) {
    this.telegramAutoAlert = enabled;
    logger.info(`Telegram auto-alert: ${enabled ? 'enabled' : 'disabled'}`);
  }

  async initialize() {
    try {
      await db.initDatabase();
      const tiers = await db.getAlertTiers();
      this.alertTiers = {
        tier1: tiers.tier1Multiplier,
        tier2: tiers.tier2Multiplier,
        tier3: tiers.tier3Multiplier
      };
      
      // Load tokens from database (last 2 hours)
      await this.loadTokensFromDatabase();
      
      logger.success(`TokenManager initialized with tiers: T1=${logger.highlight(this.alertTiers.tier1 + 'x')}, T2=${logger.highlight(this.alertTiers.tier2 + 'x')}, T3=${logger.highlight(this.alertTiers.tier3 + 'x')}`);
    } catch (error) {
      logger.error('TokenManager initialization failed', error);
      throw error;
    }
  }

  async checkAndSendTier3Alert(token) {
    // Check if token just hit tier 3 for the first time
    if (!this.telegramService || !this.telegramAutoAlert) return;
    
    // Skip holder tokens for auto alerts
    if (token.source === 'holder' || token.source === 'ex-holder') return;
    
    // Check if token has hit tier 3
    if (token.peakMultiplier >= this.alertTiers.tier3) {
      // CRITICAL: Always mark as announced when hitting T3, even if messaging is disabled
      // This prevents spam when user enables telegram later
      if (!this.telegramService.isAnnounced(token.contractAddress)) {
        this.telegramService.markAsAnnounced(token.contractAddress, true);
        
        // Only attempt to send if messaging is enabled
        try {
          const tokenInfo = {
            name: token.name,
            symbol: token.symbol,
            multiplier: token.peakMultiplier
          };
          
          const result = await this.telegramService.sendTier3Alert(token.contractAddress, tokenInfo);
          
          if (result.sentToPrivate) {
            const name = token.symbol || token.name;
            logger.info(`📢 Tier 3 alert sent: ${name} @ ${token.peakMultiplier.toFixed(2)}x`);
          }
        } catch (error) {
          logger.error(`Failed to send Tier 3 alert for ${token.contractAddress}:`, error);
        }
      }
    }
  }

  async loadTokensFromDatabase() {
    try {
      const cutoffTime = Date.now() - this.monitoringWindow;
      const tokens = await db.getTokensByAge(2); // Last 2 hours

      let loadedCount = 0;
      for (const tokenData of tokens) {
        if (tokenData.spottedAt < cutoffTime) continue;

        // Skip blacklisted tokens
        if (db.isBlacklisted(tokenData.contractAddress)) continue;

        // Guard: never overwrite spottedAt for existing tokens
        let spottedAt = tokenData.spottedAt;
        if (this.trackedTokens.has(tokenData.contractAddress)) {
          const existing = this.trackedTokens.get(tokenData.contractAddress);
          if (existing.spottedAt && existing.spottedAt < spottedAt) {
            spottedAt = existing.spottedAt;
          }
        }

        const token = {
          id: tokenData.id,
          contractAddress: tokenData.contractAddress,
          name: tokenData.name,
          symbol: tokenData.symbol,
          chainShort: tokenData.chainShort,
          logoUrl: tokenData.logoUrl,
          spottedAt: spottedAt,
          spottedMc: tokenData.spottedMc,
          currentMc: tokenData.currentMc,
          previousMc: tokenData.previousMc,
          peakMc: tokenData.peakMultiplier * tokenData.spottedMc, // Recalculate from multiplier
          peakMultiplier: tokenData.peakMultiplier || 1.0,
          volume24h: tokenData.volume24h || 0,
          previousVolume24h: tokenData.previousVolume24h,
          // For UI arrows - set to null so first update creates proper baseline
          mcTenSecondsAgo: null,
          volTenSecondsAgo: null,
          _tenSecondSnapshotAt: null,
          _needsRefresh: true, // Flag to indicate this token needs a fresh fetch
          lastUpdated: tokenData.lastUpdated || Date.now()
        };

        this.trackedTokens.set(token.contractAddress, token);
        loadedCount++;
      }

      if (loadedCount > 0) {
        logger.info(`Restored ${logger.highlight(loadedCount)} tokens from database`);
        // Refresh restored tokens to get current prices and totalSupply
        await this.refreshRestoredTokens();
      }
    } catch (error) {
      logger.error('Failed to load tokens from database', error);
    }
  }

  // Refresh all restored tokens to get current data and totalSupply for SSE
  async refreshRestoredTokens() {
    try {
      const tokensToRefresh = Array.from(this.trackedTokens.values())
        .filter(t => t._needsRefresh);

      if (tokensToRefresh.length === 0) return;

      const addresses = tokensToRefresh.map(t => t.contractAddress);
      logger.info(`Refreshing ${addresses.length} restored tokens from DexPaprika...`);

      // Fetch current data including totalSupply
      const prices = await dexpaprika.getBatchPrices(addresses, 10);

      let refreshedCount = 0;
      const now = Date.now();

      for (const [addr, data] of Object.entries(prices)) {
        if (!data) continue;

        const token = this.trackedTokens.get(addr);
        if (!token) continue;

        // Store previous values for NET calculation baseline
        const prevMc = token.currentMc;
        const prevVol = token.volume24h || 0;

        // Update with fresh data
        if (data.marketCap) token.currentMc = data.marketCap;
        if (data.volume24h !== undefined) token.volume24h = data.volume24h;
        if (data.priceUsd) token.priceUsd = data.priceUsd;
        if (data.totalSupply) token.totalSupply = data.totalSupply;

        // Set baseline for NET calculation (use DB value as "10 seconds ago")
        token.mcTenSecondsAgo = prevMc;
        token.volTenSecondsAgo = prevVol;
        token._tenSecondSnapshotAt = now;

        // Recalculate peak if current is higher
        const currentMultiplier = token.currentMc / token.spottedMc;
        if (currentMultiplier > token.peakMultiplier) {
          token.peakMultiplier = currentMultiplier;
          token.peakMc = token.currentMc;
        }

        token.lastUpdated = now;
        token._needsRefresh = false;

        refreshedCount++;
      }

      logger.success(`Refreshed ${refreshedCount}/${addresses.length} tokens with current prices`);
    } catch (error) {
      logger.error('Failed to refresh restored tokens', error);
    }
  }

  async startTracking() {
    logger.startup('Starting token tracking system');

    // CYCLE 1: Discovery - Find new tokens (every 1 second, respects 60 req/min limit)
    await this.discoverNewTokens();
    this.discoveryInterval = setInterval(() => {
      this.discoverNewTokens();
    }, 1000);

    // Wait a moment then start updates
    await new Promise(r => setTimeout(r, 500));

    // CYCLE 2: DexPaprika SSE for top 10 tokens (real-time ~1s updates)
    this.setupDexPaprikaSSE();

    // Update SSE subscriptions every 5 seconds (check if top 10 changed)
    this.topUpdateInterval = setInterval(() => {
      this.updateSSESubscriptions();
    }, 5000);

    // CYCLE 3: DexPaprika REST for background tokens (every 15 seconds)
    // This updates all tokens NOT in the SSE top 10
    this.dexpaprikaBackgroundInterval = setInterval(() => {
      this.updateBackgroundTokensDexPaprika();
    }, 15000);

    // Initial background update after 2 seconds
    setTimeout(() => {
      this.updateBackgroundTokensDexPaprika();
    }, 2000);
  }

  stopTracking() {
    if (this.discoveryInterval) clearInterval(this.discoveryInterval);
    if (this.topUpdateInterval) clearInterval(this.topUpdateInterval);
    if (this.top3UpdateInterval) clearInterval(this.top3UpdateInterval);
    if (this.next7UpdateInterval) clearInterval(this.next7UpdateInterval);
    if (this.backgroundUpdateInterval) clearInterval(this.backgroundUpdateInterval);
    if (this.restUpdateInterval) clearInterval(this.restUpdateInterval);
    if (this.dexpaprikaBackgroundInterval) clearInterval(this.dexpaprikaBackgroundInterval);

    // Shutdown DexPaprika SSE connections
    dexpaprika.shutdown();

    logger.info('Token tracking stopped');
  }

  // ============ DexPaprika SSE Integration ============

  // Setup SSE connection and price update handler
  setupDexPaprikaSSE() {
    logger.info('Setting up DexPaprika SSE for real-time top 10 updates');

    // Register callback for SSE price updates
    dexpaprika.onPriceUpdate((address, price, timestamp) => {
      this.handleSSEPriceUpdate(address, price, timestamp);
    });

    // Initial subscription
    this.updateSSESubscriptions();
  }

  // Update SSE subscriptions based on current top 10
  updateSSESubscriptions() {
    try {
      const top10 = this.getTop10(this.currentViewMode);
      const newAddresses = top10.map(t => t.contractAddress);

      // Check if top 10 actually changed
      const changed = newAddresses.length !== this.lastTop10Addresses.length ||
                      newAddresses.some((addr, i) => addr !== this.lastTop10Addresses[i]);

      if (changed) {
        const result = dexpaprika.subscribeTop10(newAddresses);
        this.sseConnectedTokens = new Set(newAddresses);
        this.lastTop10Addresses = newAddresses;

        if (newAddresses.length > 0) {
          logger.info(`📡 SSE subscribed to ${result.connected} top tokens`);
        }
      }
    } catch (error) {
      logger.error('SSE subscription update failed', error);
    }
  }

  // Handle real-time price update from SSE
  handleSSEPriceUpdate(address, price, timestamp) {
    const token = this.trackedTokens.get(address);
    if (!token) return;

    const now = Date.now();

    // Snapshot "10 seconds ago" values for UI arrows
    // Initialize baseline if null (first update after restore)
    if (token._tenSecondSnapshotAt === null) {
      token._tenSecondSnapshotAt = now;
      token.mcTenSecondsAgo = token.currentMc;
      token.volTenSecondsAgo = token.volume24h || 0;
    } else if (now - token._tenSecondSnapshotAt >= 10000) {
      token._tenSecondSnapshotAt = now;
      token.mcTenSecondsAgo = token.currentMc;
      token.volTenSecondsAgo = token.volume24h || 0;
    }

    // Update price
    token.priceUsd = price;
    token.lastUpdated = now;
    token.lastSSEUpdate = now;

    // Only calculate MC from price if we have verified supply from DexPaprika
    // Otherwise, rely on the MC from discovery/background REST updates
    if (token.totalSupply && token.totalSupply > 0) {
      const newMc = dexpaprika.calculateMarketCap(price, token.totalSupply);

      // Preserve previous value
      token.previousMc = token.currentMc;
      token.currentMc = newMc;

      // Recalculate peak multiplier
      const previousPeak = token.peakMultiplier;
      const currentMultiplier = token.currentMc / token.spottedMc;
      if (currentMultiplier > token.peakMultiplier) {
        token.peakMultiplier = currentMultiplier;
        token.peakMc = token.currentMc;
        
        // Check for tier 3 alert (only if crossing from below to above)
        if (previousPeak < this.alertTiers.tier3 && currentMultiplier >= this.alertTiers.tier3) {
          this.checkAndSendTier3Alert(token);
        }
      }
    }

    // Record snapshot for MVP momentum tracking
    mvpCalculator.recordSnapshot(address, token.currentMc, token.volume24h);

    // Save to database (debounced - only save every 5 seconds per token)
    if (!token._lastDbSave || now - token._lastDbSave >= 5000) {
      token._lastDbSave = now;
      db.insertOrUpdateToken(token).catch(err => {
        logger.error(`DB save failed for ${address}: ${err.message}`);
      });
    }
  }

  // Background update for tokens NOT in SSE top 10
  // Also includes holder/ex-holder tokens regardless of time window
  async updateBackgroundTokensDexPaprika() {
    try {
      // Get all tokens from last hour (monitoring window)
      const windowMs = 60 * 60 * 1000; // 1 hour for background tracking
      const now = Date.now();

      const backgroundTokens = Array.from(this.trackedTokens.values())
        .filter(t => {
          const isHolderToken = t.source === 'holder' || t.source === 'ex-holder';
          const inTimeWindow = now - t.spottedAt <= windowMs;
          const notInSSE = !this.sseConnectedTokens.has(t.contractAddress);
          // Include holder tokens regardless of time window, others need to be in window
          return notInSSE && (isHolderToken || inTimeWindow);
        });

      if (backgroundTokens.length === 0) return;

      const addresses = backgroundTokens.map(t => t.contractAddress);
      logger.info(`🔄 DexPaprika background update: ${addresses.length} tokens`);

      // Fetch in batches (10 concurrent requests)
      const prices = await dexpaprika.getBatchPrices(addresses, 10);

      let updatedCount = 0;
      for (const [addr, data] of Object.entries(prices)) {
        if (!data) continue;

        const token = this.trackedTokens.get(addr);
        if (!token) continue;

        // Snapshot for UI arrows (10-second for degen mode)
        // Initialize baseline if null (first update after restore)
        if (token._tenSecondSnapshotAt === null) {
          token._tenSecondSnapshotAt = now;
          token.mcTenSecondsAgo = token.currentMc;
          token.volTenSecondsAgo = token.volume24h || 0;
        } else if (now - token._tenSecondSnapshotAt >= 10000) {
          token._tenSecondSnapshotAt = now;
          token.mcTenSecondsAgo = token.currentMc;
          token.volTenSecondsAgo = token.volume24h || 0;
        }

        // 10-minute snapshot for holder mode NET calculation
        const isHolderToken = token.source === 'holder' || token.source === 'ex-holder';
        if (isHolderToken) {
          if (token._tenMinuteSnapshotAt === undefined || token._tenMinuteSnapshotAt === null) {
            token._tenMinuteSnapshotAt = now;
            token.mcTenMinutesAgo = token.currentMc;
          } else if (now - token._tenMinuteSnapshotAt >= 600000) { // 10 minutes
            token._tenMinuteSnapshotAt = now;
            token.mcTenMinutesAgo = token.currentMc;
          }
        }

        // Preserve previous values
        token.previousMc = token.currentMc;
        token.previousVolume24h = token.volume24h;

        // Sanity check: reject unrealistic data from DexPaprika
        // Volume > 1000x MC is clearly wrong data
        if (data.volume24h && data.marketCap && data.volume24h > data.marketCap * 1000) {
          logger.warn(`Rejecting bad DexPaprika data for ${addr.slice(0,8)}...: Vol ${data.volume24h} > 1000x MC ${data.marketCap}`);
          continue;
        }

        // Update with DexPaprika data
        if (data.marketCap) token.currentMc = data.marketCap;
        if (data.volume24h !== undefined) token.volume24h = data.volume24h;
        if (data.priceUsd) token.priceUsd = data.priceUsd;
        if (data.totalSupply) token.totalSupply = data.totalSupply; // Store for SSE MC calc
        token.lastUpdated = now;

        // NEW: Store transaction metrics for MVP scoring
        if (data.transactionMetrics) {
            token.transactionMetrics = data.transactionMetrics;
            token.lastMetricsUpdate = now;
        }

        // Holder tokens: initialize spottedMc if it was 0 (added without initial data)
        if (isHolderToken && token.spottedMc === 0 && data.marketCap) {
          token.spottedMc = data.marketCap;
          token.peakMc = data.marketCap;
          // Also initialize holder-specific stats with real data
          token.holderSpottedMc = data.marketCap;
          token.holderPeakMc = data.marketCap;
          // Also initialize the 10-minute baseline with real data
          token.mcTenMinutesAgo = data.marketCap;
          token._tenMinuteSnapshotAt = now;
        }

        // Clear needsDataFetch flag for holder tokens that now have data
        if (isHolderToken && token._needsDataFetch && data.marketCap) {
          token._needsDataFetch = false;
        }

        // Recalculate peak multiplier (degen mode stats)
        const previousPeak = token.peakMultiplier;
        const currentMultiplier = token.currentMc / token.spottedMc;
        if (currentMultiplier > token.peakMultiplier) {
          token.peakMultiplier = currentMultiplier;
          token.peakMc = token.currentMc;
          
          // Check for tier 3 alert (only if crossing from below to above)
          if (previousPeak < this.alertTiers.tier3 && currentMultiplier >= this.alertTiers.tier3) {
            this.checkAndSendTier3Alert(token);
          }
        }

        // Update holder-specific peak values for holder tokens
        if (isHolderToken && token.holderSpottedMc && token.holderSpottedMc > 0) {
          const holderMultiplier = token.currentMc / token.holderSpottedMc;
          if (holderMultiplier > (token.holderPeakMultiplier || 1.0)) {
            token.holderPeakMultiplier = holderMultiplier;
            token.holderPeakMc = token.currentMc;
          }
        }

        // Fetch missing logo for holder tokens (retry mechanism)
        if (isHolderToken && !token.logoUrl && !token._logoFetchAttempted) {
          try {
            const tokenData = await dexscreener.getTokenByAddress(addr);
            if (tokenData && tokenData.logoUrl) {
              token.logoUrl = tokenData.logoUrl;
              logger.info(`🖼️ Fetched missing logo for holder token: ${token.symbol || addr.slice(0, 8)}`);
            }
            // Mark as attempted to avoid repeated fetches for tokens without logos
            token._logoFetchAttempted = true;
          } catch (logoError) {
            // Silently fail - logo is not critical
            token._logoFetchAttempted = true;
          }
        }

        // Record snapshot for MVP momentum tracking
        mvpCalculator.recordSnapshot(addr, token.currentMc, token.volume24h);

        // Save to database
        await db.insertOrUpdateToken(token);
        updatedCount++;
      }

      if (updatedCount > 0) {
        logger.info(`📊 Updated ${updatedCount}/${addresses.length} background tokens via DexPaprika`);
      }

      // Cleanup old tokens
      await this.cleanupOldTokens();
    } catch (error) {
      logger.error('DexPaprika background update failed', error);
    }
  }

  // CYCLE 1: Discovery - Get new tokens from profiles API
  async discoverNewTokens() {
    try {
      await dexscreenerLimiter.acquire();
      const newTokens = await dexscreener.getLatestTokenProfiles();

      if (!newTokens || newTokens.length === 0) {
        return;
      }

      // Filter to only NEW tokens (not already tracked and not recently failed)
      const now = Date.now();
      const RETRY_FAILED_AFTER = 5 * 60 * 1000; // Retry failed tokens after 5 minutes

      const tokensToAdd = newTokens.filter(t => {
        // Skip if already tracked
        if (this.trackedTokens.has(t.contractAddress)) return false;

        // Skip if blacklisted
        if (db.isBlacklisted(t.contractAddress)) return false;

        // Skip if recently failed (retry after 5 min)
        const failed = this.failedDiscoveryTokens.get(t.contractAddress);
        if (failed && now - failed.failedAt < RETRY_FAILED_AFTER) return false;

        return true;
      });

      if (tokensToAdd.length === 0) return;

      logger.info(`🔍 Found ${tokensToAdd.length} new token${tokensToAdd.length > 1 ? 's' : ''} to discover`);

      // Batch fetch initial market caps (use the same batchFetchAndUpdate logic)
      const addresses = tokensToAdd.map(t => t.contractAddress);
      const batchSize = 30;
      
      for (let i = 0; i < addresses.length; i += batchSize) {
        const batch = addresses.slice(i, i + batchSize);
        const batchTokenData = tokensToAdd.filter(t => batch.includes(t.contractAddress));
        
        await dexscreenerLimiter.acquire();
        
        try {
          const response = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${batch.join(',')}`,
            {
              headers: { 'User-Agent': 'Project-Dexter/1.0' },
              timeout: 10000
            }
          );

          if (!response.data?.pairs) continue;

          // Group pairs by address
          const pairsByAddress = {};
          for (const pair of response.data.pairs) {
            const addr = pair.baseToken?.address;
            if (!addr) continue;
            if (!pairsByAddress[addr]) pairsByAddress[addr] = [];
            pairsByAddress[addr].push(pair);
          }

          // For each new token, pick best pair and create token object
          for (const tokenData of batchTokenData) {
            const addr = tokenData.contractAddress;
            const pairs = pairsByAddress[addr];
            
            if (!pairs || pairs.length === 0) {
              // Track this failure to avoid discovery spam
              this.failedDiscoveryTokens.set(addr, { failedAt: Date.now(), reason: 'no_pairs' });
              continue;
            }

            // Pick best pair using intelligent ranking (liquidity > market cap > price data)
            const bestPair = pairs.sort((a, b) => {
              const liqA = a.liquidity?.usd || 0;
              const liqB = b.liquidity?.usd || 0;
              const mcA = a.marketCap || a.fdv || 0;
              const mcB = b.marketCap || b.fdv || 0;
              
              // Rank by: liquidity presence > liquidity amount > market cap presence > market cap amount
              const rankA = [
                liqA > 0 ? 1 : 0,
                liqA,
                mcA > 0 ? 1 : 0,
                mcA
              ];
              const rankB = [
                liqB > 0 ? 1 : 0,
                liqB,
                mcB > 0 ? 1 : 0,
                mcB
              ];
              
              for (let i = 0; i < rankA.length; i++) {
                if (rankB[i] !== rankA[i]) return rankB[i] - rankA[i];
              }
              return 0;
            })[0];

            const mc = bestPair.marketCap || bestPair.fdv;
            if (!mc || mc === 0) {
              // Track this failure to avoid discovery spam
              this.failedDiscoveryTokens.set(addr, { failedAt: Date.now(), reason: 'no_mc' });
              continue;
            }

            // Guard: never overwrite spottedAt for existing tokens
            let spottedAt = Date.now();
            if (this.trackedTokens.has(addr)) {
              const existing = this.trackedTokens.get(addr);
              if (existing.spottedAt && existing.spottedAt < spottedAt) {
                spottedAt = existing.spottedAt;
              }
            }
            const token = {
              id: uuidv4(),
              contractAddress: addr,
              name: bestPair.baseToken?.name || tokenData.name || 'Unknown',
              symbol: bestPair.baseToken?.symbol || tokenData.symbol,
              chainShort: 'Solana',
              logoUrl: tokenData.logoUrl,
              spottedAt: spottedAt,
              spottedMc: mc,
              currentMc: mc,
              previousMc: null,
              peakMc: mc,
              peakMultiplier: 1.0,
              volume24h: bestPair.volume?.h24 || 0,
              previousVolume24h: null,
              mcTenSecondsAgo: mc,
              volTenSecondsAgo: bestPair.volume?.h24 || 0,
              _tenSecondSnapshotAt: Date.now(),
              lastUpdated: Date.now()
            };

            this.trackedTokens.set(addr, token);
            await db.insertOrUpdateToken(token);
          }
        } catch (err) {
          logger.error(`Batch discovery failed for ${batch.length} tokens:`, err?.response?.data || err?.message || err);
        }
      }

      // Cleanup old tokens (2+ hours old)
      await this.cleanupOldTokens();
    } catch (error) {
      logger.error('Token discovery failed', error);
    }
  }


  // CYCLE 2: Update tokens that hit Tier 2 (1.25x+) AND have MC >= 8K using Bitquery (max 3 tokens, every 4s) - DISABLED
  // async updateTop3Bitquery() {
  //   try {
  //     // Get all tokens that have hit Tier 2 threshold (1.25x) AND have market cap >= 8K
  //     const minMcForBitquery = 8000;
  //     const windowMs = this.getViewModeWindowMs();
  //     const now = Date.now();
  //
  //     const tier2Tokens = Array.from(this.trackedTokens.values())
  //       .filter(t => {
  //         // Filter by time window based on current view mode
  //         const inTimeWindow = windowMs ? (now - t.spottedAt <= windowMs) : true;
  //
  //         return inTimeWindow &&
  //                t.peakMultiplier >= this.alertTiers.tier2 &&
  //                t.currentMc >= minMcForBitquery;
  //       })
  //       .sort((a, b) => b.peakMultiplier - a.peakMultiplier)
  //       .slice(0, 3); // Cap at 3 tokens max
  //
  //     if (tier2Tokens.length === 0) return;
  //
  //     const addresses = tier2Tokens.map(t => t.contractAddress);
  //     logger.info(`🟦 Bitquery update: ${addresses.length} tokens ≥${this.alertTiers.tier2}x & ≥$8K (view: ${this.currentViewMode})`);
  //     await this.bitqueryBatchUpdate(addresses);
  //   } catch (error) {
  //     logger.error('Tier 2+ Bitquery update failed', error);
  //   }
  // }

  // CYCLE 3: Update all tokens using Dexscreener every 10s (using all tokens, not filtered by tier)
  async updateAllTokensDexscreener() {
    try {
      // Get all tracked tokens filtered by current view mode
      const windowMs = this.getViewModeWindowMs();
      const now = Date.now();

      const allTokens = Array.from(this.trackedTokens.values())
        .filter(t => {
          // Filter by time window based on current view mode
          const inTimeWindow = windowMs ? (now - t.spottedAt <= windowMs) : true;
          return inTimeWindow;
        });

      const addresses = allTokens.map(t => t.contractAddress);
      if (addresses.length === 0) return;

      logger.info(`🟨 Dexscreener update: ${addresses.length} tokens (view: ${this.currentViewMode})`);

      // Batch update in groups of 30 (Dexscreener limit)
      const batchSize = 30;
      for (let i = 0; i < addresses.length; i += batchSize) {
        const batch = addresses.slice(i, i + batchSize);
        await this.batchFetchAndUpdate(batch);
        if (i + batchSize < addresses.length) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      await this.cleanupOldTokens();
    } catch (error) {
      logger.error('Dexscreener update failed', error);
    }
  }

  // CYCLE 3 (OLD): Update all tokens below Tier 2 threshold using Dexscreener every 10s - DISABLED
  // async updateAllExceptTop3Dexscreener() {
  //   try {
  //     // Get tokens that are BELOW Tier 2 threshold (< 1.25x)
  //     // These get slower DexScreener updates
  //     const windowMs = this.getViewModeWindowMs();
  //     const now = Date.now();
  //
  //     const belowTier2Tokens = Array.from(this.trackedTokens.values())
  //       .filter(t => {
  //         // Filter by time window based on current view mode
  //         const inTimeWindow = windowMs ? (now - t.spottedAt <= windowMs) : true;
  //
  //         return inTimeWindow && t.peakMultiplier < this.alertTiers.tier2;
  //       });
  //
  //     const addresses = belowTier2Tokens.map(t => t.contractAddress);
  //     if (addresses.length === 0) return;
  //
  //     logger.info(`🟨 Dexscreener update: ${addresses.length} tokens <${this.alertTiers.tier2}x (view: ${this.currentViewMode})`);
  //
  //     // Batch update in groups of 30 (Dexscreener limit)
  //     const batchSize = 30;
  //     for (let i = 0; i < addresses.length; i += batchSize) {
  //       const batch = addresses.slice(i, i + batchSize);
  //       await this.batchFetchAndUpdate(batch);
  //       if (i + batchSize < addresses.length) {
  //         await new Promise(r => setTimeout(r, 1000));
  //       }
  //     }
  //     await this.cleanupOldTokens();
  //   } catch (error) {
  //     logger.error('Below Tier 2 Dexscreener update failed', error);
  //   }
  // }

  // Helper: Batch fetch and update using Bitquery API - DISABLED
  // async bitqueryBatchUpdate(addresses) {
  //   try {
  //     if (addresses.length === 0) return;
  //
  //     // Fetch market caps from Bitquery
  //     const priceData = await bitquery.getTokenMarketCaps(addresses);
  //
  //     if (priceData.size === 0) {
  //       logger.warn(`No price data returned for batch of ${addresses.length} tokens`);
  //       return;
  //     }
  //
  //     let updatedCount = 0;
  //
  //     // Update each token with Bitquery data
  //     for (const [addr, data] of priceData.entries()) {
  //       const token = this.trackedTokens.get(addr);
  //       if (!token) continue;
  //
  //       const now = Date.now();
  //
  //       // Snapshot "10 seconds ago" values for UI arrows
  //       if (!token._tenSecondSnapshotAt) {
  //         token._tenSecondSnapshotAt = now;
  //         token.mcTenSecondsAgo = token.currentMc;
  //         token.volTenSecondsAgo = token.volume24h || 0;
  //       } else if (now - token._tenSecondSnapshotAt >= 10000) {
  //         token._tenSecondSnapshotAt = now;
  //         token.mcTenSecondsAgo = token.currentMc;
  //         token.volTenSecondsAgo = token.volume24h || 0;
  //       }
  //
  //       // Preserve previous values for DB/UI
  //       token.previousMc = token.currentMc;
  //
  //       // Update market cap from Bitquery
  //       token.currentMc = data.marketCap;
  //       token.lastUpdated = now;
  //
  //       // Update name/symbol if they were "Unknown" and Bitquery has better data
  //       if (token.name === 'Unknown' && data.name) {
  //         token.name = data.name;
  //       }
  //       if (!token.symbol && data.symbol) {
  //         token.symbol = data.symbol;
  //       }
  //
  //       // Recalculate peak multiplier
  //       const currentMultiplier = token.currentMc / token.spottedMc;
  //       if (currentMultiplier > token.peakMultiplier) {
  //         token.peakMultiplier = currentMultiplier;
  //         token.peakMc = token.currentMc;
  //       }
  //
  //       // Save to database
  //       await db.insertOrUpdateToken(token);
  //       updatedCount++;
  //     }
  //
  //     if (updatedCount > 0) {
  //       logger.info(`📊 Updated ${updatedCount}/${addresses.length} tokens via Bitquery`);
  //     }
  //   } catch (error) {
  //     logger.warn(`Bitquery batch update failed: ${error?.message || 'unknown error'}`);
  //   }
  // }

  // Helper: OLD DexScreener batch update (kept for initial discovery)
  async batchFetchAndUpdate(addresses) {
    try {
      if (addresses.length === 0) return;

      await dexscreenerLimiter.acquire();

      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/tokens/${addresses.join(',')}`,
        {
          headers: { 'User-Agent': 'Project-Dexter/1.0' },
          timeout: 10000
        }
      );

      if (!response.data?.pairs) {
        logger.warn(`No pairs returned for batch of ${addresses.length} tokens`);
        return;
      }

      // Group pairs by contract address
      const pairsByAddress = {};
      for (const pair of response.data.pairs) {
        const addr = pair.baseToken?.address;
        if (!addr) continue;
        
        if (!pairsByAddress[addr]) {
          pairsByAddress[addr] = [];
        }
        pairsByAddress[addr].push(pair);
      }

      // Update each token with its best pair
      for (const addr of Object.keys(pairsByAddress)) {
        const token = this.trackedTokens.get(addr);
        if (!token) continue;

        const now = Date.now();
        // Snapshot "10 seconds ago" values for UI arrows
        // Initialize baseline if null (first update after restore)
        if (token._tenSecondSnapshotAt === null) {
          token._tenSecondSnapshotAt = now;
          token.mcTenSecondsAgo = token.currentMc;
          token.volTenSecondsAgo = token.volume24h || 0;
        } else if (now - token._tenSecondSnapshotAt >= 10000) {
          token._tenSecondSnapshotAt = now;
          token.mcTenSecondsAgo = token.currentMc;
          token.volTenSecondsAgo = token.volume24h || 0;
        }

        // Pick best pair using intelligent ranking (liquidity > market cap > price data)
        const pairs = pairsByAddress[addr].sort((a, b) => {
          const liqA = a.liquidity?.usd || 0;
          const liqB = b.liquidity?.usd || 0;
          const mcA = a.marketCap || a.fdv || 0;
          const mcB = b.marketCap || b.fdv || 0;
          
          // Rank by: liquidity presence > liquidity amount > market cap presence > market cap amount
          const rankA = [
            liqA > 0 ? 1 : 0,
            liqA,
            mcA > 0 ? 1 : 0,
            mcA
          ];
          const rankB = [
            liqB > 0 ? 1 : 0,
            liqB,
            mcB > 0 ? 1 : 0,
            mcB
          ];
          
          for (let i = 0; i < rankA.length; i++) {
            if (rankB[i] !== rankA[i]) return rankB[i] - rankA[i];
          }
          return 0;
        });

        const bestPair = pairs[0];
        
        // Update market cap and volume
        const newMc = bestPair.marketCap || bestPair.fdv;
        const newVol = bestPair.volume?.h24 || 0;
        
        // Preserve previous values for DB/UI
        token.previousMc = token.currentMc;
        token.previousVolume24h = token.volume24h;

        if (newMc) token.currentMc = newMc;
        if (newVol !== undefined) token.volume24h = newVol;
        token.lastUpdated = Date.now();

        // Recalculate peak multiplier
        const currentMultiplier = token.currentMc / token.spottedMc;
        if (currentMultiplier > token.peakMultiplier) {
          token.peakMultiplier = currentMultiplier;
          token.peakMc = token.currentMc;
        }

        // Save to database
        await db.insertOrUpdateToken(token);
      }
    } catch (error) {
      logger.warn(`Batch fetch failed: ${error?.message || 'unknown error'}`);
    }
  }

  // Helper: Get top 10 tokens (peakMultiplier >= 1.1x, sorted by peak multiplier)
  getTop10(viewMode = 'all-time') {
    // Determine time window in ms
    let windowMs = null;
    switch (viewMode) {
      case '5m': windowMs = 5 * 60 * 1000; break;
      case '30m': windowMs = 30 * 60 * 1000; break;
      case '1h': windowMs = 60 * 60 * 1000; break;
      case '4h': windowMs = 4 * 60 * 60 * 1000; break;
      case 'all-time': default: windowMs = null; break;
    }
    const now = Date.now();
    return Array.from(this.trackedTokens.values())
      .filter(t => {
        const passesTier = t.peakMultiplier >= this.alertTiers.tier1;
        const passesTime = windowMs ? (now - t.spottedAt <= windowMs) : true;
        return passesTier && passesTime;
      })
      .sort((a, b) => b.peakMultiplier - a.peakMultiplier)
      .slice(0, 10);
  }

  // Get MVP coin from top 10 based on momentum scoring
  getMVP(viewMode = 'all-time') {
    const top10 = this.getTop10(viewMode);
    return mvpCalculator.getMVP(top10, viewMode);
  }

  // Helper: Get all tokens for "Check Tokens" view
  getAllTokens() {
    return Array.from(this.trackedTokens.values())
      .sort((a, b) => b.peakMultiplier - a.peakMultiplier);
  }

  // Helper: Clean up tokens older than 2 hours (excludes holder coins)
  async cleanupOldTokens() {
    try {
      const cutoffTime = Date.now() - this.monitoringWindow;
      const keysToDelete = [];

      for (const [addr, token] of this.trackedTokens.entries()) {
        // Never expire holder coins - they stay tracked indefinitely
        if (token.source === 'holder') continue;

        if (token.spottedAt < cutoffTime) {
          keysToDelete.push(addr);
        }
      }

      keysToDelete.forEach(addr => this.trackedTokens.delete(addr));

      if (keysToDelete.length > 0) {
        logger.database(`Cleaned up ${keysToDelete.length} old tokens (2h+ old)`);
      }

      // Clean up MVP calculator buffers for tokens no longer tracked
      mvpCalculator.cleanupStaleBuffers(Array.from(this.trackedTokens.keys()));
    } catch (error) {
      logger.error('Token cleanup failed', error);
    }
  }

  setDataSource(source) {
    this.currentDataSource = 'dexscreener';
    logger.info(`Data source: ${logger.highlight('dexscreener')}`);
  }

  async setAlertTiers(tier1, tier2, tier3) {
    try {
      this.alertTiers = { tier1, tier2, tier3 };
      await db.updateAlertTiers(tier1, tier2, tier3);
      logger.success(`Alert tiers updated: T1=${logger.highlight(tier1 + 'x')}, T2=${logger.highlight(tier2 + 'x')}, T3=${logger.highlight(tier3 + 'x')}`);
    } catch (error) {
      logger.error('Failed to update alert tiers', error);
      throw error;
    }
  }

  setViewMode(viewMode) {
    const validModes = ['5m', '30m', '1h', '4h', 'all-time'];
    if (!validModes.includes(viewMode)) {
      logger.warn(`Invalid view mode: ${viewMode}, defaulting to all-time`);
      this.currentViewMode = 'all-time';
      return;
    }

    if (this.currentViewMode !== viewMode) {
      logger.info(`View mode changed: ${this.currentViewMode} → ${viewMode}`);
      this.currentViewMode = viewMode;
    }
  }

  getViewModeWindowMs(viewMode = this.currentViewMode) {
    switch (viewMode) {
      case '5m': return 5 * 60 * 1000;
      case '30m': return 30 * 60 * 1000;
      case '1h': return 60 * 60 * 1000;
      case '4h': return 4 * 60 * 60 * 1000;
      case 'all-time':
      default: return null;
    }
  }

  // ============================================
  // HOLDER MODE METHODS
  // ============================================

  // Add a token from the holder channel
  async addHolderToken(contractAddress, rank) {
    try {
      // Check if already tracking
      if (this.trackedTokens.has(contractAddress)) {
        const existing = this.trackedTokens.get(contractAddress);
        const now = Date.now();
        existing.source = 'holder';
        existing.holderRank = rank;

        // Initialize holder-specific stats if not already set (first time added to holder list)
        if (!existing.holderSpottedAt) {
          existing.holderSpottedAt = now;
          existing.holderSpottedMc = existing.currentMc || 0;
          existing.holderPeakMc = existing.currentMc || 0;
          existing.holderPeakMultiplier = 1.0;
          // Initialize 10-minute snapshot for holder NET tracking
          existing.mcTenMinutesAgo = existing.currentMc || 0;
          existing._tenMinuteSnapshotAt = now;
        }

        await db.insertOrUpdateToken(existing);
        return existing;
      }

      const now = Date.now();

      // Fetch token data from DexScreener
      const tokenData = await dexscreener.getTokenByAddress(contractAddress);

      // Even if DexScreener fails, create a basic entry - holder coins always show
      if (!tokenData) {
        logger.warn(`DexScreener has no data for holder token #${rank}: ${contractAddress.slice(0, 8)}... - creating basic entry`);

        const token = {
          id: uuidv4(),
          contractAddress,
          name: 'Unknown',
          symbol: contractAddress.slice(0, 6).toUpperCase(),
          chainShort: 'solana',
          logoUrl: null,
          spottedAt: now,
          spottedMc: 0,
          currentMc: 0,
          previousMc: null,
          peakMc: 0,
          peakMultiplier: 1.0,
          volume24h: 0,
          previousVolume24h: null,
          mcTenSecondsAgo: 0,
          volTenSecondsAgo: 0,
          _tenSecondSnapshotAt: now,
          mcTenMinutesAgo: 0,
          _tenMinuteSnapshotAt: now,
          lastUpdated: now,
          source: 'holder',
          holderRank: rank,
          // Holder-specific stats (separate from degen mode stats)
          holderSpottedAt: now,
          holderSpottedMc: 0,
          holderPeakMc: 0,
          holderPeakMultiplier: 1.0,
          _needsDataFetch: true // Flag to retry fetching data later
        };

        this.trackedTokens.set(contractAddress, token);
        await db.insertOrUpdateToken(token);
        logger.info(`Added holder token #${rank} (no data): ${contractAddress.slice(0, 8)}...`);
        return token;
      }

      // Find best pair for market cap
      const pairs = tokenData.pairs || [];
      const bestPair = pairs.sort((a, b) => {
        const mcA = a.marketCap || a.fdv || 0;
        const mcB = b.marketCap || b.fdv || 0;
        return mcB - mcA;
      })[0];

      // Even if no pairs, create entry with available data
      const mc = bestPair?.marketCap || bestPair?.fdv || 0;

      const token = {
        id: uuidv4(),
        contractAddress,
        name: bestPair?.baseToken?.name || tokenData.name || 'Unknown',
        symbol: bestPair?.baseToken?.symbol || tokenData.symbol || contractAddress.slice(0, 6).toUpperCase(),
        chainShort: bestPair?.chainId || 'solana',
        logoUrl: tokenData.logoUrl || null,
        spottedAt: now,
        spottedMc: mc,
        currentMc: mc,
        previousMc: null,
        peakMc: mc,
        peakMultiplier: 1.0,
        volume24h: bestPair?.volume?.h24 || 0,
        previousVolume24h: null,
        mcTenSecondsAgo: mc,
        volTenSecondsAgo: bestPair?.volume?.h24 || 0,
        _tenSecondSnapshotAt: now,
        mcTenMinutesAgo: mc,
        _tenMinuteSnapshotAt: now,
        lastUpdated: now,
        source: 'holder',
        holderRank: rank,
        // Holder-specific stats (separate from degen mode stats)
        holderSpottedAt: now,
        holderSpottedMc: mc,
        holderPeakMc: mc,
        holderPeakMultiplier: 1.0
      };

      this.trackedTokens.set(contractAddress, token);
      await db.insertOrUpdateToken(token);

      logger.success(`Added holder token #${rank}: ${token.symbol || token.name}`);
      return token;
    } catch (error) {
      logger.error(`Failed to add holder token ${contractAddress.slice(0, 8)}...`, error);

      // Even on error, create a minimal entry so it shows up
      const now = Date.now();
      const token = {
        id: uuidv4(),
        contractAddress,
        name: 'Unknown',
        symbol: contractAddress.slice(0, 6).toUpperCase(),
        chainShort: 'solana',
        logoUrl: null,
        spottedAt: now,
        spottedMc: 0,
        currentMc: 0,
        previousMc: null,
        peakMc: 0,
        peakMultiplier: 1.0,
        volume24h: 0,
        previousVolume24h: null,
        mcTenSecondsAgo: 0,
        volTenSecondsAgo: 0,
        _tenSecondSnapshotAt: now,
        mcTenMinutesAgo: 0,
        _tenMinuteSnapshotAt: now,
        lastUpdated: now,
        source: 'holder',
        holderRank: rank,
        // Holder-specific stats (separate from degen mode stats)
        holderSpottedAt: now,
        holderSpottedMc: 0,
        holderPeakMc: 0,
        holderPeakMultiplier: 1.0,
        _needsDataFetch: true
      };

      this.trackedTokens.set(contractAddress, token);
      return token;
    }
  }

  // Get holder tokens sorted by rank
  getHolderTokens() {
    return Array.from(this.trackedTokens.values())
      .filter(t => t.source === 'holder' && t.holderRank != null)
      .sort((a, b) => a.holderRank - b.holderRank);
  }

  // Get holder MVP based on holder-specific algorithm
  getHolderMVP() {
    const holderTokens = this.getHolderTokens();
    if (holderTokens.length === 0) return null;

    // Holder MVP Algorithm:
    // Score based on:
    // 1. Current multiplier (40%) - how much it's up from when spotted IN HOLDER MODE
    // 2. Consistency score (30%) - low volatility = good
    // 3. Volume health (20%) - healthy trading volume
    // 4. Rank bonus (10%) - higher ranked = trusted more

    let bestToken = null;
    let bestScore = -Infinity;

    for (const token of holderTokens) {
      // Use holder-specific stats for MVP calculation
      const holderSpottedMc = token.holderSpottedMc || token.spottedMc || 1;
      const holderPeakMc = token.holderPeakMc || token.peakMc || token.currentMc;
      const currentMultiplier = holderSpottedMc > 0 ? token.currentMc / holderSpottedMc : 1.0;

      // 1. Multiplier score (0-100, capped at 10x)
      const multiplierScore = Math.min(currentMultiplier / 10, 1) * 100;

      // 2. Consistency score - based on how close current is to holder peak
      // If current is near peak, token is healthy/consistent
      const consistency = holderPeakMc > 0 ? (token.currentMc / holderPeakMc) : 1;
      const consistencyScore = consistency * 100;

      // 3. Volume health - higher volume = more liquid/healthy
      const volumeScore = Math.min((token.volume24h || 0) / 100000, 1) * 100;

      // 4. Rank bonus - #1 gets 100, #10 gets 10
      const rankScore = Math.max(0, 110 - (token.holderRank * 10));

      // Weighted total
      const totalScore =
        (multiplierScore * 0.40) +
        (consistencyScore * 0.30) +
        (volumeScore * 0.20) +
        (rankScore * 0.10);

      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestToken = {
          token,
          score: totalScore,
          components: {
            multiplier: { raw: currentMultiplier, score: multiplierScore, weight: 0.40 },
            consistency: { raw: consistency, score: consistencyScore, weight: 0.30 },
            volume: { raw: token.volume24h || 0, score: volumeScore, weight: 0.20 },
            rank: { raw: token.holderRank, score: rankScore, weight: 0.10 }
          }
        };
      }
    }

    if (!bestToken) return null;

    return {
      address: bestToken.token.contractAddress,
      name: bestToken.token.symbol || bestToken.token.name,
      fullName: bestToken.token.name,
      score: bestToken.score,
      health: bestToken.components.consistency.raw * 100,
      components: bestToken.components,
      currentMc: bestToken.token.currentMc,
      spottedMc: bestToken.token.spottedMc,
      peakMc: bestToken.token.peakMc,
      volume24h: bestToken.token.volume24h,
      logoUrl: bestToken.token.logoUrl,
      contractAddress: bestToken.token.contractAddress,
      holderRank: bestToken.token.holderRank,
      multiplier: bestToken.token.currentMc / bestToken.token.spottedMc
    };
  }

  // Get ex-holder tokens (removed from holder list but still tracked)
  getExHolderTokens() {
    return Array.from(this.trackedTokens.values())
      .filter(t => t.source === 'ex-holder')
      .sort((a, b) => (b.removedFromHolderAt || 0) - (a.removedFromHolderAt || 0));
  }

  async shutdown() {
    this.stopTracking();
    dexpaprika.shutdown();
    await db.closeDatabase();
  }

  // Get DexPaprika SSE stats for monitoring
  getSSEStats() {
    return dexpaprika.getSSEStats();
  }
}

export const tokenManager = new TokenManager();
