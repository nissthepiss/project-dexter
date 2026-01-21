import { telegramService } from './telegramService.mjs';
import logger from './logger.mjs';
import * as db from './database/db-adapter.mjs';

class HolderService {
  constructor() {
    this.isPolling = false;
    this.pollInterval = null;
    this.lastEditDate = null;
    this.currentHolderCAs = [];
    this.tokenManager = null; // Will be set via setTokenManager
    this.onUpdate = null; // Callback for when holder list updates
  }

  setTokenManager(tokenManager) {
    this.tokenManager = tokenManager;
  }

  setUpdateCallback(callback) {
    this.onUpdate = callback;
  }

  async startPolling(intervalMs = 5000) {
    if (this.isPolling) {
      logger.warn('Holder polling already running');
      return;
    }

    logger.info(`Starting holder channel polling (every ${intervalMs / 1000}s)`);
    this.isPolling = true;

    // Initial fetch
    await this.pollHolderChannel();

    // Set up interval
    this.pollInterval = setInterval(() => {
      this.pollHolderChannel();
    }, intervalMs);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isPolling = false;
    logger.info('Holder channel polling stopped');
  }

  async pollHolderChannel() {
    try {
      const result = await telegramService.getHolderMessage();

      if (!result.success) {
        // Don't spam logs if telegram not connected
        if (!result.error?.includes('not connected')) {
          logger.warn(`Failed to fetch holder message: ${result.error}`);
        }
        return;
      }

      // Debug logging to see what's being fetched
      logger.debug(`Holder message: ${result.contractAddresses.length} CAs found, ${result.rawEntities} entities`);
      if (result.contractAddresses.length === 0 && result.rawEntities > 0) {
        logger.debug(`No CAs extracted from ${result.rawEntities} entities. Debug info:`, result.debugEntities);
      }

      // Check if message was edited since last check
      const editDate = result.editDate;
      if (this.lastEditDate && editDate === this.lastEditDate) {
        // No changes
        return;
      }

      this.lastEditDate = editDate;
      const newCAs = result.contractAddresses;

      // Check if CA list changed
      const hasChanged = this.hasCAListChanged(newCAs);

      if (hasChanged || this.currentHolderCAs.length === 0) {
        logger.debug(`Holder list updated: ${newCAs.length} coins`);

        // Identify removed and added CAs
        const removedCAs = this.currentHolderCAs.filter(ca => !newCAs.includes(ca));
        const addedCAs = newCAs.filter(ca => !this.currentHolderCAs.includes(ca));

        this.currentHolderCAs = newCAs;

        // Process the holder coins
        await this.processHolderCoins(newCAs, addedCAs, removedCAs);

        // Trigger update callback
        if (this.onUpdate) {
          this.onUpdate({
            coins: newCAs,
            added: addedCAs,
            removed: removedCAs,
            editDate
          });
        }
      }
    } catch (error) {
      logger.error('Error polling holder channel', error);
    }
  }

  hasCAListChanged(newCAs) {
    if (newCAs.length !== this.currentHolderCAs.length) {
      return true;
    }
    // Check if order or content changed
    for (let i = 0; i < newCAs.length; i++) {
      if (newCAs[i] !== this.currentHolderCAs[i]) {
        return true;
      }
    }
    return false;
  }

  async processHolderCoins(allCAs, addedCAs, removedCAs) {
    if (!this.tokenManager) {
      logger.warn('TokenManager not set in HolderService');
      return;
    }

    // Add new holder coins with their rank
    for (let i = 0; i < allCAs.length; i++) {
      const ca = allCAs[i];
      const rank = i + 1;

      // Check if token already exists in our system
      const existingToken = this.tokenManager.trackedTokens.get(ca);

      if (existingToken) {
        // Update source and rank for existing token
        existingToken.source = 'holder';
        existingToken.holderRank = rank;
        // CRITICAL: Save to database so source persists across restarts
        await db.insertOrUpdateToken(existingToken);
      } else {
        // Add new holder token - tokenManager will fetch data from DexScreener
        await this.tokenManager.addHolderToken(ca, rank);
      }
    }

    // Handle removed coins - they stay tracked in background but lose holder rank
    for (const ca of removedCAs) {
      const token = this.tokenManager.trackedTokens.get(ca);
      if (token && token.source === 'holder') {
        // Mark as ex-holder - continues getting background price updates
        token.source = 'ex-holder';
        token.holderRank = null;
        token.removedFromHolderAt = Date.now();
        await db.insertOrUpdateToken(token);
        logger.info(`Token ${token.symbol || ca.slice(0, 8)} removed from holder list - tracking in background`);
      }
    }
  }

  getCurrentHolderCoins() {
    return this.currentHolderCAs.map((ca, index) => ({
      contractAddress: ca,
      rank: index + 1
    }));
  }

  isHolderCoin(contractAddress) {
    return this.currentHolderCAs.includes(contractAddress);
  }

  getHolderRank(contractAddress) {
    const index = this.currentHolderCAs.indexOf(contractAddress);
    return index >= 0 ? index + 1 : null;
  }
}

export const holderService = new HolderService();
