import express from 'express';

export function createTelegramRoutes({ telegramService, logger, tokenManager }) {
  const router = express.Router();

  // Get status
  router.get('/status', (req, res) => {
    const status = telegramService.getStatus();
    res.json(status);
  });

  // Initialize Telegram client
  router.post('/init', async (req, res) => {
    try {
      const result = await telegramService.initialize();
      res.json(result);
    } catch (error) {
      logger.error('Telegram init failed', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Start authentication with phone number
  router.post('/auth/start', async (req, res) => {
    try {
      const { phone } = req.body;
      const result = await telegramService.startAuth(phone);
      res.json(result);
    } catch (error) {
      logger.error('Telegram auth start failed', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Verify authentication code
  router.post('/auth/verify', async (req, res) => {
    try {
      const { code, password } = req.body;
      if (!code) {
        return res.status(400).json({ success: false, error: 'Verification code is required' });
      }
      const result = await telegramService.verifyCode(code, password);
      res.json(result);
    } catch (error) {
      logger.error('Telegram auth verify failed', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Manual send to private channel
  router.post('/send', async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ success: false, error: 'Message is required' });
      }
      const result = await telegramService.sendMessage(message);
      
      if (result.success) {
        await telegramService.markAsAnnounced(message, false);
      }
      
      res.json(result);
    } catch (error) {
      logger.error('Telegram send failed', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Send Tier 3 alert (auto)
  router.post('/send-tier3', async (req, res) => {
    try {
      const { contractAddress, name, multiplier } = req.body;
      
      if (!contractAddress) {
        return res.status(400).json({ success: false, error: 'Contract address is required' });
      }

      const tokenInfo = { name: name || 'Unknown', symbol: name || 'Unknown' };
      const result = await telegramService.sendTier3Alert(contractAddress, tokenInfo);
      
      if (result.success) {
        await telegramService.markAsAnnounced(contractAddress, true);
        logger.success(`Tier 3 alert sent: ${name} (${multiplier}x)`);
      }
      
      res.json(result);
    } catch (error) {
      logger.error('Tier 3 alert failed', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Toggle Telegram messaging on/off
  router.post('/toggle-messaging', async (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: 'enabled must be boolean' });
      }
      telegramService.setTelegramMessaging(enabled);
      res.json({ success: true, enabled });
    } catch (error) {
      logger.error('Toggle messaging failed', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Toggle public channel on/off
  router.post('/toggle-public', async (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: 'enabled must be boolean' });
      }
      telegramService.setPublicChannel(enabled);
      res.json({ success: true, enabled });
    } catch (error) {
      logger.error('Toggle public channel failed', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Clear Telegram session (for AUTH_KEY_DUPLICATED error recovery)
  router.post('/clear-session', async (req, res) => {
    try {
      const result = await telegramService.clearSession();
      res.json(result);
    } catch (error) {
      logger.error('Clear session failed', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get current phone number
  router.get('/phone', (req, res) => {
    try {
      const phone = telegramService.getPhone();
      res.json({ success: true, phone });
    } catch (error) {
      logger.error('Get phone failed', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Set phone number
  router.post('/phone', async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) {
        return res.status(400).json({ success: false, error: 'Phone number is required' });
      }
      telegramService.setPhone(phone);
      res.json({ success: true, phone });
    } catch (error) {
      logger.error('Set phone failed', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get public channels list
  router.get('/public-channels', (req, res) => {
    try {
      const channels = telegramService.getPublicChannels();
      res.json({ success: true, channels });
    } catch (error) {
      logger.error('Get public channels failed', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Add public channel
  router.post('/public-channels/add', async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ success: false, error: 'URL is required' });
      }
      const result = telegramService.addPublicChannel(url);
      res.json(result);
    } catch (error) {
      logger.error('Add public channel failed', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Update public channel
  router.put('/public-channels/:index', async (req, res) => {
    try {
      const index = parseInt(req.params.index);
      const updates = req.body;
      const result = telegramService.updatePublicChannel(index, updates);
      res.json(result);
    } catch (error) {
      logger.error('Update public channel failed', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Delete public channel
  router.delete('/public-channels/:index', async (req, res) => {
    try {
      const index = parseInt(req.params.index);
      const result = telegramService.deletePublicChannel(index);
      res.json(result);
    } catch (error) {
      logger.error('Delete public channel failed', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Check if token was announced
  router.get('/announced/:address', async (req, res) => {
    try {
      const { address } = req.params;
      const announced = await telegramService.isAnnounced(address);
      res.json({ announced });
    } catch (error) {
      logger.error('Check announced failed', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get all announced tokens
  router.get('/announced', async (req, res) => {
    try {
      const tokens = await telegramService.getAnnouncedTokens(tokenManager);
      res.json({ tokens });
    } catch (error) {
      logger.error('Get announced tokens failed', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
