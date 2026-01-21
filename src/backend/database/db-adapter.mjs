/**
 * Database Adapter - Hybrid SQLite (Electron) + PostgreSQL (Web)
 *
 * Automatically chooses the appropriate database implementation:
 * - SQLite (local): Electron app, works offline
 * - PostgreSQL (remote): Web hosting, persistent storage
 */

import * as sqliteDB from './db.mjs';
import * as postgresDB from './db-postgres.mjs';
import logger from '../logger.mjs';

// Check if PostgreSQL DATABASE_URL is available (web hosting)
const USE_POSTGRES = !!process.env.DATABASE_URL;

// Export the appropriate database implementation
if (USE_POSTGRES) {
  logger.database('🌐 Using PostgreSQL (Web Hosting Mode)');
} else {
  logger.database('💾 Using SQLite (Electron Local Mode)');
}

// Re-export all functions from the selected database
export const initDatabase = USE_POSTGRES ? postgresDB.initDatabase : sqliteDB.initDatabase;
export const insertOrUpdateToken = USE_POSTGRES ? postgresDB.insertOrUpdateToken : sqliteDB.insertOrUpdateToken;
export const getTopTokens = USE_POSTGRES ? postgresDB.getTopTokens : sqliteDB.getTopTokens;
export const getTokenById = USE_POSTGRES ? postgresDB.getTokenById : sqliteDB.getTokenById;
export const getTokensByAge = USE_POSTGRES ? postgresDB.getTokensByAge : sqliteDB.getTokensByAge;
export const addPriceHistory = USE_POSTGRES ? postgresDB.addPriceHistory : sqliteDB.addPriceHistory;
export const getPriceHistoryForToken = USE_POSTGRES ? postgresDB.getPriceHistoryForToken : sqliteDB.getPriceHistoryForToken;
export const getAlertTiers = USE_POSTGRES ? postgresDB.getAlertTiers : sqliteDB.getAlertTiers;
export const updateAlertTiers = USE_POSTGRES ? postgresDB.updateAlertTiers : sqliteDB.updateAlertTiers;
export const deleteAllTokens = USE_POSTGRES ? postgresDB.deleteAllTokens : sqliteDB.deleteAllTokens;
export const addToBlacklist = USE_POSTGRES ? postgresDB.addToBlacklist : sqliteDB.addToBlacklist;
export const isBlacklisted = USE_POSTGRES ? postgresDB.isBlacklisted : sqliteDB.isBlacklisted;
export const getBlacklist = USE_POSTGRES ? postgresDB.getBlacklist : sqliteDB.getBlacklist;
export const removeFromBlacklist = USE_POSTGRES ? postgresDB.removeFromBlacklist : sqliteDB.removeFromBlacklist;
export const closeDatabase = USE_POSTGRES ? postgresDB.closeDatabase : sqliteDB.closeDatabase;
