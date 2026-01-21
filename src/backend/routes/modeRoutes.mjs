import express from 'express';

export function createModeRoutes({ tokenManager, logger, getModeState, setModeState }) {
  const router = express.Router();

  router.get('/mode', (req, res) => {
    res.json({ mode: getModeState() });
  });

  router.post('/mode', (req, res) => {
    const { mode } = req.body;
    if (mode !== 'degen' && mode !== 'holder') {
      return res.status(400).json({ error: 'Invalid mode. Use "degen" or "holder"' });
    }
    setModeState(mode);
    logger.info(`Mode switched to: ${logger.highlight(mode.toUpperCase())}`);
    res.json({ success: true, mode: getModeState() });
  });

  router.post('/data-source', (req, res) => {
    try {
      const { source } = req.body;
      tokenManager.setDataSource(source);
      logger.info(`Data source switched to ${logger.highlight(source)}`);
      res.json({ success: true, source });
    } catch (error) {
      logger.error('POST /api/data-source failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/view-mode', (req, res) => {
    try {
      const { viewMode } = req.body;

      if (!viewMode) {
        return res.status(400).json({ error: 'viewMode is required' });
      }

      tokenManager.setViewMode(viewMode);

      res.json({
        success: true,
        viewMode: tokenManager.currentViewMode
      });
    } catch (error) {
      logger.error('POST /api/view-mode failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/alert-tiers', async (req, res) => {
    try {
      const { tier1, tier2, tier3 } = req.body;
      await tokenManager.setAlertTiers(tier1, tier2, tier3);
      logger.success(`Alert tiers updated: T1=${logger.highlight(tier1 + 'x')}, T2=${logger.highlight(tier2 + 'x')}, T3=${logger.highlight(tier3 + 'x')}`);
      res.json({ success: true, tiers: { tier1, tier2, tier3 } });
    } catch (error) {
      logger.error('POST /api/alert-tiers failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post('/telegram-auto-alert', (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ error: 'enabled must be a boolean' });
      }
      tokenManager.setTelegramAutoAlert(enabled);
      res.json({ success: true, enabled });
    } catch (error) {
      logger.error('POST /api/telegram-auto-alert failed', error);
      res.status(500).json({ error: error.message });
    }
  });

  router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  return router;
}
