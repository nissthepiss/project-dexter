/**
 * Test script for PumpPortal WebSocket API
 * Tests data update frequency and timing
 */

import WebSocket from 'ws';

const PUMPPORTAL_WS = 'wss://pumpportal.fun/api/data';

console.log('🔗 Connecting to PumpPortal WebSocket...');
console.log('⏱️  Test duration: 60 seconds\n');

const ws = new WebSocket(PUMPPORTAL_WS);

let isConnected = false;
let messageCount = 0;
const testDuration = 60000; // Test for 60 seconds
const timestamps = [];
const tokensSeen = new Map(); // Track unique tokens and their update count
const messages = []; // Store all messages for analysis

ws.on('open', () => {
  console.log('✅ Connected to PumpPortal WebSocket!\n');
  isConnected = true;

  // Subscribe to new token creation events
  console.log('📝 Subscribing to new token creation events...');
  ws.send(JSON.stringify({
    method: 'subscribeNewToken'
  }));
  console.log('⏳ Waiting for data...\n');
  console.log('━'.repeat(80));
});

ws.on('message', (data) => {
  const now = Date.now();
  messageCount++;
  timestamps.push(now);

  try {
    const message = JSON.parse(data.toString());
    messages.push({ time: now, data: message });

    // Calculate time since start and since last message
    const timeSinceStart = ((now - timestamps[0]) / 1000).toFixed(2);
    const timeSinceLast = timestamps.length > 1
      ? ((now - timestamps[timestamps.length - 2]) / 1000).toFixed(3)
      : '0.000';

    // Track unique tokens
    if (message.mint) {
      const count = tokensSeen.get(message.mint) || 0;
      tokensSeen.set(message.mint, count + 1);
    }

    // Format output
    const elapsed = timeSinceStart.padStart(6, ' ');
    const interval = timeSinceLast.padStart(7, ' ');

    console.log(`[${elapsed}s | +${interval}s] 📨 Message #${messageCount}`);

    if (message.mint) {
      console.log(`   Token: ${message.name || 'Unknown'} (${message.symbol || 'N/A'})`);
      console.log(`   Mint: ${message.mint.substring(0, 20)}...`);
      console.log(`   Market Cap: ${message.marketCapSol?.toFixed(2) || 'N/A'} SOL`);
      console.log(`   Initial Buy: ${message.solAmount?.toFixed(4) || 'N/A'} SOL`);
      console.log(`   Type: ${message.txType || 'unknown'}`);

      // Track updates for this token
      const updateCount = tokensSeen.get(message.mint);
      if (updateCount > 1) {
        console.log(`   ⚠️  UPDATE #${updateCount} for this token`);
      }
    } else if (message.message) {
      console.log(`   ✅ ${message.message}`);
    } else if (message.errors) {
      console.log(`   ❌ ${message.errors}`);
    }
    console.log('');
  } catch (e) {
    console.log(`📨 Raw message #${messageCount}: ${data.toString().substring(0, 200)}`);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', (code, reason) => {
  console.log('━'.repeat(80));
  console.log(`\n🔌 Connection closed. Code: ${code}`);
  analyzeResults();
  process.exit(code === 1000 ? 0 : 1);
});

function analyzeResults() {
  console.log('\n📊 ANALYSIS RESULTS');
  console.log('━'.repeat(80));

  // Basic stats
  console.log(`\n📈 MESSAGE STATISTICS:`);
  console.log(`   Total messages: ${messageCount}`);
  console.log(`   Unique tokens: ${tokensSeen.size}`);

  if (timestamps.length > 1) {
    // Calculate intervals
    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const minInterval = Math.min(...intervals);
    const maxInterval = Math.max(...intervals);
    const medianInterval = intervals.sort((a, b) => a - b)[Math.floor(intervals.length / 2)];

    console.log(`   Average interval: ${(avgInterval / 1000).toFixed(3)}s (${(1000 / avgInterval).toFixed(2)} msg/sec)`);
    console.log(`   Min interval: ${(minInterval / 1000).toFixed(3)}s`);
    console.log(`   Max interval: ${(maxInterval / 1000).toFixed(3)}s`);
    console.log(`   Median interval: ${(medianInterval / 1000).toFixed(3)}s`);

    // Interval distribution
    console.log(`\n📊 INTERVAL DISTRIBUTION:`);
    const buckets = {
      '< 1s': 0,
      '1-5s': 0,
      '5-10s': 0,
      '10-30s': 0,
      '> 30s': 0
    };

    for (const interval of intervals) {
      const seconds = interval / 1000;
      if (seconds < 1) buckets['< 1s']++;
      else if (seconds < 5) buckets['1-5s']++;
      else if (seconds < 10) buckets['5-10s']++;
      else if (seconds < 30) buckets['10-30s']++;
      else buckets['> 30s']++;
    }

    for (const [bucket, count] of Object.entries(buckets)) {
      const pct = ((count / intervals.length) * 100).toFixed(1);
      console.log(`   ${bucket.padEnd(8)}: ${count.toString().padStart(3)} (${pct}%)`);
    }
  }

  // Token update frequency
  if (tokensSeen.size > 0) {
    console.log(`\n🔄 TOKEN UPDATE FREQUENCY:`);
    const updateDistribution = new Map();
    for (const [, count] of tokensSeen) {
      const key = count.toString();
      updateDistribution.set(key, (updateDistribution.get(key) || 0) + 1);
    }

    for (const [updates, tokens] of [...updateDistribution.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, {numeric: true}))) {
      console.log(`   ${updates.padStart(3)} update(s): ${tokens} token(s)`);
    }
  }

  // Rate over time
  console.log(`\n⏱️  MESSAGES PER 10-SECOND WINDOW:`);
  const startTime = timestamps[0];
  for (let i = 0; i < 6; i++) {
    const windowStart = startTime + (i * 10000);
    const windowEnd = windowStart + 10000;
    const count = timestamps.filter(t => t >= windowStart && t < windowEnd).length;
    const bar = '█'.repeat(Math.ceil(count / 2));
    console.log(`   ${i * 10}-${(i + 1) * 10}s: ${count.toString().padStart(2)} ${bar}`);
  }

  console.log('\n✅ Test complete!');
}

// Handle timeout
setTimeout(() => {
  console.log(`\n⏱️ Test duration reached (${testDuration}ms)`);
  ws.close();
}, testDuration);

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n⚠️ Interrupted by user');
  ws.close();
  process.exit(0);
});
