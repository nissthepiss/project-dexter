/**
 * Rate limiter to prevent API overload
 * DexScreener: 60 requests/minute
 * Birdeye: ~100 requests/minute
 * CoinGecko: 10-50 requests/minute (free)
 * Jupiter: Unlimited but use sparingly
 */

class RateLimiter {
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }

  async acquire() {
    const now = Date.now();
    
    // Remove old requests outside the window
    this.requests = this.requests.filter(time => now - time < this.windowMs);

    if (this.requests.length >= this.maxRequests) {
      // Wait until oldest request is outside window
      const oldestRequest = this.requests[0];
      const waitTime = this.windowMs - (now - oldestRequest) + 10;
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.acquire(); // Retry
    }

    this.requests.push(now);
  }
}

// Create limiters for each API
export const dexscreenerLimiter = new RateLimiter(60, 60000); // 60 req/min
export const birdeyeLimiter = new RateLimiter(90, 60000); // 90 req/min (safe margin)
export const coingeckoLimiter = new RateLimiter(40, 60000); // 40 req/min (safe margin)
export const jupiterLimiter = new RateLimiter(100, 60000); // 100 req/min (safe limit)
export const solscanLimiter = new RateLimiter(10, 60000); // 10 req/min (conservative)

export function getRateLimiter(apiName) {
  const limiters = {
    dexscreener: dexscreenerLimiter,
    birdeye: birdeyeLimiter,
    coingecko: coingeckoLimiter,
    jupiter: jupiterLimiter,
    solscan: solscanLimiter
  };

  return limiters[apiName.toLowerCase()] || dexscreenerLimiter;
}
