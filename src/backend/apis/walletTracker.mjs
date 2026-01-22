/**
 * Wallet Tracker API Module for Project Dexter
 *
 * Provides unified access to Solana wallet transaction and trade data
 * from multiple sources (Public RPC, Helius, DexScreener, etc.)
 *
 * FREE OPTIONS (No API Key):
 * - Solana Public RPC (limited, rate-gated)
 * - DexScreener (token pairs for address)
 *
 * FREE WITH SIGNUP (Recommended):
 * - Helius (100k calls/month) - BEST for wallet/transaction data
 * - Bitquery (GraphQL) - Good for DEX trades
 * - Moralis (free tier) - Alternative
 *
 * Usage:
 * import { getWalletTrades, getWalletTokens } from './walletTracker.mjs';
 */

// ============================================
// CONFIGURATION
// ============================================

const CONFIG = {
    // Primary RPC endpoint (Solana official)
    primaryRPC: 'https://api.mainnet-beta.solana.com',

    // Backup RPC endpoints (rotated for reliability)
    backupRPCs: [
        'https://rpc.ankr.com/solana',
        'https://solana-mainnet.rpc.extrnode.com',
    ],

    // Helius (optional, set HELIUS_API_KEY env var for best results)
    heliusAPIKey: process.env.HELIUS_API_KEY || '',

    // DexScreener (free, no key)
    dexscreenerBase: 'https://api.dexscreener.com/latest',

    // Rate limiting
    rpcRequestDelay: 500, // ms between RPC calls
    maxRetries: 3,
};

// ============================================
// HELPER FUNCTIONS
// ============================================

let rpcIndex = 0;

/**
 * Rate-limited RPC call with rotation
 */
async function callRPC(method, params = []) {
    const endpoints = [CONFIG.primaryRPC, ...CONFIG.backupRPCs];

    for (let attempt = 0; attempt < CONFIG.maxRetries; attempt++) {
        const endpoint = endpoints[rpcIndex % endpoints.length];
        rpcIndex++;

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: Date.now() + Math.random(),
                    method,
                    params
                })
            });

            const data = await response.json();

            if (data.error) {
                throw new Error(`RPC Error: ${data.error.message}`);
            }

            return data.result;
        } catch (error) {
            if (attempt === CONFIG.maxRetries - 1) {
                throw error;
            }
            // Try next endpoint after brief delay
            await new Promise(r => setTimeout(r, 500));
        }
    }
}

/**
 * Parse transaction for token transfers/swaps
 */
function parseTokenTransfers(transaction) {
    if (!transaction || !transaction.meta) {
        return [];
    }

    const transfers = [];
    const meta = transaction.meta;

    // Parse token balance changes
    if (meta.preTokenBalances && meta.postTokenBalances) {
        const accountKeys = transaction.transaction.message.accountKeys;

        meta.postTokenBalances.forEach((post, i) => {
            const pre = meta.preTokenBalances[i];

            if (pre && post && pre.mint === post.mint) {
                const preAmount = parseFloat(pre.uiTokenAmount.uiAmountString || '0');
                const postAmount = parseFloat(post.uiTokenAmount.uiAmountString || '0');
                const change = postAmount - preAmount;

                if (Math.abs(change) > 0.000001) {
                    const accountIndex = post.accountIndex;
                    const address = accountKeys[accountIndex];

                    transfers.push({
                        mint: pre.mint,
                        change: change,
                        preBalance: preAmount,
                        postBalance: postAmount,
                        decimals: pre.uiTokenAmount.decimals,
                        address: address
                    });
                }
            }
        });
    }

    return transfers;
}

/**
 * Detect if transaction is a DEX swap
 */
function detectSwapType(transaction) {
    if (!transaction || !transaction.meta || !transaction.transaction) {
        return null;
    }

    const accountKeys = transaction.transaction.message.accountKeys;

    // Check for known DEX programs
    const dexPrograms = {
        'Raydium': '675kPX9MHTjS2zt1qf1WNiJdUupEMCbqFTLBJJq4VnQU',
        'Orca': '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP',
        'Jupiter': 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
        'Meteora': 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
    };

    for (const [dex, programId] of Object.entries(dexPrograms)) {
        if (accountKeys.includes(programId)) {
            return dex;
        }
    }

    // Check for transfer instructions
    if (transaction.transaction.message.instructions) {
        for (const ix of transaction.transaction.message.instructions) {
            if (ix.programId && ix.programId.includes('Token')) {
                return 'Transfer';
            }
        }
    }

    return null;
}

// ============================================
// PUBLIC API - WALLET TRANSACTIONS
// ============================================

/**
 * Get transaction signatures for a wallet address
 * @param {string} walletAddress - Solana wallet address
 * @param {object} options - { limit: number, before: string }
 * @returns {Array} Transaction signatures
 */
export async function getWalletSignatures(walletAddress, options = {}) {
    const { limit = 10, before = null } = options;

    const params = [
        walletAddress,
        { limit }
    ];

    if (before) {
        params[1].before = before;
    }

    try {
        const result = await callRPC('getSignaturesForAddress', params);
        return result || [];
    } catch (error) {
        console.error(`[WalletTracker] Error getting signatures: ${error.message}`);
        return [];
    }
}

/**
 * Get full transaction details for a signature
 * @param {string} signature - Transaction signature
 * @returns {object|null} Transaction details
 */
export async function getTransactionDetails(signature) {
    try {
        const result = await callRPC('getTransaction', [
            signature,
            { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
        ]);

        if (!result) return null;

        // Parse transfers
        const tokenTransfers = parseTokenTransfers(result);
        const swapType = detectSwapType(result);

        return {
            signature: result.transaction.signatures[0],
            slot: result.slot,
            blockTime: result.blockTime,
            status: result.meta.err ? 'failed' : 'success',
            fee: result.meta.fee / 1e9, // SOL
            tokenTransfers,
            swapType,
            raw: result
        };
    } catch (error) {
        console.error(`[WalletTracker] Error getting transaction: ${error.message}`);
        return null;
    }
}

/**
 * Get wallet's token holdings
 * @param {string} walletAddress - Solana wallet address
 * @returns {Array} Token holdings
 */
export async function getWalletTokens(walletAddress) {
    try {
        const result = await callRPC('getTokenAccountsByOwner', [
            walletAddress,
            { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
            { encoding: 'jsonParsed' }
        ]);

        if (!result || !result.value) return [];

        return result.value.map(tokenAccount => {
            const parsed = tokenAccount.account.data.parsed;
            return {
                mint: parsed.info.mint,
                amount: parseFloat(parsed.info.tokenAmount.uiAmountString || '0'),
                decimals: parsed.info.tokenAmount.decimals,
                address: tokenAccount.pubkey
            };
        }).filter(t => t.amount > 0);
    } catch (error) {
        console.error(`[WalletTracker] Error getting tokens: ${error.message}`);
        return [];
    }
}

/**
 * Get wallet SOL balance
 * @param {string} walletAddress - Solana wallet address
 * @returns {number} SOL balance
 */
export async function getWalletBalance(walletAddress) {
    try {
        const result = await callRPC('getAccountInfo', [
            walletAddress,
            { encoding: 'jsonParsed' }
        ]);

        if (!result || !result.value) return 0;

        return result.value.lamports / 1e9; // Convert to SOL
    } catch (error) {
        console.error(`[WalletTracker] Error getting balance: ${error.message}`);
        return 0;
    }
}

/**
 * Get paginated trade history for a wallet
 * @param {string} walletAddress - Solana wallet address
 * @param {object} options - { limit: number, offset: number }
 * @returns {Array} Trade history with parsed token transfers
 */
export async function getWalletTrades(walletAddress, options = {}) {
    const { limit = 20 } = options;

    try {
        // Get signatures first
        const signatures = await getWalletSignatures(walletAddress, { limit });

        if (!signatures || signatures.length === 0) {
            return [];
        }

        // Get full details for each transaction
        const transactions = await Promise.all(
            signatures.map(sig => getTransactionDetails(sig.signature))
        );

        // Filter and format
        return transactions
            .filter(tx => tx !== null)
            .map(tx => ({
                signature: tx.signature,
                timestamp: tx.blockTime,
                status: tx.status,
                swapType: tx.swapType,
                tokens: tx.tokenTransfers,
                fee: tx.fee
            }));
    } catch (error) {
        console.error(`[WalletTracker] Error getting trades: ${error.message}`);
        return [];
    }
}

// ============================================
// HELIUS API (Optional - Better Data)
// ============================================

/**
 * Get wallet transactions via Helius (if API key available)
 * Helius provides decoded transfers and better performance
 * @param {string} walletAddress - Solana wallet address
 * @param {object} options - { limit: number, before: string }
 * @returns {Array} Enriched transaction data
 */
export async function getWalletTransactionsHelius(walletAddress, options = {}) {
    if (!CONFIG.heliusAPIKey) {
        console.warn('[WalletTracker] Helius API key not set, falling back to RPC');
        return getWalletTrades(walletAddress, options);
    }

    const { limit = 10 } = options;

    try {
        const url = `https://api.helius.xyz/v0/addresses/${walletAddress}/transactions?api-key=${CONFIG.heliusAPIKey}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Helius API error: ${response.status}`);
        }

        const transactions = await response.json();

        return transactions.map(tx => ({
            signature: tx.signature,
            timestamp: tx.timestamp,
            type: tx.type,
            source: tx.source,
            tokenTransfers: (tx.tokenTransfers || []).map(tt => ({
                mint: tt.mint,
                from: tt.fromAddress,
                to: tt.toAddress,
                amount: tt.tokenAmount
            })),
            nativeTransfers: (tx.nativeTransfers || []).map(nt => ({
                from: nt.fromAddress,
                to: nt.toAddress,
                amount: nt.amount
            })),
            fee: tx.fee
        })).slice(0, limit);
    } catch (error) {
        console.error(`[WalletTracker] Helius error: ${error.message}, falling back to RPC`);
        return getWalletTrades(walletAddress, options);
    }
}

// ============================================
// DEXSCREENER API (Token Discovery)
// ============================================

/**
 * Get tokens associated with a wallet via DexScreener
 * @param {string} walletAddress - Solana wallet address
 * @returns {Array} Token pairs the wallet has interacted with
 */
export async function getWalletTokenPairs(walletAddress) {
    try {
        const url = `${CONFIG.dexscreenerBase}/dex/search/?q=${walletAddress}`;

        const response = await fetch(url);
        const data = await response.json();

        if (!data.pairs) return [];

        // Deduplicate by token address
        const seenMints = new Set();
        const uniqueTokens = [];

        for (const pair of data.pairs) {
            if (pair.chainId !== 'solana') continue;

            const baseMint = pair.baseToken.address;
            const quoteMint = pair.quoteToken.address;

            if (!seenMints.has(baseMint)) {
                seenMints.add(baseMint);
                uniqueTokens.push({
                    address: baseMint,
                    symbol: pair.baseToken.symbol,
                    name: pair.baseToken.name,
                    dex: pair.dexId,
                    pairAddress: pair.pairAddress,
                    priceUsd: pair.priceUsd,
                    liquidity: pair.liquidity?.usd || 0
                });
            }

            if (!seenMints.has(quoteMint)) {
                seenMints.add(quoteMint);
                uniqueTokens.push({
                    address: quoteMint,
                    symbol: pair.quoteToken.symbol,
                    name: pair.quoteToken.name,
                    dex: pair.dexId,
                    pairAddress: pair.pairAddress,
                    priceUsd: pair.priceUsd,
                    liquidity: pair.liquidity?.usd || 0
                });
            }
        }

        return uniqueTokens;
    } catch (error) {
        console.error(`[WalletTracker] DexScreener error: ${error.message}`);
        return [];
    }
}

// ============================================
// HIGH-LEVEL CONVENIENCE FUNCTIONS
// ============================================

/**
 * Get comprehensive wallet profile
 * @param {string} walletAddress - Solana wallet address
 * @returns {object} Wallet profile with balance, tokens, and recent trades
 */
export async function getWalletProfile(walletAddress) {
    const [balance, tokens, trades, pairs] = await Promise.all([
        getWalletBalance(walletAddress),
        getWalletTokens(walletAddress),
        getWalletTrades(walletAddress, { limit: 10 }),
        getWalletTokenPairs(walletAddress)
    ]);

    // Analyze trading patterns
    const tradeCount = trades.length;
    const successfulTrades = trades.filter(t => t.status === 'success').length;
    const uniqueTokens = new Set();

    trades.forEach(trade => {
        trade.tokens?.forEach(token => {
            uniqueTokens.add(token.mint);
        });
    });

    return {
        address: walletAddress,
        balance,
        tokenCount: tokens.length,
        tokens: tokens.slice(0, 20), // Top 20
        recentTrades: trades,
        tradeStats: {
            total: tradeCount,
            successful: successfulTrades,
            successRate: tradeCount > 0 ? (successfulTrades / tradeCount * 100).toFixed(1) + '%' : 'N/A',
            uniqueTokensTraded: uniqueTokens.size
        },
        discoveredTokens: pairs.slice(0, 10)
    };
}

/**
 * Check if wallet has recently traded a specific token
 * @param {string} walletAddress - Solana wallet address
 * @param {string} tokenMint - Token mint address
 * @returns {boolean} True if wallet recently traded the token
 */
export async function hasWalletTradedToken(walletAddress, tokenMint) {
    try {
        const trades = await getWalletTrades(walletAddress, { limit: 50 });

        for (const trade of trades) {
            if (!trade.tokens) continue;

            for (const token of trade.tokens) {
                if (token.mint === tokenMint) {
                    return true;
                }
            }
        }

        return false;
    } catch (error) {
        console.error(`[WalletTracker] Error checking token trade: ${error.message}`);
        return false;
    }
}

/**
 * Get wallet's first interaction timestamp with a token
 * @param {string} walletAddress - Solana wallet address
 * @param {string} tokenMint - Token mint address
 * @returns {number|null} Timestamp of first trade or null
 */
export async function getFirstTokenInteraction(walletAddress, tokenMint) {
    try {
        const signatures = await getWalletSignatures(walletAddress, { limit: 100 });

        // Check transactions from oldest to newest
        for (let i = signatures.length - 1; i >= 0; i--) {
            const tx = await getTransactionDetails(signatures[i].signature);

            if (tx && tx.tokenTransfers) {
                for (const transfer of tx.tokenTransfers) {
                    if (transfer.mint === tokenMint) {
                        return tx.blockTime;
                    }
                }
            }
        }

        return null;
    } catch (error) {
        console.error(`[WalletTracker] Error getting first interaction: ${error.message}`);
        return null;
    }
}

// ============================================
// EXPORTS
// ============================================

export default {
    // Core wallet functions
    getWalletSignatures,
    getTransactionDetails,
    getWalletTokens,
    getWalletBalance,
    getWalletTrades,
    getWalletProfile,

    // Helius functions (optional)
    getWalletTransactionsHelius,

    // DexScreener functions
    getWalletTokenPairs,

    // Utility functions
    hasWalletTradedToken,
    getFirstTokenInteraction,

    // Config
    CONFIG
};
