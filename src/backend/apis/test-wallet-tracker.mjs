/**
 * Test script for walletTracker.mjs module
 * Run with: node src/backend/apis/test-wallet-tracker.mjs
 */

import {
    getWalletSignatures,
    getTransactionDetails,
    getWalletTokens,
    getWalletBalance,
    getWalletTrades,
    getWalletProfile,
    getWalletTokenPairs
} from './walletTracker.mjs';

// Test addresses
const PUMP_FUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const KNOWN_TRADER = 'DCAxDxGcPHtZUEmgjvXmAYBCwyvMvwNhEowqXGSjyFvw';

async function runTests() {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║     WALLET TRACKER MODULE TEST SUITE                          ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');

    const testWallet = PUMP_FUN_PROGRAM;

    // ==========================================
    // TEST 1: Get Wallet Signatures
    // ==========================================
    console.log('\n\n[TEST 1] Getting wallet signatures...');
    const signatures = await getWalletSignatures(testWallet, { limit: 5 });
    console.log(`✅ Found ${signatures.length} signatures`);
    if (signatures.length > 0) {
        console.log(`   Latest: ${signatures[0].signature.slice(0, 20)}...`);
    }

    // ==========================================
    // TEST 2: Get Transaction Details
    // ==========================================
    console.log('\n[TEST 2] Getting transaction details...');
    if (signatures.length > 0) {
        const txDetails = await getTransactionDetails(signatures[0].signature);
        if (txDetails) {
            console.log(`✅ Transaction details retrieved`);
            console.log(`   Status: ${txDetails.status}`);
            console.log(`   Slot: ${txDetails.slot}`);
            console.log(`   Fee: ${txDetails.fee} SOL`);
            console.log(`   Token Transfers: ${txDetails.tokenTransfers.length}`);
            console.log(`   Swap Type: ${txDetails.swapType || 'N/A'}`);
        } else {
            console.log(`⚠️  Could not retrieve transaction details`);
        }
    } else {
        console.log(`⚠️  Skipping - no signatures available`);
    }

    // ==========================================
    // TEST 3: Get Wallet Balance
    // ==========================================
    console.log('\n[TEST 3] Getting wallet balance...');
    const balance = await getWalletBalance(testWallet);
    console.log(`✅ Balance: ${balance} SOL`);

    // ==========================================
    // TEST 4: Get Wallet Tokens
    // ==========================================
    console.log('\n[TEST 4] Getting wallet tokens...');
    const tokens = await getWalletTokens(testWallet);
    console.log(`✅ Found ${tokens.length} tokens`);
    if (tokens.length > 0) {
        tokens.slice(0, 3).forEach((t, i) => {
            console.log(`   ${i + 1}. ${t.mint.slice(0, 8)}... : ${t.amount}`);
        });
    }

    // ==========================================
    // TEST 5: Get Wallet Trades
    // ==========================================
    console.log('\n[TEST 5] Getting wallet trades...');
    const trades = await getWalletTrades(testWallet, { limit: 5 });
    console.log(`✅ Found ${trades.length} trades`);
    if (trades.length > 0) {
        trades.forEach((trade, i) => {
            console.log(`   ${i + 1}. ${trade.signature.slice(0, 16)}... - ${trade.status}`);
            console.log(`      Tokens: ${trade.tokens.length}, Swap: ${trade.swapType || 'N/A'}`);
        });
    }

    // ==========================================
    // TEST 6: Get Wallet Token Pairs (DexScreener)
    // ==========================================
    console.log('\n[TEST 6] Getting wallet token pairs via DexScreener...');
    const pairs = await getWalletTokenPairs(testWallet);
    console.log(`✅ Found ${pairs.length} related tokens`);
    if (pairs.length > 0) {
        pairs.slice(0, 3).forEach((p, i) => {
            console.log(`   ${i + 1}. ${p.symbol} (${p.address.slice(0, 8)}...) - ${p.dex}`);
        });
    }

    // ==========================================
    // TEST 7: Get Full Wallet Profile
    // ==========================================
    console.log('\n[TEST 7] Getting full wallet profile...');
    const profile = await getWalletProfile(testWallet);
    console.log(`✅ Wallet profile retrieved`);
    console.log(`   Address: ${profile.address.slice(0, 8)}...`);
    console.log(`   Balance: ${profile.balance} SOL`);
    console.log(`   Token Count: ${profile.tokenCount}`);
    console.log(`   Trade Stats:`);
    console.log(`      Total: ${profile.tradeStats.total}`);
    console.log(`      Success Rate: ${profile.tradeStats.successRate}`);
    console.log(`      Unique Tokens: ${profile.tradeStats.uniqueTokensTraded}`);

    // ==========================================
    // SUMMARY
    // ==========================================
    console.log('\n\n' + '═'.repeat(64));
    console.log('📊 TEST SUMMARY');
    console.log('═'.repeat(64));
    console.log('\n✅ All tests completed!');
    console.log('\nThe walletTracker module provides:');
    console.log('  • getWalletSignatures() - Get transaction signatures');
    console.log('  • getTransactionDetails() - Full transaction with parsed transfers');
    console.log('  • getWalletTokens() - All token holdings');
    console.log('  • getWalletBalance() - SOL balance');
    console.log('  • getWalletTrades() - Paginated trade history');
    console.log('  • getWalletProfile() - Complete wallet overview');
    console.log('  • getWalletTokenPairs() - Tokens via DexScreener');
    console.log('\n🔧 For better performance, set HELIUS_API_KEY environment variable');
    console.log('   Get free API key at: https://helius.dev\n');
}

runTests().catch(console.error);
