# READ THIS FIRST — Apps Script Deployment Required

**This package changed `docs/apps-script-full-replacement.js`. You need to redeploy it.**

This is the direct, confirmed cause of the "header row showing in Milling
Operations" problem you're seeing right now — the fix for it (skip rows 1-3,
start reading at row 4) has been in this file for several packages already,
but a code fix in this zip does nothing to your live Google Sheet until you
manually redeploy it. There is no way for me to do this step for you.

## How to tell if you actually need to do this

Check every package going forward for this exact file at the top of my
message. If I say "Apps Script changed" — do the steps below. If I don't
mention it, skip this file entirely.

## Steps

1. Open your Google Sheet
2. **Extensions → Apps Script**
3. Select **all** existing code in the editor, delete it
4. Open `docs/apps-script-full-replacement.js` from this zip, copy its
   entire contents
5. Paste into the Apps Script editor, replacing everything
6. **Deploy → Manage deployments**
7. Click the **pencil/edit icon** on your existing deployment (do **not**
   click "New deployment" — that creates a different URL and breaks the
   app's connection until you update it in Sheet Sources)
8. Under **Version**, select **New version**
9. Click **Deploy**

## Also in this package: a one-time function to run

Separately from the redeploy above, this file now includes a function
called `ensureBackupSheetColumns` that adds missing columns to your backup
sheets automatically. This is **not** part of the redeploy step — after
redeploying, also do this once:

1. In the Apps Script editor, find the function dropdown at the top
   (near the Run/Debug buttons)
2. Select `ensureBackupSheetColumns`
3. Click **Run**
4. Check **View → Logs** (or Ctrl+Enter) to see what it did

Safe to run more than once — it only adds columns that don't already exist.
