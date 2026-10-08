# Daily Inventory and Age Monitoring: Feasibility Check

Status: READ-ONLY STUDY. No app code was changed. No live data was read or
written. All numbers come from a **copy** of the 2026-10-08 backup export
(5,101,579 bytes, 6,227 records) analysed offline in a scratch folder.

## 1. Your question: "we already have Date Received"

Partly. There are two different things with similar names:

| Field | What it holds | Usable for age? |
|-------|---------------|-----------------|
| "Date Received (optional)" / "Date Procured" on a pile and on each By-Products line (`dateProcured`) | Free text, e.g. `MAR 24 TO APR 4, 2025`, `May, 2026` | Only if the text can be read as a date |
| Pile `dateOfReceipt` and each balance line's "As of" | A real date | Yes, but it is the date the pile started or the balance was taken, not always when the grain was received |

Measured on the backup:
- All 77 piles have a real `dateOfReceipt`.
- 47 of 77 piles have `dateProcured` text. A simple reader understands 35 of
  those 47 (for example `May 25, 2026`, `August 17-18, 2026`). It fails on
  month-only text such as `NOVEMBER, 2025` and `May, 2026` unless a rule is added.
- Of 62 beginning-balance lines (seeds), 37 have readable date text and 25 do not.

**Conclusion:** a new field is probably not needed in Phase 0. The age anchor
for stock that existed before the app can be:
1. the readable date in "Date Received" on that line or pile (for a range such
   as `MAR 24 TO APR 4, 2025`, the **first** date: March 24, the first delivery),
2. otherwise the pile's real `dateOfReceipt`,
3. and every line that fell to step 2 is listed in the Check panel as
   "approximate", so you can fix the text on that pile.

Month-only text (`May, 2026`): the **1st** of that month.

This text is used **only** for beginning-balance lines (stock that existed
before the app, or typed override balances). Every receipt entered in the app
from September 1 ages from its own receipt date, one lot per receipt.

## 2. Age arithmetic: answered by your script

Your age-monitoring script converts time to months with **30.44 days per
month**. The new reports will use the same, so a lot crosses a bracket on the
same day as in your Sheet. (The earlier question about 30 vs 30.4375 is closed.)

## 3. Can the lot calculation work on real data? (dry run on the backup copy)

The dry run rebuilt each pile's lots oldest-first, using the app's own rules:
beginning balances always count, other transactions count only after the
warehouse's (or global) Reports Start Date, and transfers count on both sides.

| Check | Result |
|-------|--------|
| Piles | 77 |
| Piles where the lots' ending bags equal the app's current pile bags | **76 of 77** |
| Piles where an issue was larger than the lots on record | 3 |
| WSR / WSI with no pile assigned (sheet-imported, awaiting completion) | 2,074 |
| ...of those dated after the warehouse's start date (would count in stock) | **1** (one WSI, ALB-BSI B, 178 bags) |
| Transfers (WTS) in the data | 2, both within the same pile (repiling) |
| Transfers where bags/kilos differ between issued and received | 0 |
| Active transactions | 3,438 (WSR 2,844 / WSI 398 / ESR 107 / ESI 87 / WTS 2) |

What this means:
- The method **reproduces the app's existing pile balances** on 76 of 77 piles.
  The 77th and the 3 "issue larger than lots" piles are real data gaps that the
  app today silently floors to zero (examples: TABACO GID A Pile 1 has 5,658 bags
  in and 5,724 bags out). The new Check panel will list them; they are not bugs
  in the method.
- The 2,074 unassigned receipts/issues are almost all dated before each
  warehouse's start date, so they do not affect stock. The one that does (the
  WSI of 178 bags in ALB-BSI B) is the one to review, and may be the ghost
  document you are already deleting.
- With only 2 transfers so far, "lots keep their original date on transfer"
  has little real data to test against. It will be tested with generated cases.
- Data volume is small (about 3,400 transactions). One read and one pass is
  well under a second even on an old PC; no per-pile database queries are needed.

## 4. Things that exist already and can be reused

- `signatories` table (5 rows): holds warehouse supervisor "capacity" and
  "certified correct position". It does **not** hold the milling signatories
  (Milling Supervisor, Accountant III, BSQAO, Engineer III, Acting Branch
  Manager). Those are new settings.
- `ricemillAllocations` and the milling-order records exist (for example
  `AO-2026-06-45`, `millingInputCapacityBags`), so the milling liquidation can
  read milling orders. Unit prices per ricemill are new settings.
- Transactions already carry `varietyId`, sack type and condition, so lot
  variety and sack weight come from the transaction itself (needed for
  by-products piles that mix varieties).
- Province comes from each warehouse's `provinceId`, so no hand-kept province map.

## 5. What could break, and how each is prevented

| Risk | Prevention |
|------|------------|
| Writing to live data | The calculation and every report screen only **read** (`toArray`, `get`). No `put`, `add`, `update`, `delete`, `bulkPut` anywhere in the report code. Checked by code search before each release. |
| Schema change on a synced database | None planned for Phases 1-5. Lots are computed, not stored. No new Dexie version. |
| New settings (prices, signatories, contractor, Cash in Bank province) | These are the only writes, and only when an admin saves them in settings. Stored as new optional fields on existing records (reportConfig and ricemill records), so older app versions ignore them. |
| Slow screens on old PCs | One pass over about 3,400 transactions, report screen lazy-loaded, no added work on Home until the icon is opened. Performance gate on a CPU-throttled browser before release. |
| Numbers that differ from your Sheet | Expected where the Sheet drifted. Phase 1 compares September against the pile balances and the Stock Statement, and lists every difference first. |
| Changing existing screens | New files only. The only edit to an existing file is adding the quiet icon to Admin/Visitor Home (one small component). |
| Excel export size | The Excel library is loaded only when Export is tapped. |
| Google Sheet export | Never writes to your current spreadsheet. First run goes to a copy; the script only receives numbers from the app. |
| Offline | Reports work offline (data is local). Google Sheet export waits for internet. |

## 6. Remaining unknowns (cannot be settled without building)

1. Real-world lot dates for pre-app piles where the text is missing or only a
   month: they fall back to the pile date and are flagged.
2. Behaviour on the first real transfer between two piles.
3. Whether the final numbers match your Sheet by bucket. This is the purpose of
   the Phase 1 comparison and of the one-month parallel run.

## 7. Verdict

**Feasible, with low risk to live data.** The method matches the app's current
balances on 76 of 77 piles, needs no schema change, and the only data writes
are explicit settings saves. Recommended start is Phase 1 (read-only
calculation and a test page) with no Phase 0 field, using the existing "Date
Received" text and the pile date as the age anchor.
