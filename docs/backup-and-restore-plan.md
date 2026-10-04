# BSM App — Backup and Restore Plan

**Status: PLAN ONLY. Nothing in this document has been built or changed in production.**
Each phase below needs explicit approval before it starts.

Last updated: 2026-10-04 (Option A chosen; gap recovery 8.7; retries, failed-restore behavior, Sheet reconciliation, monthly restore test and plain-language approvals added)

---

## 1. Purpose and promises

**Purpose.** If anything breaks, the owner can restore the system to a known-good state using
a backup that is complete, current, stored in three places, and proven to restore correctly.

**What the plan promises**

1. A backup runs **every day, automatically**, without any user device or the app being open.
2. Each backup contains **the whole Dexie Cloud database**: every table, the user and admin
   accounts, all settings, the schema, and the Dexie Cloud access setup (realms, roles, members).
3. Every backup is **kept forever** (nothing pruned), in **three places**: GitHub, Google Drive,
   and a file on the owner's PC.
4. Every backup is **verified** the moment it is made. A bad backup fails loudly and the last
   good copy is kept.
5. The owner is **told within a day** if a backup did not happen.
6. A restore is **rehearsed on a throwaway database** before the plan is relied on, and again
   on a regular schedule.
7. **Nothing in the daily backup can change or delete production data.** It only reads.

**What "everything" does not include** (these live outside Dexie Cloud and are covered by the
recovery runbook, not by the daily database backup)

| Item | Where it lives | How it is protected |
|---|---|---|
| App code | GitHub (`ArVeeBSM`) | Git history |
| Google Sheets (transaction log, authorities, report sheets) | Google Drive | Sheet version history + a scheduled copy exported to Drive (Phase 7) |
| Apps Script code | Google; copies in `docs/` | Kept as files in the repo |
| Vercel settings and secrets | Vercel dashboard | Listed in the runbook; secrets in the owner's password manager |
| Dexie / GitHub / Google credentials | Owner's accounts | Password manager + sealed copy; rotation steps in the runbook |
| Local caches (serial counters, milling-order cache, preload state) | Each device | Not backed up; the app rebuilds them. Rehearsal proves this (Section 9) |

---

## 2. Decisions already made

| Decision | Source |
|---|---|
| Use Dexie Cloud's own export and import for backup and restore | Owner, 2026-10-03 |
| Daily scheduled job; all three copies automatic | Owner, 2026-10-03 |
| Keep everything, including users and admin settings | Owner, 2026-10-03 |
| Restore is rehearsed before it is trusted | Owner, 2026-10-03 |
| Only the owner has access to the Dexie tools | Owner, 2026-10-03 |
| **Option A: keep each day's full official export, forever** | Owner, 2026-10-04 |
| Add gap recovery from devices (Section 8.7) to the plan | Owner, 2026-10-04 |
| The existing in-app daily backup stays running during the trial | Plan default |
| Nothing is built until each phase is approved | Owner, 2026-10-03 |

## 3. Backup format: DECIDED (Option A)

**Decision (2026-10-04): Option A, a daily full export kept forever.** The comparison below is kept for the record.

**Daily full copy, or master + change files?**

The whole database exports to about **0.6 MB zipped** (6.2 MB raw, 7,536 objects on 2026-10-03).
Keeping one full official export per day costs about **215 MB a year**.

| Option | How it works | Trade-off |
|---|---|---|
| **A. Daily full export (recommended first)** | Each day's official Dexie zip is kept as-is, forever | Directly restorable with Dexie's own tool. No custom merge code, so no custom bug. Costs about 215 MB a year. |
| **B. Master + daily change files** | One merged master that grows, plus small daily change files | Uses less space, but needs custom merge code, which is exactly where a mistake could hide in a backup you must trust. |

**Decided: Option A.** Option B can still be added later, on top of A, once A is proven.

---

## 4. What exists today, and the gaps

| Today | Gap |
|---|---|
| The app reads every table and sends a gzipped dump to a Vercel function, which commits plain JSON to the `backups` branch of the `ArVeeBSM` repo, once per 24 hours | Only runs when a logged-in device is open |
| The newest 30 files stay visible on the branch (older ones remain only in git history) | Not a real retention policy |
| The Admin → Backup panel has "Export All Data" | There is **no restore function** anywhere |
| Backups are produced from a device's local copy | A device may not hold every record; the server-side export is the authoritative source |
| Nobody is alerted if a backup stops | Silent failure is possible |
| Dexie access setup (roles, members) is not in the in-app export | Incomplete for a disaster |

**Verified on 2026-10-03:** `npx dexie-cloud export` ran with the existing credentials and
exported 7,536 objects (users, settings, signatories, `realms`, and all synced tables).
The test file was deleted straight away.

**Is the admin's own PC a complete backup? No.** The admin's PC holds a local copy of what it has
synced, and it is a good extra copy, but it is not guaranteed to be complete or current (a device can
lag, can be missing a table's recent changes, and the PC itself can fail). The **server-side export is
the authoritative complete copy** because it reads the cloud database directly. One database serves
every user (users, warehouses and transactions are all records in the same database), so restoring the
database restores **everyone's** data at once; there is no separate per-user restore.

---

## 5. Target design

```
                         every day, ~02:00 Philippine time
   Dexie Cloud  --->  GitHub Action (private repo "bsm-backups")
   (live DB,                |
   READ-ONLY)               |  1. export  (npx dexie-cloud export)
                            |  2. verify  (opens, tables present, counts, hash)
                            |  3. deliver to three places
                            v
        +-------------------+--------------------+
        |                   |                    |
     GitHub repo       Google Drive folder    PC copy
   (commit file +     (Apps Script upload)    (Drive for desktop
     manifest)                                 syncs the folder)
                            |
                            v
                  4. success ping to a monitor ("dead-man's switch")
                     no ping in ~26 h  ->  e-mail to the owner
```

**Why a GitHub Action.** It runs on GitHub's servers on a schedule, so it does not depend on the
app, Vercel, or any user device. If Vercel is down, the backup still runs.

**Why a separate private repository (`bsm-backups`).** Keeps backup history out of the code
repository, limits what the stored credential can reach, and lets backups be handled
independently of code changes.

---

## 6. Components

### 6.1 Backup credential (least privilege)

Dexie lets us create a service-account credential with chosen scopes:
`IMPERSONATE`, `ACCESS_DB`, `MANAGE_DB`, `GLOBAL_READ`, `GLOBAL_WRITE`, `DELETE_DB`.

- Create a **dedicated backup credential with `GLOBAL_READ` only** (add `ACCESS_DB` only if the
  export refuses to run without it).
- A leaked read-only credential could expose data but could not change or delete anything.
- **To be verified in Phase 1:** that an export works with the read-only credential.
- Never revoke or edit the existing app credentials. (Dexie requires at least one client with all
  scopes to remain.)

### 6.2 Secrets (stored as encrypted GitHub secrets, not files)

| Secret | Purpose |
|---|---|
| `DEXIE_DB_URL` | `https://zv432njdm.dexie.cloud` |
| `DEXIE_BACKUP_CLIENT_ID` / `DEXIE_BACKUP_CLIENT_SECRET` | The read-only backup credential |
| `DRIVE_UPLOAD_URL` / `DRIVE_UPLOAD_TOKEN` | The Apps Script endpoint and its shared token |
| `MONITOR_PING_URL` | The dead-man's-switch address |

At run time the job writes the two small Dexie files the CLI expects (`dexie-cloud.json`,
`dexie-cloud.key`) from these secrets, uses them, then deletes them.

### 6.3 Repository contents

```
bsm-backups/
  .github/workflows/daily-backup.yml    the schedule + steps
  scripts/verify-backup.mjs             completeness checks and manifest
  scripts/deliver-drive.mjs             upload to Google Drive
  backups/YYYY/bsm-YYYY-MM-DD.zip       the official export
  backups/YYYY/bsm-YYYY-MM-DD.manifest.json
  RESTORE.md                            short pointer to the runbook
```

### 6.4 The manifest (written for every backup)

- date/time, database URL, Dexie export version
- SHA-256 of the zip, size
- record count **per table** and total
- the list of tables present
- result of every verification check

### 6.5 Verification checks (a backup passes only if all pass)

1. The zip opens and `data.ndjson` parses end to end.
2. Every **required table** is present and non-empty: users, warehouses, transactions, piles,
   authorities, reportConfig, settings, signatories, provinces, branches, varietyTypes, sackTypes.
3. The access setup (realms) is present.
4. Total records have not dropped more than **10%** against the previous good backup
   (a sudden big drop means something is wrong). Smaller per-table decreases are logged as warnings
   because legitimate clean-ups do happen.
5. The SHA-256 recorded in the manifest matches the delivered files at all three destinations.

Thresholds are settings, adjustable after the first weeks of real data.

### 6.6 Delivery to the three places

| Copy | Mechanism | Automatic? |
|---|---|---|
| GitHub | The job commits the zip and manifest to `bsm-backups` | Yes |
| Google Drive | The job posts the file to the existing Apps Script web app, which saves it into a Drive folder | Yes |
| The owner's PC | Google Drive for desktop syncs that folder to the PC | Yes, whenever the PC is on and signed in; catches up on its own when it comes back |

For the PC copy, set the Drive folder to be kept on the PC ("mirror" rather than "stream"), so the
files really exist on the disk.

**Where the PC copy is.** The job does not push anything to the PC. It saves the zip and the manifest
into the Drive folder, and Drive for desktop copies that folder onto the PC, for example
`D:\BSM-Backups\` or the "My Drive" location, whichever is chosen at setup. So the PC holds the same
zip and manifest as GitHub and Drive.

**How the folders are known.** The app does not need to know any of this. The Drive folder is set once
inside the Apps Script (its folder ID), and the PC folder is set once in Drive for desktop. Nothing in the
app or the job needs the PC's path.

**To be verified in Phase 3:** the Apps Script upload path (request size is tiny, so this is
expected to work). A Google service account is the fallback.

### 6.7 Monitoring

- **Job failure:** GitHub e-mails the owner.
- **Silent stop** (GitHub stops running the schedule): a free dead-man's-switch service expects a
  ping after each successful run and e-mails the owner if none arrives within about 26 hours.
- A short weekly "backups are healthy" summary is optional.

### 6.8 Retention and growth

Nothing is deleted. About 0.6 MB per day today; roughly 215 MB per year, growing with the data.
Google Drive's free tier (15 GB) and a private GitHub repository can hold this for many years.
If a repository ever gets too large, older years move to an archive repository; nothing is lost.

---

## 7. The daily run, step by step

1. Scheduled start (about 02:00 Philippine time; GitHub may delay a scheduled run by minutes).
2. Create the two Dexie files from secrets.
3. `npx dexie-cloud export` → `bsm-YYYY-MM-DD.zip`.
4. Delete the credential files.
5. Run verification (Section 6.5). **If it fails: stop, do not overwrite anything, mark the run
   failed, send the alert.**
6. Commit zip + manifest to GitHub.
7. Upload zip + manifest to Google Drive.
8. Check the hash of what arrived at each destination.
9. Ping the monitor.

Each step reports what it did. A failure in any one step fails the whole run and names the step,
so one broken destination is never hidden by a success somewhere else.

### 7.1 Retries, catch-up, and what happens after an alert

- **Retries inside the run.** Each network step (export, GitHub commit, Drive upload) is retried up to
  **3 times** with increasing waits (for example 1, 5 and 15 minutes) before the step is called failed.
  Most failures are temporary (a network hiccup, a service briefly down) and clear on a retry.
- **A second scheduled attempt the same day.** If the 02:00 run fails or does not run, a **catch-up run**
  starts a few hours later and does the same job. The owner is alerted only if the catch-up also
  fails, so one bad night does not wake anyone.
- **If the catch-up fails too.** The alert says which step failed and why. Yesterday's good backups are
  untouched. The owner can start a run by hand from GitHub (the "Run workflow" button) once the cause
  is fixed, and the runbook lists the usual causes (an expired credential, a full Drive, a Dexie outage)
  and the fix for each.
- **The silent-stop alarm** (Section 6.7) is separate: if no success ping arrives for about 26 hours,
  the owner is e-mailed even when the job never ran at all.
- **Nothing fixes itself invisibly.** A retry that succeeds is recorded in the run log, so repeated
  retries are noticed and investigated.

---

## 8. Restore

### 8.1 Safety rules (non-negotiable)

- **Admin/owner only, from the owner's machine.**
- **Preview first.** A preview mode reads the backup and the live database and prints counts per
  table and the differences. It writes nothing.
- **A fresh safety export of the current state is taken automatically before any restore.**
- **Restoring into the live database requires typing a confirmation phrase.**
- **Rehearse on a throwaway database first.** Never rehearse on production.
- **Never delete or edit the old database** during a cutover. Keep it untouched until the new one
  is proven.
- **After every restore, run the count comparison** and keep its output.

### 8.1a Before any restore: the admin's checklist

1. **Decide the scenario** with Section 8.2 (what is actually wrong).
2. **Stop new entries** if possible: tell warehouse users to pause (or restore outside working hours).
   Entries made during a restore can be missed.
3. **Do not clear or reset any device.** No browser-data clearing, no app reinstall, no logging out to
   "fix" things. Those devices may hold the newest records (Section 8.7).
4. **Have the three things ready:** the Dexie manager e-mail (a one-time code is sent to it), the backup
   credential or the restore credential, and the chosen backup zip with its manifest.
5. **Check the backup first:** its date, its manifest, and that the hash matches. The restore scripts
   do this automatically and refuse a zip that fails.
6. **Write down the time** the restore starts, for the incident log.

### 8.1b If a restore fails: what reverts and what does not

Be clear about what each method can and cannot undo:

| Method | If it fails or the result is wrong |
|---|---|
| **R2: fresh database** | **Nothing to revert.** The live database was never touched. The script stops before the cutover and nothing is switched. If a problem appears after switching, point the system back at the old database. This is the cleanest and safest method, and the **default for anything serious**. |
| **R1: repair in place** | Dexie's import cannot be rolled back automatically, and it does not delete. The safety export taken just before is kept, and the script stops, reports what failed, and prints the safety file's path. Re-importing it puts back **changed** records but does **not** remove records the failed import added. For an exact return to the earlier state, use R2 with the safety export. |
| **R3: gap recovery** | Insert-only, so a wrong insert can be found from the list the script prints and removed record by record. The safety export is also available. |

So the answer is: **R2 reverts automatically by design (it never changed the old database);
R1 stops and gives you the safety export, but is not an automatic exact undo.**
For that reason, R1 is limited to small, understood problems, and anything doubtful goes through R2.

### 8.2 Which restore for which problem

| Situation | Method |
|---|---|
| Records are missing or wrong; the database is otherwise healthy | **R1. Repair in place** (additive import) |
| Serious damage, or the database is gone | **R2. Fresh database** (new database + cutover) |
| You need the state from an earlier date | Use that day's zip in R1 or R2 |
| The cloud database is lost and the newest records exist only on devices | **R3. Gap recovery from devices** (Section 8.7), done after R2 |
| Dexie is only down or unreachable | **Nothing to restore.** Devices keep working offline and sync when it returns |
| The app code is the problem | Vercel instant rollback (not a data restore) |

### 8.3 R1: Repair in place

Dexie's import is **additive**: it adds and updates and never deletes. So R1 repairs missing or
changed records. It **does not remove** extra bad records.

1. Take a fresh safety export (automatic in the restore script).
2. Choose the backup (latest, or a chosen date).
3. Run the **preview**. Review the differences.
4. Type the confirmation phrase.
5. `npx dexie-cloud import <zip>`.
6. Export again and compare counts for the restored tables.
7. Ask a user to refresh; spot-check a known record.

### 8.4 R2: Fresh database (exact copy)

1. Safety export of the current database if it is reachable.
2. Create a new database: `npx dexie-cloud create` (a one-time code is sent to the owner's e-mail).
3. Recreate the app credential with the same scopes as the current one
   (record the current scopes first, in Phase 0, with `npx dexie-cloud clients`).
4. Whitelist the app's address on the new database (to be confirmed in rehearsal).
5. `npx dexie-cloud import <zip>` into the new database (the zip carries schema, roles, members).
6. Point the system at the new database:
   - Vercel environment: database URL, client ID, client secret.
   - The app's database URL (see 8.5).
7. Redeploy; log in on one test device and check data and sync.
8. Tell the other devices to reload. **The rehearsal must prove how devices behave** when the
   database address changes (a device may need its local copy reset). Until it is proven, this step
   is not promised to work smoothly.
9. Keep the old database untouched.

### 8.5 The only production code change in this whole plan

The Dexie database address is **hard-coded** in the app (`src/db/dexie.js`). For a fast cutover it
should come from a setting instead, **defaulting to the current address**, so with no setting
changed the app behaves exactly as today. This is small and additive, but it touches production
code, so it has its own phase, gate, and rollback (Section 11, Phase 8).

### 8.6 Restore tooling

Two guarded scripts in the backup repository (run from the owner's PC):

- `restore-preview <zip>` — read-only comparison. Safe to run any time.
- `restore-apply <zip> [--into <db>]` — takes the safety export, prints the preview, asks for the
  typed phrase, imports, then verifies counts.

**One guided menu, not many commands.** A single command, `restore`, starts a guided menu. It asks
"what is wrong?" (the situations in Section 8.2), picks the matching procedure (R1, R2 or R3), runs
the checks in 8.1a, and walks through each step, pausing for the owner's confirmation at every step
that writes anything. The owner does not need to remember individual commands.

**Why it is not a button inside the app's Admin dashboard.** A restore needs powerful Dexie
credentials. Putting them inside the web app would make every admin login a possible path to the
whole database, which is the wrong trade for a rarely used action. The guided menu runs on the owner's
own PC. The Admin → Backup panel can still **show** the last backup time and result (read-only), which
is safe, and that display is an optional small addition.

**How much is automatic.** The checks, the safety export, the preview, the import, and the
verification are automatic. The owner's part is to decide the scenario, confirm each step, switch the
system to a new database in R2, and tell users to reload. Section 8.8 and the runbook list every step.

---

### 8.7 R3: Gap recovery from devices (merging device copies into a restored database)

**Why it exists.** Every daily backup is a complete snapshot, so the latest one already holds
everything up to that day. The only data it can miss is what was entered **after** the last backup.
If the cloud database is lost, that last day's data may exist only in the local copies on devices
(including entries made offline that never reached the cloud).

**What is NOT merged.** The three backup copies (GitHub, Google Drive, PC) are the same file, so
there is nothing to merge between them.

**Why it is not the normal import.** Dexie's import overwrites by record ID. A device that holds
an older version of a record could overwrite newer data. Gap recovery is therefore **insert-only**.

**Rules (non-negotiable)**

1. **Restore the latest good backup first (R2).** Gap recovery only ever runs on top of it.
2. **Insert-only.** A record is added only if its table and ID do not already exist in the restored
   database. An existing record is never overwritten.
3. **Transactional tables only.** Only records people enter day to day are eligible:
   `transactions`, `purchaseReceipts`, `cashLedgerV2`, `cashDenominationCounts`, `pileLayoutBoxes`
   and `pileLayoutHistory`. Configuration tables (users, settings, authorities, warehouses,
   varieties, prices, signatories and the like) are **never** merged, because a record that was
   legitimately removed after the backup, such as a clean-up of duplicate authorities, could come back.
   Transactions are never physically deleted (only cancelled), so merging them is safe.
4. **Conflicts are reported, not resolved.** If the same ID exists in both with different content,
   the script lists it for the owner to decide. It never picks a winner by itself.
5. **Preview first, typed confirmation, safety export before writing**, same as every restore.
6. **Derived values are recomputed afterward.** After the insert, pile balances, serial counters and
   authority issued totals are recalculated from the transactions (the app already has these
   recalculations), and the count and balance checks are re-run.
7. **Devices must not be wiped first.** The runbook says: do not clear browser data, reinstall the app,
   or log out and reset any device until gap recovery is finished.

**Steps**

1. Complete R2 (fresh database restored from the latest backup). Keep devices untouched.
2. On each device that was in use, run **Admin > Backup > Export All Data** (the existing button).
   Collect the files on the owner's PC. (Optionally, a small "export only what has not synced yet"
   option can be added later; it is not needed for the first version.)
3. Run `gap-preview <restored database> <device files...>`. For each device file it lists, per table,
   how many records exist on the device but not in the restored database, and any conflicts.
   It writes nothing.
4. Review. Decide which device files to apply and how to handle each conflict.
5. Run `gap-apply`. It takes the safety export, shows the preview again, asks for the typed
   phrase, inserts only the missing eligible records, then recomputes derived values.
6. Verify: counts, a spot-check of the recovered records, pile balances and next serial numbers, and
   confirm no duplicates.
7. Record the outcome in the runbook's incident log.

**When it is not needed.** If Dexie is merely down or unreachable, devices sync normally when it
returns and no merge is required. Gap recovery is only for the case where the cloud database was lost
and the most recent entries exist only on devices.

**Limits stated honestly.** A device may not hold every record, so its copy is a source of
*missing recent records*, never a replacement for the backup. Device copies cannot recover anything
from a device that was wiped or lost. The merge is only as good as what the devices still hold.

### 8.8 The Google Sheet after an export, restore, or gap recovery

The Google Sheet is a second record of every transaction. After any restore or gap recovery the
database and the Sheet can disagree, so the plan includes a **Sheet reconciliation**.

**What already exists.** Every transaction carries an `isSynced` flag. The app's background queue
re-sends any transaction with `isSynced` false to the Sheet about every 30 seconds, and keeps retrying
until it succeeds. The flag lives on the transaction record itself, so it is included in every backup
and every device export.

**What this means for each case**

- **Gap recovery (R3).** A transaction recovered from a device keeps the flag it had there. If it was
  never sent to the Sheet, it is flagged unsynced and the normal queue sends it automatically once the
  device is online. No special step is needed.
- **Restore (R1/R2).** The restored database comes back with each record's saved flag. A record the Sheet
  already has stays synced. A record that was newer than the backup is gone from the database but may
  still be on the Sheet (see below).
- **Reconciliation report (new, read-only).** After any restore, a script compares the transactions in
  the database with the rows in the Sheet by document type and serial number and reports:
  1. rows on the Sheet that the database does not have (usually records newer than the backup, which
     gap recovery can bring back);
  2. transactions the database has that the Sheet does not (these are re-queued for sync);
  3. rows where the two disagree.
  Nothing is changed by the report. Re-queueing (flagging unsynced) happens only after the owner approves
  the list, and only for transactions the Sheet really lacks, so the Sheet never receives duplicates.
- **Sheet protection.** The Sheet itself is exported to the Drive folder on a schedule (Phase 7), so a
  damaged Sheet can also be recovered.

**Verification (rehearsal).** Restore into the throwaway database, run the reconciliation against a copy
of the Sheet, and confirm that missing rows are found and that re-queueing does not create duplicates.

### 8.9 Working offline, authorities, and reconnecting

**How it works today (checked in the code).** A transaction stores the authority's number as text. When a
device is offline it can still record a transaction against an authority number it already has. If the
authority is not on that device yet, the transaction is saved anyway with the number, and the authority's
balance is simply not updated at that moment. When the device reconnects, the transaction syncs to the
cloud, and the authority totals are **recalculated from the actual transactions** (the sync does this on
every pass), so the link is restored automatically by the number. An authority that was issued after a
device went offline will not appear in that device's authority list until it syncs; the user can still type
the number, and the link forms on reconnect.

**What the plan adds.** After any restore, the authority totals are recalculated the same way, the
reconciliation in 8.8 is run, and the rehearsal checks that a transaction made against an authority
number links correctly after the restore.

---

## 9. Rehearsal (the proof)

Done on a **throwaway Dexie Cloud database and a Vercel preview deployment**, never production.

1. Create a throwaway database.
2. Import a real daily backup into it.
3. Compare record counts per table against the source. **Must match exactly.**
4. Compare a sample of records field by field (users, a transaction, a pile, a setting).
5. Point a preview copy of the app at it. Sign in with a PIN. Open Home, Piles and Reports.
6. Check that **suggested next serial numbers** are correct, **pile balances** match, and **no
   duplicate transactions** appeared (this exercises the rebuilt caches).
7. Check how a device that previously used the old database behaves when switched.
8. **Gap recovery rehearsal (R3):** on the throwaway database, restore an older backup, then use an
   Export All Data file from a device whose data is newer. Confirm that only the missing
   transactional records are inserted, that nothing existing is overwritten, that a deliberately
   planted conflict is reported and left alone, and that balances and serials are correct afterward.
9. Record the results and date in the runbook's rehearsal log.
10. Repeat after any major change, and at least every few months.

**Pass condition:** counts match, spot-checks match, sign-in works, balances and serials are right,
no duplicates, and the gap-recovery rehearsal inserted only what it should. If anything is off, the plan is fixed before it is relied on.

### 9.1 Does the rehearsal happen automatically when a restore starts?

**No. The rehearsal is practice done in advance**, on a throwaway database, so that a real restore is
not the first time anything is tried. A real restore does not run a rehearsal first. It does run its own
built-in safety steps every time: the backup check, the safety export, the preview, the typed
confirmation, and the count verification afterward. R2 additionally never touches the live database.

**What can be automated: a monthly restore test.** A scheduled job restores the latest backup into a
permanent scratch Dexie database, compares record counts per table, spot-checks records, and reports
the result. The owner is alerted if it ever fails. This proves **every month, without anyone remembering
to do it**, that the backups can really be restored. (Dexie's free tier allows several databases; the
scratch database is created once.) This is a new item, Phase 6b.

---

## 10. Protection from failure

| What could go wrong | Protection |
|---|---|
| The daily job fails | GitHub e-mail; yesterday's good backup remains |
| GitHub silently stops the schedule | Dead-man's-switch e-mail after ~26 h |
| A bad or short export | Verification fails the run; nothing is overwritten |
| One destination is down | Run fails and names the step; the other copies still exist |
| GitHub account lost | Drive and PC copies exist |
| Google account lost | GitHub and PC copies exist |
| PC lost | GitHub and Drive copies exist |
| Dexie Cloud data lost | Restore R2 from any of the three copies |
| Backup credential leaked | Read-only scope; stored as an encrypted secret; rotate with `npx dexie-cloud rotate` |
| Restore run against the wrong database | Preview, typed phrase, automatic safety export |
| Restore makes things worse | The safety export from just before it; the old database untouched in R2 |
| Newest records exist only on devices after the cloud is lost | R3 gap recovery (insert-only, transactional tables, conflicts reported) |
| Owner unavailable | The runbook, written so a colleague with admin access can follow it (decision on a second manager is the owner's) |

---

## 11. Rollout phases and gates

Production is only **read** until Phase 8. Each phase ends with a go / no-go.

| Phase | What | Touches production? | Gate |
|---|---|---|---|
| **0. Prepare** | Record the current Dexie clients and scopes (read-only). Decide Option A vs B. Choose the Drive folder and the monitor. | Read only | Decisions recorded |
| **1. Credential** | Create the read-only backup credential. Prove an export works with it. Delete the test file. | Read only | Export succeeds with `GLOBAL_READ` |
| **2. Repository + manual run** | Create `bsm-backups`, the workflow and verification script. Run once by hand. | Read only | Backup + manifest correct; verification catches a deliberately damaged copy |
| **3. Drive + PC** | Add the Drive upload. Install Drive for desktop; mirror the folder. | Read only | All three copies present with matching hashes |
| **4. Monitoring** | Add the dead-man's switch and failure alerts. Test by breaking a step on purpose. | Read only | Alerts arrive |
| **5. Rehearsal** | Throwaway database; full rehearsal (Section 9). | None | Pass condition met |
| **6. Schedule on** | Turn on the daily schedule. Run **alongside** the existing in-app backup for about a week. | Read only | 7 clean daily runs |
| **6b. Monthly restore test** | Create one scratch database. Add a monthly job that restores the latest backup into it and compares. | Read only (scratch DB only) | First monthly test passes; a deliberately broken backup is caught |
| **7. Restore tooling + runbook** | Write `restore-preview` and `restore-apply`; add the Sheets export to Drive; write the runbook. | None | Tooling rehearsed; runbook reviewed |
| **7b. Gap recovery tooling** | Write `gap-preview` and `gap-apply` (insert-only, transactional tables, conflict report). Rehearse as in Section 9, step 8. | None | Rehearsal passes; no existing record is ever overwritten |
| **7c. Sheet reconciliation tooling** | Write the read-only reconciliation report (8.8) and the approved re-queue step. Rehearse against a copy of the Sheet. | None | Report finds planted gaps; re-queue creates no duplicates |
| **8. Configurable database address** | The small code change in 8.5, defaulting to today's address. Preview deployment first. | **Yes (code)** | Behaves identically with no setting; cutover rehearsed; one-click rollback ready |
| **9. Retire old backup (optional)** | Decide whether to stop the in-app daily backup. | Code | Owner's decision, after weeks of clean runs |

**Rollback.** Phases 1–7 add things beside production and can be switched off by disabling the
workflow or deleting the new repository. Phase 8 is reverted by Vercel's instant rollback.

---

## 12. Security notes

- The key file (`dexie-cloud.key`) holds the credential for **two** databases: the live one
  (`zv432njdm`) and an older one that broke (`z15dzktxq`). Nothing uses the old one; remove its
  entry later, deliberately, not now.
- Never commit key files. Both are already excluded from git.
- The backup credential is read-only and separate from the app's credentials.
- Rotate credentials with `npx dexie-cloud rotate` (the old one keeps working for 7 days).
- The CLI signs in with a one-time code sent to the e-mail of an authorized manager (currently
  the owner's). Keep that mailbox secure and recoverable.

---

## 13. Things to verify first (stated honestly as unknowns)

1. That an export works with a `GLOBAL_READ`-only credential (Phase 1).
2. The Google Drive upload route through Apps Script (Phase 3).
3. How devices behave when the database address changes (Phase 5 / 8 rehearsal).
4. That the rebuilt caches give correct serials, balances and no duplicates after a restore
   (Phase 5).
5. Current free-tier limits of GitHub Actions and the monitoring service at setup time.
6. Whether Dexie requires whitelisting the app's address on a new database, and the exact step.
7. That a device's Export All Data file holds enough to identify records missing from the restored database (rehearsal, Section 9 step 8).
8. How many records a typical device really holds locally, so the limits of gap recovery are known in practice.

### How each unknown is verified, and who does it

You do not need to know how. Each is a small test that is run for you in the phase shown, and you
approve the result. None needs production to be changed.

| # | Plain-language question | How it is tested | Phase |
|---|---|---|---|
| 1 | Can the backup use a read-only key? | Create the key, run one export with it, check the file opens. If it refuses, add the next-smallest permission and record why. | 1 |
| 2 | Can the job put a file in the right Drive folder? | Upload a small test file from the job, confirm it appears and the hash matches. | 3 |
| 3 | What does a device do when the database address changes? | On a test browser profile that has used the old database, load the app pointed at a scratch database and observe whether it syncs, asks for a reset, or errors. See the note below. | 5 / 8 |
| 4 | Do serial numbers, balances and duplicates come out right after a restore? | Restore into the scratch database and compare against the source (Section 9). | 5 |
| 5 | Are the free limits (GitHub, monitoring) enough today? | Read each service's current limits at setup and compare with one run per day and the file size. | 2 / 4 |
| 6 | Does the new database need the app's address whitelisted? | Create the scratch database, try the app against it, and record the exact step. | 5 |
| 7 | Does a device export hold what is needed to find missing records? | Make an export on a real device, compare it with a database export, count the differences. | 5 / 7b |
| 8 | How much does a device actually hold? | Compare a device export with the full database export, table by table. | 5 |

**Note on #3: is it automatic?** Partly. The database address is part of the app code, so every device
receives the new address **automatically** when it loads the new version of the app after the redeploy
(the app updates itself when it is reopened). The address cannot be passed *through the old database*,
because that database is the thing that was lost. What is not yet known is how a device that already has a
local copy tied to the old database behaves with the new address. That is exactly what test #3 settles,
and it decides whether devices need a one-time reset, which is why gap recovery (Section 8.7) comes
before any reset.

---

## 14. Cost

| Item | Cost |
|---|---|
| GitHub private repository and Actions (a daily run takes a couple of minutes) | Free tier expected to be enough; confirm at setup |
| Google Drive (about 215 MB per year) | Free tier (15 GB) |
| Dead-man's-switch monitoring | Free tier expected |
| Dexie export / import | Included in the Dexie plan |

No new paid subscriptions are expected.

---

## 15. What this plan will not do

- It will not write to, edit, or delete production data in the daily run.
- It will not change the existing app credentials or revoke any client.
- It will not remove the existing in-app backup until you decide, after weeks of clean runs.
- It will not rehearse on production.
- Gap recovery will never overwrite an existing record, and will never merge configuration tables.
- It will not start any phase without your approval.

---

## 16. Approval checklist

- [x] Option A (daily full export), decided 2026-10-04
- [ ] Separate private repository `bsm-backups` approved?
- [ ] Read-only backup credential approved (Phase 1)?
- [ ] Google Drive folder chosen, and Drive for desktop to be installed on the owner's PC?
- [ ] Monitoring service approved (free tier)?
- [ ] Phase order and gates approved?
- [ ] Phase 8 code change (configurable database address) approved in principle?
- [ ] Gap recovery from devices (Section 8.7, Phase 7b) approved as described: insert-only, transactional tables, conflicts reported?

---

## 17. What each approval means (plain language)

| Item | What you are approving | What happens if you approve | What it does not do |
|---|---|---|---|
| **Option A** (already decided) | Keep one complete official export per day, forever | About 215 MB a year of storage, directly restorable | No custom merge code |
| **Separate private repository `bsm-backups`** | A new, private GitHub repository only for backups and the backup job | Backups and their history stay out of the app's code; the job's credential can reach only this repository | It does not change the app or its repository |
| **Read-only backup credential** | A new Dexie key that can only read the database | The daily job can read and copy the data but never change or delete it | It does not replace or alter the app's existing keys |
| **Drive folder and Drive for desktop** | A Google Drive folder for the backups, and installing Google's Drive app on your PC | The second copy is on Drive and the third copy appears on your PC automatically | The app does not need to know the folder; nothing is deleted |
| **Monitoring service (free tier)** | A small free service that expects a "success" message after each backup and e-mails you if none arrives | You find out within about a day if backups silently stop | It does not see your data, only a ping |
| **Phase order and gates** | The 10 phases and the rule that each ends with your go or no-go | Nothing is built or switched on without your approval; production is only read until Phase 8 | It does not start any phase on its own |
| **Phase 8 code change** | Making the database address a setting that defaults to today's address | A fast cutover to a new database becomes possible; with no setting changed, the app behaves exactly as today | It will not be released without a preview test and a ready rollback |
| **Gap recovery from devices** | The R3 procedure and tools: insert-only, transactional tables only, conflicts reported | You can recover the newest records from devices after losing the cloud | It never overwrites an existing record and never merges settings, users or authorities |
| **Retries and catch-up (7.1)** | Up to 3 retries per step plus a second attempt the same day, then an alert | Temporary failures fix themselves; you are told only about real ones | It does not hide repeated retries; they are logged |
| **Sheet reconciliation (8.8)** | A read-only report comparing the database with the Google Sheet after a restore, and an approved step to re-send missing rows | The Sheet and the database are brought back into agreement without duplicates | It changes nothing without your approval |
| **Monthly restore test (Phase 6b)** | A scratch database and a monthly job that restores the latest backup into it | Every month it is proven that the backups really restore | It never touches production |

---

## 18. Phase 0 results (2026-10-04)

Phase 0 only reads. What was done and found:

| Item | Result |
|---|---|
| Offline safety export | Taken and saved **outside the repository** at `C:\Users\DjArVee\BSM-Safety\bsm-export-2026-10-04.zip` (7,538 objects, about 574 KB). Contains real data and PIN hashes: keep it private. **Recommended: copy it to a second private place (USB drive or a private Drive folder).** |
| Dexie clients (read-only listing) | Exactly **one** client exists: the database manager (your e-mail, e-mail verified, not a service account) with all six scopes (`IMPERSONATE`, `MANAGE_DB`, `ACCESS_DB` and three more). No dedicated backup credential exists yet. |
| Tooling | Node v24 is installed. The code repository is `github.com/arveedev/ArVeeBSM`. The GitHub command-line tool is not installed (not required; the backup repository can be created in the browser). |

**Finding to note (not acted on).** The only client has every permission, and the same credential is
the one the app's login function uses, so a leak of that credential could allow the database to be
changed or deleted. This is exactly why the backup gets its own **read-only** credential. Separately, a
narrower credential for the app's login function is worth considering later, as its own planned change.
**Nothing was changed.**

**Still needed from the owner to finish Phase 0**

1. Which Google account should own the Drive backup folder, and what should the folder be called?
2. Which free monitoring service to use for the "no backup arrived" alarm (suggested: healthchecks.io)?
3. Approval to start **Phase 1** (create the read-only backup credential and test it). Phase 1 adds one
   new client to the Dexie database's access list. It does not read or change any data, and it can be
   removed again by revoking that one client.

---

## 19. Phase 1 results (2026-10-04): the read-only assumption was WRONG

Phase 1 existed to test the plan's biggest unknown (Section 13, item 1). It did its job.

| Test | Result |
|---|---|
| Create a backup credential with `GLOBAL_READ` only | Created. The client list confirms it has exactly `GLOBAL_READ`. Nothing else in Dexie was changed. |
| Run Dexie's official export with it | **Refused (HTTP 403).** The command asks for the full set of scopes and has no option to ask for fewer. |
| Get a token with `GLOBAL_READ` only and read tables over the REST interface | Token issued, but **reading was refused**: the REST "read everything" route needs `GLOBAL_READ` **and** `ACCESS_DB` together. |
| Get a token with `GLOBAL_READ` + `ACCESS_DB` | Refused for this client, because it was created without `ACCESS_DB`. |

**What this means.** A strictly read-only credential cannot run the official export. The three real
choices are below. No decision is made yet.

| Option | Credential | Completeness | Risk if the credential leaks | Extra work |
|---|---|---|---|---|
| **A. Dedicated full-power backup client + official export** | A new client with all scopes, used only by the backup job | Complete (data, schema, roles, members) and directly restorable with Dexie's own import | The key could change or delete the database (same power as the one already in Vercel) | None; hardening steps below |
| **B. Limited client + custom REST exporter** | `GLOBAL_READ` + `ACCESS_DB` (cannot write globally, cannot delete, cannot manage clients) | Data tables only; roles, members and schema would need a separate export; format is ours and needs a converter to restore | Much smaller; a leak could read data but not delete the database | Custom code in a backup that must be trusted: more places for a mistake |
| **C. Both** | A limited client for the daily data export (B) plus the official full export (A) run by the owner by hand each month | Complete monthly, data daily | Mixed | Most work and most moving parts |

**Hardening if A is chosen:** the key is stored only as an encrypted GitHub secret in a private
repository with two-factor authentication on the account; the workflow runs only on the main branch,
uses minimal permissions and no third-party actions, and pins the Dexie command-line version; the key
is rotated on a schedule (`npx dexie-cloud rotate`), and offline copies exist so a deleted database can
be rebuilt (Section 8.4).

**Housekeeping.** The `GLOBAL_READ`-only client created in this phase is unused and harmless. It can
be revoked (`npx dexie-cloud revoke qzkhh173lifpjmqb`) once the decision above is made.
The temporary test folder holding a copy of its key was deleted. Its key file remains at
`C:\Users\DjArVee\BSM-Safety\bsm-backup-readonly.key`.

**Drive folder.** The owner supplied an existing Drive folder (owned by arvee.dev.apps@gmail.com).
Suggested name: **BSM App - Daily Database Backups**, with one sub-folder per year
(`2026`, `2027`, ...) created by the upload script. The owner needs to rename the folder in Drive.
**Monitoring service:** healthchecks.io (free tier), approved.

---

## 20. Decision and Phase 1 completion (2026-10-04)

**Decision: Option A** (a dedicated full-power backup client with Dexie's official export), with the
hardening listed in Section 19.

**Phase 1 completed**

| Item | Result |
|---|---|
| Dedicated backup client created | `wwm5ytuxp29najli`, service account, e-mail `arvee.dev.apps+bsm-backup-job@gmail.com`, all scopes. Separate from the app's own client, so either can be rotated or revoked on its own. |
| Test export with only the new client | **Worked:** 7,538 objects, same count as the manager export taken earlier. The test file and the temporary folder holding a copy of the key were deleted. |
| Unused `GLOBAL_READ`-only client | **Revoked** (`qzkhh173lifpjmqb`). Its key file was deleted. |
| Client list now | Two clients: the owner's manager client and the new backup client. |
| Where the new key is | `C:\Users\DjArVee\BSM-Safety\bsm-backup-job.key` (outside the repository). It becomes an encrypted GitHub secret in Phase 2 and the file should then be kept only offline (password manager or sealed copy). |

**Phase 2 prerequisites from the owner (cannot be done by the assistant; they involve credentials and
the owner's GitHub account)**

1. Turn on two-factor authentication on the GitHub account `arveedev` if it is not already on.
2. Create a **private** GitHub repository named `bsm-backups` (empty is fine).
3. In that repository (Settings, Secrets and variables, Actions) add these secrets, copying the values
   from the key file yourself:
   - `DEXIE_DB_URL` = `https://zv432njdm.dexie.cloud`
   - `DEXIE_BACKUP_CLIENT_ID` and `DEXIE_BACKUP_CLIENT_SECRET` (from `bsm-backup-job.key`)
4. Tell the assistant when done. The workflow and verification script are then written locally for review
   before anything is pushed.

---

## 21. Phase 2 progress (2026-10-04): written and tested locally, NOT yet pushed

Prerequisites confirmed by the owner: private repository `bsm-backups` created, GitHub two-factor
enabled, the three secrets added, the Drive folder renamed.

Written in a new local folder `C:\Users\DjArVee\Documents\GitHub\bsm-backups` (one local commit, no remote
configured yet, nothing pushed):

| File | Purpose |
|---|---|
| `.github/workflows/daily-backup.yml` | The daily job: export (3 attempts), verify, commit. 02:00 PHT main run plus 06:00 catch-up that skips if today's backup exists. Manual "Run workflow" button. Permissions: contents write only. Official GitHub actions only. Dexie command pinned to 3.0.7. Credential files are written from secrets, then always deleted. |
| `scripts/verify_backup.py` | The completeness checks (Section 6.5). Reads only; never prints record contents. Writes the manifest. |
| `scripts/test_verify.py` | Builds damaged copies of a good backup and confirms each is rejected. |
| `README.md`, `.gitignore`, `.gitattributes` | Explains the repository; blocks `*.key` and `dexie-cloud.json` from ever being committed. |

**Local test results (against the real export taken on 2026-10-04):** the good backup passes
(7,536 records, all required tables present); all 7 damaged copies are rejected: not a zip, truncated zip,
one corrupted line, users table missing, access setup missing, large drop against the previous backup,
and a different database than the previous backup.

**Not yet exercised:** the workflow itself cannot run locally. Its first real run happens on GitHub after
the owner approves the push, started by hand with "Run workflow". Phase 2's gate is that this first run
produces a correct backup and manifest in the repository. Phases 3 (Drive) and 4 (monitoring) add marked
steps to the same workflow.

---

## 22. Phase 2 gate PASSED (2026-10-04)

The workflow was pushed to `github.com/arveedev/bsm-backups` and started by hand. The first run succeeded.

| Check | Result |
|---|---|
| Run on GitHub | Succeeded (export, verify, commit) |
| Files in the repository | `backups/2026/bsm-2026-10-04.zip` and `...manifest.json` (commit "Backup 2026-10-04") |
| Records | 7,536, 32 tables, database `zv432njdm`; matches the manual export taken earlier the same day |
| Hash | The SHA-256 in the manifest matches the committed zip |
| Independent re-check | The committed zip was pulled and re-verified on the owner's PC: PASS |
| Secrets in the repository | None tracked; credential files are written only during a run and deleted after |

Remaining before the schedule is switched on (Phase 6): Phase 3 (Google Drive copy), Phase 4 (monitoring and
failure alerts), Phase 5 (restore rehearsal on a scratch database). The cron schedule is already inside the
workflow file, so **the job will also run by itself at 02:00 and 06:00 Philippine time from tonight**;
this is read-only and harmless, and it gives early evidence of scheduled runs. (If the owner prefers it off until
Phase 6, disable the workflow in the Actions tab.)

---

## 23. Google Sheet sync check (2026-10-04) and the audit it calls for

**Trigger.** The owner reported that the September PR backup sheet looked nearly empty (a figure of 1,676.97)
while the app's Procurement overview showed 14,400 bags / 775,858.377 net kg.

**What was checked (read-only; nothing was written to the Sheet).** The 2026-10-04 database export was compared
with the live Sheet by looking up each record by serial number through the Sheet script's read-only lookup.

| Check | Result |
|---|---|
| September PROCUREMENT WSRs in the app | 143 records, 14,400 bags, 775,858.377 net kg (matches the Procurement overview exactly) |
| PRs that belong to the September PR sheet (by delivery date) | 135 in the app; **all 135 found in the Sheet**; Sheet net kg **743,444.511 = app 743,444.511** |
| Unpaid September procurement (no PR yet) | 7 WSRs, 27,771.536 kg (these are correctly not on the PR sheet) |
| Transactions flagged "synced" for September (WSR, WSI, ESR, ESI) | 497 checked: 495 present in the Sheet; the other 2 are opening-balance seeds, which are deliberately never sent |
| Sheet "Warehouse Name" labels | 30 September rows exist under a different label than the app's warehouse name (for example `TABACO GID-A` vs `TABACO GID A`, `ALB ABACORP-B` vs `ABACORP B`): present, but inconsistently labelled |
| Opening-balance seeds flagged "not synced" | 21; by design (serials start `INI`) |
| October PRs (21 belong to October deliveries) | **20 are in no sheet**: only a September PR sheet source exists, so the October rows have nowhere to go; the app retries every 30 seconds and logged 21 "Sheet sync" errors |

**Conclusions.** The PR and transaction backups for September are complete and accurate. The real faults found:
1. **No October PR sheet source is configured**, so October-delivery PRs cannot be backed up (20 PRs, about 82,600 kg).
2. **Inconsistent warehouse labels** on 30 September rows.
3. **Nothing in the system checks the Sheet end to end.** A record is marked "sent" when the Sheet script answers
   SUCCESS; nothing later confirms the row is really there, and nothing warns when a month has no source.

**Added to the plan (Phase 7c, widened): a daily Sheet sync audit.** After each backup, the same job compares
the database with the Sheet using the read-only lookup, for the last few days every day and for a full month once
a week, and reports: records flagged sent but missing from the Sheet, records whose Sheet label differs, PRs with
no sheet source for their month, and totals that differ (kg and bags per warehouse per month). The result goes
into the backup's manifest and an alert if anything is wrong. It needs the Sheet script addresses as encrypted
GitHub secrets. Also proposed for the app itself: a visible warning (bell) when a PR or transaction has no sheet
source for its month, instead of only an entry in the admin error log.

---

## 24. Sheet audit built; data-integrity findings (2026-10-04)

**Built and pushed (bsm-backups, read-only):** `scripts/sheet_audit.py`, run after each backup (daily window;
full on Sundays or on demand). It reports ERROR (the run fails and GitHub e-mails the owner; the backup is
already saved) or WARN. Checks: source address shape and that it answers; a source exists for today and next
month; PRs with no source for their month; records stuck unsynced across audits; incomplete placeholder records
in the live period; the same serial held twice; possible double entry; procurement receipts with no PR;
records the app says were sent but are not in the Sheet; Sheet warehouse label differing; PR numbers differing
between app and Sheet; empty REMARKS formula. Tested against the real export: it found every issue already known.

**Sheet script updated (needs the owner to redeploy):** the REMARKS formula is filled automatically for new
SUMMARY rows, only into blank cells; see `docs/apps-script-remarks-formula-update.md`.

**Findings about records re-created from the Sheet.** The app is the source of truth since 1 September, so
the Sheet should never create live records. The import code (`transactionPreload.js`) creates a placeholder
for any Sheet row it cannot match locally, with no limit on dates. It matches on serial **and cereal category**,
so a row whose category does not resolve from the Sheet's variety name is imported as a second copy.
- Live period: 5 receipts (Aug) have an app-created copy plus a placeholder copy; WSR 11756875 (BSI C, 9/24)
  exists only as a placeholder (no pile, MTS or gross); WSR 11756886 was a placeholder twin of another entry.
- History before each warehouse's reporting cutoff: 1,671 serials held twice (about 3,250 placeholders).
  Monitoring views that are not limited by the cutoff overstate these months (for example May procurement
  counts 6,519,714 kg against 3,261,465 kg when each serial is counted once).
- September procurement (143 receipts, 775,858.377 kg) has no repeated serial, so that total is correct.

**Proposed fix, not yet made (production code, needs approval):**
1. Never create a record from the Sheet for a row dated after the data start date / warehouse cutoff; report
   it as an anomaly instead.
2. Match existing records on type + warehouse + serial regardless of category.
3. A reviewed clean-up: keep one copy per serial (the complete one), with a preview and an audit entry.

---

## 25. Duplicate history cleaned; Sheet-import crash fixed (2026-10-05)

**Done (v1.10-267 to 271):**
- The Sheet-import pass for ESR no longer crashes ("logError is not defined"); a serial held twice is now reported
  with accurate wording (usually a real entry plus an old Sheet copy).
- Admin > Duplicate Cleanup built: read-only scan, snapshot file downloaded before any delete, Restore from snapshot,
  batched deletes, local database only (the Sheet is never touched). The kept copy is the app-made one, else the
  most complete; a copy is removed only if it is a bare Sheet placeholder, or (before the cutoff) a Sheet copy with
  no Purchase Receipt link. Anything else is listed and left alone.
- Owner ran it: the roughly 1,685 repeated serials were cleaned in a trial of 20, then the rest. The scan now shows
  nothing to clean. Snapshot files stay in the owner's Downloads until a later daily backup has been checked.

**Still open:** ghosts WSR 11756875 (ALB-BSI C) and WSI 26341972 (ALB-BSI B) to be deleted from their forms; PR
5798086-0 (ALB-VRT A, 2026-10-01) missing from the October sheet, to be re-queued; restore rehearsal and the
remaining backup phases (Drive copy, monitoring ping, parallel run) as listed above.

