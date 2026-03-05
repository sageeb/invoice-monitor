# Invoice Monitor — Setup Guide

A personal service that monitors Gmail for Hebrew invoices, extracts due dates and amounts using AI, and displays them in a web dashboard.

## How It Works

```
Gmail → [Google Apps Script] → [Google Sheet] → [Vercel Dashboard]
              ↓
        [Claude API for parsing]
```

1. **Google Apps Script** scans your Gmail every 4 hours for invoice-related emails
2. It extracts text from email bodies, PDF attachments, and invoice links
3. Sends the text to Claude AI to parse vendor name, amount, and due date
4. Writes structured data to a Google Sheet
5. A web dashboard reads from the Sheet and displays invoices sorted by urgency

---

## Prerequisites

- A Google account (Gmail)
- An Anthropic account with API key (console.anthropic.com)
- A GitHub account
- A Vercel account (vercel.com) — free tier

---

## Part 1: Anthropic API Key

1. Go to **console.anthropic.com** and sign in (or create an account)
2. Go to **Settings → API Keys → Create Key**
3. Name it `invoice-monitor`
4. Copy the key and save it somewhere — you'll need it in the next step
5. Add credit to your account (minimum $5). Actual cost will be a few cents/month.

---

## Part 2: Google Apps Script (Gmail Scanner)

### Step 2.1: Create a Google Sheet

1. Go to **sheets.google.com** and create a new blank spreadsheet
2. Name it `Invoice Monitor`
3. You don't need to add any columns — the script will create them automatically

### Step 2.2: Set Up Apps Script

1. In your new Google Sheet, go to **Extensions → Apps Script**
2. This opens the Apps Script editor

### Step 2.3: Add the Code Files

**Code.gs** (replace the default content):
1. Click on `Code.gs` in the left sidebar (it should already be there)
2. Select all (Ctrl+A / Cmd+A) and delete
3. Open the file `apps-script/Code.gs` from the project repo
4. Copy the entire contents and paste into the editor

**Parser.gs** (create new file):
1. Click the **+** button next to "Files" in the left sidebar
2. Select **Script**
3. Name it `Parser` (it will automatically add `.gs`)
4. Open the file `apps-script/Parser.gs` from the project repo
5. Copy the entire contents and paste into the editor

**appsscript.json** (update manifest):
1. Click the **gear icon** (Project Settings) in the left sidebar
2. Check the box: **Show "appsscript.json" manifest file in editor**
3. Go back to the Editor (code icon in sidebar)
4. Click on `appsscript.json` in the Files list
5. Replace its entire contents with the content from `apps-script/appsscript.json` in the repo
6. Save (Ctrl+S / Cmd+S)

### Step 2.4: Set Your API Key

1. Click the **gear icon** (Project Settings) in the left sidebar
2. Scroll down to **Script Properties**
3. Click **Add script property**
4. Set:
   - **Property:** `CLAUDE_API_KEY`
   - **Value:** paste your Anthropic API key from Part 1
5. Click **Save script properties**

### Step 2.5: Test the Setup

1. In the editor, select **testParser** from the function dropdown (top bar, next to Run/Debug)
2. Click **Run** (the play button ▶)
3. On first run, it will ask you to authorize permissions:
   - Click **Review permissions**
   - Choose your Google account
   - You'll see a warning: "Google hasn't verified this app" — this is normal for personal scripts
   - Click **Advanced** → **Go to [project name] (unsafe)**
   - Click **Allow**
4. Check the **Execution log** at the bottom — you should see:
   ```
   Test result: {"vendor":"חברת חשמל לישראל","amount":450,"currency":"ILS","dueDate":"2026-04-15"}
   ```

### Step 2.6: Run the First Scan

1. Select **scanGmail** from the function dropdown
2. Click **Run**
3. Wait for it to complete (may take a few minutes)
4. Check your Google Sheet — you should see an "Invoices" tab with any found invoices
5. A "Config" tab will also be created to track processed emails

### Step 2.7: Enable Automatic Scanning

1. Select **setupTrigger** from the function dropdown
2. Click **Run**
3. It may ask for additional permissions — authorize them
4. The scanner will now run automatically every 4 hours

### Step 2.8: Customize (Optional)

In `Code.gs`, you can customize:

- **SEARCH_KEYWORDS** (line ~19): Add or remove keywords that identify invoices in your email
- **EXCLUDE_KEYWORDS** (line ~30): Add keywords that should disqualify an email (e.g., shipping notifications, credit card charges)
- **SEARCH_QUERY_DAYS** (line ~45): How far back to search (default: 14 days)

---

## Part 3: Web Dashboard

### Step 3.1: Create a Google Cloud Service Account

The dashboard needs read/write access to your Google Sheet.

1. Go to **console.cloud.google.com**
2. Click the project dropdown (top left) → **New Project**
3. Name it `invoice-monitor` → **Create**
4. Make sure the new project is selected in the dropdown
5. Go to **APIs & Services → Library**
6. Search for **Google Sheets API** → click on it → **Enable**
7. Go to **APIs & Services → Credentials**
8. Click **Create Credentials → Service Account**
9. Name it `invoice-dashboard` → click **Done**
10. Click on the service account you just created
11. Go to the **Keys** tab
12. Click **Add Key → Create new key → JSON → Create**
13. A JSON file will download — keep it safe, you'll need it soon

### Step 3.2: Share Your Sheet with the Service Account

1. Open the downloaded JSON file in a text editor
2. Find the `client_email` field — it looks like `invoice-dashboard@your-project.iam.gserviceaccount.com`
3. Open your Google Sheet → click **Share**
4. Paste that email address → set to **Editor** → **Send**

### Step 3.3: Deploy to Vercel

1. Go to your fork/copy of the `invoice-monitor` repo on GitHub
   - If you don't have one, fork https://github.com/sageeb/invoice-monitor
2. Go to **vercel.com/new**
3. Click **Import** next to the `invoice-monitor` repo
4. Set **Root Directory** to `dashboard`
5. Before clicking Deploy, add **Environment Variables**:

| Variable | Value |
|----------|-------|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | The entire contents of the JSON key file (paste as a single line) |
| `GOOGLE_SHEET_ID` | The ID from your Sheet URL: `https://docs.google.com/spreadsheets/d/`**THIS_PART**`/edit` |
| `AUTH_TOKEN` | Pick any secret string — this is your dashboard password. Avoid special characters like `!` and `@` |

6. Click **Deploy**

### Step 3.4: Access Your Dashboard

1. Once deployed, Vercel will give you a URL (e.g., `invoice-monitor-xxx.vercel.app`)
2. Open it in your browser
3. Enter your `AUTH_TOKEN` value to sign in
4. You should see your invoices listed, sorted by due date

---

## Using the Dashboard

- **Color coding:**
  - 🔴 Red = overdue
  - 🟡 Yellow = due within 7 days
  - 🟢 Green = upcoming
  - ⚪ Gray = paid

- **Mark as paid:** Click the circle button on the right side of any invoice. This updates the Google Sheet directly.

- **Filters:** Use the Pending / All / Paid tabs at the top to filter invoices.

- **Refresh:** Click "Refresh" to fetch the latest data. The dashboard also auto-refreshes every hour.

- You can also mark invoices as paid directly in the Google Sheet by changing the Status column to `paid`.

---

## Troubleshooting

### Apps Script times out
The script has a 5-minute safety limit. If you have many unprocessed emails, it will stop and pick up where it left off on the next run. You can also run `scanGmail` manually multiple times.

### Invoices not detected
Add relevant keywords to `SEARCH_KEYWORDS` in `Code.gs`. Check the Execution log for details on what was processed.

### Unwanted emails being processed
Add exclusion keywords to `EXCLUDE_KEYWORDS` in `Code.gs`.

### Dashboard shows "Unauthorized"
Make sure your `AUTH_TOKEN` env var in Vercel matches what you're entering. Avoid special characters like `!` and `@` in the token.

### Dashboard shows no invoices
- Verify the `GOOGLE_SHEET_ID` is correct
- Verify the service account email has Editor access to the Sheet
- Check Vercel Function logs for errors
