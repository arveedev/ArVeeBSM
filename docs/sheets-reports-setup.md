# Daily Inventory + Age Monitoring — setup guide

Two brand-new, separate Google Sheets. Neither ever writes to your existing
production spreadsheet (DATA_ENTRY/AI/backup sheets) — both only read from
it. This is exactly what lets you compare their tallies against your
existing working data as a sanity check.

**Set up Age Monitoring first** — Daily Inventory now depends on it. QA's
variety→category map and stock counts (warehouse + variety + age + net
bags) are entered exactly once, in the Age Monitoring spreadsheet, and
Daily Inventory reads that same data directly instead of asking for any of
it again. Neither spreadsheet reads from the production spreadsheet's
`SETUP_AGE_MONITORING` sheet anymore.

## 1. Age Monitoring spreadsheet (set this up first)

1. Create a new blank Google Sheet. Name it **"Age Monitoring (v2)"**.
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
5. Add a **Config** tab with:
   - `B1` = URL of your existing production spreadsheet
   - `B2` = monitoring start date (e.g. `2026-05-01`)
   - `B3` = comma-separated admin emails allowed to generate the report
6. Reload — a **⏳ Age Monitoring** menu appears. Click **⛳ Initialize Setup
   Sheet** once — creates **SETUP** (variety→category map — a real
   Palay/Rice dropdown, fill in every variety code your warehouses use)
   and **QA_AGE_SUBMISSIONS**.
7. **Before generating the first report**, click **📋 Bulk Import Latest
   Known Stock** and paste in QA's CURRENT, already-known stock count -
   built to accept data close to how QA's own QUASAR report already
   shows it: one line per `Warehouse, Variety, Age Bracket, Net Kilos,
   Net Bags` (fill in exactly one of the last two per line). **A
   warehouse+variety with stock in several age brackets needs one line
   per bracket** - e.g. BSI LIBON's PDs might have separate lines for
   `9.1-10.0`, `10.1-11.0`, and `12.1-13.0` - each is kept as its own
   entry, never collapsed into a single number. Age Bracket spacing is
   normalized automatically, so you can paste close to the report's own
   formatting ("9.1 -   10.0" and "9.1-10.0" both match). Set **As Of
   Date** to the report's real date, not today. This is the step that
   makes the very first report start from QA's real, already-known data
   instead of every combination defaulting to a pure elapsed-time-since-
   receipt guess - do this once as part of setup, not as an ongoing
   monthly task. **This same data is what Daily Inventory reads for its
   starting balances** - nothing needs to be entered twice.
8. Each month after that, QA (or anyone — not admin-gated) opens **📝
   Submit Stock Age** to add or correct individual warehouse/variety/age-
   bracket readings as they're physically re-checked (one bracket per
   submission, same as the bulk form).
9. An admin clicks **✅ Generate/Update Report** whenever an updated report
   is wanted. This is intentionally manual, not on a daily trigger — age
   only meaningfully changes once QA submits new numbers, so there's
   nothing new to compute in between submissions.

## 2. Daily Inventory spreadsheet

1. Create a second new blank Google Sheet. Name it **"Daily Inventory
   (v2)"**.
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
     leave both blank to run around the clock instead. See step 6 below.
   - `B6` = the URL of the Age Monitoring spreadsheet from Part 1 above.
     **Required** — this spreadsheet has no SETUP sheet of its own
     anymore; variety mapping and starting balances both come from there.
   - `B7` = optional update frequency in minutes — must be exactly one of
     `1`, `5`, `10`, `15`, or `30` (Apps Script's own constraint on a
     minutes-based trigger; anything else is ignored and it defaults to
     `5`). Leave blank for the default. **Changing B7 only takes effect
     the next time you click "Install Auto-Update"** — editing the cell
     alone doesn't reach a trigger that's already installed.
4. Reload the spreadsheet — a **🌾 GSR Daily Inventory** menu appears.
5. Click **🚀 Update Now**. Approve the authorization prompt (it now needs
   permission to read TWO other spreadsheets — the production one and the
   Age Monitoring one). This creates the month sheets, **SUMMARY**, and
   **MONTHLY** tabs.
6. Click **⏰ Install Auto-Update (Config!B7 interval)** once. From then
   on it updates itself automatically at whatever interval `Config!B7`
   specifies — no further action needed. To change the frequency later,
   edit `Config!B7` and click this again (it reinstalls the trigger using
   the new value; it doesn't apply on its own).

   **About the quota**: consumer Google accounts get roughly 90 minutes
   of total trigger execution time per day; at 5-minute intervals that's
   288 firings/day. If you set `Config!B4`/`B5` (e.g. `8` and `18`), the
   trigger still fires every interval around the clock, but outside that
   window it does nothing but check the time and return — essentially
   free — so only the real syncs during your active hours (120 of them,
   for an 8 AM–6 PM window at the 5-minute default) count meaningfully
   against the quota. Since every real run recomputes the running total
   from `Config!B2`'s start date forward (not just what's new), those
   runs will still get slower as the season's data grows — if updates
   seem to have stalled, check **Executions** in the Apps Script editor's
   left sidebar first. If runs are consistently slow even within your
   active window, raise `Config!B7` to `15` or `30` and reinstall the
   trigger rather than losing updates to the quota. Manual **🚀 Update
   Now** clicks always work regardless of the active-hours window or
   `Config!B7`.
7. Compare its numbers against your existing working spreadsheet's
   equivalent tallies. They should match; if they don't, the alert dialog
   from step 5/6 will already have told you why (unmapped variety, a
   duplicate source row, or a month whose sheet went missing).

## What's admin-gated vs. not

- **Daily Inventory**: only admins (Config!B3) can click "Update Now" or
  install/remove the auto-update trigger. The trigger itself, once
  installed by an admin, keeps running under that admin's authorization
  automatically.
- **Age Monitoring**: only admins can click "Generate/Update Report" —
  matches your requirement that report *generation* is admin-only. QA's
  stock-count *submission* (single or bulk) is deliberately left open to
  QA staff, since gating that too would defeat the point of QA being able
  to update it — and since Daily Inventory now reads that same data, an
  admin never has to touch it either.

## About column lookup

Both scripts resolve every production-sheet column by **header name**,
not position, using real confirmed headers from both sheets:

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

## About the shared QA data (one entry point, not two)

There is now exactly **one place** variety categories and stock counts get
entered: the Age Monitoring spreadsheet's **SETUP** and
**QA_AGE_SUBMISSIONS** sheets. Daily Inventory reads both directly
(`Config!B6`), the same cross-spreadsheet pattern both scripts already use
to read your production `AI`/`DATA_ENTRY` sheets — nothing gets typed
twice.

- **SETUP** (Age Monitoring spreadsheet): variety→category map, a real
  Palay/Rice dropdown. Used by both reports.
- **QA_AGE_SUBMISSIONS** (Age Monitoring spreadsheet): Warehouse, Variety,
  Age Bracket, Net Kilos (optional), Net Bags, Submission Date, Submitted
  By. A row is uniquely identified by **Warehouse + Variety + Age Bracket
  + month** - NOT just Warehouse + Variety - because a real warehouse+
  variety routinely has stock in several age brackets simultaneously (a
  real QUASAR report was the reason this changed from a single Age/Net
  Bags number per warehouse+variety). Age Bracket is a dropdown matching
  QUASAR's own labels ("0-1.0", "1.1-2.0", ... up to 60 months out); each
  bracket's midpoint is its representative age wherever a single number
  is needed. Net Bags is auto-computed from Net Kilos (÷50) whenever
  Kilos is filled in, so you can paste straight from a kilogram-based
  report without converting by hand.
  - Every qualifying entry (see below) seeds this report's starting-
    inventory baseline, one entry per bracket. QA data no longer
    overrides the age of an individual existing receipt row - with
    multiple brackets per warehouse+variety there's no single
    unambiguous age left to anchor one receipt to, so receipts are
    always aged by elapsed time since their own receipt date instead.
  - Daily Inventory only uses entries that (a) include a Net Bags value
    and (b) are dated ON OR BEFORE its own `Config!B2` start date — a
    submission dated after that would double-count against receipts
    already flowing through `DATA_ENTRY` for that same period. Each
    entry's age at Daily Inventory's start date is projected forward
    from its bracket's midpoint and its own submission date. If a
    warehouse+variety+bracket has no qualifying submission, its
    contribution is simply 0 — nothing is guessed or fabricated.

## About UNWITHDRAWN (Daily Inventory)

Between BEGINNING INVENTORY and Day 1, the start month shows one row per
customer-type category (`UNWITHDRAWN - FTI`, `UNWITHDRAWN - LGU`,
`UNWITHDRAWN - OTHER`) plus an `AVAILABLE BEGINNING INVENTORY` row that
Day 1 actually starts from — authorities (`AI` rows) issued shortly
before `Config!B2` that haven't been physically withdrawn yet (per
`Issues Backup`) still count as committed stock, so they're deducted
before Day 1's activity begins. Scoped to `[Config!B2 - 30 days,
Config!B2]` specifically — no later (already covered by the normal day-
by-day ledger) and not further back (avoids ancient/stale authorities
piling up as noise). Categorized by a substring match on the AI row's
customer name (`FTI`, `LGU` — also matches `BLGU` — with `OTHER` as an
explicit catch-all so nothing is ever silently dropped). Same manual/
auto checkbox as Beginning Inventory governs all of these rows together.

## If something looks wrong

Every run's alert dialog (or, for the automated auto-trigger, the Apps
Script execution log under **Executions** in the left sidebar) explicitly
lists:
- unmapped varieties (add them to the Age Monitoring spreadsheet's SETUP
  tab — it's shared by both reports — before the numbers can be trusted)
- duplicate source rows that were found and removed, or flagged for
  manual verification when no trustworthy reference number was available
- for Age Monitoring, FIFO shortfalls — an issuance larger than the
  recorded stock in its age bucket, which usually means the source AI/
  DATA_ENTRY data itself needs a look

None of these fail silently anymore — that was the core problem with the
scripts you were already running.
