/**
 * Extract Brave cookies via Chrome DevTools Protocol (Remote Debugging)
 * No extensions needed, no file access required
 */

import puppeteer from 'puppeteer';

// We'll use a two-step approach:
// 1. Connect to Brave's CDP to get cookies
// 2. Launch a headless Puppeteer and inject those cookies

/**
 * Launch Brave with remote debugging (run this manually)
 */
const BRAVE_DEBUG_INSTRUCTIONS = `
╔════════════════════════════════════════════════════════════════════════╗
║  STEP 1: Close ALL Brave windows (including background processes)      ║
╚════════════════════════════════════════════════════════════════════════╝

Then launch Brave with remote debugging:

"C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe" --remote-debugging-port=9222

Leave Brave open and logged into your accounts (Railway, etc).
Run this script again.

╔════════════════════════════════════════════════════════════════════════╗
║  Alternative: Seamless Method (but requires one-time setup)            ║
╚════════════════════════════════════════════════════════════════════════╝

1. Create a dedicated Brave profile for automation
2. Add a startup shortcut that launches it with --remote-debugging-port=9222
3. Keep it running in the background, logged into your services
4. Puppeteer can always connect to it

No file access needed, no extensions, completely remote.
`;

async function getCookiesFromBraveCDP() {
  try {
    // Connect to Brave's remote debugging port
    const browser = await puppeteer.connect({
      browserURL: 'http://localhost:9222'
    });

    // Get all pages/tabs to find Railway
    const pages = await browser.pages();

    // Try to find an existing Railway page, or create one
    let railwayPage = pages.find(p => p.url().includes('railway.app'));

    if (!railwayPage) {
      // Create a new page and navigate to Railway to trigger cookie access
      railwayPage = await browser.newPage();
      await railwayPage.goto('https://railway.com', { waitUntil: 'networkidle0' });
    }

    // Get all cookies via CDP
    const client = await railwayPage.target().createCDPSession();
    const cookies = await client.send('Network.getAllCookies');

    await browser.disconnect();

    return cookies.cookies;
  } catch (err) {
    if (err.message.includes('connect')) {
      console.log('❌ Cannot connect to Brave on port 9222');
      console.log(BRAVE_DEBUG_INSTRUCTIONS);
    } else {
      console.error('Error:', err.message);
    }
    return null;
  }
}

async function testWithHeadlessPuppeteer(cookies) {
  console.log('\n=== Launching headless Puppeteer with extracted cookies ===\n');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // Filter for Railway cookies (both .com and .app)
  const railwayCookies = cookies.filter(c =>
    c.domain.includes('railway')
  );

  console.log(`Setting ${railwayCookies.length} Railway cookies...`);
  await page.setCookie(...railwayCookies);

  await page.goto('https://railway.app', { waitUntil: 'networkidle0' });

  // Take screenshot
  const screenshotPath = 'railway-test.png';
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved to: ${screenshotPath}`);

  // Check login status
  const isLoggedIn = await page.evaluate(() => {
    const onLoginPage = window.location.pathname.includes('/login');
    const hasUserElements = document.querySelector('[class*="user"]') ||
                           document.querySelector('[class*="account"]') ||
                           document.querySelector('[data-testid="user-menu"]');
    return !onLoginPage && hasUserElements;
  });

  console.log(`\nLogged in status: ${isLoggedIn ? '✅ YES' : '❌ NO'}`);
  console.log(`Page title: ${await page.title()}`);
  console.log(`URL: ${page.url()}`);

  await browser.close();
  return isLoggedIn;
}

// Main execution
(async () => {
  console.log('=== Extracting cookies from Brave via CDP ===\n');

  const cookies = await getCookiesFromBraveCDP();

  if (!cookies) {
    console.log('\n❌ Failed to get cookies from Brave.');
    console.log('Make sure Brave is running with: --remote-debugging-port=9222');
    process.exit(1);
  }

  console.log(`✅ Extracted ${cookies.length} cookies from Brave`);
  console.log(`Railway cookies: ${cookies.filter(c => c.domain.includes('railway')).length}\n`);

  const success = await testWithHeadlessPuppeteer(cookies);

  if (success) {
    console.log('\n✅ SUCCESS! Puppeteer is now logged into Railway using your Brave cookies.');
  } else {
    console.log('\n❌ Login failed. Make sure you\'re logged into Railway in Brave.');
  }
})();
