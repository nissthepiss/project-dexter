/**
 * Test script to read Brave cookies and launch Puppeteer logged in
 */

import puppeteer from 'puppeteer';
import sqlite3 from 'better-sqlite3';
import path from 'path';
import { copyFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';

const cookiePath = `C:\\Users\\paulj\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data\\Default\\Network\\Cookies`;

/**
 * Copy the locked Cookies file to a temp location and read it
 */
function getBraveCookies(domainFilter = null) {
  console.log('Reading cookies from Brave...');

  // Copy to temp file since Brave locks the original
  const tempPath = path.join(tmpdir(), `brave-cookies-${Date.now()}.db`);
  console.log(`Copying cookies database to temp file: ${tempPath}`);

  try {
    copyFileSync(cookiePath, tempPath);
  } catch (err) {
    console.error('Failed to copy cookies database:', err.message);
    console.error('Make sure you have read permissions to the file');
    return [];
  }

  const db = sqlite3(tempPath, { readonly: true });

  let query = `
    SELECT name, value, host_key as domain, path, expires_utc, is_secure, is_httponly
    FROM cookies
  `;

  const params = [];
  if (domainFilter) {
    query += ` WHERE host_key LIKE ?`;
    params.push(`%${domainFilter}%`);
  }

  const rows = db.prepare(query).all(...params);
  db.close();

  // Clean up temp file
  try {
    unlinkSync(tempPath);
  } catch (err) {
    console.warn('Could not delete temp file:', err.message);
  }

  console.log(`Found ${rows.length} cookies${domainFilter ? ` for domain: ${domainFilter}` : ''}`);

  // Convert to Puppeteer format
  return rows.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: Boolean(c.is_secure),
    httpOnly: Boolean(c.is_httponly),
    // Chrome stores expiry as Mac timestamp (seconds since 1601), convert to Unix
    expirationDate: c.expires_utc > 0 ? Math.floor((c.expires_utc / 1000000) - 11644473600) : undefined
  }));
}

/**
 * Test by launching Puppeteer with Brave cookies and visiting Railway
 */
async function testRailwayLogin() {
  console.log('=== Testing Railway Login with Brave Cookies ===\n');

  // Get all railway-related cookies
  const cookies = getBraveCookies('railway');

  if (cookies.length === 0) {
    console.log('⚠️  No Railway cookies found. Are you logged into Railway in Brave?');
    return;
  }

  console.log(`Found ${cookies.length} Railway cookies from Brave:`);
  cookies.slice(0, 5).forEach(c => {
    console.log(`  - ${c.name}: ${c.value.substring(0, 20)}...`);
  });
  if (cookies.length > 5) {
    console.log(`  ... and ${cookies.length - 5} more`);
  }
  console.log();

  // Launch Puppeteer
  console.log('Launching Puppeteer (headless)...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Set cookies
  console.log('Setting cookies in Puppeteer...');
  await page.setCookie(...cookies);

  // Navigate to Railway
  console.log('Navigating to Railway.app...');
  await page.goto('https://railway.app', { waitUntil: 'networkidle0' });

  // Take a screenshot
  const screenshotPath = path.join(process.cwd(), 'railway-test.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved to: ${screenshotPath}`);

  // Check if we're logged in by looking for common logged-in indicators
  const isLoggedIn = await page.evaluate(() => {
    // Look for elements that only appear when logged in
    const indicators = [
      // Railway specific - look for user menu, dashboard links, etc.
      document.querySelector('[href="/account"]'),
      document.querySelector('[data-testid="user-menu"]'),
      document.querySelector('.avatar'),
      document.querySelector('[class*="user"]'),
      document.querySelector('[class*="account"]')
    ];

    // Also check if we're being redirected to login
    const onLoginPage = window.location.pathname.includes('/login') ||
                        document.body.innerText.includes('Sign in') ||
                        document.body.innerText.includes('Log in');

    return !onLoginPage && indicators.some(el => el !== null);
  });

  console.log('\n=== Results ===');
  console.log(`Logged in status: ${isLoggedIn ? '✅ YES' : '❌ NO'}`);

  // Get page title and URL as additional info
  const title = await page.title();
  const url = page.url();
  console.log(`Page title: ${title}`);
  console.log(`Final URL: ${url}`);

  // Get some page content to debug
  const bodyText = await page.evaluate(() => {
    return document.body.innerText.substring(0, 500);
  });
  console.log(`\nPage preview:\n${bodyText}...\n`);

  await browser.close();

  console.log('\nTest complete! Check railway-test.png to see the page.');
}

// Run the test
testRailwayLogin().catch(console.error);
