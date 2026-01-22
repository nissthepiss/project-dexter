/**
 * Test using the automation Brave window directly (no separate headless)
 */

import puppeteer from 'puppeteer';

async function testRailwayDirect() {
  console.log('=== Connecting to Automation Brave (Full Clone) ===\n');

  // Connect to the running Brave automation instance
  const browser = await puppeteer.connect({
    browserURL: 'http://localhost:9222'
  });

  console.log('✅ Connected to Brave');

  // Get existing pages or create new one
  const pages = await browser.pages();
  let railwayPage = pages.find(p => p.url().includes('railway'));

  if (!railwayPage) {
    console.log('Opening Railway...');
    railwayPage = await browser.newPage();
  }

  // Navigate to Railway
  console.log('Navigating to Railway.com...');
  await railwayPage.goto('https://railway.com', { waitUntil: 'networkidle0' });

  // Take screenshot
  const screenshotPath = 'railway-test.png';
  await railwayPage.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`Screenshot saved to: ${screenshotPath}`);

  // Check login status
  const isLoggedIn = await railwayPage.evaluate(() => {
    const onLoginPage = window.location.pathname.includes('/login');
    const hasUserElements = document.querySelector('[class*="user"]') ||
                           document.querySelector('[class*="account"]') ||
                           document.querySelector('[data-testid="user-menu"]') ||
                           document.querySelector('[href="/account"]');
    return !onLoginPage && hasUserElements;
  });

  console.log(`\nLogged in status: ${isLoggedIn ? '✅ YES' : '❌ NO'}`);
  console.log(`Page title: ${await railwayPage.title()}`);
  console.log(`URL: ${railwayPage.url()}`);

  // Don't disconnect - keep the browser open for the user to see
  console.log('\n💡 The automation Brave window should now show Railway.');
  console.log('If not logged in, just log in once and it will persist.');

  await browser.disconnect();

  return isLoggedIn;
}

testRailwayDirect().catch(console.error);
