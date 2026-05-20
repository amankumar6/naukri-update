# Naukri Profile Auto-Update Bot

Automatically keeps your Naukri.com profile marked as "recently updated" so it shows up in front of recruiters — without you having to log in manually every day.

It runs **completely free on GitHub Actions** (no server, no cron job on your laptop, no need to keep your machine on). By default it runs **3 times a day at 9 AM, 1 PM, and 6 PM IST**.

## What it does

On each run, the bot:

1. Loads your Naukri session from saved cookies (stored as a GitHub Secret).
2. Opens your profile page.
3. Clicks the basic-details edit icon and immediately clicks **Save** — this is what bumps the "Profile last updated" timestamp to today.
4. Re-uploads your resume from the `resume/` folder — this bumps the "Resume last updated" timestamp.
5. Closes the browser and exits.

If anything fails, a screenshot is saved and uploaded as an artifact on the GitHub Actions run so you can see what went wrong.

## Why cookies (not password)?

Naukri's anti-bot system blocks password logins coming from datacenter IPs (GitHub Actions, AWS, GCP, Azure — basically any cloud). It returns a generic *"Something went wrong. Please try again."* error even when your credentials are correct.

The fix: log in once on your normal computer (residential IP, which Naukri trusts), export your session cookies, and the bot replays them instead of logging in. Naukri can't bot-detect what doesn't happen.

**Tradeoff:** cookies typically expire after ~30 days. When that happens, the bot will fail and you'll need to re-export cookies (a 2-minute task). The README shows you how.

## Project structure

```
naukri-update/
├── .github/workflows/naukri-update.yml   # GitHub Actions schedule + workflow
├── resume/
│   └── aman_resume_backend.pdf           # The resume file the bot uploads
├── naukri-update.js                      # Main Puppeteer script
├── package.json
├── .env.example                          # Template for local testing
├── .gitignore
└── README.md
```

## Setup

### 1. Push this repo to GitHub

If you haven't already:

```bash
cd /Users/wizard/Desktop/kiro/naukri-update
git init
git add .
git commit -m "Initial commit: Naukri auto-update bot"
git branch -M main
git remote add origin https://github.com/<your-username>/naukri-update.git
git push -u origin main
```

The `resume/` folder **does** get committed (the bot needs it). The `.env` file does **not** — it's gitignored.

### 2. Export your Naukri session cookies

You'll do this once on your normal browser (the one Naukri trusts).

1. **Install the Cookie-Editor extension** in Chrome / Edge / Brave / Firefox:
   - Chrome: <https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm>
   - Firefox: <https://addons.mozilla.org/firefox/addon/cookie-editor/>
2. **Log into Naukri** at <https://www.naukri.com> (use Google sign-in or password — whichever works for you). Confirm you can see your profile while logged in.
3. **While on naukri.com**, click the Cookie-Editor extension icon in your toolbar.
4. Click the **Export** icon (looks like an outgoing arrow, usually at the bottom of the popup).
5. Choose **Export as JSON**. The cookies are now copied to your clipboard.

The JSON should look something like this (heavily abbreviated):

```json
[
  {"name":"nauk_at","value":"...","domain":".naukri.com","path":"/","secure":true,"httpOnly":true,"expirationDate":1234567890},
  {"name":"_t_us","value":"...","domain":".naukri.com",...}
]
```

### 3. Add the cookies as a GitHub Secret

On GitHub, go to your repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Name             | Value                                           |
| ---------------- | ----------------------------------------------- |
| `NAUKRI_COOKIES` | Paste the entire JSON array from your clipboard |

Click **Add secret**. The value is encrypted at rest and never appears in logs.

> **Tip:** if your repo is configured to require an "Environment" before adding secrets, just create one (any name like `production` works) and proceed. It doesn't affect functionality.

### 4. Trigger the workflow once manually to verify

GitHub → **Actions** tab → **Naukri Profile Auto-Update** → **Run workflow** (the manual `workflow_dispatch` trigger).

Watch the logs. On success you'll see `All steps completed successfully ✅`. Check your Naukri profile — both the "profile last updated" and "resume last updated" timestamps should show today.

After this, the schedule takes over and runs automatically.

## Refreshing cookies (when they expire)

When the bot fails with `Cookie session is invalid or expired`, it means Naukri logged your browser session out. To refresh:

1. Re-export cookies from your browser (same steps as setup step 2).
2. Update the `NAUKRI_COOKIES` secret on GitHub (Settings → Secrets and variables → Actions → click `NAUKRI_COOKIES` → **Update secret** → paste the new JSON).
3. Re-run the workflow manually to confirm it's working again.

This usually needs to happen every 3–4 weeks. If you log into Naukri occasionally on your normal browser anyway, the session refreshes itself and the cookies stay alive longer.

## Modifying the schedule

The schedule is defined in `.github/workflows/naukri-update.yml`:

```yaml
on:
  schedule:
    - cron: "30 3 * * *"   # 09:00 IST
    - cron: "30 7 * * *"   # 13:00 IST
    - cron: "30 12 * * *"  # 18:00 IST
```

**GitHub Actions cron is in UTC**, so to get IST you subtract 5h30m:

| IST   | UTC   | Cron expression |
| ----- | ----- | --------------- |
| 08:00 | 02:30 | `30 2 * * *`    |
| 09:00 | 03:30 | `30 3 * * *`    |
| 11:00 | 05:30 | `30 5 * * *`    |
| 13:00 | 07:30 | `30 7 * * *`    |
| 15:00 | 09:30 | `30 9 * * *`    |
| 18:00 | 12:30 | `30 12 * * *`   |
| 21:00 | 15:30 | `30 15 * * *`   |
| 23:00 | 17:30 | `30 17 * * *`   |

To add a new run time, just add another `- cron:` line. Commit and push — GitHub picks up the new schedule automatically.

> **Note:** Scheduled GitHub Actions can be delayed by 5–15 minutes during peak load. That's fine for this use case.

## Replacing the resume

Drop a new file into the `resume/` folder, delete the old one, commit, and push:

```bash
git add resume/
git commit -m "Update resume"
git push
```

The script picks the **first non-hidden file** in `resume/`, regardless of name or extension.

## Running locally

You have two options for local testing:

**Option A — with cookies (matches production behavior):**

```bash
npm install
# Save the cookie JSON to a file
echo '<paste your cookie JSON here>' > cookies.json
NAUKRI_COOKIES="$(cat cookies.json)" npm start
```

`cookies.json` is gitignored.

**Option B — with email + password (only works from your home network):**

```bash
npm install
cp .env.example .env
# Edit .env, fill in NAUKRI_EMAIL and NAUKRI_PASSWORD, leave NAUKRI_COOKIES blank
npm start
```

Both options use the same `resume/` folder and produce the same result. Failure screenshots go to `screenshots/` (gitignored).

To watch the browser visually while debugging, change `headless: 'new'` to `headless: false` in `naukri-update.js`.

## Troubleshooting

**`Cookie session is invalid or expired`**
Your saved cookies are no longer valid. Re-export them from your browser and update the `NAUKRI_COOKIES` secret. See "Refreshing cookies" above.

**Run failed and the failure screenshot shows `Something went wrong. Please try again.`**
That's Naukri's bot-detection rejection message. It means the bot tried to log in with email+password from a datacenter IP. Make sure you've set `NAUKRI_COOKIES` in repo secrets (cookies bypass this entirely).

**The workflow runs but my profile timestamp didn't update.**
Open the failed run's logs and download the `failure-screenshots` artifact to see what the page looked like when it failed.

**Selectors changed.**
Naukri occasionally tweaks their DOM. If `.icon.edit`, `#saveBasicDetailsBtn`, or `.dummyUpload.typ-14Bold` stop working, open the profile in your browser, inspect the equivalent element, and update the selector in `naukri-update.js`.

**GitHub Actions usage limits.**
Public repos get unlimited free Actions minutes. Private repos get 2,000 free minutes/month — this bot uses ~1 minute per run × 3 runs/day × 30 days ≈ **90 minutes/month**, well within the free tier.

## Security notes

- Cookies are as sensitive as your password — anyone with them can act as you on Naukri. Treat the `NAUKRI_COOKIES` secret with the same care.
- Never paste cookies into a public chat, screenshot, or commit them to a file.
- The `.env` and `cookies.json` files are gitignored — don't disable that.
- If you suspect a cookie leak: log out of Naukri on all devices (this invalidates all sessions), log back in, and re-export fresh cookies into the secret.
