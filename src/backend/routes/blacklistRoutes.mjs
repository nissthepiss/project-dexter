import express from 'express';

export function createBlacklistRoutes({ tokenManager, logger }) {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      const { contractAddress, name } = req.body;

      if (!contractAddress) {
        return res.status(400).json({ error: 'contractAddress is required' });
      }

      const db = await import('../database/db.mjs');
      await db.addToBlacklist(contractAddress, name);

      tokenManager.trackedTokens.delete(contractAddress);
      tokenManager.topTokens = tokenManager.topTokens.filter(t => t.contractAddress !== contractAddress);

      logger.warn(`Blacklisted: ${name} (${contractAddress})`);

      res.json({ success: true, message: `Token ${name} blacklisted` });
    } catch (error) {
      logger.error('Blacklist failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/', async (req, res) => {
    try {
      const db = await import('../database/db.mjs');
      const blacklist = await db.getBlacklist();
      res.json({ blacklist });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  router.delete('/:contractAddress', async (req, res) => {
    try {
      const { contractAddress } = req.params;
      const db = await import('../database/db.mjs');
      await db.removeFromBlacklist(contractAddress);
      logger.info(`Removed from blacklist: ${contractAddress}`);
      res.json({ success: true });
    } catch (error) {
      logger.error('Remove from blacklist failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}
