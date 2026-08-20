# Daily Inventory + Age Monitoring — setup guide

Two brand-new, separate Google Sheets. Neither ever writes to your existing
production spreadsheet (DATA_ENTRY/AI/backup sheets) — both only read from
it. This is exactly what lets you compare their tallies against your
existing working data as a sanity check.

Both spreadsheets now own their own, fully self-contained config — neither
one reads from the production spreadsheet's `SETUP_AGE_MONITORING` sheet at
all anymore.

## 1. Daily Inventory spreadsheet

1. Create a new blank Google Sheet. Name it something like **"Daily
   Inventory (v2)"**.
2. Extensions > Apps Script. Delete the default `Code.gs` content and paste
   in [`daily-inventory-report-script.js`](daily-inventory-report-script.js).
3. Back in the spreadsheet, add a tab named exactly **Config** with:
   - `B1` = the URL of your existing production spreadsheet (this script
     only ever reads its `AI` and `DATA_ENTRY` sheets — nothing else)
   - `B2` = the date to start accounting from (e.g. `2026-05-01`)
   - `B3` = comma-separated admin emails allowed to run/install the sync
     (e.g. `arvee.dev.apps@gmail.com`)
   - `B4`, `B5` = optional active-hours window for the auto-trigger, e.g.
     `8` and `18` to only actually sync between 8 AM and 6 PM (GMT+8) —
     leave both blank to run around the clock instead. See step 7 below.
4. Reload the spreadsheet — a **🌾 GSR Daily Inventory** menu appears.
5. Click **⛳ Initialize Setup Sheet** once. This creates this spreadsheet's
   own **SETUP** tab — fill in every variety code your warehouses use
   (Palay/Rice), and optionally a one-time starting balance per
   warehouse+variety+age if you're not starting from zero. This SETUP tab
   is completely local to this spreadsheet.
6. Click **🚀 Update Now**. Approve the authorization prompt (it needs
   permission to read the other spreadsheet). This creates the month
   sheets, **SUMMARY**, and **MONTHLY** tabs.
7. Click **⏰ Install Auto-Update (every 5 min)** once. From then on it
   updates itself automatically every 5 minutes — no further action
   needed.

   **About the quota**: consumer Google accounts get roughly 90 minutes
   of total trigger execution time per day; at 5-minute intervals that's
   288 firings/day. If you set `Config!B4`/`B5` (e.g. `8` and `18`), the
   trigger still fires every 5 minutes around the clock, but outside that
   window it does nothing but check the time and return — essentially
   free — so only the real syncs during your active hours (120 of them,
   for an 8 AM–6 PM window) count meaningfully against the quota. Since
   every real run recomputes the running total from `Config!B2`'s start
   date forward (not just what's new), those runs will still get slower
   as the season's data grows — if updates seem to have stalled, check
   **Executions** in the Apps Script editor's left sidebar first. If runs
   are consistently slow even within your active window, switch the
   trigger to `.everyMinutes(15)` or `.everyMinutes(30)` in
   `installDailyTrigger()` rather than losing updates to the quota.
   Manual **🚀 Update Now** clicks always work regardless of the active-
   hours window.
8. Compare its numbers against your existing working spreadsheet's
   equivalent tallies. They should match; if they don't, the alert dialog
   from step 6/7 will already have told you why (unmapped variety, a
   duplicate source row, or a month whose sheet went missing).

## 2. Age Monitoring spreadsheet

1. Create a second new blank Google Sheet. Name it **"Age Monitoring
   (v2)"**.
2. Extensions > Apps Script. Paste in
   [`age-monitoring-report-script.js`](age-monitoring-report-script.js).
3. Add a new HTML file (Files > + > HTML) named exactly **AgeSubmissionForm**
   and paste in the body of
   [`age-submission-form.html`](age-submission-form.html) (skip the leading
   HTML comment block — that part is just setup notes for you, not for the
   file itself).
4. Add a second HTML file named exactly **BulkAgeImportForm** and paste in
   the body of
   [`age-bulk-import-form.html`](age-bulk-import-form.html) (same — skip
   the leading comment block).
5. Add a **Config** tab, same as above: `B1` = production spreadsheet URL,
   `B2` = monitoring start date, `B3` = admin emails.
6. Reload — a **⏳ Age Monitoring** menu appears. Click **⛳ Initialize Setup
   Sheet** once — creates **SETUP** (variety→category map, fill in every
   variety code your warehouses use) and **QA_AGE_SUBMISSIONS**.
7. **Before generating the first report**, click **📋 Bulk Import Latest
   Known Ages** and paste in QA's CURRENT, already-known age reading for
   every warehouse+variety you have (one per line: `Warehouse, Variety, Age
   in months`). This is the step that makes the very first report start
   from QA's real, already-known data instead of every combination
   defaulting to a pure elapsed-time-since-receipt guess — do this once as
   part of setup, not as an ongoing monthly task.
8. Each month after that, QA (or anyone — not admin-gated) opens **📝
   Submit Monthly Ages** to correct individual warehouse/variety readings
   as they're physically re-checked.
9. An admin clicks **✅ Generate/Update Report** whenever an updated report
   is wanted. This is intentionally manual, not on a daily trigger — age
   only meaningfully changes once QA submits new numbers, so there's
   nothing new to compute in between submissions.

## What's admin-gated vs. not

- **Daily Inventory**: only admins (Config!B3) can click "Update Now" or
  install/remove the daily trigger. The trigger itself, once installed by
  an admin, keeps running under that admin's authorization automatically.
- **Age Monitoring**: only admins can click "Generate/Update Report" —
  matches your requirement that report *generation* is admin-only. QA's
  age *submission* (single or bulk) is deliberately left open to QA staff,
  since gating that too would defeat the point of QA being able to update
  it.

## About column lookup

Both scripts resolve every source column by **header name**, not position,
using real confirmed headers from both sheets:

- `DATA_ENTRY`: Timestamp, Date, Transaction, Variety, Bags, Net Kilos,
  Warehouse Name, Customer Name, Province, Net Bags, WH Code, WSR #,
  WSI #, AGE, Age Unit, Last Modified.
- `AI`: DATE (2026) — note the year is embedded in this header and will
  change every January; both scripts match it by prefix ("DATE...") so
  this doesn't need updating each year — AI #, NAME OF CUSTOMER, ISSUING
  WHSE, VARIETY CODE, BAG, NET KG, TRANSACTION, AUTHORITY, OR No., Note1,
  Note2, Age Group, Last Modified.

`AI #` and `WSR #`/`WSI #` are real unique reference numbers, so matches
on those are genuinely trustworthy and get actually removed as
duplicates. Any row that somehow has none of those (shouldn't normally
happen) falls back to a value-based composite key, which is NOT trusted
enough to auto-remove — it's only ever reported as "possible duplicate,
verify against the sheet" so a value coincidence (e.g. two separate
authorities issued the same day for the same amount) can never be
silently deleted.

## About the two SETUP sheets

Each new spreadsheet has its own **SETUP** tab, fully local, no
dependency on the production spreadsheet's `SETUP_AGE_MONITORING`:

- **Daily Inventory's SETUP**: variety→category map (required for every
  variety you use), plus an optional one-time starting-balance block —
  only ever consulted for the very first sync of a brand-new
  warehouse+variety+age combination; after that the hidden STATE sheet is
  always the source of truth and SETUP's starting balances are never
  re-read for that combination.
- **Age Monitoring's SETUP**: variety→category map only. Actual ages come
  from QA_AGE_SUBMISSIONS (seeded via bulk import, corrected monthly via
  the single-row form), never from a hand-maintained balance number.

## If something looks wrong

Every run's alert dialog (or, for the automated daily trigger, the Apps
Script execution log under **Executions** in the left sidebar) explicitly
lists:
- unmapped varieties (add them to that spreadsheet's own SETUP tab before
  the numbers can be trusted)
- duplicate source rows that were found and removed, or flagged for
  manual verification when no trustworthy reference number was available
- for Age Monitoring, FIFO shortfalls — an issuance larger than the
  recorded stock in its age bucket, which usually means the source AI/
  DATA_ENTRY data itself needs a look

None of these fail silently anymore — that was the core problem with the
scripts you were already running.
