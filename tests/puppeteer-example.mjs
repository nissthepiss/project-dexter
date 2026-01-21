import puppeteer from 'puppeteer';

/**
 * Puppeteer test script for Project Dexter
 *
 * Usage:
 *   node tests/puppeteer-example.mjs
 *
 * For Electron testing:
 *   node tests/puppeteer-example.mjs --electron
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const IS_ELECTRON = process.argv.includes('--electron');

/**
 * Basic example: Screenshot the app
 */
async function screenshotExample() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Set viewport size
  await page.setViewport({ width: 1280, height: 800 });

  console.log(`Navigating to ${BASE_URL}...`);
  await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

  // Take a screenshot
  await page.screenshot({ path: 'screenshot.png' });
  console.log('Screenshot saved to screenshot.png');

  await browser.close();
}

/**
 * Test token loading functionality
 */
async function testTokenLoading() {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  // Enable console logging from the page
  page.on('console', msg => {
    console.log('PAGE LOG:', msg.text());
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle0' });

  // Wait for tokens to load (check for token elements)
  console.log('Waiting for tokens to load...');
  await page.waitForSelector('.token-row, .token-item, [data-token]', { timeout: 10000 })
    .catch(() => console.log('No token elements found - might need to adjust selector'));

  // Get page content for debugging
  const content = await page.evaluate(() => {
    return {
      title: document.title,
      tokenCount: document.querySelectorAll('.token-row, .token-item, [data-token]').length,
      hasTable: !!document.querySelector('table'),
      bodyText: document.body?.innerText?.substring(0, 500) || 'No body text'
    };
  });

  console.log('Page info:', content);

  await browser.close();
  return content;
}

/**
 * Debug mode: Keep browser open for manual inspection
 */
async function debugMode() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    slowMo: 50 // Slow down actions for visibility
  });
  const page = await browser.newPage();

  await page.goto(BASE_URL);

  // Keep browser open
  console.log('Browser open for inspection. Press Ctrl+C to exit.');
  await new Promise(() => {}); // Never resolve
}

/**
 * Test API endpoints directly
 */
async function testAPI() {
  const browser = await puppeteer.launch({
    headless: 'new'
  });
  const page = await browser.newPage();

  const API_BASE = 'http://localhost:3001/api';

  // Test /api/tokens/top
  console.log('Testing /api/tokens/top...');
  const response = await page.evaluate(async (url) => {
    const res = await fetch(url);
    return { status: res.status, data: await res.json() };
  }, `${API_BASE}/tokens/top?viewMode=5m`);

  console.log('API Response status:', response.status);
  console.log('Token count:', response.data?.tokens?.length || response.data?.length || 0);

  await browser.close();
  return response;
}

/**
 * Main runner
 */
async function main() {
  const mode = process.argv[2] === '--electron' ? process.argv[3] : process.argv[2];

  switch (mode) {
    case 'screenshot':
      await screenshotExample();
      break;
    case 'test':
      await testTokenLoading();
      break;
    case 'debug':
      await debugMode();
      break;
    case 'api':
      await testAPI();
      break;
    default:
      console.log(`
Puppeteer Test Suite for Project Dexter

Usage:
  node tests/puppeteer-example.mjs <command>

Commands:
  screenshot    - Take a screenshot of the app
  test          - Test token loading and basic functionality
  debug         - Open browser for manual inspection (stays open)
  api           - Test backend API endpoints

Examples:
  node tests/puppeteer-example.mjs screenshot
  node tests/puppeteer-example.mjs test
  node tests/puppeteer-example.mjs debug

Environment:
  BASE_URL      - Default: http://localhost:3000
      `);
  }
}

main().catch(console.error);
