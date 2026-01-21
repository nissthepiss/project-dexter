import axios from 'axios';
import logger from '../logger.mjs';

const DEXSCREENER_URL = 'https://api.dexscreamer.com/token-profiles/latest/v1';

export async function getLatestTokenProfiles() {
  try {
    const response = await axios.get(DEXSCREENER_URL, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Project-Dexter/1.0'
      }
    });

    const allTokens = Array.isArray(response.data) ? response.data : (response.data.tokens || []);

    const solanTokens = allTokens.filter(
      token => token.chainId === 'solana' || token.chain === 'solana'
    );

    return solanTokens.map(token => ({
      id: token.tokenAddress || token.address,
      contractAddress: token.tokenAddress || token.address,
      name: token.name || token.symbol || 'Unknown',
      chainShort: 'Solana',
      symbol: token.symbol || 'UNKNOWN',
      logoUrl: token.imageUrl || token.icon || null,
      paidPromotion: token.paid === true
    })).filter(token => token.contractAddress);
  } catch (error) {
    logger.error('DexScreener API call failed', error);
    return [];
  }
}

export async function getTokenData(contractAddress) {
  try {
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`,
      {
        timeout: 10000,
        headers: {
          'User-Agent': 'Project-Dexter/1.0'
        }
      }
    );

    if (response.data.pairs && response.data.pairs.length > 0) {
      const pair = response.data.pairs[0];
      return {
        marketCap: pair.marketCap || pair.fdv || 0,
        volume24h: pair.volume?.h24 || 0,
        priceUsd: parseFloat(pair.priceUsd) || 0,
        liquidity: pair.liquidity?.usd || 0,
        name: pair.baseToken?.name || null
      };
    }

    return null;
  } catch (error) {
    logger.error(`DexScreener token data error for ${contractAddress}`, error);
    return null;
  }
}
