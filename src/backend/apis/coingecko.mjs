import axios from 'axios';
import logger from '../logger.mjs';

const COINGECKO_URL = 'https://api.coingecko.com/api/v3';

export async function getTokenName(contractAddress) {
  try {
    const response = await axios.get(
      `${COINGECKO_URL}/search`,
      {
        params: {
          query: contractAddress,
          order: 'market_cap_desc',
          per_page: 1,
          page: 1
        },
        timeout: 5000
      }
    );

    if (response.data.coins && response.data.coins.length > 0) {
      const coin = response.data.coins[0];
      return coin.name || null;
    }

    return null;
  } catch (error) {
    return null;
  }
}

export async function getTokenNameBatch(contractAddresses) {
  try {
    const response = await axios.get(
      `${COINGECKO_URL}/search`,
      {
        params: {
          query: contractAddresses[0],
          order: 'market_cap_desc',
          per_page: 250,
          page: 1
        },
        timeout: 5000
      }
    );

    if (response.data.coins && response.data.coins.length > 0) {
      const nameMap = {};
      response.data.coins.forEach(coin => {
        nameMap[coin.symbol?.toUpperCase() || ''] = coin.name;
      });
      return nameMap;
    }

    return {};
  } catch (error) {
    return {};
  }
}
