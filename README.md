# Naukri Profile Auto-Update Bot

Automatically keeps your Naukri.com profile marked as "recently updated" so it shows up in front of recruiters — without you having to log in manually every day.

It runs **completely free on GitHub Actions** (no server, no cron job on your laptop, no need to keep your machine on). By default it runs **3 times a day at 9 AM, 1 PM, and 6 PM IST**.

## What it does

On each run, the bot:

1. Logs into Naukri using credentials stored as GitHub Secrets.
2. Opens your profile page.
3. Clicks the basic-details edit icon and immediately clicks **Save** — this is what bumps the "Profile last updated" timestamp to today.
4. Re-uploads your resume from the `resume/` folder — this bumps the "Resume last updated" timestamp.
5. Closes the browser and exits.

If anything fails, a screenshot is saved and uploaded as an artifact on the GitHub Actions run so you can see what went wrong.

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

The `resume/` folder **does** get committed (the bot needs it to be in the repo so GitHub Actions can read it). The `.env` file does **not** — it's gitignored.

### 2. Add your Naukri credentials as GitHub Secrets

On GitHub, go to your repo → **Settings → Secrets and variables → Actions → New repository secret**, and add:

| Name              | Value                       |
| ----------------- | --------------------------- |
| `NAUKRI_EMAIL`    | Your Naukri login email     |
| `NAUKRI_PASSWORD` | Your Naukri login password  |

These are encrypted at rest and never appear in logs.

### 3. Trigger the workflow once manually to verify

GitHub → **Actions** tab → **Naukri Profile Auto-Update** → **Run workflow** (the manual `workflow_dispatch` trigger).

Watch the logs. On success you'll see `All steps completed successfully ✅`. Then check your Naukri profile — both timestamps should show today.

After this, the schedule takes over and runs automatically.

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

To add a new run time, just add another `- cron:` line. To remove one, delete the line. Commit and push — GitHub picks up the new schedule automatically.

> **Note:** Scheduled GitHub Actions can be delayed by 5–15 minutes during peak load. That's fine for this use case.

## Replacing the resume

Drop a new file into the `resume/` folder, delete the old one, commit, and push:

```bash
# place your new resume file in resume/, then:
git add resume/
git commit -m "Update resume"
git push
```

The script just picks the **first non-hidden file** in `resume/`, regardless of name or extension — so you don't need to rename anything.

## Running locally (optional, for testing)

```bash
# 1. Install dependencies
npm install

# 2. Create a .env file from the template
cp .env.example .env
# then edit .env with your real credentials

# 3. Run
npm start
```

Local runs use the same script and the same `resume/` folder. Screenshots on failure go to `screenshots/` (gitignored).

To watch the browser visually while debugging, change `headless: 'new'` to `headless: false` in `naukri-update.js`.

## Troubleshooting

**The workflow runs but my profile timestamp didn't update.**
Open the failed run's logs and download the `failure-screenshots` artifact to see what the page looked like when it failed.

**Login failed — Naukri may be showing a captcha/2FA.**
This is the one scenario this bot can't get around automatically. If Naukri starts requiring a captcha or 2FA on every login, you'll need to log into Naukri manually once from the same network/IP profile, or the bot needs to be reworked to use a saved session cookie. Watch the screenshot artifact to confirm.

**Selectors changed.**
Naukri occasionally tweaks their DOM. If `.icon.edit`, `#saveBasicDetailsBtn`, or `.dummyUpload.typ-14Bold` stop working, open the profile in your browser, inspect the equivalent element, and update the selector in `naukri-update.js`.

**GitHub Actions usage limits.**
Public repos get unlimited free Actions minutes. Private repos get 2,000 free minutes/month — this bot uses ~1 minute per run × 3 runs/day × 30 days ≈ **90 minutes/month**, well within the free tier.

## Security notes

- Your password lives only in GitHub Secrets (encrypted, not visible in logs).
- The `.env` file is gitignored — don't commit one with real credentials.
- If you ever want to rotate the password: change it on Naukri, then update the `NAUKRI_PASSWORD` secret in your repo settings.
