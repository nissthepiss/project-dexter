import express from 'express';

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

function formatCurrencyValue(value) {
  if (!value || value === 0) return '$0';
  if (value >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export function createDebugRoutes({ tokenManager, logger, telegramService, dexscreenerLimiter, dexscreener, testAllAPIs, getRandomTestToken, dataCollector }) {
  const router = express.Router();

  router.get('/debug/data-collector', (req, res) => {
    try {
      const stats = dataCollector.getStats();
      res.json({
        success: true,
        ...stats
      });
    } catch (error) {
      logger.error('GET /api/debug/data-collector failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/debug/data-collector/toggle', (req, res) => {
    try {
      const { enabled } = req.body;
      const currentState = dataCollector.enabled;

      // Toggle if no body, or set to specified value
      const newState = enabled !== undefined ? enabled : !currentState;
      dataCollector.setEnabled(newState);

      res.json({
        success: true,
        enabled: newState,
        message: `Data collection ${newState ? 'enabled' : 'disabled'}`
      });
    } catch (error) {
      logger.error('POST /api/debug/data-collector/toggle failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/debug/holder-message', async (req, res) => {
    try {
      const result = await telegramService.getHolderMessage();
      res.json(result);
    } catch (error) {
      logger.error('GET /api/debug/holder-message failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/test/run-api-comparison', async (req, res) => {
    try {
      const contractAddress = await getRandomTestToken();
      logger.api(`Running API comparison test on ${logger.highlight(contractAddress)}`);
      const results = await testAllAPIs(contractAddress);
      res.json(results);
    } catch (error) {
      logger.error('API test failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/test/run-api-comparison/:address', async (req, res) => {
    try {
      const { address } = req.params;
      logger.api(`Running API comparison test on ${logger.highlight(address)}`);
      const results = await testAllAPIs(address);
      res.json(results);
    } catch (error) {
      logger.error('API test failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/test/mc-check', async (req, res) => {
    const { address } = req.body;

    if (!address) {
      return res.status(400).json({
        success: false,
        error: 'Address required',
        marketCap: null,
        formattedMc: 'N/A'
      });
    }

    logger.info(`MC Check requested for: ${address}`);

    try {
      const result = await withTimeout(
        (async () => {
          logger.info(`  > Acquiring rate limit token...`);
          await dexscreenerLimiter.acquire();
          logger.info(`  > Rate limit acquired, fetching from DexScreener...`);

          const tokenData = await dexscreener.getTokenData(address);
          logger.info(`  > DexScreener response received`);

          if (!tokenData) {
            logger.warn(`  > No token data returned (null)`);
            return {
              success: false,
              marketCap: null,
              formattedMc: 'N/A',
              error: 'Token not found on DexScreener'
            };
          }

          const mc = tokenData.marketCap;
          if (mc === null || mc === undefined || mc === 0) {
            logger.warn(`  > No market cap available (${mc})`);
            return {
              success: false,
              marketCap: null,
              formattedMc: 'N/A',
              error: 'No market cap data available'
            };
          }

          const formattedMc = formatCurrencyValue(mc);
          logger.info(`  > Success: MC=${formattedMc}`);

          return {
            success: true,
            marketCap: mc,
            formattedMc: formattedMc,
            timestamp: Date.now()
          };
        })(),
        30000
      );

      res.json(result);
    } catch (error) {
      logger.error(`MC check error: ${error.message}`);
      res.status(500).json({
        success: false,
        error: error.message,
        marketCap: null,
        formattedMc: 'Error'
      });
    }
  });

  router.post('/purge', async (req, res) => {
    try {
      logger.section('PURGE INITIATED (DEGEN ONLY)');
      logger.warn('Stopping all tracking...');

      tokenManager.stopTracking();

      // Only remove degen tokens, preserve holder tokens
      for (const [address, token] of tokenManager.trackedTokens.entries()) {
        if (token.source === 'degen') {
          tokenManager.trackedTokens.delete(address);
        }
      }
      tokenManager.topTokens = [];
      tokenManager.fadeOutTokens = [];

      tokenManager.discoveryStats = {
        lastReportTime: Date.now(),
        tokensDiscovered: 0,
        reportInterval: 2 * 60 * 1000
      };

      logger.warn('Purging database (degen only, holder tokens preserved)...');

      const db = await import('../database/db.mjs');
      const result = await db.deleteAllTokens();

      logger.success(`Database purged: ${result.tokensDeleted} degen tokens, ${result.priceRecordsDeleted} price records, ${result.alertRecordsDeleted} alerts (holder tokens preserved)`);
      logger.warn('Restarting tracking system...');

      await tokenManager.startTracking();

      logger.success('PURGE COMPLETE - Degen tokens cleared, holder tokens preserved');
      logger.divider();

      res.json({
        success: true,
        message: 'Degen tokens purged, holder tokens preserved',
        tokensCleared: result.tokensDeleted,
        priceRecordsCleared: result.priceRecordsDeleted,
        alertRecordsCleared: result.alertRecordsDeleted
      });
    } catch (error) {
      logger.error('Purge failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
