# DexPaprika API Analysis - Data Available for Top 10 Algorithm

## Executive Summary

This document analyzes the **DexPaprika Free API** to identify all available data fields, update frequencies, and useful metrics for improving the top 10 token ranking algorithm.

**Key Finding**: REST API provides significantly more data than SSE, including critical transaction metrics (buys/sells) and buy/sell pressure indicators that are **gold** for detecting pump momentum.

---

## API Comparison Overview

| Aspect | SSE (Streaming) | REST (Polling) |
|--------|-----------------|----------------|
| **Endpoint** | `https://streaming.dexpaprika.com/stream?method=t_p&chain=solana&address={address}` | `https://api.dexpaprika.com/networks/solana/tokens/{address}` |
| **Update Rate** | Real-time (instant) | ~15 seconds (~4 updates/minute) |
| **Data Fields** | 3 fields (address, price, timestamp) | 81 fields |
| **Rate Limits** | Max 10 concurrent connections | ~30 requests/minute (429 after ~25 rapid requests) |
| **Bandwidth** | Low | Medium |
| **Reliability** | Good | Good |

---

## SSE API (Server-Sent Events)

### What It Provides

Real-time price updates via streaming connection.

### Data Structure
```javascript
{
  "a": "token_address",      // Contract address
  "c": "solana",             // Chain
  "p": 0.00001234,           // Current price
  "t": 1705687234567,        // Server timestamp
  "t_p": 1705687234567       // Price timestamp
}
```

### Fields Available (3 fields)

| Field | Type | Description |
|-------|------|-------------|
| `p` | float | **Current price USD** |
| `t` | int | Server timestamp |
| `t_p` | int | Price timestamp |

### Update Frequency
- **Instant** - updates arrive as soon as price changes
- No polling delay
- Must maintain persistent connection

### Limitations
- Max 10 concurrent connections (suitable for top 10 only)
- No volume data
- No transaction counts
- No liquidity data
- No buy/sell pressure
- No price change percentage

---

## REST API (Polling)

### What It Provides

Comprehensive token data including price, volume, liquidity, market cap, and **transaction metrics**.

### Data Structure
```javascript
{
  "id": "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  "name": "Bonk",
  "symbol": "BONK",
  "chain": "solana",
  "decimals": 5,
  "total_supply": 87995165207958.38,
  "description": "...",
  "website": "https://bonkcoin.com",
  "has_image": true,
  "added_at": "2026-01-10T15:39:37Z",
  "summary": {
    "price_usd": 0.00000915,
    "fdv": 805878863.57,
    "liquidity_usd": 4978601.42,
    "pools": 253,
    "24h": { volume, buys, sells, txns, buy_usd, sell_usd, last_price_usd_change },
    "6h": { ... },
    "1h": { ... },
    "30m": { ... },
    "15m": { ... },
    "5m": { ... },
    "1m": { ... }
  },
  "last_updated": "2026-01-19T12:43:28.277860237Z"
}
```

### Fields Available (81 fields)

#### Static Token Metadata (13 fields) - Rarely Changes

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Contract address |
| `name` | string | Token name |
| `symbol` | string | Token symbol |
| `chain` | string | "solana" |
| `decimals` | int | Token decimals |
| `total_supply` | float | Total token supply |
| `description` | string | Token description |
| `website` | string | Project website |
| `has_image` | boolean | Has logo image |
| `added_at` | string | When added to DexPaprika |
| `summary.chain` | string | Chain identifier |
| `summary.id` | string | Token ID in summary |
| `summary.pools` | int | **Number of liquidity pools** |

#### Dynamic Market Data (5 fields) - Updates Every ~15 Seconds

| Field | Type | Description | Algorithm Value |
|-------|------|-------------|-----------------|
| `summary.price_usd` | float | **Current price** | ✓ Price tracking |
| `summary.fdv` | float | **Fully diluted value (market cap)** | ✓✓✓ Market cap ranking |
| `summary.liquidity_usd` | float | **Total liquidity USD** | ✓✓ Safety filter (avoid rugs) |
| `last_updated` | string | Last update timestamp | Data freshness check |

#### Time-Window Metrics - 7 Timeframes Available

Each timeframe (1m, 5m, 15m, 30m, 1h, 6h, 24h) provides **8 fields**:

| Field | Type | Description | Algorithm Value |
|-------|------|-------------|-----------------|
| `summary.{timeframe}.volume` | float | Volume in token | |
| `summary.{timeframe}.volume_usd` | float | **Volume USD** | ✓✓ Trading activity |
| `summary.{timeframe}.buys` | int | **Number of buy transactions** | ✓✓✓ Buy pressure |
| `summary.{timeframe}.sells` | int | **Number of sell transactions** | ✓✓✓ Sell pressure |
| `summary.{timeframe}.txns` | int | **Total transactions** | ✓✓✓ Activity score |
| `summary.{timeframe}.buy_usd` | float | **USD value of buys** | ✓✓✓ Real buy volume |
| `summary.{timeframe}.sell_usd` | float | **USD value of sells** | ✓✓✓ Real sell volume |
| `summary.{timeframe}.last_price_usd_change` | float | **Price change %** | ✓✓✓ Momentum indicator |

**Total time-window fields**: 7 timeframes × 8 fields = **56 fields**

### Update Frequency

From 60-second polling test (26 requests):
- **4 unique responses** = ~4 updates per minute
- **Updates every ~15 seconds**
- Only 15% of polls returned new data (when polling every 2 seconds)
- Got rate-limited (429) after ~25 rapid requests

**Recommended polling interval**: Every 15-20 seconds

### Rate Limits

- Free tier appears to allow ~30 requests/minute
- 429 errors after rapid polling
- Recommend: Poll top 20-30 tokens every 15-20 seconds

---

## Missing Data (Not Available)

The following data is **NOT provided** by either API:

- ❌ Holder count
- ❌ Holder distribution (top 10 holders, etc.)
- ❌ Unique wallet count
- ❌ Token age / creation time
- ❌ Social media metrics
- ❌ Developer activity
- ❌ Contract audit status

---

## Algorithm Recommendations

### High-Value Metrics for Top 10 Ranking

Based on available data, here are the most valuable metrics:

#### Tier 1: Critical for Momentum Detection

| Metric | Source | Formula | Why It's Valuable |
|--------|--------|---------|-------------------|
| **Buy Pressure Ratio** | REST 5m/15m | `buys / (buys + sells)` | >0.5 = bullish, detecting accumulation |
| **Transaction Velocity** | REST 5m/15m | `txns` (count) | High txns = active trading, pump signal |
| **Price Momentum** | REST 5m/15m | `last_price_usd_change` | Positive = pumping |
| **Net Buy Volume** | REST 5m/15m | `buy_usd - sell_usd` | Positive money flow |

#### Tier 2: Important for Filtering

| Metric | Source | Why It's Valuable |
|--------|--------|-------------------|
| **Liquidity** | REST | Filter out low-liquidity rugs |
| **Market Cap (FDV)** | REST | Size/safety indicator |
| **Pool Count** | REST | More pools = healthier distribution |
| **Real-time Price** | SSE | Instant updates on top 10 |

#### Tier 3: Secondary Indicators

| Metric | Source | Why It's Valuable |
|--------|--------|-------------------|
| **Volume USD** | REST | Overall activity |
| **Total Supply** | REST | For calculating market cap |

### Proposed Scoring Formula

```javascript
// Example scoring algorithm (weights need tuning)
const calculateScore = (token, ssePrice) => {
    const rest = token.summary;

    // Momentum signals (5m is most responsive)
    const priceChange5m = rest['5m'].last_price_usd_change;
    const buyRatio5m = rest['5m'].buys / (rest['5m'].buys + rest['5m'].sells);
    const txns5m = rest['5m'].txns;
    const netBuyVolume5m = rest['5m'].buy_usd - rest['5m'].sell_usd;

    // Trend confirmation (15m)
    const priceChange15m = rest['15m'].last_price_usd_change;
    const txns15m = rest['15m'].txns;

    // Safety filters
    const liquidity = rest.liquidity_usd;
    const pools = rest.pools;

    // Real-time check from SSE
    const ssePriceScore = ssePrice ? 1.2 : 1; // Boost if we have SSE data

    // Calculate score
    let score = 0;

    // Momentum (40% weight)
    score += priceChange5m * 2; // Price momentum
    score += (buyRatio5m - 0.5) * 10; // Buy pressure (0.5 = neutral)
    score += Math.min(txns5m / 10, 5); // Transaction activity
    score += Math.log10(Math.max(netBuyVolume5m, 1)) * 0.5; // Net money flow

    // Trend confirmation (30% weight)
    score += priceChange15m * 1.5;
    score += Math.min(txns15m / 20, 3);

    // Safety bonus (20% weight)
    if (liquidity > 50000) score += 2; // Decent liquidity
    if (liquidity > 200000) score += 3; // High liquidity
    if (pools > 10) score += 1; // Healthy distribution

    // Real-time boost (10% weight)
    score *= ssePriceScore;

    return score;
};
```

### Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Top 10 Algorithm                         │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────┐         ┌─────────────┐                    │
│  │ SSE (10)    │         │ REST (30)   │                    │
│  │ Top 10 only │         │ Top 30      │                    │
│  │ Real-time   │         │ Every 15s   │                    │
│  └──────┬──────┘         └──────┬──────┘                    │
│         │                      │                            │
│         │ price                │ comprehensive data        │
│         ▼                      ▼                            │
│  ┌─────────────────────────────────────────┐               │
│  │           Scoring Engine                │               │
│  │  • Buy pressure from REST               │               │
│  │  • Momentum from REST                   │               │
│  │  • Real-time price from SSE             │               │
│  │  • Liquidity filter from REST           │               │
│  └──────────────────┬──────────────────────┘               │
│                     │                                        │
│                     ▼                                        │
│              ┌──────────┐                                   │
│              │ Top 10   │                                   │
│              │ Ranked   │                                   │
│              └──────────┘                                   │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Strategy

1. **REST Poller** (runs every 15 seconds)
   - Fetch data for top 30 tokens
   - Calculate buy pressure, momentum, txns
   - Update scores

2. **SSE Manager** (persistent connections)
   - Maintain 10 SSE connections for current top 10
   - Provide instant price updates
   - Adjust scores on significant price moves

3. **Scoring & Ranking**
   - Combine REST metrics + SSE price
   - Apply liquidity/safety filters
   - Sort and return top 10

4. **Connection Rotation**
   - When top 10 changes, disconnect SSE for dropped tokens
   - Connect SSE for new top 10 entries

---

## Quick Reference: Best Metrics by Use Case

| Use Case | Best Metric(s) | Source |
|----------|----------------|--------|
| **Detect pump start** | `5m.last_price_usd_change`, `5m.txns` | REST |
| **Confirm sustainable pump** | `5m.buys > 5m.sells`, `15m.price_change > 0` | REST |
| **Filter rugs** | `liquidity_usd > 50000` | REST |
| **Real-time tracking** | SSE `price` | SSE |
| **Buy pressure** | `(buy_usd - sell_usd)` or `buys / (buys + sells)` | REST |
| **Activity score** | `txns` | REST |
| **Market cap ranking** | `fdv` | REST |

---

## Test Data

Test conducted on: `2026-01-19`
Test token: `DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263` (BONK)
Test duration: 60 seconds
Polling interval: 2 seconds
Results: 4 unique responses (15% of requests)

---

## Conclusion

The DexPaprika REST API provides **significantly more valuable data** than SSE for ranking tokens. The key advantage is **transaction-level data** (buys, sells, txns) which allows detection of:

1. **Buy pressure** - Are people accumulating?
2. **Transaction velocity** - Is trading activity increasing?
3. **Money flow** - Is net volume positive?

Combined with SSE for real-time price updates on the final top 10, this creates a powerful system for detecting and ranking pumping tokens.

**Recommended approach**: Use REST to monitor top 30 tokens every 15 seconds, use SSE for real-time price updates on final top 10.
