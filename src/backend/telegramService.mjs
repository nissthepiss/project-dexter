import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { computeCheck } from 'telegram/Password.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Telegram API credentials
const API_ID = 24633284;
const API_HASH = 'db57716f3f179bc1c653c3ec0f7377d5';
const PHONE = '+447521185232';

// Channels
const PRIVATE_CHANNEL_ID = BigInt('-1003511885609');
const HOLDER_CHANNEL_ID = BigInt('-1002244051860');
const HOLDER_MESSAGE_ID = 7;

// Rate limiting for public channels: max 3 per 5 minutes
const PUBLIC_RATE_LIMIT = {
  maxSends: 3,
  windowMs: 5 * 60 * 1000 // 5 minutes
};

// Session file paths
const SESSION_FILE = path.join(__dirname, '../data/telegram_session.txt');
const ANNOUNCED_TOKENS_FILE = path.join(__dirname, '../data/announced_tokens.json');
const PUBLIC_CHANNELS_FILE = path.join(__dirname, '../data/public_channels.json');

class TelegramService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.isAuthenticating = false;
    this.phoneCodeHash = null;
    
    // Toggles
    this.telegramMessagingEnabled = false; // "Telegram Message" toggle (default OFF)
    this.publicChannelEnabled = false;     // "Public Channels" toggle (default OFF)
    
    // Track announced tokens
    this.announcedTokens = new Map(); // address -> { announcedAt, isAuto }
    this.loadAnnouncedTokens();
    
    // Public channels list (loaded from file)
    this.publicChannels = [];
    this.loadPublicChannels();
    
    // Public channel rate limiting
    this.publicSendHistory = []; // Track send times
  }

  // ==========================================================================
  // PUBLIC CHANNELS MANAGEMENT
  // ==========================================================================

  loadPublicChannels() {
    try {
      if (fs.existsSync(PUBLIC_CHANNELS_FILE)) {
        const data = JSON.parse(fs.readFileSync(PUBLIC_CHANNELS_FILE, 'utf-8'));
        this.publicChannels = data.channels || [];
        logger.info(`Loaded ${this.publicChannels.length} public channels`);
      } else {
        // Default: one channel
        this.publicChannels = [
          { url: 'https://web.telegram.org/a/#-1003318418308', enabled: true }
        ];
        this.savePublicChannels();
      }
    } catch (error) {
      logger.warn('Failed to load public channels, using defaults', error);
      this.publicChannels = [
        { url: 'https://web.telegram.org/a/#-1003318418308', enabled: true }
      ];
    }
  }

  savePublicChannels() {
    try {
      const dataDir = path.dirname(PUBLIC_CHANNELS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const data = { channels: this.publicChannels };
      fs.writeFileSync(PUBLIC_CHANNELS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save public channels', error);
    }
  }

  extractChannelId(url) {
    // Extract channel ID from Telegram URL
    // Format: https://web.telegram.org/a/#-1003318418308
    // or: https://t.me/joinchat/...
    // or: just the ID: -1003318418308
    
    try {
      // If it's already just an ID
      if (/^-?\d+$/.test(url.trim())) {
        return BigInt(url.trim());
      }

      // Extract from web.telegram.org URL
      const webMatch = url.match(/#(-?\d+)/);
      if (webMatch) {
        return BigInt(webMatch[1]);
      }

      // Extract from t.me URL with channel ID
      const tmeMatch = url.match(/t\.me\/c\/(\d+)/);
      if (tmeMatch) {
        return BigInt('-100' + tmeMatch[1]);
      }

      return null;
    } catch {
      return null;
    }
  }

  getPublicChannels() {
    return this.publicChannels;
  }

  addPublicChannel(url) {
    const channelId = this.extractChannelId(url);
    if (!channelId) {
      return { success: false, error: 'Invalid Telegram URL or channel ID' };
    }

    // Check if already exists
    const exists = this.publicChannels.some(ch => {
      const existingId = this.extractChannelId(ch.url);
      return existingId && existingId.toString() === channelId.toString();
    });

    if (exists) {
      return { success: false, error: 'Channel already exists' };
    }

    this.publicChannels.push({ url, enabled: true });
    this.savePublicChannels();
    logger.info(`Added public channel: ${url}`);
    return { success: true, channels: this.publicChannels };
  }

  updatePublicChannel(index, updates) {
    if (index < 0 || index >= this.publicChannels.length) {
      return { success: false, error: 'Invalid channel index' };
    }

    if (updates.url !== undefined) {
      const channelId = this.extractChannelId(updates.url);
      if (!channelId) {
        return { success: false, error: 'Invalid Telegram URL or channel ID' };
      }
      this.publicChannels[index].url = updates.url;
    }

    if (updates.enabled !== undefined) {
      this.publicChannels[index].enabled = updates.enabled;
    }

    this.savePublicChannels();
    logger.info(`Updated public channel at index ${index}`);
    return { success: true, channels: this.publicChannels };
  }

  deletePublicChannel(index) {
    if (index < 0 || index >= this.publicChannels.length) {
      return { success: false, error: 'Invalid channel index' };
    }

    const removed = this.publicChannels.splice(index, 1);
    this.savePublicChannels();
    logger.info(`Deleted public channel: ${removed[0].url}`);
    return { success: true, channels: this.publicChannels };
  }

  // ==========================================================================
  // AUTHENTICATION & CONNECTION
  // ==========================================================================

  async initialize() {
    try {
      let sessionString = '';
      if (fs.existsSync(SESSION_FILE)) {
        sessionString = fs.readFileSync(SESSION_FILE, 'utf-8').trim();
        logger.info('Loaded existing Telegram session');
      }

      const session = new StringSession(sessionString);
      this.client = new TelegramClient(session, API_ID, API_HASH, {
        connectionRetries: 5,
      });

      await this.client.connect();

      if (await this.client.isUserAuthorized()) {
        this.isConnected = true;
        logger.success('Telegram client connected and authorized');
        return { success: true, status: 'connected' };
      } else {
        logger.warn('Telegram client needs authentication');
        return { success: false, status: 'needs_auth' };
      }
    } catch (error) {
      logger.error('Failed to initialize Telegram client', error);
      return { success: false, status: 'error', error: error.message };
    }
  }

  async startAuth() {
    if (this.isAuthenticating) {
      return { success: false, error: 'Authentication already in progress' };
    }

    try {
      if (!this.client) {
        await this.initialize();
      }

      this.isAuthenticating = true;

      const Api = (await import('telegram/tl/index.js')).Api;
      const result = await this.client.invoke(
        new Api.auth.SendCode({
          phoneNumber: PHONE,
          apiId: API_ID,
          apiHash: API_HASH,
          settings: new Api.CodeSettings({})
        })
      );

      this.phoneCodeHash = result.phoneCodeHash;
      logger.info(`Verification code sent to ${PHONE}`);
      return { success: true, status: 'code_sent', phone: PHONE };
    } catch (error) {
      this.isAuthenticating = false;
      logger.error('Failed to send auth code', error);
      return { success: false, error: error.message };
    }
  }

  async verifyCode(code, password = null) {
    if (!this.isAuthenticating || !this.phoneCodeHash) {
      return { 
        success: false, 
        error: 'No authentication in progress. Please request a code first.' 
      };
    }

    try {
      const Api = (await import('telegram/tl/index.js')).Api;

      try {
        await this.client.invoke(
          new Api.auth.SignIn({
            phoneNumber: PHONE,
            phoneCodeHash: this.phoneCodeHash,
            phoneCode: code
          })
        );

        await this.saveSession();
        return { success: true, status: 'authenticated' };

      } catch (signInError) {
        if (signInError.errorMessage === 'SESSION_PASSWORD_NEEDED') {
          if (!password) {
            return { 
              success: false, 
              status: 'needs_password', 
              error: 'Two-factor authentication password required' 
            };
          }

          const passwordInfo = await this.client.invoke(new Api.account.GetPassword());
          const passwordSrp = await computeCheck(passwordInfo, password);
          await this.client.invoke(new Api.auth.CheckPassword({ password: passwordSrp }));

          await this.saveSession();
          return { success: true, status: 'authenticated' };
        }

        throw signInError;
      }
    } catch (error) {
      logger.error('Failed to verify code', error);

      if (error.errorMessage !== 'SESSION_PASSWORD_NEEDED') {
        this.isAuthenticating = false;
        this.phoneCodeHash = null;
      }

      return { 
        success: false, 
        error: error.message || error.errorMessage || 'Verification failed' 
      };
    }
  }

  async saveSession() {
    const sessionString = this.client.session.save();
    const dataDir = path.dirname(SESSION_FILE);
    
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(SESSION_FILE, sessionString);
    this.isConnected = true;
    this.isAuthenticating = false;
    this.phoneCodeHash = null;
    logger.success('Telegram authentication successful, session saved');
  }

  // ==========================================================================
  // MESSAGING - CORE FUNCTIONS
  // ==========================================================================

  async ensureConnected() {
    if (!this.isConnected) {
      const initResult = await this.initialize();
      if (!initResult.success) {
        throw new Error('Telegram not connected. Please authenticate first.');
      }
    }
  }

  async sendToChannel(channelId, message) {
    await this.ensureConnected();
    await this.client.sendMessage(channelId, { message });
    logger.success(`Sent to channel ${channelId}: ${message}`);
  }

  canSendToPublicChannel() {
    const now = Date.now();
    
    // Clean up old history
    this.publicSendHistory = this.publicSendHistory.filter(
      sendTime => (now - sendTime) < PUBLIC_RATE_LIMIT.windowMs
    );
    
    return this.publicSendHistory.length < PUBLIC_RATE_LIMIT.maxSends;
  }

  recordPublicSend() {
    this.publicSendHistory.push(Date.now());
  }

  /**
   * Main Tier 3 alert flow:
   * 1. Check if "Telegram Message" is enabled -> if not, skip everything
   * 2. Send to private channel
   * 3. Check if "Public Channels" is enabled -> if yes, send to all enabled public channels (rate limited)
   */
  async sendTier3Alert(contractAddress, tokenInfo) {
    // STEP 1: Check if Telegram messaging is enabled
    if (!this.telegramMessagingEnabled) {
      logger.info(`❌ Telegram messaging DISABLED, skipping alert for ${contractAddress}`);
      return { 
        success: true, 
        status: 'disabled',
        sentToPrivate: false,
        sentToPublic: false
      };
    }

    logger.info(`✅ Telegram messaging ENABLED for ${contractAddress}`);

    const results = {
      success: true,
      sentToPrivate: false,
      sentToPublic: false,
      publicRateLimited: false,
      publicChannelsSent: []
    };

    // STEP 2: Send to private channel
    try {
      await this.sendToChannel(PRIVATE_CHANNEL_ID, contractAddress);
      results.sentToPrivate = true;
      logger.success(`✅ Sent to PRIVATE channel: ${contractAddress}`);
    } catch (error) {
      logger.error(`❌ Failed to send to private channel: ${contractAddress}`, error);
      results.success = false;
    }

    // STEP 3: Check if public channels are enabled
    if (!this.publicChannelEnabled) {
      logger.info(`⚠️ Public channels DISABLED, skipping for ${contractAddress}`);
      return results;
    }

    logger.info(`✅ Public channels ENABLED for ${contractAddress}`);

    // STEP 4: Check rate limit for public channels
    if (!this.canSendToPublicChannel()) {
      logger.warn(`⏳ Public channels rate limited (${this.publicSendHistory.length}/${PUBLIC_RATE_LIMIT.maxSends}), skipping ${contractAddress}`);
      results.publicRateLimited = true;
      return results;
    }

    logger.info(`✅ Rate limit OK (${this.publicSendHistory.length}/${PUBLIC_RATE_LIMIT.maxSends})`);

    // STEP 5: Send to all enabled public channels
    const enabledChannels = this.publicChannels.filter(ch => ch.enabled);
    if (enabledChannels.length === 0) {
      logger.warn(`⚠️ No enabled public channels for ${contractAddress}`);
      return results;
    }

    logger.info(`📡 Found ${enabledChannels.length} enabled public channel(s)`);

    for (const channel of enabledChannels) {
      try {
        const channelId = this.extractChannelId(channel.url);
        if (!channelId) {
          logger.error(`❌ Invalid channel URL: ${channel.url}`);
          continue;
        }

        logger.info(`📤 Sending to public channel ${channelId}...`);
        await this.sendToChannel(channelId, contractAddress);
        results.publicChannelsSent.push(channel.url);
        logger.success(`✅ Sent to public channel ${channel.url}`);
      } catch (error) {
        logger.error(`❌ Failed to send to public channel ${channel.url}:`, error);
      }
    }

    if (results.publicChannelsSent.length > 0) {
      this.recordPublicSend();
      results.sentToPublic = true;
      logger.success(`✅ Sent to ${results.publicChannelsSent.length} public channel(s): ${contractAddress} (${this.publicSendHistory.length}/${PUBLIC_RATE_LIMIT.maxSends} slots used)`);
    } else {
      logger.warn(`⚠️ Failed to send to any public channels for ${contractAddress}`);
    }

    return results;
  }

  // Legacy method for manual sends (backward compatibility)
  async sendMessage(text) {
    if (!this.telegramMessagingEnabled) {
      return { success: false, error: 'Telegram messaging is disabled' };
    }

    try {
      await this.sendToChannel(PRIVATE_CHANNEL_ID, text);
      return { success: true };
    } catch (error) {
      logger.error('Failed to send Telegram message', error);
      return { success: false, error: error.message };
    }
  }

  // ==========================================================================
  // TOGGLES
  // ==========================================================================

  setTelegramMessaging(enabled) {
    this.telegramMessagingEnabled = enabled;
    logger.info(`📡 Telegram messaging: ${enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
  }

  setPublicChannel(enabled) {
    this.publicChannelEnabled = enabled;
    logger.info(`📡 Public channels: ${enabled ? '✅ ENABLED' : '❌ DISABLED'}`);
  }

  getStatus() {
    const now = Date.now();
    this.publicSendHistory = this.publicSendHistory.filter(
      sendTime => (now - sendTime) < PUBLIC_RATE_LIMIT.windowMs
    );

    return {
      isConnected: this.isConnected,
      isAuthenticating: this.isAuthenticating,
      telegramMessagingEnabled: this.telegramMessagingEnabled,
      publicChannelEnabled: this.publicChannelEnabled,
      publicChannels: this.publicChannels,
      publicRateLimit: {
        current: this.publicSendHistory.length,
        max: PUBLIC_RATE_LIMIT.maxSends,
        windowMinutes: PUBLIC_RATE_LIMIT.windowMs / 60000,
        canSend: this.canSendToPublicChannel()
      }
    };
  }

  // ==========================================================================
  // ANNOUNCED TOKENS TRACKING
  // ==========================================================================

  loadAnnouncedTokens() {
    try {
      if (fs.existsSync(ANNOUNCED_TOKENS_FILE)) {
        const data = JSON.parse(fs.readFileSync(ANNOUNCED_TOKENS_FILE, 'utf-8'));
        this.announcedTokens = new Map(Object.entries(data));
        logger.info(`Loaded ${this.announcedTokens.size} announced tokens`);
      }
    } catch (error) {
      logger.warn('Failed to load announced tokens, starting fresh', error);
      this.announcedTokens = new Map();
    }
  }

  saveAnnouncedTokens() {
    try {
      const dataDir = path.dirname(ANNOUNCED_TOKENS_FILE);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      const data = Object.fromEntries(this.announcedTokens);
      fs.writeFileSync(ANNOUNCED_TOKENS_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Failed to save announced tokens', error);
    }
  }

  markAsAnnounced(contractAddress, isAuto = false) {
    this.announcedTokens.set(contractAddress, {
      announcedAt: Date.now(),
      isAuto
    });
    this.saveAnnouncedTokens();
  }

  isAnnounced(contractAddress) {
    return this.announcedTokens.has(contractAddress);
  }

  getAnnouncedTokens(tokenManager) {
    const tokens = [];
    
    for (const [address, info] of this.announcedTokens.entries()) {
      const token = tokenManager.trackedTokens.get(address);
      
      if (token) {
        const change1m = this.calculate1MinChange(token);
        
        tokens.push({
          contractAddress: address,
          name: token.name || token.symbol || 'Unknown',
          symbol: token.symbol,
          announcedAt: info.announcedAt,
          isAuto: info.isAuto,
          peakMultiplier: token.peakMultiplier || 1.0,
          currentMc: token.currentMc || 0,
          change1m
        });
      } else {
        tokens.push({
          contractAddress: address,
          name: 'Unknown',
          symbol: 'Unknown',
          announcedAt: info.announcedAt,
          isAuto: info.isAuto,
          peakMultiplier: 1.0,
          currentMc: 0,
          change1m: 0
        });
      }
    }
    
    tokens.sort((a, b) => b.announcedAt - a.announcedAt);
    return tokens;
  }

  calculate1MinChange(token) {
    if (token.mcTenSecondsAgo && token.mcTenSecondsAgo > 0) {
      const change = ((token.currentMc - token.mcTenSecondsAgo) / token.mcTenSecondsAgo) * 100;
      return change * 6;
    }
    return 0;
  }

  // ==========================================================================
  // HOLDER MESSAGE READING
  // ==========================================================================

  async getHolderMessage() {
    await this.ensureConnected();

    try {
      const Api = (await import('telegram/tl/index.js')).Api;

      const result = await this.client.invoke(
        new Api.channels.GetMessages({
          channel: HOLDER_CHANNEL_ID,
          id: [new Api.InputMessageID({ id: HOLDER_MESSAGE_ID })]
        })
      );

      if (!result.messages || result.messages.length === 0) {
        logger.warn(`Holder message not found - Channel ID: ${HOLDER_CHANNEL_ID}, Message ID: ${HOLDER_MESSAGE_ID}`);
        return { success: false, error: 'Message not found' };
      }

      const message = result.messages[0];
      const messageText = message.message || '';
      const entities = message.entities || [];
      const editDate = message.editDate || message.date;

      const contractAddresses = [];

      for (const entity of entities) {
        const isTextUrl = entity.className === 'MessageEntityTextUrl' ||
                          entity.constructor?.name === 'MessageEntityTextUrl' ||
                          entity.url !== undefined;

        if (isTextUrl && entity.url) {
          const ca = this.extractCAFromUrl(entity.url);
          if (ca && !contractAddresses.includes(ca)) {
            contractAddresses.push(ca);
          }
        }
      }

      const textCAs = this.extractCAsFromText(messageText);
      for (const ca of textCAs) {
        if (!contractAddresses.includes(ca)) {
          contractAddresses.push(ca);
        }
      }

      return {
        success: true,
        messageText,
        contractAddresses,
        editDate,
        rawEntities: entities.length
      };
    } catch (error) {
      logger.error('Failed to get holder message', error);
      return { success: false, error: error.message };
    }
  }

  extractCAFromUrl(url) {
    try {
      const telegramBotMatch = url.match(/t\.me\/\w+\?start=(?:pf_|price_)([A-Za-z0-9]+)/i);
      if (telegramBotMatch) return telegramBotMatch[1];

      const bagsMatch = url.match(/bags\.fm\/([A-Za-z0-9]+)/i);
      if (bagsMatch) return bagsMatch[1];

      const dexMatch = url.match(/dexscreener\.com\/\w+\/([A-Za-z0-9]+)/i);
      if (dexMatch) return dexMatch[1];

      const pumpMatch = url.match(/pump\.fun\/(?:coin\/)?([A-Za-z0-9]+)/i);
      if (pumpMatch) return pumpMatch[1];

      const birdeyeMatch = url.match(/birdeye\.so\/token\/([A-Za-z0-9]+)/i);
      if (birdeyeMatch) return birdeyeMatch[1];

      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(url)) {
        return url;
      }

      if (/^0x[a-fA-F0-9]{40}$/.test(url)) {
        return url;
      }

      return null;
    } catch {
      return null;
    }
  }

  extractCAsFromText(text) {
    const cas = [];

    const solanaMatches = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g) || [];
    for (const match of solanaMatches) {
      if (match.length >= 32 && !cas.includes(match)) {
        cas.push(match);
      }
    }

    const evmMatches = text.match(/0x[a-fA-F0-9]{40}/g) || [];
    for (const match of evmMatches) {
      if (!cas.includes(match)) {
        cas.push(match);
      }
    }

    return cas;
  }
}

export const telegramService = new TelegramService();
