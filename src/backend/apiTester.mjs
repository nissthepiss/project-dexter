import axios from 'axios';

// Popular Solana token addresses for testing
const TEST_TOKENS = [
  'EPjFWaLb3odcccccccccccccccccccccccccccccccc', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenErt', // USDT
  'So11111111111111111111111111111111111111112', // SOL (wrapped)
  'MangoCzJ36AjZyKwVj3VnYU4GTonjfVEnJmvvWaxLac', // MANGO
  'EPjFWaLb3odcccccccccccccccccccccccccccccccc', // USDC (repeat for variety)
  'SRMuApVgqbCV5e1kCncjiMY93KbjmZbCVrnthinBC51', // SRM
  'TokenkegQfeZyiNwAJsyFbPVwwQW8JwQzccUapQiCis', // TOKEN
  '4k3Dyjzvzp8eMZWUXbBCjEvwSViQjuvQnAv9KwYjG6i', // COPE
];

export async function getRandomTestToken() {
  return TEST_TOKENS[Math.floor(Math.random() * TEST_TOKENS.length)];
}

export async function testAllAPIs(contractAddress) {
  const results = {};
  const startTime = Date.now();

  // Test DexScreener
  results.dexscreener = await testDexScreener(contractAddress);

  // Test Birdeye
  results.birdeye = await testBirdeye(contractAddress);

  // Test Jupiter
  results.jupiter = await testJupiter(contractAddress);

  // Test CoinGecko
  results.coingecko = await testCoinGecko(contractAddress);

  // Test Solscan
  results.solscan = await testSolscan(contractAddress);

  const totalTime = Date.now() - startTime;

  return {
    contractAddress,
    totalTime,
    results,
    fastest: Object.entries(results).reduce((a, b) => 
      (a[1].time || Infinity) < (b[1].time || Infinity) ? a : b
    )[0],
    mostReliable: Object.entries(results).reduce((a, b) =>
      (a[1].success && a[1].marketCap > 0) ? a : b
    )[0]
  };
}

async function testDexScreener(contractAddress) {
  const startTime = Date.now();
  try {
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`,
      { timeout: 10000 }
    );

    const time = Date.now() - startTime;
    if (response.data.pairs && response.data.pairs.length > 0) {
      const pair = response.data.pairs[0];
      return {
        success: true,
        time,
        marketCap: pair.marketCap || pair.fdv || 0,
        volume24h: pair.volume?.h24 || 0,
        price: parseFloat(pair.priceUsd) || 0
      };
    }
    return { success: false, time, error: 'No pairs found' };
  } catch (error) {
    return {
      success: false,
      time: Date.now() - startTime,
      error: error.message
    };
  }
}

async function testBirdeye(contractAddress) {
  const startTime = Date.now();
  const apiKey = process.env.BIRDEYE_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      time: 0,
      error: 'API key not set'
    };
  }

  try {
    const response = await axios.get(
      'https://api.birdeye.so/defi/token_summary',
      {
        params: {
          address: contractAddress,
          time_from: Math.floor(Date.now() / 1000) - 86400
        },
        headers: { 'X-API-KEY': apiKey },
        timeout: 10000
      }
    );

    const time = Date.now() - startTime;
    if (response.data.success && response.data.data) {
      return {
        success: true,
        time,
        marketCap: response.data.data.marketCap || 0,
        volume24h: response.data.data.volume?.['24h'] || 0,
        holders: response.data.data.holders || 0
      };
    }
    return { success: false, time, error: 'Request failed' };
  } catch (error) {
    return {
      success: false,
      time: Date.now() - startTime,
      error: error.message
    };
  }
}

async function testJupiter(contractAddress) {
  const startTime = Date.now();
  try {
    const response = await axios.get(
      'https://price.jup.ag/price',
      {
        params: { ids: contractAddress },
        timeout: 10000
      }
    );

    const time = Date.now() - startTime;
    if (response.data.data && response.data.data[contractAddress]) {
      return {
        success: true,
        time,
        price: parseFloat(response.data.data[contractAddress].price) || 0,
        lastUpdated: response.data.data[contractAddress].lastUpdated
      };
    }
    return { success: false, time, error: 'No data found' };
  } catch (error) {
    return {
      success: false,
      time: Date.now() - startTime,
      error: error.message
    };
  }
}

async function testCoinGecko(contractAddress) {
  const startTime = Date.now();
  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/simple/price',
      {
        params: {
          ids: 'solana',
          vs_currencies: 'usd',
          include_market_cap: true,
          include_24hr_vol: true
        },
        timeout: 10000
      }
    );

    const time = Date.now() - startTime;
    // CoinGecko doesn't work with contract addresses, returns SOL data as fallback
    if (response.data.solana) {
      return {
        success: true,
        time,
        price: response.data.solana.usd || 0,
        marketCap: response.data.solana.usd_market_cap || 0,
        volume24h: response.data.solana.usd_24h_vol || 0,
        note: 'Returns SOL data, not token-specific'
      };
    }
    return { success: false, time, error: 'No data found' };
  } catch (error) {
    return {
      success: false,
      time: Date.now() - startTime,
      error: error.message
    };
  }
}

async function testSolscan(contractAddress) {
  const startTime = Date.now();
  const apiKey = process.env.SOLSCAN_API_KEY;

  if (!apiKey) {
    return {
      success: false,
      time: 0,
      error: 'API key not set'
    };
  }

  try {
    const response = await axios.get(
      'https://api.solscan.io/token/meta',
      {
        params: {
          token: contractAddress,
          apikey: apiKey
        },
        timeout: 10000
      }
    );

    const time = Date.now() - startTime;
    if (response.data.success && response.data.data) {
      return {
        success: true,
        time,
        name: response.data.data.name,
        symbol: response.data.data.symbol,
        decimals: response.data.data.decimals
      };
    }
    return { success: false, time, error: 'Request failed' };
  } catch (error) {
    return {
      success: false,
      time: Date.now() - startTime,
      error: error.message
    };
  }
}
