# SCORING METRICS DATA LOG

## Overview
This directory contains JSON snapshots of token scoring data collected during Project Dexter operation.
Each file contains timestamped snapshots of the top 10 tokens, their scores, components, and market data.

## File Naming Convention
- Format: `scoring-snapshot-YYYY-MM-DD-HH-MM-SS.json`
- New files are created every 1000 records
- Each record is a snapshot from an API fetch (every 1-3 seconds)

## Data Structure

Each snapshot contains:
```json
{
  "timestamp": "2025-01-20T14:30:00.000Z",
  "type": "top10",              // or "holder"
  "viewMode": "all-time",        // or "current"
  "data": {
    "tokens": [
      {
        "rank": 1,
        "address": "0x...",
        "symbol": "TOKEN",
        "score": 75.5,
        "components": {
          "buyPressure": { "raw": 0.85, "weighted": 8.5, "weight": 0.1 },
          "netBuyVolume": { "raw": 50000, "weighted": 15.2, "weight": 0.2 },
          "txnsVelocity": { "raw": 150, "weighted": 12.3, "weight": 0.15 },
          "priceMomentum": { "raw": 0.25, "weighted": 18.7, "weight": 0.25 },
          "sseMomentum": { "raw": 0.12, "weighted": 20.8, "weight": 0.3 }
        },
        "currentMc": 1000000,
        "spottedMc": 500000,
        "multiplier": "5.00x",
        "currentMultiplier": "2.00x",
        "volume24h": 250000,
        "netPercent": 15.5,
        "metricsFresh": true,
        "spottedAt": 1737394200000
      }
    ],
    "mvp": {
      "address": "0x...",
      "score": 85.2,
      "health": 92.5,
      "acceleration": { "mc": 25.5, "volume": 30.2 }
    }
  }
}
```

## Analysis Guide

### 1. Understanding the Score Components

The MVP score is a weighted sum of 5 components:

| Component | What it measures | Weight |
|-----------|------------------|--------|
| buyPressure | Ratio of buy vs sell transactions | 10% |
| netBuyVolume | Net buy volume in USD | 20% |
| txnsVelocity | Transaction frequency | 15% |
| priceMomentum | Price change rate | 25% |
| sseMomentum | Smart money trend strength | 30% |

### 2. Key Analysis Questions

#### Predictive Power Analysis
- Do tokens with higher scores tend to reach higher multipliers?
- What score threshold gives the best trade-off between false positives and false negatives?
- How long after scoring do tokens typically peak?

#### Component Effectiveness
- Which components correlate most with successful tokens?
- Are certain components more predictive at different market conditions?
- Should weights be adjusted based on token market cap tier?

#### Time-Based Analysis
- How does score predictive power change over time?
- Do scores degrade in predictive value as tokens age?
- What's the optimal holding period after a high score?

#### False Positive Analysis
- Which high-scoring tokens failed to perform well?
- What patterns distinguish false positives from true positives?
- Are there specific market conditions that reduce accuracy?

### 3. Analysis Approach

#### Step 1: Load the Data
```python
import json
from glob import glob

# Load all JSON files
files = glob('scoring-snapshot-*.json')
data = []
for f in files:
    with open(f) as file:
        data.extend(json.load(file))

print(f"Loaded {len(data)} snapshots")
```

#### Step 2: Extract Token Performance
```python
from collections import defaultdict

tokens = defaultdict(list)

for snapshot in data:
    for token in snapshot['data']['tokens']:
        # Track token over time
        tokens[token['address']].append({
            'timestamp': snapshot['timestamp'],
            'score': token['score'],
            'multiplier': float(token['currentMultiplier'].replace('x', '')),
            'volume24h': token['volume24h'],
            'components': token['components']
        })

# Calculate peak multiplier for each token
token_performance = {}
for address, history in tokens.items():
    peak_mult = max(t['multiplier'] for t in history)
    avg_score = sum(t['score'] for t in history) / len(history)
    first_score = history[0]['score']

    token_performance[address] = {
        'peak_multiplier': peak_mult,
        'avg_score': avg_score,
        'first_score': first_score,
        'snapshots': len(history)
    }
```

#### Step 3: Score vs Multiplier Correlation
```python
import matplotlib.pyplot as plt

scores = [p['first_score'] for p in token_performance.values()]
multipliers = [p['peak_multiplier'] for p in token_performance.values()]

plt.scatter(scores, multipliers, alpha=0.5)
plt.xlabel('Initial Score')
plt.ylabel('Peak Multiplier')
plt.title('Score vs Peak Multiplier Correlation')
plt.savefig('score_vs_multiplier.png')

# Calculate correlation
import numpy as np
correlation = np.corrcoef(scores, multipliers)[0][1]
print(f"Correlation: {correlation:.3f}")
```

#### Step 4: Score Binning Analysis
```python
# Group by score ranges
score_bins = {
    '0-20': [],
    '20-40': [],
    '40-60': [],
    '60-80': [],
    '80-100': []
}

for perf in token_performance.values():
    score = perf['first_score']
    mult = perf['peak_multiplier']

    if score < 20:
        score_bins['0-20'].append(mult)
    elif score < 40:
        score_bins['20-40'].append(mult)
    elif score < 60:
        score_bins['40-60'].append(mult)
    elif score < 80:
        score_bins['60-80'].append(mult)
    else:
        score_bins['80-100'].append(mult)

# Calculate statistics for each bin
for bin_name, mults in score_bins.items():
    if mults:
        print(f"{bin_name}:")
        print(f"  Tokens: {len(mults)}")
        print(f"  Avg Peak Mult: {np.mean(mults):.2f}x")
        print(f"  Max Peak Mult: {np.max(mults):.2f}x")
        print(f"  % Hit 5x: {sum(1 for m in mults if m >= 5) / len(mults) * 100:.1f}%")
        print(f"  % Hit 10x: {sum(1 for m in mults if m >= 10) / len(mults) * 100:.1f}%")
```

#### Step 5: Component Importance Analysis
```python
# Analyze which components correlate most with success
successful_tokens = {addr: p for addr, p in token_performance.items() if p['peak_multiplier'] >= 5}
failed_tokens = {addr: p for addr, p in token_performance.items() if p['peak_multiplier'] < 2}

component_analysis = {}
for comp_name in ['buyPressure', 'netBuyVolume', 'txnsVelocity', 'priceMomentum', 'sseMomentum']:
    successful_scores = []
    failed_scores = []

    for addr in successful_tokens:
        history = tokens[addr]
        if history and history[0]['components']:
            successful_scores.append(history[0]['components'][comp_name]['weighted'])

    for addr in failed_tokens:
        history = tokens[addr]
        if history and history[0]['components']:
            failed_scores.append(history[0]['components'][comp_name]['weighted'])

    if successful_scores and failed_scores:
        component_analysis[comp_name] = {
            'successful_avg': np.mean(successful_scores),
            'failed_avg': np.mean(failed_scores),
            'separation': np.mean(successful_scores) - np.mean(failed_scores)
        }

for comp, stats in sorted(component_analysis.items(), key=lambda x: x[1]['separation'], reverse=True):
    print(f"{comp}:")
    print(f"  Successful (5x+): {stats['successful_avg']:.2f}")
    print(f"  Failed (<2x): {stats['failed_avg']:.2f}")
    print(f"  Separation: {stats['separation']:.2f}")
```

### 4. Confidence Intervals

Based on your analysis, you can define confidence levels:

```python
# Example: Calculate confidence score based on historical performance
def get_confidence_percentage(score, historical_data):
    """
    Returns the probability that a token with given score will hit 5x
    """
    # Find tokens with similar scores
    similar_tokens = [p for p in historical_data if abs(p['first_score'] - score) < 10]

    if not similar_tokens:
        return 50  # Unknown

    success_rate = sum(1 for p in similar_tokens if p['peak_multiplier'] >= 5) / len(similar_tokens)
    return success_rate * 100

# Apply to your scoring algorithm
for token in tokens_to_score:
    confidence = get_confidence_percentage(token.score, token_performance)
    print(f"{token.symbol}: Score {token.score} = {confidence:.1f}% confidence of 5x+")
```

### 5. Optimization Targets

After analysis, you can optimize:

1. **Weight Tuning**: Adjust component weights based on separation analysis
2. **Score Thresholds**: Set minimum scores for different risk levels
3. **Component Filtering**: Remove or reduce weight of low-separation components
4. **Market Conditions**: Different weights for bull vs bear markets
5. **Time Windows**: Adjust how much historical data to consider

### 6. Common Metrics to Track

- **Precision**: Of tokens with score > X, what % hit 5x?
- **Recall**: Of all tokens that hit 5x, what % had score > X?
- **F1 Score**: Harmonic mean of precision and recall
- **False Positive Rate**: % of high-scoring tokens that failed
- **False Negative Rate**: % of successful tokens with low scores

## Tips for Better Analysis

1. **Collect at least 1 week of data** for meaningful statistics
2. **Separate by market conditions** - bull vs bear markets behave differently
3. **Track over different time periods** - 1h, 6h, 24h, 7d performance
4. **Consider market cap tiers** - micro vs small vs mid caps
5. **Note outliers** - extreme wins/failures often teach the most
6. **Cross-validate** - test findings on held-out data

## Quick Start Analysis Script

```python
# Run this script to get a quick overview
import json, glob
from collections import defaultdict
import numpy as np

files = glob('*.json')
all_data = []
for f in files:
    with open(f) as file:
        all_data.extend(json.load(file))

tokens = defaultdict(list)
for snapshot in all_data:
    for token in snapshot.get('data', {}).get('tokens', []):
        tokens[token['address']].append({
            'score': token['score'],
            'mult': float(token['currentMultiplier'].replace('x', ''))
        })

results = []
for addr, history in tokens.items():
    results.append({
        'addr': addr,
        'first_score': history[0]['score'],
        'peak_mult': max(h['mult'] for h in history)
    })

results.sort(key=lambda x: x['first_score'], reverse=True)

print("Top 20 by initial score:")
for r in results[:20]:
    print(f"Score {r['first_score']:.1f} -> Peak {r['peak_mult']:.2f}x")

print(f"\nTotal tokens tracked: {len(results)}")
print(f"Correlation: {np.corrcoef([r['first_score'] for r in results], [r['peak_mult'] for r in results])[0][1]:.3f}")
```

---

Generated by Project Dexter Data Collector
For questions, refer to the main project documentation.
