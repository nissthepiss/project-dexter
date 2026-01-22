/**
 * Test PumpPortal REST API for existing token data
 */

import axios from 'axios';

const PUMPPORTAL_REST = 'https://pumpportal.fun/api/data';

// Test tokens from recent new token events (within last hour)
const RECENT_TOKENS = [
  'FtYdWC3VSeuDPYmU9gLMWZbHhQqYLbVjDmGfFKeKpump',  // PUMPFUN VS STATES
  'GGuuvtgN5e62VkARBkr9SCTgfYJpXHhMZtNpWvYHpump',  // Chinese Capital Markets
  'GoKDHXqhKhxNxdXKXWLe8SYCvYmFT7JqHZhC6HBLpump',  // 蟹蟹
  '5yGucXmGPsEX35CkJpEnLXRqhFn4mzVWHPqk2RXApump',  // the original coin
  '58hMz4ytu79bTthekmfgPmLBMjZBCF7TQTmcgqyUpump'   // solixdb app
];

console.log('🔍 Testing PumpPortal REST API for existing token data\n');
console.log('━'.repeat(80));

async function testTokenData(mint) {
  try {
    // Try different REST endpoints
    const endpoints = [
      `/token/${mint}`,
      `/tokens/${mint}`,
      `/token?address=${mint}`,
      `/tokens?address=${mint}`,
      `/?token=${mint}`
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`${PUMPPORTAL_REST}${endpoint}`, {
          timeout: 5000,
          headers: { 'User-Agent': 'Project-Dexter/1.0' }
        });

        if (response.data && Object.keys(response.data).length > 0) {
          return { success: true, endpoint, data: response.data };
        }
      } catch (e) {
        // Try next endpoint
      }
    }

    return { success: false, error: 'No working endpoint found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function testCurrentPrice(mint) {
  try {
    const endpoints = [
      `/price/${mint}`,
      `/price?address=${mint}`,
      `/token-price/${mint}`
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`${PUMPPORTAL_REST}${endpoint}`, {
          timeout: 5000
        });

        if (response.data) {
          return { success: true, endpoint, data: response.data };
        }
      } catch (e) {
        // Try next
      }
    }

    return { success: false };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('\n📋 Testing tokens (from most recent first):\n');

  for (let i = 0; i < RECENT_TOKENS.length; i++) {
    const mint = RECENT_TOKENS[i];
    console.log(`\n${i + 1}. Testing: ${mint.substring(0, 20)}...`);

    const result = await testTokenData(mint);
    if (result.success) {
      console.log(`   ✅ SUCCESS with endpoint: ${result.endpoint}`);
      console.log(`   Data:`, JSON.stringify(result.data, null, 2).substring(0, 500));
    } else {
      console.log(`   ❌ Token data: ${result.error}`);
    }

    const priceResult = await testCurrentPrice(mint);
    if (priceResult.success) {
      console.log(`   ✅ Price endpoint: ${priceResult.endpoint}`);
      console.log(`   Data:`, JSON.stringify(priceResult.data, null, 2));
    } else {
      console.log(`   ❌ Price data: ${priceResult.error || 'Not found'}`);
    }

    // Rate limit - small delay between requests
    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n━'.repeat(80));
  console.log('\n📊 SUMMARY:');
  console.log('   PumpPortal REST API appears to be for WebSocket only.');
  console.log('   There is NO REST endpoint for querying existing token data.');
  console.log('   Use DexPaprika or DexScreener REST for existing token queries.');
  console.log('   Use PumpPortal WebSocket for:');
  console.log('     - New token creation events (subscribeNewToken)');
  console.log('     - Real-time trade events (subscribeTokenTrade with keys array)');
}

main().catch(console.error);
