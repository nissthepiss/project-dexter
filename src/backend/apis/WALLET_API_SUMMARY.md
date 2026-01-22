# Solana Wallet & Trade API Summary

## Tested and Confirmed Working APIs

### 1. **Solana Public RPC** (FREE, No API Key)

**Endpoint:** `https://api.mainnet-beta.solana.com`

**Capabilities:**
- ✅ Get transaction signatures for any address (`getSignaturesForAddress`)
- ✅ Get full transaction details (`getTransaction`)
- ✅ Get account balance (`getAccountInfo`)
- ✅ Get token holdings (`getTokenAccountsByOwner`)
- ✅ Parse token transfers from transactions

**Limitations:**
- Rate limited (not for high-frequency requests)
- Requires manual parsing of transaction data
- Some endpoints may return incomplete data

**Best For:**
- Basic wallet exploration
- Transaction history lookup
- Token balance checking

---

### 2. **Helius API** (FREE with Signup - Recommended)

**Website:** https://helius.dev
**Free Tier:** 100,000 API calls/month

**Capabilities:**
- ✅ Decoded wallet transactions (`/v0/addresses/{address}/transactions`)
- ✅ Token balances and transfers (pre-parsed)
- ✅ NFT data
- ✅ Webhook support for real-time updates
- ✅ Enhanced performance over public RPC

**Why Recommended:**
- Provides decoded transaction data (token transfers, swaps)
- Much faster than public RPC
- No manual parsing needed
- Generous free tier

**Get API Key:** https://helius.dev

---

### 3. **DexScreener API** (FREE, No API Key)

**Endpoint:** `https://api.dexscreener.com/latest/dex/search/?q={address}`

**Capabilities:**
- ✅ Find tokens associated with wallet address
- ✅ Get token price and liquidity data
- ✅ Discover trading pairs

**Best For:**
- Token discovery
- Price and liquidity checks

---

### 4. **Bitquery** (FREE Tier Available)

**Website:** https://bitquery.io
**API:** GraphQL-based Solana DEX Trades API

**Capabilities:**
- ✅ DEX trade history
- ✅ Token transfers
- ✅ Complex queries via GraphQL
- ✅ Historical data

**Best For:**
- Analytical queries
- DEX-specific trade data
- Complex filtering

---

### 5. **Birdeye API** (Limited Public, Better with Key)

**Website:** https://birdeye.so
**Free Tier:** Limited public access, more with API key

**Capabilities:**
- ✅ Transaction history with decoded types
- ✅ Token price data
- ✅ Wallet analytics

**Limitations:**
- Public endpoint is rate-limited
- 401 Unauthorized without proper key

---

## APIs NOT Working (No Key)

- **Solscan API:** Returns 403 Forbidden without API key
- **Moralis:** Requires API key
- **QuickNode:** Requires signup

---

## Implementation in Project Dexter

### New Module: `walletTracker.mjs`

A production-ready module with the following exports:

```javascript
import {
    // Core wallet functions
    getWalletSignatures,      // Get transaction signatures
    getTransactionDetails,    // Full transaction with parsed transfers
    getWalletTokens,          // All token holdings
    getWalletBalance,         // SOL balance
    getWalletTrades,          // Paginated trade history
    getWalletProfile,         // Complete wallet overview

    // Optional Helius (requires HELIUS_API_KEY env var)
    getWalletTransactionsHelius,

    // DexScreener
    getWalletTokenPairs,      // Tokens discovered via DexScreener

    // Utilities
    hasWalletTradedToken,     // Check if wallet traded specific token
    getFirstTokenInteraction  // Get first trade timestamp
} from './walletTracker.mjs';
```

### Usage Examples

```javascript
// Get wallet profile
const profile = await getWalletProfile('wallet_address_here');
console.log(profile.balance, profile.tradeStats);

// Check if wallet traded a token
const hasTraded = await hasWalletTradedToken('wallet', 'token_mint');

// Get recent trades
const trades = await getWalletTrades('wallet', { limit: 20 });
```

---

## Recommendations for Project Dexter

### For Wallet Tracking Features:

1. **Primary:** Use **Helius** (free tier) for:
   - Real-time wallet transaction monitoring
   - Decoded token transfers
   - Trade history

2. **Fallback:** Use **Solana Public RPC** for:
   - Basic wallet queries when Helius is unavailable
   - Account info and balances

3. **Token Discovery:** Use **DexScreener** for:
   - Finding tokens a wallet has interacted with
   - Price and liquidity data

### Setup Instructions

1. **Get Helius API Key (Recommended):**
   - Go to https://helius.dev
   - Sign up for free account
   - Get API key from dashboard

2. **Set Environment Variable:**
   ```bash
   # Windows
   set HELIUS_API_KEY=your_key_here

   # Linux/Mac
   export HELIUS_API_KEY=your_key_here
   ```

3. **Import and Use:**
   ```javascript
   import { getWalletProfile } from './src/backend/apis/walletTracker.mjs';
   const profile = await getWalletProfile(walletAddress);
   ```

---

## Test Scripts

Run these scripts to verify APIs are working:

```bash
# Comprehensive API test (all providers)
node src/backend/apis/test-wallet-apis.mjs

# Module-specific test
node src/backend/apis/test-wallet-tracker.mjs
```

---

## Summary Table

| API | Free Tier | No Key | Wallet Tx | Token Trades | Best For |
|-----|-----------|--------|-----------|--------------|----------|
| Solana Public RPC | ✅ | ✅ | ✅ | ✅* | Basic queries |
| Helius | 100k/mo | ❌ | ✅ | ✅ | Production use |
| DexScreener | ✅ | ✅ | ❌ | ✅ | Token discovery |
| Bitquery | Limited | ❌ | ✅ | ✅ | Analytics |
| Birdeye | Limited | ❌ | ✅ | ✅ | Price data |

*Requires manual parsing of transaction data
