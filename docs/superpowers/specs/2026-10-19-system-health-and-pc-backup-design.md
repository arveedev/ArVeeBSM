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
- Every office PC (Windows, Chrome or Edge, installed app) automatically keeps a full dated backup file of its own data in TWO
  independent places: (1) a folder on the PC itself, chosen once per PC, so the PC can heal itself with no internet; (2) the
  Admin's Google Drive, uploaded automatically with no field-office setup. At least 30 days are kept in both (decision: 45
  daily files).
- A PC can restore itself from its own file with no internet: an in-app "Restore this PC from a backup file" (see 4.6).
- Device files and the nightly status are usable by the existing tools (backup, merging, restoration).

Non-goals
- Phones and tablets do NOT make backup files (no local file, no Drive upload) (owner decision). They still report their sync status (a few numbers) so the
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

### 4.3 Automatic backup on each office PC (two independent copies)
Why two: the local file survives a Drive or internet failure and lets an offline PC restore itself; the Drive copy survives the
loss of the PC or its disk. Losing either one never loses the other. (The main database already has three more copies: cloud,
GitHub, Drive, and the Admin PC folder.)

Local copy
- A browser cannot choose a folder by itself, so each PC needs ONE click, once: a quiet banner "Choose a folder for this PC's
  automatic backup" with a single button. The folder name is the same everywhere by convention (`C:\BSM-Backup`, the banner says
  so), and the Admin sees in System health which PCs have no folder yet (amber after 3 days) so the Admin can ask that office
  to click the banner; nothing needs a visit. Chrome/Edge may ask for one click to renew the folder permission after a
  restart; the banner returns until done.
- Daily file `bsm-<deviceName>-<yyyy-mm-dd>.json.gz` plus a `.manifest.json`. Keep the newest 45 days (never fewer than 30);
  delete only files matching its own naming pattern, never anything else in the folder. A marker file holds the device id.
- Until the folder is chosen, the PC may keep its newest file in the browser's own private file storage (OPFS) as a stop-gap
  that needs no click (builder: confirm it survives the cases we care about; it does not survive "clear site data").

Drive copy
- The same file is uploaded automatically, in the background, to one central Drive folder `BSM Device Backups`, one subfolder per
  PC, through an app server function that holds the Drive secret (the secret never reaches a PC). The Drive receiver script gets
  a device-file mode that accepts only these file names and trims only the oldest device files beyond 45 per PC.
- Upload only when online; a failed upload retries later; nothing blocks the user.

Both copies
- Never interrupt: start only after the app has been idle for a while, with no entry form open and no unsent typing; read tables
  in small slices yielding to the interface; no pop-ups; stop and retry later if the user starts working or taps update. The
  file is written under a temporary name and renamed only when complete and read back successfully.
- Content (a superset of today's Export All Data JSON, so `tools/gap-recovery/gap.mjs` reads it after `.gz` handling): a `meta`
  block (format version, device id and name, user, app version, schema version, the database id the device is bound to, export
  time, last successful sync time, count and ids per table of entries still waiting to send), `tables` (every table in
  full), `counts` per table, and a SHA-256 of the canonical tables content. The manifest repeats `meta`, `counts` and the hash.
- After writing, the app reads the file back and recomputes the hash; both copies' results are reported in `deviceStatus`.

### 4.4 Tools (rehearsed on practice databases before any real use)
- `tools/gap-recovery/gap.mjs`: read `.json.gz` device files and a whole folder of them; use `meta.pending` to flag entries
  the device holds that the cloud may lack; still insert-only with the typed confirmation phrase.
- New `verify-device-file` command: checks hash, counts, database id and format version; says plainly if the file is usable.
- `tools/restore/restore.mjs` option 3 (recover from devices) accepts the folder.
- Rehearsal log entry and runbook update (`docs/restore-runbook.md`).

### 4.4b Restore this PC from a backup file (new in-app feature, works offline)
Today the app can export but not restore. New Admin-only (Admin PIN) action in Admin > Backup: "Restore this PC from a backup
file". It reads a device file (or the newest file in this PC's backup folder), verifies it (hash, counts, database id, format
version), shows a preview in plain words (how many records are missing from this PC, how many differ, how many entries are
waiting to send), and only after a typed confirmation adds the missing records to this PC's local database. It never deletes
and never overwrites a record that differs without showing it (conflicts are listed and left alone). Works with no internet;
the PC syncs normally when it is back online. Same insert-only rules as the gap-recovery tool; rehearsed on a practice database
and a rehearsal copy of the app first. A PC whose local database must be fully reset can reset, then restore from its file,
then sign in. (Builder: check how Dexie Cloud treats restored records on first sync and write that into the rehearsal.)

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
4. PC backup: local folder (idle-aware, verified, 45-day retention, banner, marker file), then the Drive upload (server function, Drive receiver device mode).
5. Restore this PC from a file (in-app, offline) and the tools: read device files, verify command; rehearsal on practice databases and the rehearsal app; runbook.
Docs (PRD, app-flow, backend-schema, TDD, activity log, handoff) updated at each stage.

## 6. Calls made by the assistant (owner to confirm or change)
- Retention 45 daily files (owner asked for at least 30).
- Thresholds in 4.5 and the 10-minute reporting throttle.
- File naming and `.json.gz` compression; manifest file beside each backup.
- Phones report status only (no files), per the owner's decision.
- Local folder needs one click per PC (browser security); the Admin chases it from the System health card, no visits.
- Drive device folder trimmed by the receiver to 45 files per PC; the Drive secret stays on the server.
- The nightly workflows write status into the database (needs their service client to have write access, which it already has).

## 7. Left to the builder
Exact table field names and indexes; the idle-detection details; the permission/realm setup for the two new tables; how the
Admin edits a device name; the visual details inside the agreed layout.
