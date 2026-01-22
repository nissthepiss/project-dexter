/**
 * Database Adapter - Hybrid SQLite (Electron) + PostgreSQL (Web)
 *
 * Automatically chooses the appropriate database implementation:
 * - SQLite (local): Electron app, works offline
 * - PostgreSQL (remote): Web hosting, persistent storage
 */

import logger from '../logger.mjs';

// Check if PostgreSQL DATABASE_URL is available (web hosting)
const USE_POSTGRES = !!process.env.DATABASE_URL;

// Export the appropriate database implementation
if (USE_POSTGRES) {
  logger.database('🌐 Using PostgreSQL (Web Hosting Mode)');
} else {
  logger.database('💾 Using SQLite (Electron Local Mode)');
}

// Re-export all functions from the selected database using dynamic imports
// This prevents both modules from loading at startup (avoids sql.js on Railway)
const dbModule = await (USE_POSTGRES
  ? import('./db-postgres.mjs')
  : import('./db.mjs'));

export const initDatabase = dbModule.initDatabase;
export const insertOrUpdateToken = dbModule.insertOrUpdateToken;
export const getTopTokens = dbModule.getTopTokens;
export const getTokenById = dbModule.getTokenById;
export const getTokensByAge = dbModule.getTokensByAge;
export const addPriceHistory = dbModule.addPriceHistory;
export const getPriceHistoryForToken = dbModule.getPriceHistoryForToken;
export const getAlertTiers = dbModule.getAlertTiers;
export const updateAlertTiers = dbModule.updateAlertTiers;
export const deleteAllTokens = dbModule.deleteAllTokens;
export const addToBlacklist = dbModule.addToBlacklist;
export const isBlacklisted = dbModule.isBlacklisted;
export const getBlacklist = dbModule.getBlacklist;
export const removeFromBlacklist = dbModule.removeFromBlacklist;
export const closeDatabase = dbModule.closeDatabase;
