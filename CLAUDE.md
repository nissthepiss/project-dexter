# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Project Dexter** is an Electron desktop application for real-time Solana token tracking, specifically designed for monitoring pump.fun tokens and detecting early momentum trading opportunities.

### Architecture

```
Electron Main Process (src/main/index.js)
    ↓ spawns
Express Backend Server (src/backend/server.mjs) on port 3001
    ↓ serves
Vanilla JS Frontend (src/renderer/)
```

- **Main Process**: Manages Electron window lifecycle and spawns backend as child process
- **Backend**: Express server with SSE/REST API integrations, SQLite database, and multi-source token tracking
- **Frontend**: Terminal-style UI with real-time updates

### Entry Points

- `src/main/index.js` - Electron main process
- `src/backend/server.mjs` - Express server (started as child process)
- `src/renderer/index.html` - Frontend entry point

## Development Commands

```bash
npm run dev        # Run with DevTools
npm start          # Run in production mode
npm run build      # Build for current platform
npm run build:win  # Build Windows installer/portable
```

## Backend Architecture

### Core Services (src/backend/)

- **tokenManager.mjs** - Central orchestrator for all token tracking. Manages token lifecycle, discovery cycles, SSE subscriptions, and coordinates all data sources.
- **mvpCalculator_v3.mjs** - Sophisticated scoring algorithm combining SSE price momentum with REST transaction metrics (buy pressure, net volume, txns velocity, price momentum).
- **telegramService.mjs** - Telegram bot integration for alerts
- **holderService.mjs** - Alternative analysis mode for longer-term token tracking

### API Integrations (src/backend/apis/)

- **dexpaprika.mjs** - Primary data source via SSE (real-time price updates for top 10) and REST (batch token data, transaction metrics)
- **dexscreener.mjs** - Token discovery via profiles API, initial market cap data
- **bitquery.mjs** - Transaction data (currently disabled in favor of DexPaprika)
- **birdeye.mjs**, **solscan.mjs**, **coingecko.mjs** - Additional data sources

### Tracking Cycles

The system runs multiple concurrent update cycles:

1. **Discovery** (every 1s) - Find new tokens via DexScreener profiles API (rate limited to 60 req/min)
2. **SSE Top 10** (real-time ~1s) - DexPaprika SSE for price updates on current top 10 tokens
3. **SSE Subscription Update** (every 5s) - Re-evaluate top 10 and update SSE subscriptions
4. **Background REST** (every 15s) - Update all tokens NOT in SSE top 10 via DexPaprika REST
5. **SSE Token Metrics** (every 15s) - Fetch transaction metrics for SSE-connected tokens
6. **Unknown Ticker Refresh** (every 1m min) - Retry tokens with "Unknown" symbols

### Token Lifecycle

1. Discovered via DexScreener profiles API
2. Initial data fetch (market cap, volume, metadata)
3. Added to `trackedTokens` Map and SQLite database
4. Updated via SSE (if in top 10) or REST (background)
5. Cleaned up after 2 hours (unless holder token)

### View Modes

The application supports multiple time-window filters:
- `5m`, `30m`, `1h`, `2h` - Time-filtered views
- `all-time` - No time filtering

View modes affect:
- Top 10 calculation for SSE subscriptions
- MVP scoring weights (short-term modes favor immediate signals)
- Token filtering in API responses

## MVP Scoring System

The MVP calculator (v3) uses a hybrid approach:

**Components:**
- Buy Pressure (35%) - Ratio of buys to total transactions (0-1, 0.5 = neutral)
- Net Buy Volume (20%) - Logarithmic scale of capital inflow
- Transaction Velocity (15%) - Activity level (txns per 5m)
- Price Momentum (20%) - Percentage price change
- SSE Momentum (10%) - Real-time price velocity from SSE streams

**Weights adjust by view mode:**
- Short-term (5m): Favor immediate signals (SSE, price momentum)
- Long-term (all-time): Favor sustained signals (buy pressure, net volume)

## Database

- SQLite-based storage (`src/backend/database/`)
- Tokens stored with all metadata, peaks, and holder-specific stats
- Alert tiers configuration persisted
- Blacklist support

## Dual Operation Modes

1. **Degen Mode** (default) - Quick pumps, 2-hour monitoring window
2. **Holder Mode** - Longer-term analysis, separate tracking via holderService

Tokens from holder mode have:
- Separate stats (`holderSpottedMc`, `holderPeakMultiplier`)
- Indefinite tracking (never expire)
- Different NET calculation (10-minute snapshots vs 10-second)

## Rate Limiting

- DexScreener: 60 req/min (profiles API) via token-bucket limiter
- DexPaprika: 10 concurrent requests in batch operations

## Important Implementation Details

### SSE (Server-Sent Events) Top 10 Rotation
- Only top 10 tokens (by peak multiplier) get SSE real-time updates
- SSE subscriptions re-evaluated every 5 seconds
- Debounced during view mode changes (2s delay) to prevent rapid re-subscription

### Token Object Structure
Key fields in token objects:
- `contractAddress` - Unique identifier (Map key)
- `spottedAt`, `spottedMc` - Discovery baseline
- `currentMc`, `peakMc`, `peakMultiplier` - Market cap tracking
- `volume24h`, `previousVolume24h` - Volume with NET calculation
- `mcTenSecondsAgo`, `volTenSecondsAgo` - Baseline for UI arrows
- `source` - 'degen' (default) or 'holder'/'ex-holder'
- `transactionMetrics` - REST API transaction data (5m, 15m timeframes)
- `lastMetricsUpdate` - Timestamp for metrics freshness check

### Discovery Failure Handling
- Tokens that fail discovery are tracked in `failedDiscoveryTokens` Map
- Retry after 5 minutes to avoid spamming bad addresses

### Alert System
- Tier-based: 1.1x (tier1), 1.2x (tier2), 1.3x (tier3)
- Tier 3 triggers auto Telegram alert (if enabled)
- Sound alerts for tier 1 hits
- Spam prevention via announced token tracking

## API Routes

- `/api/tokens/top?viewMode=<mode>` - Get top 10 tokens with MVP
- `/api/tokens/mvp?viewMode=<mode>` - Get MVP token details
- `/api/mode` - Get/set current mode (degen/holder)
- `/api/telegram/*` - Telegram bot management
- `/api/blacklist/*` - Token blacklist management
- `/api/channels` - Holder channel polling endpoint

## Frontend

- Vanilla JavaScript (no frameworks)
- `app.js` - Main app logic with polling updates
- `styles.css` - Terminal-style dark theme
- Updates every 500ms via `fetchTokens()`

## LocalTunnel

Backend automatically creates public URL via LocalTunnel for external sharing. Fallback to direct IP access if tunnel fails (requires port forwarding).

## Testing

- `src/backend/apiTester.mjs` - API integration testing
- `src/backend/dataCollector.mjs` - Records scoring metrics to `src/data/scoring-logs/` for algorithm analysis
