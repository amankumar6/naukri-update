/**
 * Naukri Profile Auto-Update Bot
 *
 * Logs into Naukri, clicks the profile edit icon, saves basic details (which updates
 * the "last updated" timestamp), and re-uploads the resume from the /resume folder.
 *
 * Run locally:   NAUKRI_EMAIL=... NAUKRI_PASSWORD=... node naukri-update.js
 * Or via .env:   create .env (see .env.example), then `npm start`
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// --- Config ---------------------------------------------------------------

const LOGIN_URL = 'https://www.naukri.com/nlogin/login';
const PROFILE_URL = 'https://www.naukri.com/mnjuser/profile?id=&altresid';
const RESUME_DIR = path.join(__dirname, 'resume');
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

const NAV_TIMEOUT = 60_000;       // 60s for page navigations (Naukri can be slow)
const SELECTOR_TIMEOUT = 30_000;  // 30s for individual elements

// --- Helpers --------------------------------------------------------------

function log(msg) {
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] ${msg}`);
}

function findResumeFile() {
  if (!fs.existsSync(RESUME_DIR)) {
    throw new Error(`Resume folder not found: ${RESUME_DIR}`);
  }
  const files = fs
    .readdirSync(RESUME_DIR)
    .filter((f) => !f.startsWith('.')) // ignore hidden files like .DS_Store
    .map((f) => path.join(RESUME_DIR, f))
    .filter((p) => fs.statSync(p).isFile());

  if (files.length === 0) {
    throw new Error(`No resume file found in ${RESUME_DIR}`);
  }
  // Pick the first file regardless of name/extension
  return files[0];
}

async function takeScreenshot(page, label) {
  try {
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(SCREENSHOT_DIR, `${label}-${ts}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    log(`Saved screenshot: ${filePath}`);
  } catch (err) {
    log(`Failed to take screenshot: ${err.message}`);
  }
}

/**
 * Try a list of selectors in order; return the first one that resolves.
 * Throws if none match within the timeout.
 */
async function waitForAnySelector(page, selectors, timeout = SELECTOR_TIMEOUT) {
  const start = Date.now();
  const interval = 500;

  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      const el = await page.$(sel);
      if (el) return { element: el, selector: sel };
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(
    `Timed out waiting for any of: ${selectors.join(', ')} (after ${timeout}ms)`
  );
}

// --- Steps ----------------------------------------------------------------

async function login(page, email, password) {
  log('Navigating to login page…');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

  log('Waiting for login form…');
  // Naukri occasionally tweaks selectors; try the common ones.
  const emailSelectors = [
    'input[placeholder*="Email" i]',
    'input[type="text"][name="email"]',
    '#usernameField',
    'input[type="email"]',
  ];
  const passwordSelectors = [
    'input[type="password"]',
    'input[placeholder*="Password" i]',
    '#passwordField',
  ];

  const { element: emailInput } = await waitForAnySelector(page, emailSelectors);
  const { element: passwordInput } = await waitForAnySelector(page, passwordSelectors);

  log('Filling credentials…');
  await emailInput.click({ clickCount: 3 });
  await emailInput.type(email, { delay: 30 });
  await passwordInput.click({ clickCount: 3 });
  await passwordInput.type(password, { delay: 30 });

  log('Submitting login form…');
  // Submit either by clicking the Login button or pressing Enter
  const submitSelectors = [
    'button[type="submit"]',
    'button.loginButton',
    'button.btn-primary',
  ];
  let submitted = false;
  for (const sel of submitSelectors) {
    const btn = await page.$(sel);
    if (btn) {
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
          .catch(() => null),
        btn.click(),
      ]);
      submitted = true;
      break;
    }
  }
  if (!submitted) {
    await passwordInput.press('Enter');
    await page
      .waitForNavigation({ waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT })
      .catch(() => null);
  }

  // Verify login: the URL should have changed away from /nlogin/login
  const currentUrl = page.url();
  log(`Post-login URL: ${currentUrl}`);
  if (currentUrl.includes('/nlogin/login')) {
    await takeScreenshot(page, 'login-failed');
    throw new Error(
      'Login appears to have failed (still on login page). ' +
        'Check credentials, or Naukri may be showing a captcha/2FA.'
    );
  }
  log('Login successful.');
}

async function editAndSaveProfile(page) {
  log('Navigating to profile page…');
  await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

  // Give the SPA a moment to hydrate
  await new Promise((r) => setTimeout(r, 3000));

  log('Waiting for edit icon (.icon.edit)…');
  await page.waitForSelector('.icon.edit', { timeout: SELECTOR_TIMEOUT, visible: true });

  log('Clicking edit icon…');
  // There may be multiple `.icon.edit` on the page; the first one is the basic-details edit
  await page.$$eval('.icon.edit', (els) => els[0] && els[0].click());

  log('Waiting for save button (#saveBasicDetailsBtn)…');
  await page.waitForSelector('#saveBasicDetailsBtn', {
    timeout: SELECTOR_TIMEOUT,
    visible: true,
  });

  log('Clicking save button…');
  await page.click('#saveBasicDetailsBtn');

  // Wait for the save to complete — the modal usually closes; give it some time.
  await new Promise((r) => setTimeout(r, 5000));
  log('Basic details saved.');
}

async function uploadResume(page) {
  const resumePath = findResumeFile();
  log(`Uploading resume: ${resumePath}`);

  // Make sure we're on the profile page (in case prior step navigated away)
  if (!page.url().includes('/mnjuser/profile')) {
    await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await new Promise((r) => setTimeout(r, 3000));
  }

  log('Waiting for resume upload trigger (.dummyUpload.typ-14Bold)…');
  await page.waitForSelector('.dummyUpload.typ-14Bold', {
    timeout: SELECTOR_TIMEOUT,
  });

  // The dummy upload button has an associated <input type="file"> nearby (usually #attachCV).
  // Approach 1: target the file input directly.
  const fileInputSelectors = [
    '#attachCV',
    'input[type="file"][name="attachCV"]',
    'input[type="file"]',
  ];

  let uploaded = false;
  for (const sel of fileInputSelectors) {
    const input = await page.$(sel);
    if (input) {
      log(`Found file input: ${sel}`);
      await input.uploadFile(resumePath);
      uploaded = true;
      break;
    }
  }

  // Approach 2: fall back to filechooser API if no input found in DOM yet
  if (!uploaded) {
    log('No file input in DOM; falling back to file chooser…');
    const [fileChooser] = await Promise.all([
      page.waitForFileChooser({ timeout: SELECTOR_TIMEOUT }),
      page.click('.dummyUpload.typ-14Bold'),
    ]);
    await fileChooser.accept([resumePath]);
    uploaded = true;
  }

  // Wait for upload to complete. Naukri shows a success message; give generous time.
  log('Waiting for upload to complete…');
  await new Promise((r) => setTimeout(r, 8000));
  log('Resume upload finished.');
}

// --- Main -----------------------------------------------------------------

(async () => {
  const email = process.env.NAUKRI_EMAIL;
  const password = process.env.NAUKRI_PASSWORD;

  if (!email || !password) {
    console.error(
      'ERROR: NAUKRI_EMAIL and NAUKRI_PASSWORD env vars are required. ' +
        'Set them in a .env file (local) or as GitHub Secrets (CI).'
    );
    process.exit(1);
  }

  log('Launching browser…');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1366,768',
    ],
    defaultViewport: { width: 1366, height: 768 },
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(SELECTOR_TIMEOUT);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);

  // Realistic user agent helps avoid simple bot checks
  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  let exitCode = 0;
  try {
    await login(page, email, password);
    await editAndSaveProfile(page);
    await uploadResume(page);
    log('All steps completed successfully ✅');
  } catch (err) {
    console.error(`Run failed: ${err.message}`);
    await takeScreenshot(page, 'failure');
    exitCode = 1;
  } finally {
    await browser.close();
    log('Browser closed.');
    process.exit(exitCode);
  }
})();
