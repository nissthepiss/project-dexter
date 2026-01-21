import axios from 'axios';

const SOLSCAN_BASE = 'https://api.solscan.io';

// Note: Requires SOLSCAN_API_KEY environment variable
const apiKey = process.env.SOLSCAN_API_KEY || '';

export async function getTokenMetadata(contractAddress) {
  if (!apiKey) {
    console.warn('Solscan API key not set');
    return null;
  }

  try {
    const response = await axios.get(`${SOLSCAN_BASE}/token/meta`, {
      params: {
        token: contractAddress,
        apikey: apiKey
      },
      timeout: 10000
    });

    if (response.data.success) {
      return response.data.data;
    }

    return null;
  } catch (error) {
    console.error(`Solscan metadata error for ${contractAddress}:`, error.message);
    return null;
  }
}

export async function getTokenHolders(contractAddress, limit = 10) {
  if (!apiKey) {
    console.warn('Solscan API key not set');
    return null;
  }

  try {
    const response = await axios.get(`${SOLSCAN_BASE}/token/holder`, {
      params: {
        token: contractAddress,
        limit,
        apikey: apiKey
      },
      timeout: 10000
    });

    if (response.data.success) {
      return response.data.data;
    }

    return null;
  } catch (error) {
    console.error(`Solscan holders error for ${contractAddress}:`, error.message);
    return null;
  }
}
