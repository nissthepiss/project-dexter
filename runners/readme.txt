# RUNNERS DATA TRACKING
=====================

## What We're Gathering
This directory tracks tokens that hit 2x+ multiplier from their initial spotted market cap.
We're capturing comprehensive data at the exact moment a token crosses 2x to identify
patterns and trends that separate successful runners from failures.

## Why We're Gathering It
By analyzing tokens that successfully hit 2x, we can:
- Identify early indicators of successful pumps
- Understand the relationship between buy pressure, volume, and price action
- Discover time-based patterns (day of week, hour of day)
- Compare "degen" tokens (newly discovered) vs "holder" tokens (from ranked list)
- Build predictive models for future token performance

## Data Structure
Data is stored in `runners.json` with the following structure:

```json
{
  "metadata": {
    "version": "1.0",
    "createdAt": "ISO timestamp",
    "description": "..."
  },
  "degen": [ /* tokens discovered via DexScreener */ ],
  "holder": [ /* tokens from holder channel */ ]
}
```

## Each Token Record Contains:

### Basic Information
- contractAddress: Token contract address
- name, symbol, chain, logoUrl
- source: 'degen' or 'holder' or 'ex-holder'
- holderRank: Position in holder list (if applicable)

### 2x Event Data
- twoxTimestamp: Unix timestamp when 2x was hit
- twoxIsoTime: Human-readable timestamp
- twoxMultiplier: The exact multiplier at detection

### Market Cap Data
- spottedMc: Market cap when first discovered
- spottedAt: Timestamp when discovered
- currentMc: Market cap at 2x moment
- peakMc: Highest market cap seen
- peakMultiplier: Highest multiplier achieved
- timeToTwoXSeconds: Seconds from discovery to 2x

### Volume & Liquidity
- volume24h: 24-hour trading volume
- liquidity: Total liquidity in USD
- pools: Number of trading pools

### Transaction Metrics (5m, 15m, 30m, 1h, 6h, 24h)
- buys: Number of buy transactions
- sells: Number of sell transactions
- txns: Total transactions
- buy_usd: USD volume of buys
- sell_usd: USD volume of sells
- price_change: Price percentage change

### MVP Score Components
- buyPressure: Buy/sell ratio (-10 to +10)
- netBuyVolume: Net capital inflow (log scale)
- txnsVelocity: Transaction activity
- priceMomentum: Price change percentage
- sseMomentum: Real-time price velocity

### Price Path Snapshots
- 1.25x: { marketCap, timestamp, multiplier }
- 1.5x:  { marketCap, timestamp, multiplier }
- 1.75x: { marketCap, timestamp, multiplier }

### Temporal Data
- dayOfWeek: 0=Sunday, 6=Saturday
- hourOfDay: 0-23 (for time-of-day patterns)

## How to Process the Data

### 1. Manual Inspection
Open `runners.json` in any text editor or JSON viewer.

### 2. Python Analysis
```python
import json

with open('runners.json', 'r') as f:
    data = json.load(f)

# Analyze degen vs holder performance
degens = data['degen']
holders = data['holder']

# Average time to 2x
avg_time_degen = sum(t['timeToTwoXSeconds'] for t in degens if t['timeToTwoXSeconds']) / len(degens)
avg_time_holder = sum(t['timeToTwoXSeconds'] for t in holders if t['timeToTwoXSeconds']) / len(holders)

# Day of week analysis
from collections import Counter
day_counts = Counter(t['dayOfWeek'] for t in degens + holders)
```

### 3. JavaScript/Node.js Analysis
```javascript
const data = require('./runners.json');

// Analyze MVP scores
const avgMVP = data.degen.reduce((sum, t) => sum + t.mvpScore, 0) / data.degen.length;

// Find tokens with highest buy pressure
const topBuyPressure = [...data.degen, ...data.holder]
  .sort((a, b) => b.mvpComponents.buyPressure.raw - a.mvpComponents.buyPressure.raw)
  .slice(0, 10);
```

### 4. Import to Spreadsheet
Convert JSON to CSV and import to Excel/Google Sheets for pivot tables and charts.

## Key Metrics to Analyze

1. **Time to 2x**: How fast do successful tokens move?
   - Fast movers (< 10 min) vs slow movers (> 1 hour)

2. **Buy Pressure Thresholds**: What buy/sell ratios indicate success?
   - Compare winners vs losers

3. **Volume Patterns**: Relationship between volume and price action
   - High volume + high buy pressure = ?

4. **Time of Day**: Are certain times more profitable?
   - Early morning vs late night patterns

5. **Source Comparison**: Do holder tokens outperform degen tokens?
   - Ranked list vs new discoveries

6. **Price Path Analysis**: How do tokens move between milestones?
   - Linear progression vs explosive moves

7. **MVP Component Weights**: Which signals are most predictive?
   - Correlation between each component and 2x success

## Questions This Data Can Answer

1. What buy pressure threshold best predicts 2x success?
2. Do tokens that hit 2x faster continue higher or reverse?
3. What time of day produces the most runners?
4. How do holder channel tokens compare to new discoveries?
5. What volume pattern indicates a sustainable pump vs a dump?
6. Which MVP components are most correlated with 2x success?
7. Do certain days of the week produce better results?

## File Locations
- Data: `runners.json`
- This readme: `readme.txt`
- Source code: `src/backend/dataDumper.mjs`

## Notes
- Each token is only recorded once (first time it hits 2x)
- Data persists across application restarts
- File is automatically updated when new tokens hit 2x
- Price milestones (1.25x, 1.5x, 1.75x) are tracked in real-time

Generated by Project Dexter - Token Analysis System
