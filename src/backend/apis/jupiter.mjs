import axios from 'axios';

const JUPITER_BASE = 'https://price.jup.ag';

export async function getTokenPrice(contractAddress) {
  try {
    const response = await axios.get(`${JUPITER_BASE}/price`, {
      params: {
        ids: contractAddress
      },
      timeout: 10000
    });

    if (response.data.data && response.data.data[contractAddress]) {
      return {
        price: parseFloat(response.data.data[contractAddress].price) || 0,
        lastUpdated: response.data.data[contractAddress].lastUpdated
      };
    }

    return null;
  } catch (error) {
    console.error(`Jupiter price error for ${contractAddress}:`, error.message);
    return null;
  }
}

export async function getPrices(contractAddresses) {
  try {
    const response = await axios.get(`${JUPITER_BASE}/price`, {
      params: {
        ids: contractAddresses.join(',')
      },
      timeout: 10000
    });

    return response.data.data || {};
  } catch (error) {
    console.error('Jupiter batch price error:', error.message);
    return {};
  }
}
