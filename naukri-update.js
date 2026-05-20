/**
 * Naukri Profile Auto-Update Bot
 *
 * Authentication: prefers cookie-based session (NAUKRI_COOKIES env var, JSON string).
 * Falls back to password login (NAUKRI_EMAIL/NAUKRI_PASSWORD) only for local use —
 * Naukri's anti-bot blocks password login from datacenter IPs (GitHub Actions etc.).
 *
 * Run locally with cookies:
 *   NAUKRI_COOKIES="$(cat cookies.json)" npm start
 *
 * Run locally with password (fallback):
 *   NAUKRI_EMAIL=... NAUKRI_PASSWORD=... npm start
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');

// --- Config ---------------------------------------------------------------

const LOGIN_URL = 'https://www.naukri.com/nlogin/login';
const PROFILE_URL = 'https://www.naukri.com/mnjuser/profile?id=&altresid';
const HOME_URL = 'https://www.naukri.com';
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

/**
 * Normalize cookies exported from Cookie-Editor (or similar Chrome extensions)
 * into the shape Puppeteer's setCookie() expects.
 */
function normalizeCookies(rawCookies) {
  if (!Array.isArray(rawCookies)) {
    throw new Error('Cookies must be a JSON array.');
  }

  const sameSiteMap = {
    no_restriction: 'None',
    none: 'None',
    lax: 'Lax',
    strict: 'Strict',
  };

  return rawCookies
    .map((c) => {
      if (!c || !c.name || c.value === undefined) return null;

      const out = {
        name: c.name,
        value: String(c.value),
        domain: c.domain || undefined,
        path: c.path || '/',
        secure: Boolean(c.secure),
        httpOnly: Boolean(c.httpOnly),
      };

      // Only set expires for non-session cookies; Puppeteer wants seconds (Unix epoch)
      if (c.expirationDate && !c.session) {
        out.expires = Math.floor(c.expirationDate);
      }

      // Map sameSite if present and supported
      if (c.sameSite) {
        const mapped = sameSiteMap[String(c.sameSite).toLowerCase()];
        if (mapped) out.sameSite = mapped;
      }

      return out;
    })
    .filter(Boolean);
}

// --- Auth strategies ------------------------------------------------------

async function loginWithCookies(page, cookiesJson) {
  log('Authenticating with cookies…');

  let raw;
  try {
    raw = JSON.parse(cookiesJson);
  } catch (err) {
    throw new Error(
      'NAUKRI_COOKIES is not valid JSON. Re-export from your browser extension.'
    );
  }

  const cookies = normalizeCookies(raw);
  if (cookies.length === 0) {
    throw new Error('NAUKRI_COOKIES contains no usable cookies.');
  }
  log(`Loaded ${cookies.length} cookies.`);

  // Navigate to the domain first so cookies attach to the right context,
  // then set them, then go to the actual profile.
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
  await page.setCookie(...cookies);

  // Verify by hitting the profile page — if the session is bad, Naukri redirects
  // back to /nlogin/login.
  await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

  const url = page.url();
  log(`Post-cookie URL: ${url}`);
  if (url.includes('/nlogin/login') || url.includes('/login')) {
    await takeScreenshot(page, 'cookie-auth-failed');
    throw new Error(
      'Cookie session is invalid or expired. Re-export cookies from your browser ' +
        'and update the NAUKRI_COOKIES secret.'
    );
  }
  log('Cookie authentication successful.');
}

async function loginWithPassword(page, email, password) {
  log('Authenticating with email/password (local fallback)…');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

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

  await emailInput.click({ clickCount: 3 });
  await emailInput.type(email, { delay: 30 });
  await passwordInput.click({ clickCount: 3 });
  await passwordInput.type(password, { delay: 30 });

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

  const currentUrl = page.url();
  log(`Post-login URL: ${currentUrl}`);
  if (currentUrl.includes('/nlogin/login')) {
    await takeScreenshot(page, 'login-failed');
    throw new Error(
      'Password login failed (still on login page). On GitHub Actions this is ' +
        'expected — Naukri blocks logins from datacenter IPs. Use NAUKRI_COOKIES instead.'
    );
  }
  log('Password login successful.');
}

// --- Steps ----------------------------------------------------------------

async function editAndSaveProfile(page) {
  log('Navigating to profile page…');
  await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });

  // Give the SPA a moment to hydrate
  await new Promise((r) => setTimeout(r, 3000));

  log('Waiting for edit icon (.icon.edit)…');
  await page.waitForSelector('.icon.edit', { timeout: SELECTOR_TIMEOUT, visible: true });

  log('Clicking edit icon…');
  await page.$$eval('.icon.edit', (els) => els[0] && els[0].click());

  log('Waiting for save button (#saveBasicDetailsBtn)…');
  await page.waitForSelector('#saveBasicDetailsBtn', {
    timeout: SELECTOR_TIMEOUT,
    visible: true,
  });

  log('Clicking save button…');
  await page.click('#saveBasicDetailsBtn');

  await new Promise((r) => setTimeout(r, 5000));
  log('Basic details saved.');
}

async function uploadResume(page) {
  const resumePath = findResumeFile();
  log(`Uploading resume: ${resumePath}`);

  if (!page.url().includes('/mnjuser/profile')) {
    await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await new Promise((r) => setTimeout(r, 3000));
  }

  log('Waiting for resume upload trigger (.dummyUpload.typ-14Bold)…');
  await page.waitForSelector('.dummyUpload.typ-14Bold', {
    timeout: SELECTOR_TIMEOUT,
  });

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

  if (!uploaded) {
    log('No file input in DOM; falling back to file chooser…');
    const [fileChooser] = await Promise.all([
      page.waitForFileChooser({ timeout: SELECTOR_TIMEOUT }),
      page.click('.dummyUpload.typ-14Bold'),
    ]);
    await fileChooser.accept([resumePath]);
    uploaded = true;
  }

  log('Waiting for upload to complete…');
  await new Promise((r) => setTimeout(r, 8000));
  log('Resume upload finished.');
}

// --- Main -----------------------------------------------------------------

(async () => {
  const cookiesJson = process.env.NAUKRI_COOKIES;
  const email = process.env.NAUKRI_EMAIL;
  const password = process.env.NAUKRI_PASSWORD;

  const hasCookies = Boolean(cookiesJson && cookiesJson.trim());
  const hasPassword = Boolean(email && password);

  if (!hasCookies && !hasPassword) {
    console.error(
      'ERROR: No credentials provided. Set NAUKRI_COOKIES (preferred) or ' +
        'NAUKRI_EMAIL + NAUKRI_PASSWORD (local fallback only — blocked on GitHub Actions).'
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

  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  );

  let exitCode = 0;
  try {
    if (hasCookies) {
      await loginWithCookies(page, cookiesJson);
    } else {
      await loginWithPassword(page, email, password);
    }
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
