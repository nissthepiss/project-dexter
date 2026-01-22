/**
 * PostgreSQL Database Implementation
 * For web-hosted version (Railway, Render, etc.)
 */

import pg from 'pg';
import logger from '../logger.mjs';

const { Pool } = pg;
let pool;

/**
 * Initialize PostgreSQL connection
 */
export async function initDatabase() {
  try {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL environment variable is required for PostgreSQL mode');
    }

    // Create connection pool
    pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    // Test connection
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();

    logger.database(`PostgreSQL connected: ${result.rows[0].now}`);

    // Create tables
    await createTables();

    return Promise.resolve();
  } catch (err) {
    logger.error('PostgreSQL connection failed', err);
    return Promise.reject(err);
  }
}

/**
 * Migrate existing tables to use BIGINT for timestamps
 */
async function migrateTables() {
  const client = await pool.connect();

  try {
    // Alter tokens table timestamps to BIGINT
    await client.query(`ALTER TABLE tokens ALTER COLUMN spottedAt TYPE BIGINT`);
    await client.query(`ALTER TABLE tokens ALTER COLUMN lastUpdated TYPE BIGINT`);
    await client.query(`ALTER TABLE tokens ALTER COLUMN holderSpottedAt TYPE BIGINT`);

    // Alter priceHistory timestamp to BIGINT
    await client.query(`ALTER TABLE priceHistory ALTER COLUMN timestamp TYPE BIGINT`);

    // Alter alertTiers createdAt to BIGINT
    await client.query(`ALTER TABLE alertTiers ALTER COLUMN createdAt TYPE BIGINT`);

    // Alter alertHistory triggeredAt to BIGINT
    await client.query(`ALTER TABLE alertHistory ALTER COLUMN triggeredAt TYPE BIGINT`);

    // Alter blacklist blacklistedAt to BIGINT
    await client.query(`ALTER TABLE blacklist ALTER COLUMN blacklistedAt TYPE BIGINT`);

    logger.database('PostgreSQL tables migrated to BIGINT timestamps');
  } catch (err) {
    // Tables might not exist yet, which is fine
    logger.database('Migration skipped (tables may not exist yet)');
  } finally {
    client.release();
  }
}

/**
 * Create database tables
 */
async function createTables() {
  const client = await pool.connect();

  try {
    // First, try to migrate existing tables
    await migrateTables();

    // Main tokens table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tokens (
        id TEXT PRIMARY KEY,
        contractAddress TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        chainShort TEXT,
        symbol TEXT,
        spottedAt BIGINT NOT NULL,
        spottedMc REAL NOT NULL,
        currentMc REAL,
        previousMc REAL,
        volume24h REAL,
        previousVolume24h REAL,
        peakMultiplier REAL DEFAULT 1.0,
        lastUpdated BIGINT,
        logoUrl TEXT,
        source TEXT DEFAULT 'degen',
        holderRank INTEGER DEFAULT NULL,
        holderSpottedAt BIGINT DEFAULT NULL,
        holderSpottedMc REAL DEFAULT NULL,
        holderPeakMc REAL DEFAULT NULL,
        holderPeakMultiplier REAL DEFAULT NULL
      )
    `);

    // Price history table
    await client.query(`
      CREATE TABLE IF NOT EXISTS priceHistory (
        id SERIAL PRIMARY KEY,
        tokenId TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        marketCap REAL,
        volume REAL,
        FOREIGN KEY (tokenId) REFERENCES tokens(id) ON DELETE CASCADE
      )
    `);

    // Alert tiers configuration
    await client.query(`
      CREATE TABLE IF NOT EXISTS alertTiers (
        id SERIAL PRIMARY KEY,
        tier1Multiplier REAL DEFAULT 1.1,
        tier2Multiplier REAL DEFAULT 1.3,
        tier3Multiplier REAL DEFAULT 1.4,
        createdAt BIGINT
      )
    `);

    // Alert history
    await client.query(`
      CREATE TABLE IF NOT EXISTS alertHistory (
        id SERIAL PRIMARY KEY,
        tokenId TEXT NOT NULL,
        multiplier REAL,
        tier INTEGER,
        triggeredAt BIGINT,
        FOREIGN KEY (tokenId) REFERENCES tokens(id) ON DELETE CASCADE
      )
    `);

    // Blacklist
    await client.query(`
      CREATE TABLE IF NOT EXISTS blacklist (
        id SERIAL PRIMARY KEY,
        contractAddress TEXT UNIQUE NOT NULL,
        name TEXT,
        blacklistedAt BIGINT NOT NULL
      )
    `);

    // Insert default alert tiers if table is empty
    const tierResult = await client.query('SELECT COUNT(*) as count FROM alertTiers');
    if (parseInt(tierResult.rows[0].count) === 0) {
      await client.query(`
        INSERT INTO alertTiers (tier1Multiplier, tier2Multiplier, tier3Multiplier, createdAt)
        VALUES ($1, $2, $3, $4)
      `, [1.1, 1.25, 1.4, Date.now()]);
      logger.database('Inserted default alert tiers');
    }

    logger.database('PostgreSQL tables created/verified');
  } finally {
    client.release();
  }
}

/**
 * Insert or update a token
 */
export function insertOrUpdateToken(token) {
  return pool.query(`
    INSERT INTO tokens
    (id, contractAddress, name, chainShort, symbol, spottedAt, spottedMc, currentMc, previousMc, volume24h, previousVolume24h, peakMultiplier, lastUpdated, logoUrl, source, holderRank, holderSpottedAt, holderSpottedMc, holderPeakMc, holderPeakMultiplier)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    ON CONFLICT (contractAddress) DO UPDATE SET
      name = EXCLUDED.name,
      chainShort = EXCLUDED.chainShort,
      symbol = EXCLUDED.symbol,
      currentMc = EXCLUDED.currentMc,
      previousMc = EXCLUDED.previousMc,
      volume24h = EXCLUDED.volume24h,
      previousVolume24h = EXCLUDED.previousVolume24h,
      peakMultiplier = EXCLUDED.peakMultiplier,
      lastUpdated = EXCLUDED.lastUpdated,
      logoUrl = EXCLUDED.logoUrl,
      source = EXCLUDED.source,
      holderRank = EXCLUDED.holderRank,
      holderSpottedAt = EXCLUDED.holderSpottedAt,
      holderSpottedMc = EXCLUDED.holderSpottedMc,
      holderPeakMc = EXCLUDED.holderPeakMc,
      holderPeakMultiplier = EXCLUDED.holderPeakMultiplier
  `, [
    token.id ?? null,
    token.contractAddress ?? null,
    token.name ?? 'Unknown',
    token.chainShort ?? null,
    token.symbol ?? null,
    token.spottedAt ?? Date.now(),
    token.spottedMc ?? 0,
    token.currentMc ?? null,
    token.previousMc ?? null,
    token.volume24h ?? null,
    token.previousVolume24h ?? null,
    token.peakMultiplier ?? 1.0,
    Date.now(),
    token.logoUrl ?? null,
    token.source ?? 'degen',
    token.holderRank ?? null,
    token.holderSpottedAt ?? null,
    token.holderSpottedMc ?? null,
    token.holderPeakMc ?? null,
    token.holderPeakMultiplier ?? null
  ])
  .then(() => ({ id: token.id, changes: 1 }))
  .catch(err => {
    logger.error(`Failed to insert/update token: ${err.message}`);
    throw err;
  });
}

/**
 * Get top tokens by peak multiplier
 */
export function getTopTokens(limit = 10) {
  return pool.query(`
    SELECT * FROM tokens
    ORDER BY peakMultiplier DESC
    LIMIT $1
  `, [limit])
  .then(result => result.rows)
  .catch(err => {
    logger.error('Failed to get top tokens', err);
    throw err;
  });
}

/**
 * Get token by ID
 */
export function getTokenById(id) {
  return pool.query('SELECT * FROM tokens WHERE id = $1', [id])
  .then(result => result.rows[0] || null)
  .catch(err => {
    logger.error('Failed to get token by ID', err);
    throw err;
  });
}

/**
 * Get tokens by age (hours)
 */
export function getTokensByAge(hours = 3) {
  const thresholdMs = hours * 60 * 60 * 1000;
  const cutoffTime = Date.now() - thresholdMs;

  return pool.query(`
    SELECT * FROM tokens WHERE spottedAt > $1 ORDER BY peakMultiplier DESC
  `, [cutoffTime])
  .then(result => result.rows)
  .catch(err => {
    logger.error('Failed to get tokens by age', err);
    throw err;
  });
}

/**
 * Add price history entry
 */
export function addPriceHistory(tokenId, marketCap, volume) {
  return pool.query(`
    INSERT INTO priceHistory (tokenId, timestamp, marketCap, volume)
    VALUES ($1, $2, $3, $4)
  `, [tokenId ?? null, Date.now(), marketCap ?? null, volume ?? null])
  .then(() => true)
  .catch(err => {
    logger.error('Failed to add price history', err);
    throw err;
  });
}

/**
 * Get price history for token
 */
export function getPriceHistoryForToken(tokenId, minutes = 1) {
  const cutoffTime = Date.now() - (minutes * 60 * 1000);

  return pool.query(`
    SELECT * FROM priceHistory
    WHERE tokenId = $1 AND timestamp > $2
    ORDER BY timestamp DESC
  `, [tokenId ?? null, cutoffTime])
  .then(result => result.rows)
  .catch(err => {
    logger.error('Failed to get price history', err);
    throw err;
  });
}

/**
 * Get alert tiers configuration
 */
export function getAlertTiers() {
  return pool.query('SELECT * FROM alertTiers ORDER BY createdAt DESC LIMIT 1')
  .then(result => {
    if (result.rows.length > 0) {
      return result.rows[0];
    }
    return { tier1Multiplier: 1.1, tier2Multiplier: 1.25, tier3Multiplier: 1.4 };
  })
  .catch(err => {
    logger.error('Failed to get alert tiers', err);
    throw err;
  });
}

/**
 * Update alert tiers
 */
export function updateAlertTiers(tier1, tier2, tier3) {
  return pool.query(`
    INSERT INTO alertTiers (tier1Multiplier, tier2Multiplier, tier3Multiplier, createdAt)
    VALUES ($1, $2, $3, $4)
  `, [tier1 ?? 2.0, tier2 ?? 5.0, tier3 ?? 10.0, Date.now()])
  .then(() => true)
  .catch(err => {
    logger.error('Failed to update alert tiers', err);
    throw err;
  });
}

/**
 * Delete all tokens (preserve blacklist)
 */
export async function deleteAllTokens() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Count before deletion
    const tokenResult = await client.query('SELECT COUNT(*) as count FROM tokens');
    const tokensDeleted = parseInt(tokenResult.rows[0].count);

    const priceResult = await client.query('SELECT COUNT(*) as count FROM priceHistory');
    const priceRecordsDeleted = parseInt(priceResult.rows[0].count);

    const alertResult = await client.query('SELECT COUNT(*) as count FROM alertHistory');
    const alertRecordsDeleted = parseInt(alertResult.rows[0].count);

    // Get blacklist count
    const blacklistResult = await client.query('SELECT COUNT(*) as count FROM blacklist');
    const blacklistCount = parseInt(blacklistResult.rows[0].count);

    // Delete tokens (only degen, preserve holder)
    await client.query("DELETE FROM tokens WHERE source = 'degen'");
    await client.query('DELETE FROM priceHistory');
    await client.query('DELETE FROM alertHistory');

    await client.query('COMMIT');

    logger.database(`❌ PURGE COMPLETE: Deleted ${tokensDeleted} tokens, ${priceRecordsDeleted} price records, ${alertRecordsDeleted} alerts`);
    logger.database(`✅ Database reset (blacklist preserved: ${blacklistCount} tokens)`);

    return {
      success: true,
      tokensDeleted,
      priceRecordsDeleted,
      alertRecordsDeleted,
      blacklistPreserved: blacklistCount
    };
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('deleteAllTokens failed', err);
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Add token to blacklist
 */
export function addToBlacklist(contractAddress, name) {
  return pool.query(`
    INSERT INTO blacklist (contractAddress, name, blacklistedAt)
    VALUES ($1, $2, $3)
    ON CONFLICT (contractAddress) DO NOTHING
  `, [contractAddress, name ?? 'Unknown', Date.now()])
  .then(() => pool.query('DELETE FROM tokens WHERE contractAddress = $1', [contractAddress]))
  .then(() => {
    logger.database(`Blacklisted token: ${name} (${contractAddress})`);
    return { success: true };
  })
  .catch(err => {
    logger.error('Failed to blacklist token', err);
    throw err;
  });
}

/**
 * Check if token is blacklisted
 */
export function isBlacklisted(contractAddress) {
  return pool.query('SELECT COUNT(*) as count FROM blacklist WHERE contractAddress = $1', [contractAddress])
  .then(result => parseInt(result.rows[0].count) > 0)
  .catch(err => {
    logger.error('Failed to check blacklist', err);
    return false;
  });
}

/**
 * Get all blacklisted tokens
 */
export function getBlacklist() {
  return pool.query('SELECT * FROM blacklist ORDER BY blacklistedAt DESC')
  .then(result => result.rows)
  .catch(err => {
    logger.error('Failed to get blacklist', err);
    throw err;
  });
}

/**
 * Remove token from blacklist
 */
export function removeFromBlacklist(contractAddress) {
  return pool.query('DELETE FROM blacklist WHERE contractAddress = $1', [contractAddress])
  .then(() => {
    logger.database(`Removed from blacklist: ${contractAddress}`);
    return { success: true };
  })
  .catch(err => {
    logger.error('Failed to remove from blacklist', err);
    throw err;
  });
}

/**
 * Close database connection
 */
export async function closeDatabase() {
  if (pool) {
    await pool.end();
    logger.database('PostgreSQL connection closed');
  }
}
