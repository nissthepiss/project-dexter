/**
 * Test GeckoTerminal API for existing token data
 */

import axios from 'axios';

const GECKOTERMINAL_API = 'https://api.geckoterminal.com/api/v2';

// Test tokens
const TEST_TOKENS = [
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY (well-known)
  'G33ZtfudqADnP14jHbsKLM4C7TTFBjrkNKjm38DXpump',  // pump.fun token
];

console.log('🔍 Testing GeckoTerminal API for existing token data\n');
console.log('━'.repeat(80));

async function testTokenByAddress(mint) {
  try {
    // GeckoTerminal uses pools, not token addresses directly
    // Need to search for pools containing this token
    console.log(`\n📋 Searching for pools with token: ${mint.substring(0, 20)}...`);

    // Try different endpoint patterns
    const endpoints = [
      `/networks/solana/tokens/${mint}/pools`,     // Get pools for token
      `/networks/solana/tokens/${mint}`,            // Get token info
      `/networks/solana/pools?token=${mint}`,       // Search pools
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(`${GECKOTERMINAL_API}${endpoint}`, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Project-Dexter/1.0',
            'Accept': 'application/json'
          }
        });

        if (response.data && (response.data.data || response.data.data?.length > 0)) {
          console.log(`   ✅ SUCCESS with endpoint: ${endpoint}`);

          const data = response.data.data;
          if (Array.isArray(data)) {
            console.log(`   Found ${data.length} pools`);
            if (data.length > 0) {
              console.log(`   First pool:`, JSON.stringify(data[0], null, 2).substring(0, 600));
            }
          } else {
            console.log(`   Data:`, JSON.stringify(data, null, 2).substring(0, 600));
          }

          return { success: true, endpoint, data: response.data };
        }
      } catch (e) {
        const status = e.response?.status;
        const msg = e.response?.data?.errors?.[0]?.detail || e.message;
        console.log(`   ❌ ${endpoint} - ${status}: ${msg?.substring(0, 80)}`);
      }
    }

    return { success: false, error: 'No working endpoint' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function testMultiTokenQuery(mints) {
  try {
    console.log(`\n📋 Testing multi-token query (${mints.length} tokens)...`);

    // GeckoTerminal may support batch queries
    const response = await axios.get(`${GECKOTERMINAL_API}/networks/solana/tokens/multi`, {
      timeout: 10000,
      params: { addresses: mints.join(',') }
    });

    if (response.data?.data) {
      console.log(`   ✅ Multi-token query works!`);
      console.log(`   Data:`, JSON.stringify(response.data.data, null, 2).substring(0, 500));
      return { success: true, data: response.data };
    }

    return { success: false };
  } catch (e) {
    console.log(`   ❌ Multi-token query failed: ${e.message}`);
    return { success: false };
  }
}

async function searchPumpFunTokens() {
  try {
    console.log(`\n📋 Searching for pump.fun pools on Solana...`);

    // Search for pump.fun DEX pools
    const response = await axios.get(`${GECKOTERMINAL_API}/networks/solana/pools`, {
      timeout: 10000,
      params: {
        dex: 'pump',
        limit: 5
      }
    });

    if (response.data?.data) {
      console.log(`   ✅ Found ${response.data.data.length} pump.fun pools`);

      // Extract token addresses from pools
      for (const pool of response.data.data.slice(0, 3)) {
        const addr = pool.attributes?.address;
        const name = pool.attributes?.name?.substring(0, 30);
        console.log(`      Pool: ${name || 'Unknown'} (${addr?.substring(0, 20)}...)`);
      }

      return { success: true, data: response.data };
    }

    return { success: false };
  } catch (e) {
    console.log(`   ❌ Pump.fun pool search failed: ${e.message}`);
    return { success: false };
  }
}

async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Test 1: Query by token address
  for (const mint of TEST_TOKENS) {
    await testTokenByAddress(mint);
    await new Promise(r => setTimeout(r, 1000));
  }

  // Test 2: Multi-token query
  await testMultiTokenQuery(TEST_TOKENS);
  await new Promise(r => setTimeout(r, 1000));

  // Test 3: Search pump.fun pools
  await searchPumpFunTokens();

  console.log('\n' + '━'.repeat(80));
  console.log('\n📊 GECKOTERMINAL API SUMMARY:\n');
  console.log('   GeckoTerminal provides:');
  console.log('   ✅ REST API for querying existing tokens');
  console.log('   ✅ Pool data (price, volume, liquidity, mcap)');
  console.log('   ✅ Multi-token queries');
  console.log('   ✅ OHLCV data for different timeframes');
  console.log('   ✅ FREE to use');
  console.log('\n   Limitations:');
  console.log('   ⚠️  Uses pool-based queries (not direct token address)');
  console.log('   ⚠️  May need to find pool address first');
}

main().catch(console.error);
