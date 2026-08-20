# Daily Inventory + Age Monitoring — setup guide

Two brand-new, separate Google Sheets. Neither ever writes to your existing
production spreadsheet (DATA_ENTRY/AI/backup sheets) — both only read from
it. This is exactly what lets you compare their tallies against your
existing working data as a sanity check.

## 1. Daily Inventory spreadsheet

1. Create a new blank Google Sheet. Name it something like **"Daily
   Inventory (v2)"**.
2. Extensions > Apps Script. Delete the default `Code.gs` content and paste
   in [`daily-inventory-report-script.js`](daily-inventory-report-script.js).
3. Back in the spreadsheet, add a tab named exactly **Config** with:
   - `B1` = the URL of your existing production spreadsheet
   - `B2` = the date to start accounting from (e.g. `2026-05-01`)
   - `B3` = comma-separated admin emails allowed to run/install the sync
     (e.g. `arvee.dev.apps@gmail.com`)
4. Reload the spreadsheet — a **🌾 GSR Daily Inventory** menu appears.
5. Click **🚀 Update Now** once. Approve the authorization prompt (it needs
   permission to read the other spreadsheet). This creates the month
   sheets, **SUMMARY**, and **MONTHLY** tabs.
6. Click **⏰ Install Daily Auto-Update** once. From then on it updates
   itself automatically every day around 2 AM — no further action needed.
7. Compare its numbers against your existing working spreadsheet's
   equivalent tallies. They should match; if they don't, the alert dialog
   from step 5/6 will already have told you why (unmapped variety, a
   duplicate source row, or a month whose sheet went missing).

## 2. Age Monitoring spreadsheet

1. Create a second new blank Google Sheet. Name it **"Age Monitoring
   (v2)"**.
2. Extensions > Apps Script. Paste in
   [`age-monitoring-report-script.js`](age-monitoring-report-script.js).
3. Add a new HTML file (Files > + > HTML) named exactly **AgeSubmissionForm**
   and paste in the body of
   [`age-submission-form.html`](age-submission-form.html) (skip the leading
   HTML comment block, that part is just setup notes for you, not for the
   file itself).
4. Add a **Config** tab, same as above: `B1` = production spreadsheet URL,
   `B2` = monitoring start date, `B3` = admin emails.
5. Reload — a **⏳ Age Monitoring** menu appears. Click **⛳ Initialize Setup
   Sheet** once — creates **SETUP** (variety→category map, fill in every
   variety code your warehouses use) and **QA_AGE_SUBMISSIONS**.
6. Each month, QA (or anyone, not admin-gated) opens **📝 Submit Monthly
   Ages** and enters the physically observed age per warehouse + variety.
7. An admin clicks **✅ Generate/Update Report** whenever an updated report
   is wanted. This is intentionally manual, not on a daily trigger — age
   only meaningfully changes once QA submits new numbers, so there's
   nothing new to compute in between submissions.

## What's admin-gated vs. not

- **Daily Inventory**: only admins (Config!B3) can click "Update Now" or
  install/remove the daily trigger. The trigger itself, once installed by
  an admin, keeps running under that admin's authorization automatically.
- **Age Monitoring**: only admins can click "Generate/Update Report" —
  matches your requirement that report *generation* is admin-only. QA's
  monthly age *submission* is deliberately left open to QA staff, since
  gating that too would defeat the point of QA being able to update it.

## About column lookup

Both scripts resolve every column by **header name**, not position, using
real confirmed headers from both sheets:

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

## If something looks wrong

Every run's alert dialog (or, for the automated daily trigger, the Apps
Script execution log under **Executions** in the left sidebar) explicitly
lists:
- unmapped varieties (add them to SETUP before the numbers can be trusted)
- duplicate source rows that were found and ignored
- for Age Monitoring, FIFO shortfalls — an issuance larger than the
  recorded stock in its age bucket, which usually means the source AI/
  DATA_ENTRY data itself needs a look

None of these fail silently anymore — that was the core problem with the
scripts you were already running.
