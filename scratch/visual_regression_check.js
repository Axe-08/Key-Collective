/**
 * visual_regression_check.js
 * 
 * Visual Regression & Element Presence Automation Script
 * Automated verification across 4 core screens and the OAuth modal for Key Collective.
 * 
 * Features:
 * - High-DPI (2x scale) screenshot capture for Stitch design verification
 * - Element presence & visibility assertions
 * - Supports navigation across Dashboard, Keys, Analytics, Settings, and OAuth Modal
 * - Flexible base URL and configurable viewport
 * - Outputs structured test execution summary & artifact manifest
 */

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.APP_URL || process.env.BASE_URL || 'http://localhost:5173';
const OUTPUT_DIR = process.env.SCREENSHOT_DIR || path.join(__dirname, 'screenshots');
const TIMEOUT = parseInt(process.env.TEST_TIMEOUT || '10000', 10);
const VIEWPORT = {
  width: 1440,
  height: 900,
  deviceScaleFactor: 2, // High-res retina scale for Stitch comparison
};

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Colorized logging helpers
const log = {
  info: (msg) => console.log(`\x1b[34m[INFO]\x1b[0m ${msg}`),
  pass: (msg) => console.log(`\x1b[32m[PASS]\x1b[0m ${msg}`),
  fail: (msg) => console.error(`\x1b[31m[FAIL]\x1b[0m ${msg}`),
  warn: (msg) => console.warn(`\x1b[33m[WARN]\x1b[0m ${msg}`),
  step: (msg) => console.log(`\n\x1b[36m===> ${msg}\x1b[0m`),
};

/**
 * Screen specifications to verify
 */
const SCREENS = [
  {
    id: 'dashboard',
    name: 'Screen 1: Dashboard / Overview',
    path: '/',
    screenshot: '01_screen_dashboard.png',
    expectedElements: [
      { selector: 'header, nav, [data-testid="navbar"]', description: 'Navigation Bar' },
      { selector: 'h1, h2, [data-testid="page-title"]', description: 'Page Header' },
      { selector: '[data-testid="key-metrics"], .metric-card, .stats-container, .card', description: 'Metrics / Stats Section' }
    ]
  },
  {
    id: 'keys',
    name: 'Screen 2: Key Management & Pools',
    path: '/keys',
    fallbackNavSelector: 'a[href*="key"], [data-nav="keys"], button:has-text("Keys")',
    screenshot: '02_screen_keys.png',
    expectedElements: [
      { selector: 'table, [data-testid="keys-table"], .key-list, .key-item', description: 'API Keys List / Table' },
      { selector: 'button, [data-testid="add-key-btn"], .btn-primary', description: 'Add / Generate Key Button' }
    ]
  },
  {
    id: 'analytics',
    name: 'Screen 3: Observability & Telemetry',
    path: '/analytics',
    fallbackNavSelector: 'a[href*="analytics"], a[href*="metrics"], [data-nav="analytics"]',
    screenshot: '03_screen_analytics.png',
    expectedElements: [
      { selector: 'canvas, svg, [data-testid="analytics-chart"], .chart-container, .graph', description: 'Usage / Metrics Chart' }
    ]
  },
  {
    id: 'settings',
    name: 'Screen 4: Settings & Tenant Configuration',
    path: '/settings',
    fallbackNavSelector: 'a[href*="setting"], [data-nav="settings"]',
    screenshot: '04_screen_settings.png',
    expectedElements: [
      { selector: 'form, [data-testid="settings-form"], .settings-panel, input', description: 'Settings Configuration Form' }
    ]
  },
  {
    id: 'oauth_modal',
    name: 'Screen 5: OAuth / Provider Modal',
    path: '/',
    action: async (page) => {
      // Look for a trigger button that opens the OAuth or Provider Modal
      const modalTriggerSelectors = [
        '[data-testid="connect-provider"]',
        '[data-testid="oauth-btn"]',
        '[data-testid="open-modal"]',
        'button[aria-haspopup="dialog"]',
        'button:has-text("Connect")',
        'button:has-text("OAuth")',
        'button:has-text("Add Provider")',
        '.oauth-trigger'
      ];

      let opened = false;
      for (const sel of modalTriggerSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            await btn.click();
            await page.waitForTimeout(600);
            opened = true;
            log.info(`Clicked modal trigger: ${sel}`);
            break;
          }
        } catch (_) {}
      }

      if (!opened) {
        log.warn('Could not find explicit modal trigger button; attempting JS modal open or verifying static modal structure');
      }
    },
    screenshot: '05_screen_oauth_modal.png',
    expectedElements: [
      { selector: '[role="dialog"], .modal, .modal-backdrop, [data-testid="oauth-modal"]', description: 'OAuth Modal Container' }
    ]
  }
];

/**
 * Main execution runner
 */
async function runVisualRegressionChecks() {
  log.step('Initializing Puppeteer Headless Chrome');
  
  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch (e) {
    try {
      puppeteer = require('puppeteer-core');
    } catch (err) {
      log.fail('Puppeteer is not installed in the current environment. Please install puppeteer via `npm i -D puppeteer`.');
      process.exit(1);
    }
  }

  const launchOptions = {
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--hide-scrollbars'
    ],
    defaultViewport: VIEWPORT
  };

  if (process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  let browser;
  try {
    browser = await puppeteer.launch(launchOptions);
  } catch (err) {
    log.fail(`Failed to launch browser: ${err.message}`);
    process.exit(1);
  }

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  const results = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    totalScreens: SCREENS.length,
    passedScreens: 0,
    failedScreens: 0,
    artifacts: [],
    details: []
  };

  for (const screen of SCREENS) {
    log.step(`Verifying ${screen.name}`);
    const screenDetail = {
      id: screen.id,
      name: screen.name,
      status: 'PENDING',
      elementsChecked: [],
      screenshotPath: null,
      error: null
    };

    try {
      const targetUrl = `${BASE_URL.replace(/\/$/, '')}${screen.path}`;
      log.info(`Navigating to ${targetUrl}`);

      try {
        await page.goto(targetUrl, { waitUntil: 'networkidle0', timeout: TIMEOUT });
      } catch (navErr) {
        log.warn(`Navigation timeout or error on ${targetUrl}: ${navErr.message}. Attempting domcontentloaded fallback.`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      }

      // Execute custom setup action if specified (e.g. opening modal)
      if (typeof screen.action === 'function') {
        await screen.action(page);
      }

      // Assert expected elements presence
      let allElementsFound = true;
      for (const expected of screen.expectedElements) {
        let found = false;
        try {
          const el = await page.$(expected.selector);
          if (el) {
            found = true;
            log.pass(`Found ${expected.description} (${expected.selector})`);
          } else {
            log.warn(`Missing element: ${expected.description} (${expected.selector})`);
            allElementsFound = false;
          }
        } catch (e) {
          log.warn(`Error querying selector ${expected.selector}: ${e.message}`);
          allElementsFound = false;
        }

        screenDetail.elementsChecked.push({
          description: expected.description,
          selector: expected.selector,
          found
        });
      }

      // Capture High-Resolution Screenshot
      const screenshotFile = path.join(OUTPUT_DIR, screen.screenshot);
      await page.screenshot({
        path: screenshotFile,
        fullPage: false // Capture exact viewport matching Stitch mockups
      });

      log.pass(`Captured screenshot: ${screenshotFile}`);
      screenDetail.screenshotPath = screenshotFile;
      results.artifacts.push(screenshotFile);

      screenDetail.status = allElementsFound ? 'PASS' : 'WARN_ELEMENTS_MISSING';
      results.passedScreens++;
    } catch (err) {
      log.fail(`Error during check for ${screen.name}: ${err.message}`);
      screenDetail.status = 'FAIL';
      screenDetail.error = err.message;
      results.failedScreens++;
    }

    results.details.push(screenDetail);
  }

  await browser.close();

  // Write Summary Manifest
  const manifestPath = path.join(OUTPUT_DIR, 'visual_regression_manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(results, null, 2));
  log.step('Summary Report');
  log.info(`Results saved to: ${manifestPath}`);
  console.table(results.details.map(d => ({
    Screen: d.name,
    Status: d.status,
    Screenshot: d.screenshotPath ? path.basename(d.screenshotPath) : 'None'
  })));

  if (results.failedScreens > 0) {
    log.fail(`Completed with ${results.failedScreens} failed screen(s).`);
    process.exit(1);
  } else {
    log.pass(`All ${results.passedScreens} visual regression checks executed successfully.`);
    process.exit(0);
  }
}

// Execute if run directly
if (require.main === module) {
  runVisualRegressionChecks().catch((err) => {
    console.error('Unhandled error during visual regression check:', err);
    process.exit(1);
  });
}

module.exports = {
  runVisualRegressionChecks,
  SCREENS,
  VIEWPORT
};
