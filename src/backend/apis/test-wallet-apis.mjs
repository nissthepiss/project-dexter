/**
 * Test Script for Free Solana Wallet/Trade APIs
 *
 * This script tests various free APIs for fetching Solana wallet data and token trades.
 * Run with: node src/backend/apis/test-wallet-apis.mjs
 *
 * Requirements: Node.js 18+ (native fetch)
 */

// Native fetch is available in Node.js 18+

// Test wallet addresses (known active Solana wallets and contracts)
const TEST_WALLETS = [
    '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', // Pump.fun program (very active)
    '7zKfLeCaqwLYeEWpGcYLtd5sVD1xWkpJkDbQsM4agWGC', // Known active wallet
    '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM', // Popular wallet
];

const PUBLIC_RPC_ENDPOINTS = [
    'https://api.mainnet-beta.solana.com',
    'https://solana-api.projectserum.com',
    'https://rpc.ankr.com/solana',
    'https://solana-mainnet.rpc.extrnode.com',
    'https://solana.public-rpc.com', // Triton one
    'https://rpc.symmetric.network', // Symmetric
];

// ============================================
// API TEST FUNCTIONS
// ============================================

/**
 * Test 1: Solana Public RPC - Get Signatures for Address
 * Returns transaction signatures for a wallet (basic transaction history)
 */
async function testPublicRPC_GetSignatures(rpcUrl, walletAddress) {
    console.log(`\n📡 Testing Public RPC: ${rpcUrl.split('/')[2]}`);
    console.log(`   Wallet: ${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}`);

    try {
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getSignaturesForAddress',
                params: [
                    walletAddress,
                    { limit: 5 }
                ]
            })
        });

        const data = await response.json();

        if (data.result && data.result.length > 0) {
            console.log(`   ✅ SUCCESS: Found ${data.result.length} transactions`);
            console.log(`   Latest: ${data.result[0].signature.slice(0, 16)}... (block: ${data.result[0].slot})`);

            return {
                success: true,
                transactions: data.result,
                rpcUrl
            };
        } else {
            console.log(`   ⚠️  No transactions found (or new wallet)`);
            return { success: true, transactions: [], rpcUrl };
        }
    } catch (error) {
        console.log(`   ❌ ERROR: ${error.message}`);
        return { success: false, error: error.message, rpcUrl };
    }
}

/**
 * Test 2: Solana Public RPC - Get Account Info
 * Returns basic account information (balance, owner, executable status)
 */
async function testPublicRPC_GetAccountInfo(rpcUrl, walletAddress) {
    console.log(`\n💰 Testing Account Info on ${rpcUrl.split('/')[2]}`);

    try {
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getAccountInfo',
                params: [
                    walletAddress,
                    { encoding: 'jsonParsed' }
                ]
            })
        });

        const data = await response.json();

        if (data.result && data.result.value) {
            const balance = data.result.value.lamports / 1e9; // Convert to SOL
            console.log(`   ✅ SUCCESS: Balance = ${balance.toFixed(6)} SOL`);

            return {
                success: true,
                balance: balance,
                rpcUrl
            };
        } else {
            console.log(`   ⚠️  No account data found`);
            return { success: true, balance: 0, rpcUrl };
        }
    } catch (error) {
        console.log(`   ❌ ERROR: ${error.message}`);
        return { success: false, error: error.message, rpcUrl };
    }
}

/**
 * Test 3: Solana Public RPC - Get Transaction Details
 * Returns full transaction details (can parse for swaps/transfers)
 */
async function testPublicRPC_GetTransaction(rpcUrl, signature) {
    console.log(`\n📄 Testing Transaction Details on ${rpcUrl.split('/')[2]}`);
    console.log(`   Signature: ${signature.slice(0, 16)}...`);

    try {
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getTransaction',
                params: [
                    signature,
                    { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }
                ]
            })
        });

        const data = await response.json();

        if (data.result && data.result.meta) {
            const meta = data.result.meta;

            // Check if it's a token transfer
            const preBalances = meta.preBalances || [];
            const postBalances = meta.postBalances || [];
            const balanceChange = (postBalances[0] - preBalances[0]) / 1e9;

            console.log(`   ✅ SUCCESS: Transaction fetched`);
            console.log(`   Status: ${meta.err ? 'Failed' : 'Success'}`);
            console.log(`   SOL Change: ${balanceChange.toFixed(6)} SOL`);

            // Check for token transfers
            if (meta.preTokenBalances && meta.postTokenBalances) {
                const tokenTransfers = [];
                meta.postTokenBalances.forEach((post, i) => {
                    const pre = meta.preTokenBalances[i];
                    if (pre && post && pre.mint === post.mint) {
                        const preAmount = pre.uiTokenAmount.uiAmount || 0;
                        const postAmount = post.uiTokenAmount.uiAmount || 0;
                        if (preAmount !== postAmount) {
                            tokenTransfers.push({
                                mint: post.mint,
                                change: postAmount - preAmount
                            });
                        }
                    }
                });

                if (tokenTransfers.length > 0) {
                    console.log(`   🪙 Token Transfers: ${tokenTransfers.length}`);
                    tokenTransfers.forEach(t => {
                        console.log(`      ${t.mint.slice(0, 8)}...: ${t.change > 0 ? '+' : ''}${t.change.toFixed(6)}`);
                    });
                }
            }

            return {
                success: true,
                transaction: data.result,
                rpcUrl
            };
        } else {
            console.log(`   ⚠️  Transaction not found`);
            return { success: false, error: 'Not found', rpcUrl };
        }
    } catch (error) {
        console.log(`   ❌ ERROR: ${error.message}`);
        return { success: false, error: error.message, rpcUrl };
    }
}

/**
 * Test 4: Get Token Accounts for Wallet
 * Returns all SPL tokens held by the wallet
 */
async function testPublicRPC_GetTokenAccounts(rpcUrl, walletAddress) {
    console.log(`\n🏦 Testing Token Accounts on ${rpcUrl.split('/')[2]}`);

    try {
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'getTokenAccountsByOwner',
                params: [
                    walletAddress,
                    { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, // SPL Token Program
                    { encoding: 'jsonParsed' }
                ]
            })
        });

        const data = await response.json();

        if (data.result && data.result.value) {
            const tokens = data.result.value;
            console.log(`   ✅ SUCCESS: Found ${tokens.length} token accounts`);

            // Show first 5 tokens
            tokens.slice(0, 5).forEach((token, i) => {
                const account = token.account.data.parsed;
                const mint = account.info.mint;
                const amount = account.info.tokenAmount.uiAmount;
                console.log(`   ${i + 1}. ${mint.slice(0, 8)}...${mint.slice(-6)}: ${amount}`);
            });

            if (tokens.length > 5) {
                console.log(`   ... and ${tokens.length - 5} more`);
            }

            return {
                success: true,
                tokenCount: tokens.length,
                tokens: tokens,
                rpcUrl
            };
        } else {
            console.log(`   ⚠️  No tokens found`);
            return { success: true, tokenCount: 0, tokens: [], rpcUrl };
        }
    } catch (error) {
        console.log(`   ❌ ERROR: ${error.message}`);
        return { success: false, error: error.message, rpcUrl };
    }
}

/**
 * Test 5: Helius API - Webhook/Transaction API
 * Requires free API key (100k calls/month)
 * Helius provides enriched transaction data with decoded transfers
 */
async function testHeliusAPI(apiKey, walletAddress) {
    console.log(`\n🔥 Testing Helius API`);
    console.log(`   Wallet: ${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}`);

    try {
        // Helius getTransactionsForAddress endpoint
        const url = `https://api.helius.xyz/v0/addresses/${walletAddress}/transactions?api-key=${apiKey}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const transactions = await response.json();

        if (transactions && transactions.length > 0) {
            console.log(`   ✅ SUCCESS: Found ${transactions.length} transactions`);

            // Parse transaction types
            const types = {};
            transactions.forEach(tx => {
                const type = tx.type || 'unknown';
                types[type] = (types[type] || 0) + 1;
            });

            console.log(`   Transaction Types: ${JSON.stringify(types)}`);

            // Show first transaction details
            if (transactions[0]) {
                const tx = transactions[0];
                console.log(`   Latest: ${tx.type} - ${tx.signature.slice(0, 16)}...`);

                if (tx.tokenTransfers && tx.tokenTransfers.length > 0) {
                    console.log(`   Token Transfers:`);
                    tx.tokenTransfers.forEach((tt, i) => {
                        console.log(`      ${i + 1}. ${tt.mint.slice(0, 8)}...: ${tt.tokenAmount} (${tt.fromAddress.slice(0, 8)}... → ${tt.toAddress.slice(0, 8)}...)`);
                    });
                }

                if (tx.nativeTransfers && tx.nativeTransfers.length > 0) {
                    console.log(`   SOL Transfers: ${tx.nativeTransfers.length}`);
                }
            }

            return {
                success: true,
                transactions: transactions,
                apiKey: apiKey.substring(0, 10) + '...'
            };
        } else {
            console.log(`   ⚠️  No transactions found`);
            return { success: true, transactions: [], apiKey };
        }
    } catch (error) {
        console.log(`   ❌ ERROR: ${error.message}`);
        if (error.message.includes('401')) {
            console.log(`   💡 Tip: Check your Helius API key at https://helius.dev`);
        }
        return { success: false, error: error.message };
    }
}

/**
 * Test 6: Birdeye API - Wallet Transaction History
 * Birdeye provides decoded transaction data for wallets
 */
async function testBirdeyeAPI(walletAddress) {
    console.log(`\n🦜 Testing Birdeye API`);
    console.log(`   Wallet: ${walletAddress.slice(0, 8)}...${walletAddress.slice(-8)}`);

    try {
        // Birdeye wallet overview endpoint (public, no API key required for basic data)
        const url = `https://public-api.birdeye.so/v1/wallet/tx_list?wallet=${walletAddress}`;

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'X-API-KEY': '' // Can add API key for higher rate limits
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.success && data.data && data.data.total > 0) {
            console.log(`   ✅ SUCCESS: Found ${data.data.total} transactions`);

            const items = data.data.items || [];
            items.slice(0, 3).forEach((tx, i) => {
                const type = tx.type || tx.txType || 'unknown';
                console.log(`   ${i + 1}. ${type}: ${tx.txHash.slice(0, 16)}...`);
            });

            return {
                success: true,
                totalTransactions: data.data.total,
                transactions: items
            };
        } else {
            console.log(`   ⚠️  ${data.message || 'No transactions found'}`);
            return { success: true, totalTransactions: 0, transactions: [] };
        }
    } catch (error) {
        console.log(`   ❌ ERROR: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * Test 7: DexScreener API - Address Profile
 * Shows tokens traded by a wallet address
 */
async function testDexScreenerAPI(walletAddress) {
    console.log(`\n📊 Testing DexScreener Address API`);

    try {
        const url = `https://api.dexscreener.com/latest/dex/search/?q=${walletAddress}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.pairs && data.pairs.length > 0) {
            console.log(`   ✅ SUCCESS: Found ${data.pairs.length} related pairs`);

            // Unique tokens this wallet has interacted with
            const uniqueTokens = new Set();
            data.pairs.forEach(pair => {
                uniqueTokens.add(pair.baseToken.address);
            });

            console.log(`   Unique Tokens: ${uniqueTokens.size}`);

            // Show first 3 pairs
            data.pairs.slice(0, 3).forEach((pair, i) => {
                console.log(`   ${i + 1}. ${pair.baseToken.symbol} - ${pair.dexId}: ${pair.pairAddress.slice(0, 8)}...`);
            });

            return {
                success: true,
                pairs: data.pairs,
                uniqueTokenCount: uniqueTokens.size
            };
        } else {
            console.log(`   ⚠️  No pairs found for this address`);
            return { success: true, pairs: [], uniqueTokenCount: 0 };
        }
    } catch (error) {
        console.log(`   ❌ ERROR: ${error.message}`);
        return { success: false, error: error.message };
    }
}

/**
 * Test 8: Solscan API (limited, no key)
 * Solscan has a public API with basic wallet info
 */
async function testSolscanAPI(walletAddress) {
    console.log(`\n🔍 Testing Solscan Public API`);

    try {
        // Solscan account endpoint (limited public access)
        const url = `https://api.solscan.io/account?address=${walletAddress}`;

        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        if (data && data.address) {
            console.log(`   ✅ SUCCESS: Account data retrieved`);
            console.log(`   Address: ${data.address.slice(0, 8)}...`);
            console.log(`   SOL Balance: ${data.lamports / 1e9} SOL`);
            console.log(`   Tx Count: ${data.txCount || 'N/A'}`);

            return {
                success: true,
                account: data
            };
        } else {
            console.log(`   ⚠️  Limited data (may need API key for full access)`);
            return { success: true, account: null };
        }
    } catch (error) {
        console.log(`   ❌ ERROR: ${error.message}`);
        return { success: false, error: error.message };
    }
}

// ============================================
// MAIN TEST RUNNER
// ============================================

async function runAllTests() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     SOLANA WALLET & TRADE API TEST SUITE                     ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');

    const testWallet = TEST_WALLETS[0]; // Use first wallet (known active)
    let signatureToTest = null;

    // ==========================================
    // SECTION 1: PUBLIC RPC ENDPOINTS
    // ==========================================
    console.log('\n\n' + '═'.repeat(64));
    console.log('📡 SECTION 1: PUBLIC RPC ENDPOINTS (No API Key Required)');
    console.log('═'.repeat(64));

    const workingRPCs = [];

    for (const rpc of PUBLIC_RPC_ENDPOINTS) {
        // Test 1: Get Signatures
        const sigResult = await testPublicRPC_GetSignatures(rpc, testWallet);
        if (sigResult.success && sigResult.transactions.length > 0) {
            workingRPCs.push(rpc);
            if (!signatureToTest) {
                signatureToTest = sigResult.transactions[0].signature;
            }
        }

        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 500));
    }

    console.log(`\n✅ Working RPC Endpoints: ${workingRPCs.length}/${PUBLIC_RPC_ENDPOINTS.length}`);
    workingRPCs.forEach(rpc => console.log(`   - ${rpc}`));

    // ==========================================
    // SECTION 2: DETAILED TRANSACTION DATA
    // ==========================================
    console.log('\n\n' + '═'.repeat(64));
    console.log('📄 SECTION 2: DETAILED TRANSACTION PARSING');
    console.log('═'.repeat(64));

    if (signatureToTest && workingRPCs.length > 0) {
        await testPublicRPC_GetTransaction(workingRPCs[0], signatureToTest);
    } else {
        console.log('⚠️  Skipping - no signature available from previous tests');
    }

    // ==========================================
    // SECTION 3: TOKEN HOLDINGS
    // ==========================================
    console.log('\n\n' + '═'.repeat(64));
    console.log('🏦 SECTION 3: TOKEN ACCOUNTS & HOLDINGS');
    console.log('═'.repeat(64));

    if (workingRPCs.length > 0) {
        await testPublicRPC_GetTokenAccounts(workingRPCs[0], testWallet);
        await testPublicRPC_GetAccountInfo(workingRPCs[0], testWallet);
    }

    // ==========================================
    // SECTION 4: ENRICHED APIs (Require Setup)
    // ==========================================
    console.log('\n\n' + '═'.repeat(64));
    console.log('🔥 SECTION 4: ENRICHED APIs (Better Data, May Require Key)');
    console.log('═'.repeat(64));

    // Helius (skip if no key provided - will show instructions)
    const HELIUS_KEY = process.env.HELIUS_API_KEY || '';
    if (HELIUS_KEY) {
        await testHeliusAPI(HELIUS_KEY, testWallet);
    } else {
        console.log('\n🔥 Helius API - SKIPPED (No API Key)');
        console.log('   Get 100k free calls/month at: https://helius.dev');
        console.log('   Set HELIUS_API_KEY environment variable to test');
    }

    await new Promise(r => setTimeout(r, 1000));

    // Birdeye
    await testBirdeyeAPI(testWallet);
    await new Promise(r => setTimeout(r, 1000));

    // DexScreener
    await testDexScreenerAPI(testWallet);
    await new Promise(r => setTimeout(r, 1000));

    // Solscan
    await testSolscanAPI(testWallet);

    // ==========================================
    // SUMMARY
    // ==========================================
    console.log('\n\n' + '═'.repeat(64));
    console.log('📊 SUMMARY & RECOMMENDATIONS');
    console.log('═'.repeat(64));

    console.log('\n✅ FREE - NO API KEY REQUIRED:');
    console.log('   1. Solana Public RPC (getSignaturesForAddress)');
    console.log('      - Basic transaction signatures');
    console.log('      - Can get full details with getTransaction');
    console.log('      - Rate limited but reliable');
    console.log('   2. DexScreener API');
    console.log('      - Shows tokens associated with wallet');
    console.log('      - Good for discovering token activity');
    console.log('   3. Solscan Public API (limited)');
    console.log('      - Basic account info');
    console.log('      - Upgrade for full access');

    console.log('\n🔥 FREE WITH SIGNUP (Recommended):');
    console.log('   1. Helius (100k calls/month free)');
    console.log('      - BEST: getTransactionsForAddress with decoded transfers');
    console.log('      - Token balances, NFTs, enriched data');
    console.log('      - Sign up: https://helius.dev');
    console.log('   2. Birdeye (limited public, more with key)');
    console.log('      - Transaction history with decoded types');
    console.log('      - Price data, token analytics');
    console.log('   3. Bitquery (free tier available)');
    console.log('      - GraphQL API for complex queries');
    console.log('      - DEX trades, transfers, analytics');

    console.log('\n💡 RECOMMENDED APPROACH:');
    console.log('   1. Use Helius free tier for primary wallet/transaction data');
    console.log('   2. Fall back to public RPC for resilience');
    console.log('   3. Use DexScreener for token discovery');
    console.log('\n');
}

// Run the tests
runAllTests().catch(console.error);
