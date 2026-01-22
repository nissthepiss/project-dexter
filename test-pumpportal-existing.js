/**
 * Test script for PumpPortal WebSocket API
 * Tests subscribeTokenTrade for EXISTING tokens (by CA)
 */

import WebSocket from 'ws';

const PUMPPORTAL_WS = 'wss://pumpportal.fun/api/data';

console.log('🔗 Connecting to PumpPortal WebSocket...');
console.log('⏱️  Test duration: 60 seconds\n');
console.log('🎯 Testing: subscribeTokenTrade for EXISTING tokens\n');

const ws = new WebSocket(PUMPPORTAL_WS);

let isConnected = false;
let messageCount = 0;
const testDuration = 60000;
const timestamps = [];
const tradesPerToken = new Map();
const allTradeData = [];

// Known existing pump.fun tokens to test
// These are tokens from the previous test that should still exist
const TEST_TOKENS = [
  { mint: 'G33ZtfudqADnP14jHbsKLM4C7TTFBjrkNKjm38DXpump', name: '金狗' },
  { mint: 'DjVJvwJRmKH1qno6ZBJGmMBReea2Up7YbGRdJQNCpump', name: 'uncanny valley horse' },
  { mint: '6nZgdnJwxTgVNYwJiPaDeRmW5rXR4L77xaVCQuPApump', name: 'Paddy the Baddy' },
  // Also test with some more recent tokens from the 60s test
  { mint: '4f6SKs5LFcX48jiHjr4Ld5tJhWgkWCiJtZXfga3Mpump', name: 'Misanthropic' },
  { mint: 'GH9H988TmETEet9vEDoa1tUxkKxLWRU3zQYdVCyDpump', name: 'uvh' }
];

console.log('📋 Tokens to monitor:');
TEST_TOKENS.forEach((t, i) => {
  console.log(`   ${i + 1}. ${t.name}`);
  console.log(`      CA: ${t.mint}`);
});

ws.on('open', () => {
  console.log('\n✅ Connected to PumpPortal WebSocket!\n');

  isConnected = true;

  // Subscribe to trade events for specific existing tokens
  console.log('📝 Subscribing to trade events for these tokens...');
  ws.send(JSON.stringify({
    method: 'subscribeTokenTrade',
    keys: TEST_TOKENS.map(t => t.mint)
  }));

  console.log('⏳ Waiting for trade data...\n');
  console.log('━'.repeat(100));
});

ws.on('message', (data) => {
  const now = Date.now();
  messageCount++;
  timestamps.push(now);

  try {
    const message = JSON.parse(data.toString());
    allTradeData.push({ time: now, data: message });

    // Calculate time since start and since last message
    const timeSinceStart = timestamps.length > 1
      ? ((now - timestamps[0]) / 1000).toFixed(2)
      : '0.00';
    const timeSinceLast = timestamps.length > 1
      ? ((now - timestamps[timestamps.length - 2]) / 1000).toFixed(3)
      : '0.000';

    const elapsed = timeSinceStart.padStart(7, ' ');
    const interval = timeSinceLast.padStart(8, ' ');

    console.log(`[${elapsed}s | +${interval}s] 📨 Trade Message #${messageCount}`);

    if (message.txType === 'buy' || message.txType === 'sell') {
      // This is a trade event
      const tokenName = message.name || 'Unknown';
      const symbol = message.symbol || 'N/A';
      const txType = message.txType?.toUpperCase().padEnd(4);
      const solAmount = message.solAmount || 0;
      const tokens = message.tokenAmount || 0;

      // Track trades per token
      const mint = message.mint;
      if (!tradesPerToken.has(mint)) {
        tradesPerToken.set(mint, { buys: 0, sells: 0, totalSol: 0, name: tokenName });
      }
      const stats = tradesPerToken.get(mint);
      if (message.txType === 'buy') stats.buys++;
      if (message.txType === 'sell') stats.sells++;
      stats.totalSol += solAmount;

      console.log(`   ${txType} | ${tokenName} (${symbol})`);
      console.log(`   SOL: ${solAmount?.toFixed(6)} | Tokens: ${tokens?.toFixed(2)}`);
      console.log(`   Trader: ${message.traderPublicKey?.substring(0, 20)}...`);
      console.log(`   Mint: ${mint?.substring(0, 20)}...`);

      if (message.marketCapSol) {
        console.log(`   Market Cap: ${message.marketCapSol?.toFixed(2)} SOL`);
      }
    } else if (message.message) {
      console.log(`   ✅ ${message.message}`);
    } else if (message.errors) {
      console.log(`   ❌ Error: ${message.errors}`);
    } else {
      // Unknown message type, print full data
      console.log(`   ℹ️  Other message type: ${JSON.stringify(message).substring(0, 200)}...`);
    }
    console.log('');
  } catch (e) {
    console.log(`📨 Raw message: ${data.toString().substring(0, 300)}`);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
});

ws.on('close', (code, reason) => {
  console.log('━'.repeat(100));
  console.log(`\n🔌 Connection closed. Code: ${code}`);
  analyzeResults();
  process.exit(code === 1000 ? 0 : 1);
});

function analyzeResults() {
  console.log('\n📊 ANALYSIS RESULTS');
  console.log('━'.repeat(100));

  // Basic stats
  console.log(`\n📈 MESSAGE STATISTICS:`);
  console.log(`   Total messages: ${messageCount}`);
  console.log(`   Trade messages: ${allTradeData.filter(m => m.data.txType === 'buy' || m.data.txType === 'sell').length}`);
  console.log(`   Subscribed tokens: ${TEST_TOKENS.length}`);
  console.log(`   Tokens with activity: ${tradesPerToken.size}`);

  if (timestamps.length > 1) {
    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const minInterval = Math.min(...intervals);
    const maxInterval = Math.max(...intervals);

    console.log(`   Average interval: ${(avgInterval / 1000).toFixed(3)}s`);
    console.log(`   Min interval: ${(minInterval / 1000).toFixed(3)}s`);
    console.log(`   Max interval: ${(maxInterval / 1000).toFixed(3)}s`);
  }

  // Per-token statistics
  if (tradesPerToken.size > 0) {
    console.log(`\n💰 TRADES PER TOKEN:`);
    for (const [mint, stats] of tradesPerToken) {
      const totalTrades = stats.buys + stats.sells;
      const buyRatio = ((stats.buys / totalTrades) * 100).toFixed(1);
      console.log(`   ${stats.name}`);
      console.log(`      Total: ${totalTrades} | ${stats.buys} buys (${buyRatio}%) | ${stats.sells} sells`);
      console.log(`      SOL Volume: ${stats.totalSol.toFixed(4)} SOL`);
      console.log(`      Mint: ${mint.substring(0, 20)}...`);
    }
  } else {
    console.log(`\n⚠️  No trade activity detected in the test period.`);
    console.log(`   This could mean:`);
    console.log(`   - Tokens are less active`);
    console.log(`   - Test period was too short`);
    console.log(`   - Tokens may no longer exist`);
  }

  // Rate over time
  console.log(`\n⏱️  TRADES PER 10-SECOND WINDOW:`);
  const startTime = timestamps[0];
  for (let i = 0; i < 6; i++) {
    const windowStart = startTime + (i * 10000);
    const windowEnd = windowStart + 10000;
    const tradesInWindow = allTradeData.filter(m => {
      const isTrade = m.data.txType === 'buy' || m.data.txType === 'sell';
      const inWindow = m.time >= windowStart && m.time < windowEnd;
      return isTrade && inWindow;
    }).length;
    const bar = '█'.repeat(tradesInWindow);
    console.log(`   ${i * 10}-${(i + 1) * 10}s: ${tradesInWindow} ${bar}`);
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
