REQUIREMENTS:

THINK SPECIFICALLY LOW MARKET CAPS - 10-100k mcap coins mostly, less than 10 mins old, but not always. Optimise around that.

1. ADVANCED MOMENTUM METRICS:
   - Multi-timeframe analysis (1s, 3s, 5s, 10s windows simultaneously)
   - Jerk calculation (rate of change of acceleration)
   - Volume/MC correlation coefficient
   - Volatility index (standard deviation of price changes)
   - Trend strength indicator (how consistent is the growth)

2. MACHINE LEARNING INDICATORS:
   - Pattern recognition for "pump signatures"
   - Historical comparison against known successful runners
   - Anomaly detection for unusual volume spikes
   - Bayesian probability scoring for "will this 10x?"

3. EARLY WARNING SIGNALS:
   - Detect accumulation phase (volume increasing, price stable)
   - Identify breakout moments (price + volume spike together)
   - Whale activity detection (large single transactions)
   - FOMO detection (rapid acceleration in both metrics)

4. SCORING ALGORITHM:
   - Dynamic weight adjustment based on token age
   - Confidence intervals (how sure are we about this score?)
   - Risk-adjusted scoring (potential upside vs volatility)
   - Time-decay function (newer momentum weighted higher)

5. OPTIMIZATION:
   - Must run in <10ms per token (60+ tokens tracked)
   - Memory efficient (only 30s buffer per token)
   - No external API calls (use only in-memory data)
   - Compatible with existing tokenManager.mjs structure


7. TESTING:
   - Unit tests for all calculation functions
   - Performance benchmarks
   - Backtesting capability against historical data
   - Debug mode with detailed signal breakdown

SUCCESS CRITERIA:
- [ ] mvpCalculator_v3.mjs created in C:\Projects\Project Dexter\src\backend\
- [ ] All momentum metrics implemented and tested
- [ ] Scoring runs in <10ms per token
- [ ] Unit tests with >85% coverage
- [ ] README.md with algorithm explanation and tuning guide
- [ ] Integration example showing how to swap from mvpCalculator_improved.mjs
- [ ] Debug/visualization mode for testing signals