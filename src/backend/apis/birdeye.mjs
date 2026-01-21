import axios from 'axios';

const BIRDEYE_BASE = 'https://api.birdeye.so/defi';

// Note: Requires BIRDEYE_API_KEY environment variable
const apiKey = process.env.BIRDEYE_API_KEY || '';

export async function getTokenMetadata(contractAddress) {
  if (!apiKey) {
    console.warn('Birdeye API key not set');
    return null;
  }

  try {
    const response = await axios.get(`${BIRDEYE_BASE}/token_metadata`, {
      params: {
        address: contractAddress
      },
      headers: {
        'X-API-KEY': apiKey,
        'User-Agent': 'Project-Dexter/1.0'
      },
      timeout: 10000
    });

    if (response.data.success && response.data.data) {
      return response.data.data;
    }

    return null;
  } catch (error) {
    console.error(`Birdeye metadata error for ${contractAddress}:`, error.message);
    return null;
  }
}

export async function getTokenPrice(contractAddress) {
  if (!apiKey) {
    console.warn('Birdeye API key not set');
    return null;
  }

  try {
    const response = await axios.get(`${BIRDEYE_BASE}/token_price`, {
      params: {
        address: contractAddress
      },
      headers: {
        'X-API-KEY': apiKey,
        'User-Agent': 'Project-Dexter/1.0'
      },
      timeout: 10000
    });

    if (response.data.success && response.data.data) {
      return {
        price: response.data.data.value || 0,
        updateTime: response.data.data.updateTime
      };
    }

    return null;
  } catch (error) {
    console.error(`Birdeye price error for ${contractAddress}:`, error.message);
    return null;
  }
}

export async function getTokenVolume(contractAddress) {
  if (!apiKey) {
    console.warn('Birdeye API key not set');
    return null;
  }

  try {
    const response = await axios.get(`${BIRDEYE_BASE}/token_summary`, {
      params: {
        address: contractAddress,
        time_from: Math.floor(Date.now() / 1000) - 86400 // Last 24h
      },
      headers: {
        'X-API-KEY': apiKey,
        'User-Agent': 'Project-Dexter/1.0'
      },
      timeout: 10000
    });

    if (response.data.success && response.data.data) {
      return {
        volume24h: response.data.data.volume?.['24h'] || 0,
        marketCap: response.data.data.marketCap || 0,
        holders: response.data.data.holders || 0
      };
    }

    return null;
  } catch (error) {
    console.error(`Birdeye volume error for ${contractAddress}:`, error.message);
    return null;
  }
}
