import axios from 'axios';
import https from 'https';
import logger from '../logger.mjs';

const REST_BASE_URL = 'https://api.dexpaprika.com';
const SSE_BASE_URL = 'https://streaming.dexpaprika.com';

// ============ SSE CONNECTION MANAGER ============
// Manages up to 10 real-time SSE connections for top tokens

class SSEManager {
    constructor(maxConnections = 10) {
        this.maxConnections = maxConnections;
        this.connections = new Map(); // address -> { request, lastPrice, lastUpdate, priceTimestamp }
        this.priceCallbacks = new Map(); // address -> Set of callbacks
        this.globalCallback = null; // Called on any price update
        this.connectionQueue = []; // Queue for staggered connections
        this.isProcessingQueue = false;
        this.failedConnections = new Map(); // address -> { failures, lastAttempt, backoffUntil }
        this.connectionDelay = 500; // Delay between connections in ms
    }

    // Check if address is in backoff period (rate limited)
    _isInBackoff(address) {
        const failed = this.failedConnections.get(address);
        if (!failed) return false;
        return Date.now() < failed.backoffUntil;
    }

    // Handle connection failure with exponential backoff
    _handleConnectionFailure(address, statusCode) {
        const failed = this.failedConnections.get(address) || { failures: 0 };
        failed.failures = failed.failures + 1;
        failed.lastAttempt = Date.now();

        // Exponential backoff: 2^failures * 1000ms, max 60 seconds
        const backoffMs = Math.min(Math.pow(2, failed.failures) * 1000, 60000);
        failed.backoffUntil = Date.now() + backoffMs;

        this.failedConnections.set(address, failed);

        if (statusCode === 429) {
            logger.warn(`SSE: Rate limited for ${address.slice(0, 8)}... - backing off ${Math.round(backoffMs/1000)}s`);
        }
    }

    // Reset failure state on successful connection
    _handleConnectionSuccess(address) {
        this.failedConnections.delete(address);
    }

    // Subscribe to real-time price updates for a token
    connect(address) {
        if (this.connections.has(address)) {
            return true; // Already connected
        }

        // Check if in backoff period
        if (this._isInBackoff(address)) {
            const failed = this.failedConnections.get(address);
            const waitTime = Math.round((failed.backoffUntil - Date.now()) / 1000);
            logger.debug(`SSE: Skipping ${address.slice(0, 8)}... (in backoff, ${waitTime}s remaining)`);
            return false;
        }

        if (this.connections.size >= this.maxConnections) {
            logger.warn(`SSE: Max connections (${this.maxConnections}) reached, cannot connect ${address.slice(0, 8)}...`);
            return false;
        }

        const url = `${SSE_BASE_URL}/stream?method=t_p&chain=solana&address=${address}`;
        let buffer = '';

        const request = https.get(url, (res) => {
            if (res.statusCode !== 200) {
                this._handleConnectionFailure(address, res.statusCode);
                logger.error(`SSE: Failed to connect to ${address.slice(0, 8)}... (status ${res.statusCode})`);
                this.connections.delete(address);
                return;
            }

            this._handleConnectionSuccess(address);
            logger.debug(`SSE: Connected to ${address.slice(0, 8)}...`);

            res.on('data', (chunk) => {
                buffer += chunk.toString();
                const lines = buffer.split('\n');
                buffer = lines.pop();

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const jsonStr = line.slice(5).trim();
                        if (jsonStr) {
                            try {
                                const data = JSON.parse(jsonStr);
                                // SSE format: a=address, c=chain, p=price, t=timestamp, t_p=price_timestamp
                                const price = parseFloat(data.p);
                                const priceTimestamp = data.t_p;

                                const conn = this.connections.get(address);
                                if (conn) {
                                    const oldPrice = conn.lastPrice;
                                    conn.lastPrice = price;
                                    conn.lastUpdate = Date.now();
                                    conn.priceTimestamp = priceTimestamp;

                                    // Notify callbacks if price changed
                                    if (oldPrice !== price) {
                                        this._notifyCallbacks(address, price, priceTimestamp);
                                    }
                                }
                            } catch (e) {
                                // Skip non-JSON lines
                            }
                        }
                    }
                }
            });

            res.on('error', (err) => {
                logger.debug(`SSE: Stream error for ${address.slice(0, 8)}...: ${err.message}`);
            });
        });

        request.on('error', (err) => {
            this._handleConnectionFailure(address, 0);
            logger.debug(`SSE: Connection error for ${address.slice(0, 8)}...: ${err.message}`);
            this.connections.delete(address);
        });

        this.connections.set(address, {
            request,
            lastPrice: null,
            lastUpdate: null,
            priceTimestamp: null
        });

        return true;
    }

    // Disconnect from a token's SSE stream
    disconnect(address) {
        const conn = this.connections.get(address);
        if (conn) {
            conn.request.destroy();
            this.connections.delete(address);
            this.priceCallbacks.delete(address);
            logger.info(`SSE: Disconnected from ${address.slice(0, 8)}...`);
            return true;
        }
        return false;
    }

    // Process connection queue with staggered delay
    async _processConnectionQueue() {
        if (this.isProcessingQueue) return;
        this.isProcessingQueue = true;

        while (this.connectionQueue.length > 0) {
            const address = this.connectionQueue.shift();

            // Skip if already connected or in backoff
            if (this.connections.has(address) || this._isInBackoff(address)) {
                continue;
            }

            this.connect(address);

            // Wait before connecting next token (stagger connections)
            if (this.connectionQueue.length > 0) {
                await new Promise(resolve => setTimeout(resolve, this.connectionDelay));
            }
        }

        this.isProcessingQueue = false;
    }

    // Update which tokens are in the top 10 - connects new ones, disconnects old ones
    updateTop10(addresses) {
        const newSet = new Set(addresses.slice(0, this.maxConnections));
        const currentSet = new Set(this.connections.keys());

        // Disconnect tokens no longer in top 10
        for (const addr of currentSet) {
            if (!newSet.has(addr)) {
                this.disconnect(addr);
            }
        }

        // Queue new top 10 tokens for staggered connection
        let newlyQueued = 0;
        for (const addr of newSet) {
            if (!currentSet.has(addr) && !this.connectionQueue.includes(addr)) {
                this.connectionQueue.push(addr);
                newlyQueued++;
            }
        }

        // Start processing queue if there are new tokens
        if (newlyQueued > 0) {
            this._processConnectionQueue().catch(err => {
                logger.error(`SSE queue processing error: ${err.message}`);
            });
        }

        return {
            connected: this.connections.size,
            queued: this.connectionQueue.length,
            addresses: Array.from(this.connections.keys())
        };
    }

    // Get current price for a connected token
    getPrice(address) {
        const conn = this.connections.get(address);
        if (conn && conn.lastPrice !== null) {
            return {
                price: conn.lastPrice,
                timestamp: conn.priceTimestamp,
                age: Date.now() - conn.lastUpdate
            };
        }
        return null;
    }

    // Get all current prices
    getAllPrices() {
        const prices = {};
        for (const [addr, conn] of this.connections) {
            if (conn.lastPrice !== null) {
                prices[addr] = {
                    price: conn.lastPrice,
                    timestamp: conn.priceTimestamp,
                    age: Date.now() - conn.lastUpdate
                };
            }
        }
        return prices;
    }

    // Register callback for price updates
    onPriceUpdate(callback) {
        this.globalCallback = callback;
    }

    // Register callback for specific token
    onTokenPriceUpdate(address, callback) {
        if (!this.priceCallbacks.has(address)) {
            this.priceCallbacks.set(address, new Set());
        }
        this.priceCallbacks.get(address).add(callback);
    }

    _notifyCallbacks(address, price, timestamp) {
        // Global callback
        if (this.globalCallback) {
            this.globalCallback(address, price, timestamp);
        }

        // Token-specific callbacks
        const callbacks = this.priceCallbacks.get(address);
        if (callbacks) {
            for (const cb of callbacks) {
                cb(price, timestamp);
            }
        }
    }

    // Get connection stats
    getStats() {
        return {
            activeConnections: this.connections.size,
            maxConnections: this.maxConnections,
            tokens: Array.from(this.connections.keys()).map(addr => ({
                address: addr,
                hasPrice: this.connections.get(addr).lastPrice !== null,
                age: this.connections.get(addr).lastUpdate
                    ? Date.now() - this.connections.get(addr).lastUpdate
                    : null
            }))
        };
    }

    // Disconnect all
    disconnectAll() {
        for (const addr of this.connections.keys()) {
            this.disconnect(addr);
        }
    }
}

// Singleton SSE manager instance
export const sseManager = new SSEManager(10);

// ============ REST API FUNCTIONS ============

// Helper: Extract transaction metrics from all timeframes
export function extractTransactionMetrics(summary) {
    const timeframes = ['5m', '15m', '30m', '1h', '6h', '24h'];
    const metrics = {};

    for (const tf of timeframes) {
        const tfData = summary[tf] || {};
        metrics[tf] = {
            buys: tfData.buys || 0,
            sells: tfData.sells || 0,
            txns: tfData.txns || 0,
            buy_usd: tfData.buy_usd || 0,
            sell_usd: tfData.sell_usd || 0,
            price_change: tfData.last_price_usd_change || 0
        };
    }

    return metrics;
}

// Get full token data (mcap, volume, liquidity, price, transaction metrics)
export async function getTokenData(contractAddress) {
    try {
        const response = await axios.get(
            `${REST_BASE_URL}/networks/solana/tokens/${contractAddress}`,
            {
                timeout: 10000,
                headers: { 'User-Agent': 'Project-Dexter/1.0' }
            }
        );

        const data = response.data;
        const summary = data.summary || {};

        return {
            name: data.name || 'Unknown',
            symbol: data.symbol || 'UNKNOWN',
            priceUsd: summary.price_usd || 0,
            marketCap: summary.fdv || 0, // FDV = price * total supply
            volume24h: summary['24h']?.volume_usd || 0,
            liquidity: summary.liquidity_usd || 0,
            pools: summary.pools || 0,
            totalSupply: data.total_supply || 0,
            lastUpdated: data.last_updated,
            transactionMetrics: extractTransactionMetrics(summary)
        };
    } catch (error) {
        logger.error(`DexPaprika token data error for ${contractAddress}: ${error.message}`);
        return null;
    }
}

// Get prices for multiple tokens (individual requests in parallel)
// DexPaprika doesn't have a working batch endpoint, so we parallelize
export async function getBatchPrices(addresses, concurrency = 10) {
    const results = {};
    const chunks = [];

    // Split into chunks for controlled concurrency
    for (let i = 0; i < addresses.length; i += concurrency) {
        chunks.push(addresses.slice(i, i + concurrency));
    }

    for (const chunk of chunks) {
        const promises = chunk.map(async (addr) => {
            try {
                const response = await axios.get(
                    `${REST_BASE_URL}/networks/solana/tokens/${addr}`,
                    {
                        timeout: 10000,
                        headers: { 'User-Agent': 'Project-Dexter/1.0' }
                    }
                );

                const summary = response.data.summary || {};
                return {
                    address: addr,
                    data: {
                        priceUsd: summary.price_usd || 0,
                        marketCap: summary.fdv || 0,
                        volume24h: summary['24h']?.volume_usd || 0,
                        liquidity: summary.liquidity_usd || 0,
                        totalSupply: response.data.total_supply || 0,
                        transactionMetrics: extractTransactionMetrics(summary)
                    }
                };
            } catch (error) {
                return { address: addr, data: null, error: error.message };
            }
        });

        const chunkResults = await Promise.all(promises);
        for (const result of chunkResults) {
            results[result.address] = result.data;
        }
    }

    return results;
}

// Calculate market cap from SSE price (price * 1B supply for pump.fun tokens)
export function calculateMarketCap(price, totalSupply = 1_000_000_000) {
    return price * totalSupply;
}

// ============ CONVENIENCE FUNCTIONS ============

// Subscribe top 10 tokens to SSE and return current prices
export function subscribeTop10(addresses) {
    return sseManager.updateTop10(addresses);
}

// Get real-time price from SSE (falls back to null if not connected)
export function getRealtimePrice(address) {
    return sseManager.getPrice(address);
}

// Register callback for real-time price updates
export function onPriceUpdate(callback) {
    sseManager.onPriceUpdate(callback);
}

// Get SSE connection stats
export function getSSEStats() {
    return sseManager.getStats();
}

// Cleanup on shutdown
export function shutdown() {
    sseManager.disconnectAll();
}

export default {
    sseManager,
    getTokenData,
    getBatchPrices,
    calculateMarketCap,
    subscribeTop10,
    getRealtimePrice,
    onPriceUpdate,
    getSSEStats,
    shutdown
};
