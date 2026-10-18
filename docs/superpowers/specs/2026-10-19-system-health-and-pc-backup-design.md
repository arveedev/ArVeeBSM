# System Health screen and automatic PC backup - design

Status: DRAFT for the owner's approval (2026-10-19). Nothing is built. Visual layout was shown and agreed in chat.

## 1. Intent

The owner (NFA Albay branch developer and the app's only Admin) wants to be able to answer, at a glance and without
technical knowledge: "is every backup running, would a restore work, does every device have the right data, and is there any
data problem?" Today the answers live in GitHub, a log file on one PC, and several Admin panels. The Admin also wants every
office PC to keep its own automatic backup file, so that when a backup or the cloud has a problem, a PC's file can repair that
PC, move to another PC, or fill gaps in the main backup (the existing gap-recovery and restore tools, rehearsed first).

## 2. Goals, non-goals, anti-goals

Goals
- One Admin-only screen, "System health", that shows overall status and four cards (Backups, Restore test, Devices, Data checks),
  each opening a detailed list; a collapsed per-device data table inside the Devices card; animated; opened by the secret
  shortcut **Ctrl+Alt+Q** (never shown in the UI); a coloured dot beside the Admin entry point when something is amber or red.
- Every office PC (Windows, Chrome or Edge, installed app) automatically saves a full dated backup file of its own data to a
  folder chosen once, keeping **at least 30 days** (decision: 45 daily files).
- Device files and the nightly status are usable by the existing tools (backup, merging, restoration).

Non-goals
- Phones and tablets do NOT save backup files (owner decision). They still report their sync status (a few numbers) so the
  Devices card is complete.
- The screen shows problems; it does not repair them. Repairs stay with Data Repair and the restore tools.
- No change to the nightly GitHub backup itself, to how the Google Sheet sync works, or to who may enter data.

Anti-goals (a failure even if it technically works)
- Any backup or status reporting that interrupts, slows or distracts a user: no pop-ups, no waiting screens, no work while
  someone is typing or an entry form is open.
- A half-written file replacing a good one. A device file that cannot be verified being treated as good.
- Anyone but the Admin seeing the screen, the dot, or the shortcut working.

## 3. Constraints

- Offline-first Dexie + Dexie Cloud (schema now v47). New synced tables need a schema bump and every device must update before
  it can report; old devices simply show as "not reporting yet".
- Reporting must be tiny and throttled (device status at most every 10 minutes and on app open/close; nothing while offline).
- Admin-only is enforced where the data is read (Admin check in the screen and the shortcut handler) and, for the status tables,
  by the database access rules: a device may write only its own device record; every signed-in Admin may read all of them
  (builder: verify the realm/permission model for this; the nightly job writes through its own service client).
- Browser folder saving (File System Access API) exists only in Chrome and Edge on desktop; the owner confirmed everyone uses
  these. The folder permission can lapse after a browser restart and needs one click to renew.
- Existing shortcuts: Ctrl+Alt+A (Admin dashboard), Ctrl+Alt+D (Stock Desk). Ctrl+S is Save inside entry forms. The new one,
  Ctrl+Alt+Q, must follow the same pattern as the others (see `src/App.jsx` and `src/components/common/StockDeskHost.jsx`).
- App updates are never automatic: they happen only when a user taps the update prompt (see `src/services/appUpdate.js`).

## 4. The design

### 4.1 Device status (every device, including phones)
A new synced table `deviceStatus`, one record per device, keyed by a permanent device id. Fields: device id, device name (editable
by the Admin, default from the browser/OS), signed-in user and warehouse, app version, kind (pc or phone), last sync time,
number of entries waiting to send, record counts of key tables, a short totals fingerprint, last device-backup time and result
(PCs), folder-permission state (PCs), first seen, last seen. The screen lists only devices seen in the last 30 days.
"Matches cloud" compares the device's key-table counts with the cloud's own counts (the nightly job writes these); a gap larger
than a small tolerance while the device says it is in sync is amber.
The device id lives in the browser database and, for PCs, in a small marker file in the backup folder, so a PC whose browser
data was cleared is recognised again.

### 4.2 Job status (written by the nightly job)
A new synced table `systemStatus` with a few records written by the existing GitHub jobs through their service client, after
their own work is finished, so a failure to write never fails or delays a backup: `cloudBackup` (time, result, records, size,
per-table counts, Drive delivered yes/no), `restoreTest` (time, result, records identical, next test), `sheetAudit` (time,
errors, warnings, top lines), `history` (last 30 days of backup results for the strip). The nightly workflow gets one extra
step; the restore-test workflow gets one extra step. The in-app backup time (already in reportConfig) is shown too.

### 4.3 Automatic backup on each office PC
- First run: a quiet banner (Admin or user) "Choose a folder for this PC's automatic backup". Choosing it stores the folder
  handle and a marker file. Without a folder the PC reports "no folder yet" (amber after 3 days).
- Daily file `bsm-<deviceName>-<yyyy-mm-dd>.json.gz` plus `bsm-<deviceName>-<yyyy-mm-dd>.manifest.json`. Keep the newest 45
  days (never fewer than 30); delete only files matching its own naming pattern; never anything else in the folder.
- Never interrupts: starts only after the app has been idle for a while, with no entry form open and no unsent typing; reads
  tables in small slices yielding to the interface; no pop-ups; stops and retries later if the user starts working or taps
  update. The file is written under a temporary name and renamed only when complete and read back successfully.
- Content (a superset of today's Export All Data JSON, so `tools/gap-recovery/gap.mjs` reads it unchanged after the `.gz` is
  handled): `meta` block (format version, device id and name, user, app version, schema version, the database id the device is
  bound to, export time, last successful sync time, count and ids per table of entries still waiting to send), `tables`
  (every table in full), `counts` per table, and a SHA-256 of the canonical tables content. The manifest repeats `meta`,
  `counts` and the hash so a file can be checked without opening it.
- After writing, the app verifies the file by reading it back and recomputing the hash; the result is reported in
  `deviceStatus`.

### 4.4 Tools (rehearsed on practice databases before any real use)
- `tools/gap-recovery/gap.mjs`: read `.json.gz` device files and a whole folder of them; use `meta.pending` to flag entries
  the device holds that the cloud may lack; still insert-only with the typed confirmation phrase.
- New `verify-device-file` command: checks hash, counts, database id and format version; says plainly if the file is usable.
- `tools/restore/restore.mjs` option 3 (recover from devices) accepts the folder.
- Rehearsal log entry and runbook update (`docs/restore-runbook.md`).

### 4.5 The System health screen
Layout agreed in chat (the interactive mock): top "System health" with a segmented health bar (one segment per card, filling
in on open, amber pulses) and one line saying what needs attention with a button that opens the right card; four cards
(Backups, Restore test, Devices, Data checks) that fade up in turn; tapping a card slides its detail list open below the cards
(one at a time); inside Devices, "Show device data" opens the table (device, user, last sync, app, waiting, matches cloud,
last device backup, folder state), collapsed by default. Animations respect reduced-motion.
Status rules (builder: put thresholds in one config object so the owner can adjust them):
- Amber: a PC or phone has not synced for 24 h or has entries waiting over 1 h; the last cloud backup is over 30 h old; a
  PC has had no device backup for 48 h or no folder for 3 days; the Sheet audit has warnings; the Stock check has notes.
- Red: no cloud backup for 48 h or the last backup did not pass; the last restore test failed; a device out of sync for 7 days;
  the Sheet audit has errors.
Sources of "Data checks": Sheet audit (systemStatus), the Stock Desk lots check and data check (existing code), error log
count (existing), duplicate serial and placeholder counts (existing audit).
Entry points: shortcut Ctrl+Alt+Q (Admin only, not shown anywhere), a card/tab in the Admin dashboard, and the dot beside the
Admin button.

## 5. Stages (each tested by the owner on real devices before the next)
1. Device status reporting (schema v48, deviceStatus). Screen not yet built; the Admin dashboard shows a plain list.
2. Job status reporting (systemStatus) from the two GitHub workflows.
3. The System health screen, dot and shortcut.
4. PC folder backup (idle-aware, verified, 45-day retention, banner, marker file).
5. Tools: read device files, verify command, rehearsal on practice databases, runbook.
Docs (PRD, app-flow, backend-schema, TDD, activity log, handoff) updated at each stage.

## 6. Calls made by the assistant (owner to confirm or change)
- Retention 45 daily files (owner asked for at least 30).
- Thresholds in 4.5 and the 10-minute reporting throttle.
- File naming and `.json.gz` compression; manifest file beside each backup.
- Phones report status only (no files), per the owner's decision.
- The nightly workflows write status into the database (needs their service client to have write access, which it already has).

## 7. Left to the builder
Exact table field names and indexes; the idle-detection details; the permission/realm setup for the two new tables; how the
Admin edits a device name; the visual details inside the agreed layout.
