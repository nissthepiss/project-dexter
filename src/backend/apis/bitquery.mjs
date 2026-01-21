import axios from 'axios';
import logger from '../logger.mjs';

const BITQUERY_URL = 'https://streaming.bitquery.io/graphql';
const API_KEY = 'ory_at_AXoks5d0PI1Ra7Iwvg-2l9Yrp-56cdX2BXogVRZcSfA.E9gdo8FuPVfJ_yqdRq4jf4dZLUONr_lA5cgVYlIHPog';
const MAX_BATCH_SIZE = 50; // Bitquery limit

/**
 * Create GraphQL query for fetching token prices
 * @param {string[]} addresses - Array of Solana token mint addresses (max 50)
 * @returns {string} GraphQL query string
 */
function createPriceQuery(addresses) {
  const tokensString = addresses.map(addr => `"${addr}"`).join(', ');
  
  return `{
  Solana {
    DEXTradeByTokens(
      orderBy: {descending: Block_Time}
      where: {
        Trade: {
          Currency: {MintAddress: {in: [${tokensString}]}}
          Side: {Currency: {MintAddress: {is: "So11111111111111111111111111111111111111112"}}}
        }
      }
      limitBy: {by: Trade_Currency_MintAddress count: 1}
    ) {
      Block {
        Time
      }
      Trade {
        Currency {
          Name
          Symbol
          MintAddress
        }
        PriceInSol: Price
        PriceInUSD
        Side {
          Currency {
            Name
            MintAddress
          }
        }
      }
    }
  }
}`;
}

/**
 * Fetch token prices from Bitquery API
 * @param {string[]} addresses - Array of Solana token mint addresses (max 50)
 * @returns {Promise<Object>} API response data
 */
export async function fetchTokenPrices(addresses) {
  if (addresses.length > MAX_BATCH_SIZE) {
    throw new Error(`Batch size ${addresses.length} exceeds Bitquery limit of ${MAX_BATCH_SIZE}`);
  }

  if (addresses.length === 0) {
    return { data: { Solana: { DEXTradeByTokens: [] } } };
  }

  try {
    const response = await axios.post(
      BITQUERY_URL,
      {
        query: createPriceQuery(addresses)
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        timeout: 15000 // 15 second timeout
      }
    );

    return response.data;
  } catch (error) {
    logger.error(`Bitquery API error: ${error?.response?.data?.errors?.[0]?.message || error?.message || 'unknown'}`, {
      addresses: addresses.length,
      status: error?.response?.status
    });
    throw error;
  }
}

/**
 * Parse Bitquery response and extract token market caps
 * @param {Object} responseData - Bitquery API response
 * @returns {Map<string, Object>} Map of token address -> {priceUSD, marketCap, timestamp}
 */
export function parseTokenPrices(responseData) {
  const results = new Map();

  if (!responseData?.data?.Solana?.DEXTradeByTokens) {
    logger.warn('Invalid Bitquery response structure');
    return results;
  }

  const trades = responseData.data.Solana.DEXTradeByTokens;

  for (const trade of trades) {
    const mintAddress = trade.Trade?.Currency?.MintAddress;
    const priceInUSD = parseFloat(trade.Trade?.PriceInUSD || 0);
    const timestamp = trade.Block?.Time;

    if (!mintAddress || !priceInUSD) continue;

    // Calculate market cap (1 billion supply for pump.fun tokens)
    const marketCap = 1_000_000_000 * priceInUSD;

    results.set(mintAddress, {
      priceUSD: priceInUSD,
      marketCap: marketCap,
      timestamp: timestamp ? new Date(timestamp).getTime() : Date.now(),
      name: trade.Trade?.Currency?.Name || null,
      symbol: trade.Trade?.Currency?.Symbol || null
    });
  }

  return results;
}

/**
 * Fetch and parse token prices in one call
 * @param {string[]} addresses - Array of Solana token mint addresses (max 50)
 * @returns {Promise<Map<string, Object>>} Map of token address -> price data
 */
export async function getTokenMarketCaps(addresses) {
  if (addresses.length > MAX_BATCH_SIZE) {
    throw new Error(`Batch size ${addresses.length} exceeds Bitquery limit of ${MAX_BATCH_SIZE}`);
  }

  const responseData = await fetchTokenPrices(addresses);
  return parseTokenPrices(responseData);
}

export { MAX_BATCH_SIZE };
