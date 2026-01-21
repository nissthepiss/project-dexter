import express from 'express';
import logger from '../logger.mjs';

const router = express.Router();

// Get channels
router.get('/', async (req, res) => {
  try {
    const telegramService = req.app.get('telegramService');
    
    if (!telegramService) {
      return res.status(500).json({ error: 'Telegram service not initialized' });
    }
    
    const channels = telegramService.publicChannels || [];
    res.json({ channels });
  } catch (err) {
    logger.error('Failed to get channels', err);
    res.status(500).json({ error: 'Failed to get channels' });
  }
});

// Update channels
router.post('/', async (req, res) => {
  try {
    const telegramService = req.app.get('telegramService');
    
    if (!telegramService) {
      return res.status(500).json({ error: 'Telegram service not initialized' });
    }
    
    const { channels } = req.body;
    
    if (!Array.isArray(channels)) {
      return res.status(400).json({ error: 'Invalid channels format' });
    }
    
    // Validate channels
    const validChannels = channels.filter(ch => {
      return ch && typeof ch === 'object' && typeof ch.url === 'string' && typeof ch.enabled === 'boolean';
    });
    
    telegramService.publicChannels = validChannels;
    telegramService.savePublicChannels();
    
    logger.info(`Updated ${validChannels.length} public channels`);
    res.json({ success: true, channels: validChannels });
  } catch (err) {
    logger.error('Failed to update channels', err);
    res.status(500).json({ error: 'Failed to update channels' });
  }
});

export default router;
