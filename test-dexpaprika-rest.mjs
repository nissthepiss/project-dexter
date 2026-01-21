/**
 * Test script to analyze DexPaprika REST API:
 * 1. How often does it return new data?
 * 2. What additional fields are available beyond volume?
 * 3. Any useful data for improving the top 10 algorithm?
 */

import axios from 'axios';
import crypto from 'crypto';

const REST_BASE_URL = 'https://api.dexpaprika.com';

// Some known Solana tokens to test
const TEST_TOKENS = [
    'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // Bonk
    '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // Raydium
    '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr', // SOL
    'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG', // Jupiter
];

// Pick a random token to test
const testToken = TEST_TOKENS[Math.floor(Math.random() * TEST_TOKENS.length)];

console.log(`=".repeat(60)`);
console.log(`DEXPAPRIKA REST API TEST`);
console.log(`Testing token: ${testToken}`);
console.log(`=".repeat(60)}\n`);

// ============ PART 1: Full API Response Structure ============
console.log(`\n${"=".repeat(60)}`);
console.log(`PART 1: ANALYZING FULL API RESPONSE STRUCTURE`);
console.log(`${"=".repeat(60)}\n`);

async function analyzeFullResponse() {
    try {
        const response = await axios.get(
            `${REST_BASE_URL}/networks/solana/tokens/${testToken}`,
            {
                timeout: 10000,
                headers: { 'User-Agent': 'Project-Dexter/1.0' }
            }
        );

        const data = response.data;

        console.log("FULL RESPONSE STRUCTURE:");
        console.log(JSON.stringify(data, null, 2));

        console.log("\n\nAVAILABLE FIELDS:");
        console.log("-".repeat(60));

        // Recursively print all paths
        const paths = [];
        function extractPaths(obj, prefix = '') {
            if (typeof obj !== 'object' || obj === null) {
                paths.push(`${prefix}: ${typeof obj} = ${JSON.stringify(obj)}`);
                return;
            }
            for (const [key, value] of Object.entries(obj)) {
                const newPrefix = prefix ? `${prefix}.${key}` : key;
                if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                    extractPaths(value, newPrefix);
                } else if (Array.isArray(value)) {
                    if (value.length > 0 && typeof value[0] === 'object') {
                        paths.push(`${newPrefix}: Array[${value.length}] of objects`);
                        if (value.length > 0) {
                            extractPaths(value[0], `${newPrefix}[0]`);
                        }
                    } else {
                        paths.push(`${newPrefix}: Array[${value.length}] = ${JSON.stringify(value.slice(0, 3))}${value.length > 3 ? '...' : ''}`);
                    }
                } else {
                    paths.push(`${newPrefix}: ${typeof value} = ${value}`);
                }
            }
        }

        extractPaths(data);
        paths.forEach(p => console.log(`  ${p}`));

        return data;
    } catch (error) {
        console.error(`Error fetching full response: ${error.message}`);
        return null;
    }
}

// ============ PART 2: Poll for Update Frequency ============
console.log(`\n\n${"=".repeat(60)}`);
console.log(`PART 2: POLLING FOR UPDATE FREQUENCY (60 seconds)`);
console.log(`${"=".repeat(60)}\n`);

async function pollForUpdates(tokenAddress, durationMs = 60000) {
    const results = {
        requestCount: 0,
        uniqueResponses: 0,
        changes: [],
        firstResponse: null,
        lastResponse: null,
        fieldsThatChange: new Set(),
        allFields: new Set(),
    };

    const startTime = Date.now();
    let lastData = null;
    let lastResponseTime = null;

    console.log(`Polling every 2 seconds for ${durationMs / 1000} seconds...`);
    console.log("Timestamp            | Changes | Fields Changed");
    console.log("-".repeat(80));

    while (Date.now() - startTime < durationMs) {
        try {
            const requestStart = Date.now();
            const response = await axios.get(
                `${REST_BASE_URL}/networks/solana/tokens/${tokenAddress}`,
                {
                    timeout: 10000,
                    headers: { 'User-Agent': 'Project-Dexter/1.0' }
                }
            );
            const requestTime = Date.now() - requestStart;

            results.requestCount++;

            // Get hash of response for comparison
            const responseHash = crypto.createHash('md5').update(JSON.stringify(response.data)).digest('hex');

            const isFirstRequest = !results.firstResponse;
            const dataChanged = lastData && JSON.stringify(response.data) !== JSON.stringify(lastData);

            if (isFirstRequest) {
                results.firstResponse = response.data;
                results.uniqueResponses = 1;

                // Collect all field paths
                const paths = getFieldPaths(response.data);
                paths.forEach(p => results.allFields.add(p));

                console.log(`${new Date().toISOString()} | INIT   | First response (${requestTime}ms) - ${paths.length} fields`);
            } else if (dataChanged) {
                results.uniqueResponses++;

                // Find which fields changed
                const changedFields = findChangedFields(lastData, response.data);
                changedFields.forEach(f => results.fieldsThatChange.add(f));

                const timestamp = new Date().toISOString();
                const timeSinceLast = lastResponseTime ? `+${((Date.now() - lastResponseTime) / 1000).toFixed(1)}s` : 'N/A';

                console.log(`${timestamp} | CHANGE  | ${changedFields.length} fields changed (${timeSinceLast}, ${requestTime}ms)`);
                changedFields.slice(0, 5).forEach(f => console.log(`                      - ${f}`));
                if (changedFields.length > 5) {
                    console.log(`                      ... and ${changedFields.length - 5} more`);
                }
            } else {
                // Same response
                console.log(`${new Date().toISOString()} | SAME   | ${results.uniqueResponses} unique so far (${requestTime}ms)`);
            }

            lastData = response.data;
            lastResponseTime = Date.now();
            results.lastResponse = response.data;

        } catch (error) {
            console.error(`${new Date().toISOString()} | ERROR  | ${error.message}`);
        }

        // Wait 2 seconds between requests
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    return results;
}

// Helper to get all field paths from an object
function getFieldPaths(obj, prefix = '') {
    const paths = [];
    if (typeof obj !== 'object' || obj === null) return paths;

    for (const [key, value] of Object.entries(obj)) {
        const newPrefix = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            paths.push(newPrefix);
            paths.push(...getFieldPaths(value, newPrefix));
        } else {
            paths.push(newPrefix);
        }
    }
    return paths;
}

// Helper to find which fields changed between two objects
function findChangedFields(oldObj, newObj, prefix = '') {
    const changed = [];

    const oldKeys = typeof oldObj === 'object' && oldObj !== null ? Object.keys(oldObj) : [];
    const newKeys = typeof newObj === 'object' && newObj !== null ? Object.keys(newObj) : [];
    const allKeys = new Set([...oldKeys, ...newKeys]);

    for (const key of allKeys) {
        const newPrefix = prefix ? `${prefix}.${key}` : key;
        const oldValue = oldObj?.[key];
        const newValue = newObj?.[key];

        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
            if (typeof newValue === 'object' && newValue !== null && !Array.isArray(newValue)) {
                changed.push(...findChangedFields(oldValue, newValue, newPrefix));
            } else {
                changed.push(newPrefix);
            }
        }
    }

    return changed;
}

// ============ RUN TESTS ============
async function runTests() {
    // First, analyze the full response structure
    const fullData = await analyzeFullResponse();

    // Then poll for updates
    const pollResults = await pollForUpdates(testToken, 60000);

    // Print summary
    console.log(`\n\n${"=".repeat(60)}`);
    console.log(`SUMMARY`);
    console.log(`${"=".repeat(60)}\n`);

    const duration = ((pollResults.lastResponse ? Date.now() : Date.now()) - Date.now() + 60000) / 1000;

    console.log(`UPDATE FREQUENCY:`);
    console.log(`  Total requests:     ${pollResults.requestCount}`);
    console.log(`  Unique responses:   ${pollResults.uniqueResponses}`);
    console.log(`  Change rate:        ${(pollResults.uniqueResponses / pollResults.requestCount * 100).toFixed(1)}% of requests returned new data`);
    console.log(`  Updates per minute: ${(pollResults.uniqueResponses / 60 * 60).toFixed(1)}`);

    console.log(`\nALL AVAILABLE FIELDS (${pollResults.allFields.size}):`);
    Array.from(pollResults.allFields).sort().forEach(f => console.log(`  - ${f}`));

    console.log(`\nFIELDS THAT CHANGED (${pollResults.fieldsThatChange.size}):`);
    if (pollResults.fieldsThatChange.size > 0) {
        Array.from(pollResults.fieldsThatChange).sort().forEach(f => console.log(`  - ${f}`));
    } else {
        console.log(`  (none - no changes detected during polling period)`);
    }

    console.log(`\nSTATIC FIELDS (never changed):`);
    const staticFields = Array.from(pollResults.allFields).filter(f => !pollResults.fieldsThatChange.has(f));
    staticFields.forEach(f => console.log(`  - ${f}`));
}

// Run
runTests().catch(console.error);
