import initSqlJs from 'sql.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import logger from '../logger.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'tokens.db');

let db;
let SQL;

export async function initDatabase() {
  try {
    // Create data directory if it doesn't exist
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
      logger.database(`Created data directory`);
    }

    // Initialize sql.js
    SQL = await initSqlJs();
    
    // Load existing database or create new one
    if (existsSync(dbPath)) {
      const buffer = readFileSync(dbPath);
      db = new SQL.Database(buffer);
      logger.database(`Database loaded successfully`);
    } else {
      db = new SQL.Database();
      logger.database(`New database created`);
    }
    
    createTables();
    return Promise.resolve();
  } catch (err) {
    logger.error('Database connection failed', err);
    return Promise.reject(err);
  }
}

function saveDatabase() {
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    writeFileSync(dbPath, buffer);
  } catch (err) {
    logger.error('Failed to save database', err);
  }
}

function createTables() {
  // Main tokens table
  db.run(`
    CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY,
      contractAddress TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      chainShort TEXT,
      symbol TEXT,
      spottedAt INTEGER NOT NULL,
      spottedMc REAL NOT NULL,
      currentMc REAL,
      previousMc REAL,
      volume24h REAL,
      previousVolume24h REAL,
      peakMultiplier REAL DEFAULT 1.0,
      lastUpdated INTEGER,
      logoUrl TEXT,
      source TEXT DEFAULT 'degen',
      holderRank INTEGER DEFAULT NULL
    )
  `);

  // Migration: Add columns if missing (for existing databases)
  try {
    const columns = db.exec(`PRAGMA table_info(tokens)`);
    const columnNames = columns[0]?.values.map(row => row[1]) || [];
    if (!columnNames.includes('source')) {
      db.run(`ALTER TABLE tokens ADD COLUMN source TEXT DEFAULT 'degen'`);
      logger.database('Added source column to tokens table');
    }
    if (!columnNames.includes('holderRank')) {
      db.run(`ALTER TABLE tokens ADD COLUMN holderRank INTEGER DEFAULT NULL`);
      logger.database('Added holderRank column to tokens table');
    }
    // Holder-specific stats columns
    if (!columnNames.includes('holderSpottedAt')) {
      db.run(`ALTER TABLE tokens ADD COLUMN holderSpottedAt INTEGER DEFAULT NULL`);
      logger.database('Added holderSpottedAt column to tokens table');
    }
    if (!columnNames.includes('holderSpottedMc')) {
      db.run(`ALTER TABLE tokens ADD COLUMN holderSpottedMc REAL DEFAULT NULL`);
      logger.database('Added holderSpottedMc column to tokens table');
    }
    if (!columnNames.includes('holderPeakMc')) {
      db.run(`ALTER TABLE tokens ADD COLUMN holderPeakMc REAL DEFAULT NULL`);
      logger.database('Added holderPeakMc column to tokens table');
    }
    if (!columnNames.includes('holderPeakMultiplier')) {
      db.run(`ALTER TABLE tokens ADD COLUMN holderPeakMultiplier REAL DEFAULT NULL`);
      logger.database('Added holderPeakMultiplier column to tokens table');
    }
  } catch (e) {
    // Ignore migration errors - columns may already exist
  }

  // Price history for 1-min changes
  db.run(`
    CREATE TABLE IF NOT EXISTS priceHistory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tokenId TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      marketCap REAL,
      volume REAL,
      FOREIGN KEY (tokenId) REFERENCES tokens(id)
    )
  `);

  // Alert tiers configuration
  db.run(`
    CREATE TABLE IF NOT EXISTS alertTiers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tier1Multiplier REAL DEFAULT 1.1,
      tier2Multiplier REAL DEFAULT 1.3,
      tier3Multiplier REAL DEFAULT 1.4,
      createdAt INTEGER
    )
  `);

  // Logged alerts history
  db.run(`
    CREATE TABLE IF NOT EXISTS alertHistory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tokenId TEXT NOT NULL,
      multiplier REAL,
      tier INTEGER,
      triggeredAt INTEGER,
      FOREIGN KEY (tokenId) REFERENCES tokens(id)
    )
  `);

  // Blacklisted tokens - permanent, survives purge
  db.run(`
    CREATE TABLE IF NOT EXISTS blacklist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contractAddress TEXT UNIQUE NOT NULL,
      name TEXT,
      blacklistedAt INTEGER NOT NULL
    )
  `);

  // Insert default alert tiers if table is empty
  const tierCount = db.exec(`SELECT COUNT(*) as count FROM alertTiers`);
  if (tierCount[0] && tierCount[0].values[0][0] === 0) {
    db.run(`
      INSERT INTO alertTiers (tier1Multiplier, tier2Multiplier, tier3Multiplier, createdAt)
      VALUES (?, ?, ?, ?)
    `, [1.1, 1.25, 1.4, Date.now()]);
    saveDatabase();
  }
}

export function insertOrUpdateToken(token) {
  try {
    const {
      id,
      contractAddress,
      name,
      chainShort,
      symbol,
      spottedAt,
      spottedMc,
      currentMc,
      previousMc,
      volume24h,
      previousVolume24h,
      peakMultiplier,
      logoUrl,
      source,
      holderRank,
      holderSpottedAt,
      holderSpottedMc,
      holderPeakMc,
      holderPeakMultiplier
    } = token;

    // CRITICAL FIX: Convert undefined values to null for SQL.js
    // sql.js cannot bind undefined values; it must be null or a valid type
    db.run(`
      INSERT OR REPLACE INTO tokens
      (id, contractAddress, name, chainShort, symbol, spottedAt, spottedMc, currentMc, previousMc, volume24h, previousVolume24h, peakMultiplier, lastUpdated, logoUrl, source, holderRank, holderSpottedAt, holderSpottedMc, holderPeakMc, holderPeakMultiplier)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id ?? null,
      contractAddress ?? null,
      name ?? 'Unknown',
      chainShort ?? null,
      symbol ?? null,
      spottedAt ?? Date.now(),
      spottedMc ?? 0,
      currentMc ?? null,
      previousMc ?? null,
      volume24h ?? null,
      previousVolume24h ?? null,
      peakMultiplier ?? 1.0,
      Date.now(),
      logoUrl ?? null,
      source ?? 'degen',
      holderRank ?? null,
      holderSpottedAt ?? null,
      holderSpottedMc ?? null,
      holderPeakMc ?? null,
      holderPeakMultiplier ?? null
    ]);

    saveDatabase();
    return Promise.resolve({ id, changes: 1 });
  } catch (err) {
    logger.error(`Failed to insert/update token: ${err.message}`);
    return Promise.reject(err);
  }
}

export function getTopTokens(limit = 10) {
  try {
    const result = db.exec(`
      SELECT * FROM tokens 
      ORDER BY peakMultiplier DESC 
      LIMIT ?
    `, [limit]);

    if (result[0]) {
      const columns = result[0].columns;
      const rows = result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, index) => {
          obj[col] = row[index];
        });
        return obj;
      });
      return Promise.resolve(rows);
    }

    return Promise.resolve([]);
  } catch (err) {
    return Promise.reject(err);
  }
}

export function getTokenById(id) {
  try {
    const result = db.exec(`SELECT * FROM tokens WHERE id = ?`, [id]);
    
    if (result[0] && result[0].values.length > 0) {
      const columns = result[0].columns;
      const row = result[0].values[0];
      const obj = {};
      columns.forEach((col, index) => {
        obj[col] = row[index];
      });
      return Promise.resolve(obj);
    }

    return Promise.resolve(null);
  } catch (err) {
    return Promise.reject(err);
  }
}

export function getTokensByAge(hours = 3) {
  try {
    const thresholdMs = hours * 60 * 60 * 1000;
    const cutoffTime = Date.now() - thresholdMs;

    const result = db.exec(`
      SELECT * FROM tokens WHERE spottedAt > ? ORDER BY peakMultiplier DESC
    `, [cutoffTime]);

    if (result[0]) {
      const columns = result[0].columns;
      const rows = result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, index) => {
          obj[col] = row[index];
        });
        return obj;
      });
      return Promise.resolve(rows);
    }

    return Promise.resolve([]);
  } catch (err) {
    return Promise.reject(err);
  }
}

export function addPriceHistory(tokenId, marketCap, volume) {
  try {
    db.run(`
      INSERT INTO priceHistory (tokenId, timestamp, marketCap, volume)
      VALUES (?, ?, ?, ?)
    `, [tokenId ?? null, Date.now(), marketCap ?? null, volume ?? null]);

    saveDatabase();
    return Promise.resolve(true);
  } catch (err) {
    return Promise.reject(err);
  }
}

export function getPriceHistoryForToken(tokenId, minutes = 1) {
  try {
    const cutoffTime = Date.now() - (minutes * 60 * 1000);

    const result = db.exec(`
      SELECT * FROM priceHistory 
      WHERE tokenId = ? AND timestamp > ? 
      ORDER BY timestamp DESC
    `, [tokenId ?? null, cutoffTime]);

    if (result[0]) {
      const columns = result[0].columns;
      const rows = result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, index) => {
          obj[col] = row[index];
        });
        return obj;
      });
      return Promise.resolve(rows);
    }

    return Promise.resolve([]);
  } catch (err) {
    return Promise.reject(err);
  }
}

export function getAlertTiers() {
  try {
    const result = db.exec(`SELECT * FROM alertTiers ORDER BY createdAt DESC LIMIT 1`);
    
    if (result[0] && result[0].values.length > 0) {
      const columns = result[0].columns;
      const row = result[0].values[0];
      const obj = {};
      columns.forEach((col, index) => {
        obj[col] = row[index];
      });
      return Promise.resolve(obj);
    }

    return Promise.resolve({ tier1Multiplier: 1.1, tier2Multiplier: 1.25, tier3Multiplier: 1.4 });
  } catch (err) {
    return Promise.reject(err);
  }
}

export function updateAlertTiers(tier1, tier2, tier3) {
  try {
    db.run(`
      INSERT INTO alertTiers (tier1Multiplier, tier2Multiplier, tier3Multiplier, createdAt)
      VALUES (?, ?, ?, ?)
    `, [tier1 ?? 2.0, tier2 ?? 5.0, tier3 ?? 10.0, Date.now()]);

    saveDatabase();
    return Promise.resolve(true);
  } catch (err) {
    return Promise.reject(err);
  }
}

export function deleteAllTokens() {
  try {
    // Count before deletion
    const tokenResult = db.exec(`SELECT COUNT(*) as count FROM tokens`);
    const tokensDeleted = tokenResult[0]?.values[0]?.[0] || 0;

    const priceResult = db.exec(`SELECT COUNT(*) as count FROM priceHistory`);
    const priceRecordsDeleted = priceResult[0]?.values[0]?.[0] || 0;

    const alertResult = db.exec(`SELECT COUNT(*) as count FROM alertHistory`);
    const alertRecordsDeleted = alertResult[0]?.values[0]?.[0] || 0;

    // Preserve blacklist before purge
    const blacklistData = [];
    try {
      const blacklistResult = db.exec(`SELECT contractAddress, name, blacklistedAt FROM blacklist`);
      if (blacklistResult[0]?.values) {
        for (const row of blacklistResult[0].values) {
          blacklistData.push({ contractAddress: row[0], name: row[1], blacklistedAt: row[2] });
        }
      }
    } catch (e) {
      logger.warn('Could not backup blacklist:', e.message);
    }

    // Only delete degen tokens, preserve holder tokens
    db.run(`DELETE FROM tokens WHERE source = 'degen'`);
    db.run(`DELETE FROM priceHistory`);
    db.run(`DELETE FROM alertHistory`);

    // Close and save before deleting files
    saveDatabase();

    // CRITICAL: Delete SQLite shadow files (.shm and .wal)
    // These persist old data even after main DB is cleared!
    const shmPath = dbPath + '-shm';
    const walPath = dbPath + '-wal';

    try {
      if (existsSync(dbPath)) {
        unlinkSync(dbPath);
        logger.database('Deleted: tokens.db');
      }
      if (existsSync(shmPath)) {
        unlinkSync(shmPath);
        logger.database('Deleted: tokens.db-shm (SQLite cache)');
      }
      if (existsSync(walPath)) {
        unlinkSync(walPath);
        logger.database('Deleted: tokens.db-wal (SQLite journal)');
      }
    } catch (fileErr) {
      logger.warn('Could not delete database files:', fileErr.message);
    }

    // Recreate fresh database instance
    db = new SQL.Database();
    createTables();

    // Restore blacklist
    if (blacklistData.length > 0) {
      for (const item of blacklistData) {
        db.run(`
          INSERT OR IGNORE INTO blacklist (contractAddress, name, blacklistedAt)
          VALUES (?, ?, ?)
        `, [item.contractAddress, item.name, item.blacklistedAt]);
      }
      logger.database(`Restored ${blacklistData.length} blacklisted tokens`);
    }

    saveDatabase();

    logger.database(`❌ PURGE COMPLETE: Deleted ${tokensDeleted} tokens, ${priceRecordsDeleted} price records, ${alertRecordsDeleted} alerts`);
    logger.database(`✅ Database reset (blacklist preserved: ${blacklistData.length} tokens)`);

    return Promise.resolve({
      success: true,
      tokensDeleted,
      priceRecordsDeleted,
      alertRecordsDeleted,
      blacklistPreserved: blacklistData.length
    });
  } catch (err) {
    logger.error('deleteAllTokens failed', err);
    return Promise.reject(err);
  }
}

export function addToBlacklist(contractAddress, name) {
  try {
    db.run(`
      INSERT OR IGNORE INTO blacklist (contractAddress, name, blacklistedAt)
      VALUES (?, ?, ?)
    `, [contractAddress, name ?? 'Unknown', Date.now()]);

    // Also remove from tokens table if present
    db.run(`DELETE FROM tokens WHERE contractAddress = ?`, [contractAddress]);

    saveDatabase();
    logger.database(`Blacklisted token: ${name} (${contractAddress})`);
    return Promise.resolve({ success: true });
  } catch (err) {
    logger.error('Failed to blacklist token', err);
    return Promise.reject(err);
  }
}

export function isBlacklisted(contractAddress) {
  try {
    const result = db.exec(`SELECT COUNT(*) as count FROM blacklist WHERE contractAddress = ?`, [contractAddress]);
    const count = result[0]?.values[0]?.[0] || 0;
    return count > 0;
  } catch (err) {
    logger.error('Failed to check blacklist', err);
    return false;
  }
}

export function getBlacklist() {
  try {
    const result = db.exec(`SELECT * FROM blacklist ORDER BY blacklistedAt DESC`);

    if (result[0]) {
      const columns = result[0].columns;
      const rows = result[0].values.map(row => {
        const obj = {};
        columns.forEach((col, index) => {
          obj[col] = row[index];
        });
        return obj;
      });
      return Promise.resolve(rows);
    }

    return Promise.resolve([]);
  } catch (err) {
    return Promise.reject(err);
  }
}

export function removeFromBlacklist(contractAddress) {
  try {
    db.run(`DELETE FROM blacklist WHERE contractAddress = ?`, [contractAddress]);
    saveDatabase();
    logger.database(`Removed from blacklist: ${contractAddress}`);
    return Promise.resolve({ success: true });
  } catch (err) {
    logger.error('Failed to remove from blacklist', err);
    return Promise.reject(err);
  }
}

export function closeDatabase() {
  try {
    if (db) {
      saveDatabase();
      db.close();
    }
    return Promise.resolve();
  } catch (err) {
    return Promise.reject(err);
  }
}