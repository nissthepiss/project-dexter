/**
 * Data Collector for Scoring Metrics
 * Records snapshots of token scoring data for algorithm analysis
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DataCollector {
    constructor(logger) {
        this.logger = logger;
        this.enabled = true;
        this.dataDir = path.join(process.cwd(), 'src', 'data', 'scoring-logs');
        this.currentFile = null;
        this.recordCount = 0;
        this.maxRecordsPerFile = 1000; // Create new file after 1000 records
        this.flushInterval = 60000; // Flush to disk every 60 seconds
        this.buffer = [];
        this.flushTimer = null;
        this.maxLogFiles = 50; // Keep only last 50 log files
        this.cleanupInterval = 3600000; // Run cleanup every hour
        this.cleanupTimer = null;

        this.init();
    }

    init() {
        // Create data directory if it doesn't exist
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }

        // Start flush timer
        this.flushTimer = setInterval(() => {
            this.flush();
        }, this.flushInterval);

        // Start cleanup timer for old log files
        this.cleanupTimer = setInterval(() => {
            this.cleanupOldLogs();
        }, this.cleanupInterval);

        // Run initial cleanup
        this.cleanupOldLogs();

        this.logger?.info('[DataCollector] Initialized');
    }

    /**
     * Generate filename based on current timestamp
     */
    generateFilename() {
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const timeStr = now.toISOString().split('T')[1].split('.')[0].replace(/:/g, '-'); // HH-MM-SS
        return `scoring-snapshot-${dateStr}-${timeStr}.json`;
    }

    /**
     * Record a snapshot of current scoring data
     */
    recordSnapshot(data) {
        if (!this.enabled) return;

        const snapshot = {
            timestamp: new Date().toISOString(),
            snapshot: data
        };

        this.buffer.push(snapshot);
        this.recordCount++;

        // Auto-flush if buffer gets too large
        if (this.buffer.length >= 50) {
            this.flush();
        }
    }

    /**
     * Record top 10 tokens with their scores
     */
    recordTop10(tokens, viewMode, mvp = null) {
        if (!this.enabled) return;

        const snapshot = {
            timestamp: new Date().toISOString(),
            type: 'top10',
            viewMode: viewMode,
            data: {
                tokens: tokens.map((token, index) => ({
                    rank: index + 1,
                    address: token.contractAddress,
                    symbol: token.symbol,
                    name: token.name,
                    score: token.score,
                    components: token.components,
                    currentMc: token.currentMc,
                    spottedMc: token.spottedMc,
                    multiplier: token.multiplier,
                    currentMultiplier: token.currentMultiplier,
                    volume24h: token.volume24h,
                    netPercent: token.netPercent,
                    metricsFresh: token.metricsFresh,
                    spottedAt: token.spottedAt
                })),
                mvp: mvp ? {
                    address: mvp.address,
                    score: mvp.score,
                    health: mvp.health,
                    acceleration: mvp.acceleration
                } : null
            }
        };

        this.buffer.push(snapshot);
        this.recordCount++;

        // Check if we need a new file
        if (this.recordCount >= this.maxRecordsPerFile) {
            this.flush(true); // Force new file
        }

        if (this.buffer.length >= 50) {
            this.flush();
        }
    }

    /**
     * Record holder mode tokens
     */
    recordHolderTokens(tokens, viewMode, topHolder = null) {
        if (!this.enabled) return;

        const snapshot = {
            timestamp: new Date().toISOString(),
            type: 'holder',
            viewMode: viewMode,
            data: {
                tokens: tokens.map((token, index) => ({
                    rank: index + 1,
                    address: token.contractAddress,
                    symbol: token.symbol,
                    name: token.name,
                    score: token.score,
                    components: token.components,
                    currentMc: token.currentMc,
                    volume24h: token.volume24h,
                    holderCount: token.holderCount,
                    holderGrowth24h: token.holderGrowth24h
                })),
                topHolder: topHolder ? {
                    address: topHolder.address,
                    score: topHolder.score
                } : null
            }
        };

        this.buffer.push(snapshot);
        this.recordCount++;

        if (this.buffer.length >= 50) {
            this.flush();
        }
    }

    /**
     * Flush buffer to disk
     */
    flush(forceNewFile = false) {
        if (this.buffer.length === 0) return;

        try {
            // Determine file to write to
            if (!this.currentFile || forceNewFile) {
                this.currentFile = path.join(this.dataDir, this.generateFilename());
                this.recordCount = 0;
            }

            // Append to file (read existing, append, write back)
            let existingData = [];
            if (fs.existsSync(this.currentFile)) {
                try {
                    const content = fs.readFileSync(this.currentFile, 'utf-8');
                    existingData = JSON.parse(content);
                } catch (e) {
                    existingData = [];
                }
            }

            // Merge buffer with existing data
            const allData = [...existingData, ...this.buffer];
            fs.writeFileSync(this.currentFile, JSON.stringify(allData, null, 2));

            this.logger?.info(`[DataCollector] Flushed ${this.buffer.length} records to ${path.basename(this.currentFile)}`);
            this.buffer = [];

        } catch (error) {
            this.logger?.error(`[DataCollector] Failed to flush data: ${error.message}`);
        }
    }

    /**
     * Enable or disable data collection
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        this.logger?.info(`[DataCollector] Data collection ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Get current file path
     */
    getCurrentFile() {
        return this.currentFile;
    }

    /**
     * Get stats about collected data
     */
    getStats() {
        return {
            enabled: this.enabled,
            currentFile: this.currentFile ? path.basename(this.currentFile) : null,
            recordsInBuffer: this.buffer.length,
            totalRecordsCollected: this.recordCount,
            dataDir: this.dataDir
        };
    }

    /**
     * Cleanup on shutdown
     */
    shutdown() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
        }
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }
        this.flush();
        this.logger?.info('[DataCollector] Shutdown complete');
    }

    /**
     * Clean up old log files, keeping only the most recent maxLogFiles
     */
    cleanupOldLogs() {
        try {
            if (!fs.existsSync(this.dataDir)) {
                return;
            }

            const files = fs.readdirSync(this.dataDir)
                .filter(f => f.endsWith('.json') && f.startsWith('scoring-snapshot-'))
                .map(f => {
                    const filePath = path.join(this.dataDir, f);
                    const stats = fs.statSync(filePath);
                    return { file: f, path: filePath, mtime: stats.mtime };
                })
                .sort((a, b) => b.mtime - a.mtime); // Sort by modification time, newest first

            if (files.length > this.maxLogFiles) {
                const filesToDelete = files.slice(this.maxLogFiles);
                let deletedCount = 0;

                for (const f of filesToDelete) {
                    try {
                        fs.unlinkSync(f.path);
                        deletedCount++;
                    } catch (e) {
                        this.logger?.error(`[DataCollector] Failed to delete old log file ${f.file}: ${e.message}`);
                    }
                }

                if (deletedCount > 0) {
                    this.logger?.info(`[DataCollector] Cleaned up ${deletedCount} old log files (${files.length - deletedCount}/${this.maxLogFiles} retained)`);
                }
            }
        } catch (error) {
            this.logger?.error(`[DataCollector] Failed to cleanup old logs: ${error.message}`);
        }
    }
}

export default DataCollector;
