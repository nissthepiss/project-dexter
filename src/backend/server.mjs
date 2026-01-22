import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import localtunnel from 'localtunnel';
import axios from 'axios';
import logger from './logger.mjs';
import { tokenManager } from './tokenManager.mjs';
import { testAllAPIs, getRandomTestToken } from './apiTester.mjs';
import { dexscreenerLimiter } from './rateLimit.mjs';
import * as dexscreener from './apis/dexscreener.mjs';
import { telegramService } from './telegramService.mjs';
import { holderService } from './holderService.mjs';
import DataCollector from './dataCollector.mjs';

// Route modules
import { createTokenRoutes } from './routes/tokenRoutes.mjs';
import { createModeRoutes } from './routes/modeRoutes.mjs';
import { createDebugRoutes } from './routes/debugRoutes.mjs';
import { createTelegramRoutes } from './routes/telegramRoutes.mjs';
import { createBlacklistRoutes } from './routes/blacklistRoutes.mjs';
import channelsRouter from './routes/channels.mjs';

// Current app mode: 'degen' or 'holder'
let currentMode = 'degen';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// CORS: Allow local development and production origins
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3001', 'http://127.0.0.1:3001'];
const isProduction = !!process.env.DATABASE_URL;

app.use(cors({
  origin: isProduction ? '*' : ALLOWED_ORIGINS,
  credentials: true
}));
app.use(express.json());

// Initialize data collector for algorithm analysis
const dataCollector = new DataCollector(logger);
logger.info('[DataCollector] Recording scoring metrics to src/data/scoring-logs/');

// Initialize token manager
tokenManager.initialize().catch(err => {
  logger.error('Failed to initialize TokenManager', err);
  process.exit(1);
});

// Inject telegram service into token manager for auto-alerts
tokenManager.setTelegramService(telegramService);

tokenManager.startTracking();

// Initialize holder service - runs independently of UI mode
holderService.setTokenManager(tokenManager);
holderService.startPolling(5000);

// Mode state accessors
const getModeState = () => currentMode;
const setModeState = (mode) => { currentMode = mode; };

// Register route modules
app.use('/api/tokens', createTokenRoutes({ tokenManager, logger, dataCollector }));
app.use('/api', createModeRoutes({ tokenManager, logger, getModeState, setModeState }));
app.use('/api', createDebugRoutes({
  tokenManager,
  logger,
  telegramService,
  dexscreenerLimiter,
  dexscreener,
  testAllAPIs,
  getRandomTestToken,
  dataCollector
}));
app.use('/api/telegram', createTelegramRoutes({ telegramService, logger, tokenManager }));
app.use('/api/blacklist', createBlacklistRoutes({ tokenManager, logger }));

// Make telegramService available to channels route
app.set('telegramService', telegramService);
app.use('/api/channels', channelsRouter);

// Health check endpoint for Railway/deployment platforms
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', mode: process.env.DATABASE_URL ? 'PostgreSQL' : 'SQLite' });
});

// Serve static frontend for external viewing (read-only)
app.use(express.static(path.join(__dirname, '../renderer')));

// Serve a read-only web version of the interface
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Project Dexter - Live View</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background-color: #1a1a1a;
                color: #e0e0e0;
                padding: 20px;
            }
            .container {
                max-width: 1200px;
                margin: 0 auto;
            }
            .header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-bottom: 24px;
                padding-bottom: 16px;
            }
            .header h1 {
                font-size: 56px;
                color: #ff8c00;
                font-weight: 700;
                font-family: 'Courier New', monospace;
                letter-spacing: 8px;
                position: relative;
            }
            .header h1::after {
                content: 'TOKEN HUNTER';
                position: absolute;
                bottom: -12px;
                left: 2px;
                font-size: 13px;
                color: #888;
                letter-spacing: 3px;
                font-family: 'Trebuchet MS', sans-serif;
                font-weight: 400;
            }
            .logo-dot {
                color: #4ade80;
            }
            .live-indicator {
                position: fixed;
                bottom: 20px;
                left: 20px;
                display: flex;
                align-items: center;
                gap: 8px;
                background: #2a2a2a;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 12px;
                font-weight: 700;
                z-index: 1000;
            }
            .status-dot {
                width: 8px;
                height: 8px;
                background: #4ade80;
                border-radius: 50%;
                animation: pulse 2s infinite;
            }
            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }
            .read-only-badge {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: #2a2a2a;
                padding: 8px 16px;
                border-radius: 20px;
                font-size: 11px;
                color: #888;
                z-index: 1000;
            }
            .column-headers {
                display: flex;
                justify-content: space-between;
                padding: 12px 20px;
                background: #2a2a2a;
                border-radius: 8px;
                margin-bottom: 12px;
            }
            .header-left {
                display: flex;
                align-items: center;
                gap: 60px;
            }
            .header-right {
                display: flex;
                gap: 80px;
                align-items: center;
            }
            .header-item {
                font-size: 13px;
                font-weight: 700;
                color: #888;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .header-rank {
                width: 40px;
                font-size: 13px;
                font-weight: 700;
                color: #888;
                text-transform: uppercase;
            }
            .header-token {
                font-size: 13px;
                font-weight: 700;
                color: #888;
                text-transform: uppercase;
            }
            .token-list {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .token-card {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 16px 20px;
                background: #2a2a2a;
                border-radius: 8px;
                transition: all 0.2s ease;
                border-left: 4px solid transparent;
            }
            .token-card:hover {
                background: #333;
            }
            .rank-1 { border-left-color: rgba(255, 215, 0, 0.3); }
            .rank-2 { border-left-color: rgba(192, 192, 192, 0.3); }
            .rank-3 { border-left-color: rgba(205, 127, 50, 0.3); }
            .rank {
                font-size: 18px;
                font-weight: 700;
                color: #666;
                width: 40px;
                text-align: center;
            }
            .icon {
                width: 40px;
                height: 40px;
                margin-right: 16px;
            }
            .token-logo {
                width: 100%;
                height: 100%;
                border-radius: 50%;
            }
            .icon-fallback {
                width: 100%;
                height: 100%;
                border-radius: 50%;
                background: linear-gradient(135deg, #ff8c00, #ffa500);
                display: flex;
                align-items: center;
                justify-content: center;
                font-weight: 700;
                color: #1a1a1a;
                font-size: 16px;
            }
            .name-info {
                flex: 1;
            }
            .token-name {
                font-size: 14px;
                font-weight: 700;
                color: #fff;
                margin-bottom: 4px;
            }
            .chain {
                font-size: 10px;
                color: #666;
                font-family: 'Courier New', monospace;
            }
            .data-row {
                display: flex;
                gap: 80px;
                align-items: center;
            }
            .data-item {
                text-align: right;
            }
            .data-value {
                font-size: 12px;
                color: #ff8c00;
                font-weight: 600;
            }
            .data-value.primary {
                color: #ff8c00;
            }
            .change {
                margin-left: 6px;
                font-size: 11px;
            }
            .time-col .time-text {
                font-size: 10px;
                color: #888;
            }
            .peak-col .peak-text {
                font-size: 18px;
                font-weight: 700;
                color: #ff8c00;
            }
            .empty-state {
                text-align: center;
                padding: 60px 20px;
                color: #666;
            }
            @keyframes flash {
                0%, 100% { background: transparent; }
                50% { background: rgba(255, 140, 0, 0.1); }
            }
            .value-changing {
                animation: flash 0.5s ease;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>DEXTER<span class="logo-dot">.</span></h1>
            </div>

            <div class="live-indicator">
                <span class="status-dot"></span>
                <span class="status-text">LIVE</span>
            </div>

            <div class="read-only-badge">
                READ-ONLY VIEW
            </div>

            <div class="column-headers">
                <div class="header-left">
                    <span class="header-rank">#</span>
                    <span class="header-token">Token</span>
                </div>
                <div class="header-right">
                    <span class="header-item">Spotted</span>
                    <span class="header-item">Current</span>
                    <span class="header-item">Volume</span>
                    <span class="header-item">Time</span>
                    <span class="header-item">Peak</span>
                </div>
            </div>

            <div class="token-list" id="token-list">
                <div class="empty-state">
                    <p>Loading tokens...</p>
                </div>
            </div>
        </div>

        <script>
            const API_BASE = window.location.origin + '/api';
            let previousTokenData = {};

            function formatCurrency(value) {
                if (!value || value === 0) return '$0';
                if (value >= 1e9) return \`$\${(value / 1e9).toFixed(1)}B\`;
                if (value >= 1e6) return \`$\${(value / 1e6).toFixed(1)}M\`;
                if (value >= 1e3) return \`$\${(value / 1e3).toFixed(1)}K\`;
                return \`$\${value.toFixed(2)}\`;
            }

            function getTimeAgo(timestamp) {
                const secondsAgo = Math.floor((Date.now() - timestamp) / 1000);
                if (secondsAgo < 60) return \`\${secondsAgo}s ago\`;
                if (secondsAgo < 3600) return \`\${Math.floor(secondsAgo / 60)}m ago\`;
                return \`\${Math.floor(secondsAgo / 3600)}h ago\`;
            }

            function getArrows(percentChange) {
                const abs = Math.abs(percentChange);
                const isPositive = percentChange > 0;
                const color = isPositive ? '#4ade80' : '#f87171';

                let arrows = '';
                if (abs >= 25) arrows = '↑↑↑';
                else if (abs >= 15) arrows = '↑↑';
                else if (abs >= 5) arrows = '↑';
                else return '';

                if (!isPositive) {
                    arrows = arrows.replace(/↑/g, '↓');
                }

                return \`<span style="color: \${color};">\${arrows}</span>\`;
            }

            async function fetchTokens() {
                try {
                    const response = await fetch(\`\${API_BASE}/tokens/top?viewMode=all-time\`);
                    if (!response.ok) throw new Error('Failed to fetch');

                    const data = await response.json();
                    const tokens = data.top10 || [];

                    if (tokens.length === 0) {
                        document.getElementById('token-list').innerHTML = '<div class="empty-state"><p>Waiting for tokens...</p></div>';
                        return;
                    }

                    const html = tokens.map((token, index) => {
                        const timeAgo = getTimeAgo(token.spottedAt);
                        const multiplier = token.multiplier;
                        const rankClass = \`rank-\${token.rank}\`;

                        const spottedMc = formatCurrency(token.spottedMc);
                        const currentMc = formatCurrency(token.currentMc);
                        const volume = formatCurrency(token.volume24h);

                        const mcChange = token.mcTenSecondsAgo ? token.currentMc - token.mcTenSecondsAgo : 0;
                        const volChange = token.volTenSecondsAgo ? token.volume24h - token.volTenSecondsAgo : 0;

                        const mcChangePercent = token.mcTenSecondsAgo && token.mcTenSecondsAgo > 0 ? (mcChange / token.mcTenSecondsAgo) * 100 : 0;
                        const volChangePercent = token.volTenSecondsAgo && token.volTenSecondsAgo > 0 ? (volChange / token.volTenSecondsAgo) * 100 : 0;

                        const mcArrows = getArrows(mcChangePercent);
                        const volArrows = getArrows(volChangePercent);

                        const iconHtml = token.logoUrl
                            ? \`<img src="\${token.logoUrl}" alt="\${token.name}" class="token-logo" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" /><div class="icon-fallback" style="display:none;">\${token.name.charAt(0).toUpperCase()}</div>\`
                            : \`<div class="icon-fallback">\${token.name.charAt(0).toUpperCase()}</div>\`;

                        const prevData = previousTokenData[token.contractAddress] || {};
                        const mcChanged = prevData.currentMc !== token.currentMc;
                        const volChanged = prevData.volume24h !== token.volume24h;
                        const peakChanged = prevData.peakMultiplier !== token.peakMultiplier;

                        previousTokenData[token.contractAddress] = {
                            currentMc: token.currentMc,
                            volume24h: token.volume24h,
                            peakMultiplier: token.peakMultiplier
                        };

                        return \`
                            <div class="token-card \${rankClass}">
                                <div class="rank">#\${token.rank}</div>
                                <div class="icon">\${iconHtml}</div>
                                <div class="name-info">
                                    <div class="token-name">\${token.name}</div>
                                    <div class="chain">\${token.contractAddress}</div>
                                </div>
                                <div class="data-row">
                                    <div class="data-item">
                                        <div class="data-value primary">\${spottedMc}</div>
                                    </div>
                                    <div class="data-item">
                                        <div class="data-value \${mcChanged ? 'value-changing' : ''}">\${currentMc}<span class="change">\${mcArrows}</span></div>
                                    </div>
                                    <div class="data-item">
                                        <div class="data-value \${volChanged ? 'value-changing' : ''}">\${volume}<span class="change">\${volArrows}</span></div>
                                    </div>
                                    <div class="data-item time-col">
                                        <span class="time-text">\${timeAgo}</span>
                                    </div>
                                    <div class="data-item peak-col">
                                        <span class="peak-text \${peakChanged ? 'value-changing' : ''}">\${multiplier}</span>
                                    </div>
                                </div>
                            </div>
                        \`;
                    }).join('');

                    document.getElementById('token-list').innerHTML = html;
                } catch (error) {
                    console.error('Fetch error:', error);
                }
            }

            // Fetch every second
            fetchTokens();
            setInterval(fetchTokens, 1000);
        </script>
    </body>
    </html>
  `);
});

// Error handler
app.use((err, req, res, next) => {
  logger.error('Express middleware error', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.warn('Shutting down gracefully...');
  dataCollector.shutdown();
  await tokenManager.shutdown();
  logger.success('Shutdown complete');
  process.exit(0);
});

// Start server
const server = app.listen(PORT, '0.0.0.0', async () => {
  const mode = process.env.DATABASE_URL ? '🌐 WEB HOSTING MODE (PostgreSQL)' : '💾 ELECTRON MODE (SQLite)';
  logger.success(`Server running on ${logger.highlight(`http://localhost:${PORT}`)} [${mode}]`);

  // Skip LocalTunnel and external IP detection in web hosting mode
  const isWebHosted = !!process.env.DATABASE_URL;

  if (isWebHosted) {
    logger.info('Running on web hosting platform - skipping LocalTunnel');
    logger.info('Use the platform-provided URL to access this service');
  } else {
    // Get external IP with multiple fallbacks
    const ipServices = [
      'https://api.ipify.org?format=json',
      'https://api64.ipify.org?format=json',
      'https://icanhazip.com',
      'https://ifconfig.me/ip'
    ];

    let externalIP = null;

    for (const service of ipServices) {
      try {
        const response = await axios.get(service, {
          timeout: 5000,
          headers: { 'User-Agent': 'Project-Dexter/1.0' }
        });

        if (response.data.ip) {
          externalIP = response.data.ip;
        } else if (typeof response.data === 'string') {
          externalIP = response.data.trim();
        }

        if (externalIP) {
          logger.info(`External IP: ${logger.highlight(externalIP)}`);
          break;
        }
      } catch (error) {
        continue;
      }
    }

    if (!externalIP) {
      logger.warn('Could not fetch external IP');
    }

    // Start LocalTunnel
    logger.info('Starting LocalTunnel...');
    try {
      const tunnel = await localtunnel({ port: PORT });
      logger.success(`Public URL: ${logger.highlight(tunnel.url)}`);
      logger.info('Share this link with friends - no port forwarding needed!');
      logger.warn('Note: LocalTunnel URL is temporary and changes on restart');

      tunnel.on('close', () => {
        logger.warn('LocalTunnel closed');
      });

      tunnel.on('error', (err) => {
        logger.error('LocalTunnel error:', err);
      });
    } catch (error) {
      logger.error('Failed to start LocalTunnel:', error.message);
      logger.info('Falling back to direct IP access');

      if (externalIP) {
        logger.info(`Direct link: ${logger.highlight(`http://${externalIP}:${PORT}`)}`);
        logger.warn('External access checklist:');
        logger.warn('  1. Windows Firewall: Allow port 3001 inbound');
        logger.warn('  2. Router: Forward port 3001 to this PC');
        logger.warn('  3. Server binds to 0.0.0.0 (all interfaces)');
      }
    }
  }

  logger.divider();
  logger.info(`Monitoring window: ${logger.highlight('3 hours')}`);
  logger.info(`Profiles API: ${logger.highlight('60 req/min')} | Token data API: ${logger.highlight('300 req/min')}`);
  logger.info(`Discovery: ${logger.highlight('Every 1s')} (60 req/min - max profiles rate)`);
  logger.info(`Top 10: ${logger.highlight('Every 0.5s')} (120 req/min - instant updates!)`);
  logger.info(`Background: ${logger.highlight('Every 5s')} (180 req/min - 150 tokens/cycle)`);
  logger.divider();
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} is already in use. Another Project Dexter backend is probably running. Close it and retry.`);
  } else {
    logger.error('Backend server error', err);
  }

  Promise.resolve()
    .then(() => tokenManager.shutdown())
    .catch(() => {})
    .finally(() => process.exit(1));
});
