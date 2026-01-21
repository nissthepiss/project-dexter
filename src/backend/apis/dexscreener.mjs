import axios from 'axios';
import logger from '../logger.mjs';

const DEXSCREENER_URL = 'https://api.dexscreener.com/token-profiles/latest/v1';

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
        timeout: 15000,
        headers: {
          'User-Agent': 'Project-Dexter/1.0'
        }
      }
    );

    if (response.data.pairs && response.data.pairs.length > 0) {
      // CRITICAL FIX: For Solana pump.fun tokens, prefer pumpfun DEX over others
      // Then sort by liquidity, then by volume
      const sortedPairs = response.data.pairs.sort((a, b) => {
        // 1. Prioritize pumpfun DEX (most reliable for pump.fun tokens)
        const aIsPumpfun = a.dexId === 'pumpfun' ? 1 : 0;
        const bIsPumpfun = b.dexId === 'pumpfun' ? 1 : 0;
        if (aIsPumpfun !== bIsPumpfun) return bIsPumpfun - aIsPumpfun;

        // 2. Then sort by volume24h (higher volume = more reliable)
        const volumeA = a.volume?.h24 || 0;
        const volumeB = b.volume?.h24 || 0;
        if (volumeB !== volumeA) return volumeB - volumeA;

        // 3. Then by liquidity
        const liquidityA = a.liquidity?.usd || 0;
        const liquidityB = b.liquidity?.usd || 0;
        return liquidityB - liquidityA;
      });

      const pair = sortedPairs[0];

      return {
        name: pair.baseToken?.name || pair.quoteToken?.name || 'Unknown',
        marketCap: pair.marketCap || pair.fdv || 0,
        volume24h: pair.volume?.h24 || 0,
        priceUsd: parseFloat(pair.priceUsd) || 0,
        liquidity: pair.liquidity?.usd || 0,
        logoUrl: pair.info?.imageUrl || null
      };
    }

    return null;
  } catch (error) {
    logger.error(`DexScreener token data error for ${contractAddress}: ${error.message}`);
    return null;
  }
}

// Get token by address with full pair data (for holder mode)
export async function getTokenByAddress(contractAddress) {
  try {
    const response = await axios.get(
      `https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`,
      {
        timeout: 15000,
        headers: {
          'User-Agent': 'Project-Dexter/1.0'
        }
      }
    );

    if (response.data.pairs && response.data.pairs.length > 0) {
      const firstPair = response.data.pairs[0];
      // Extract logoUrl from pair info - DexScreener stores it in info.imageUrl
      const logoUrl = firstPair.info?.imageUrl || null;

      return {
        pairs: response.data.pairs,
        name: firstPair.baseToken?.name,
        symbol: firstPair.baseToken?.symbol,
        logoUrl: logoUrl
      };
    }

    return null;
  } catch (error) {
    logger.warn(`DexScreener lookup failed for ${contractAddress.slice(0, 8)}...: ${error.message}`);
    return null;
  }
}
