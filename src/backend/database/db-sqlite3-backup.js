import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, '../../data/tokens.db');

let db;

export function initDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('Database connection error:', err);
        reject(err);
      } else {
        console.log('Database connected');
        createTables().then(resolve).catch(reject);
      }
    });
  });
}

function createTables() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
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
          volume24h REAL,
          peakMultiplier REAL DEFAULT 1.0,
          lastUpdated INTEGER,
          logoUrl TEXT
        )
      `, (err) => {
        if (err) reject(err);
      });

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
      `, (err) => {
        if (err) reject(err);
      });

      // Alert tiers configuration
      db.run(`
        CREATE TABLE IF NOT EXISTS alertTiers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tier1Multiplier REAL DEFAULT 2.0,
          tier2Multiplier REAL DEFAULT 5.0,
          tier3Multiplier REAL DEFAULT 10.0,
          createdAt INTEGER
        )
      `, (err) => {
        if (err) reject(err);
      });

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
      `, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

export function insertOrUpdateToken(token) {
  return new Promise((resolve, reject) => {
    const {
      id,
      contractAddress,
      name,
      chainShort,
      symbol,
      spottedAt,
      spottedMc,
      currentMc,
      volume24h,
      peakMultiplier,
      logoUrl
    } = token;

    db.run(
      `INSERT OR REPLACE INTO tokens 
       (id, contractAddress, name, chainShort, symbol, spottedAt, spottedMc, currentMc, volume24h, peakMultiplier, lastUpdated, logoUrl)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, contractAddress, name, chainShort, symbol, spottedAt, spottedMc, currentMc, volume24h, peakMultiplier, Date.now(), logoUrl],
      function(err) {
        if (err) reject(err);
        else resolve({ id, changes: this.changes });
      }
    );
  });
}

export function getTopTokens(limit = 10) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM tokens 
       ORDER BY peakMultiplier DESC 
       LIMIT ?`,
      [limit],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}

export function getTokenById(id) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM tokens WHERE id = ?`, [id], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

export function getTokensByAge(hours = 3) {
  return new Promise((resolve, reject) => {
    const thresholdMs = hours * 60 * 60 * 1000;
    const cutoffTime = Date.now() - thresholdMs;

    db.all(
      `SELECT * FROM tokens WHERE spottedAt > ? ORDER BY peakMultiplier DESC`,
      [cutoffTime],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}

export function addPriceHistory(tokenId, marketCap, volume) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO priceHistory (tokenId, timestamp, marketCap, volume)
       VALUES (?, ?, ?, ?)`,
      [tokenId, Date.now(), marketCap, volume],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

export function getPriceHistoryForToken(tokenId, minutes = 1) {
  return new Promise((resolve, reject) => {
    const cutoffTime = Date.now() - (minutes * 60 * 1000);

    db.all(
      `SELECT * FROM priceHistory 
       WHERE tokenId = ? AND timestamp > ? 
       ORDER BY timestamp DESC`,
      [tokenId, cutoffTime],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}

export function getAlertTiers() {
  return new Promise((resolve, reject) => {
    db.get(`SELECT * FROM alertTiers ORDER BY createdAt DESC LIMIT 1`, (err, row) => {
      if (err) reject(err);
      else resolve(row || { tier1Multiplier: 2.0, tier2Multiplier: 5.0, tier3Multiplier: 10.0 });
    });
  });
}

export function updateAlertTiers(tier1, tier2, tier3) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO alertTiers (tier1Multiplier, tier2Multiplier, tier3Multiplier, createdAt)
       VALUES (?, ?, ?, ?)`,
      [tier1, tier2, tier3, Date.now()],
      function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      }
    );
  });
}

export function closeDatabase() {
  return new Promise((resolve, reject) => {
    if (db) {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    } else {
      resolve();
    }
  });
}
