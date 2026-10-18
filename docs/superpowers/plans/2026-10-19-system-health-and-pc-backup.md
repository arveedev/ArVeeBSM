# System health and PC backup Implementation Plan

> **For agentic workers:** executed natively in one session (owner asked for no stage stops). Steps use checkbox syntax.

**Goal:** Admin-only System health screen (Ctrl+Alt+Q), device and job status reporting, automatic per-PC backup (local folder + Drive), and offline restore-from-file.

**Architecture:** Two new synced tables (`deviceStatus`, `systemStatus`, schema v48) following the `errorLogs` pattern (ownerless, every device reads and writes; Admin-only is enforced in the UI). One pure module `src/utils/deviceFile.js` (format, verify, diff) shared by the app and the node tools. Pure rules module `src/utils/healthRules.js`. Services for status reporting and the idle-aware backup. A Vercel function forwards device files to the Drive receiver.

**Tech Stack:** React 18, Dexie 4 + Dexie Cloud, Vite, Vercel functions, node:test (no new dependency), Python for the GitHub job scripts.

**Spec:** `docs/superpowers/specs/2026-10-19-system-health-and-pc-backup-design.md`

## Global Constraints
- Admin only: screen, dot, shortcut (Ctrl+Alt+Q, never shown in UI). Phones: status only, no backup files.
- Keep at least 30 days; chosen: 45 daily files, delete only own-pattern files. Backups never interrupt: idle only, no open form, sliced reads, no pop-ups.
- Device file: gzip of two lines; line 1 meta JSON (with `tablesSha256`), line 2 the Export All Data JSON (`exportedAt`, `databaseName`, `tables`). Hash = SHA-256 of line 2's UTF-8 bytes.
- Restore is insert-only, preview + typed phrase, Admin PIN, never deletes, conflicts listed and left alone.
- Thresholds in one config object (`HEALTH_THRESHOLDS`).
- Check build before commit; docs (activity log, handoff, app-flow, TDD, backend-schema) updated; bump `src/version.js`.

## Review Focus
- Device with no clock/odd dates -> status unknown, not a crash. - Empty tables -> file still valid. - Corrupt/truncated .gz -> verify says unusable, restore refuses. - Device file from another database id -> restore refuses. - Two devices with the same name -> both listed (id is the key).

---
### Task 1: Pure device-file module + tests
Files: Create `src/utils/deviceFile.js`, `tests/deviceFile.test.mjs`.
Produces: `buildDeviceFileText(meta, tables) -> {text, sha256}` (async), `parseDeviceFileText(text) -> {meta, data}`, `verifyDeviceFile(text) -> {ok, problems[], meta, counts}`, `diffAgainstLocal(data, localIdsByTable, opts) -> {perTable, missing, conflicts}`, `RESTORE_EXCLUDED_TABLES`.
- [ ] Tests (node:test): round trip passes; flipped byte fails hash; counts mismatch fails; wrong format fails; diff finds missing ids only; excluded tables never in plan.
- [ ] Implement; run `node --test tests/`; commit.

### Task 2: Health rules + tests
Files: Create `src/utils/healthRules.js`, `tests/healthRules.test.mjs`.
Produces: `HEALTH_THRESHOLDS`, `evaluateHealth({systemStatus, devices, now}) -> {overall, cards:{backups,restore,devices,data}, attention[]}` with levels `ok|amber|red|unknown`.
- [ ] Tests for every amber/red rule in the spec section 4.5 and the 30-day device filter.
- [ ] Implement; run; commit.

### Task 3: Schema v48 + device identity + status worker
Files: Modify `src/db/dexie.js` (v48 `deviceStatus: 'id, lastSeen'`, `systemStatus: 'id'`, `deviceInfo: 'id'` unsynced), Create `src/services/deviceIdentity.js`, `src/services/deviceStatusWorker.js`; Modify `src/App.jsx` (start worker when logged in).
- [ ] Implement `getDeviceId()`, `getDeviceName()/setDeviceName()`, `deviceKind()`; worker writes `deviceStatus` on start, every 10 min, on visibility change; counts, pending (`$*_mutations`), lastSync, appVersion, user; never throws.
- [ ] Build; commit.

### Task 4: Device backup service (local + Drive) + banner
Files: Create `src/services/deviceBackup.js`, `api/device-backup.js`, `src/components/common/DeviceBackupBanner.jsx`; Modify `src/services/backupWorker.js` (export `buildFullDump`), `src/App.jsx`.
- [ ] Idle-aware scheduler, sliced dump, write + read-back verify via `deviceFile.js`, retention 45 (own pattern), marker file, OPFS stop-gap, Drive upload, status into `deviceStatus`; banner with one button (PC, Chrome/Edge only).
- [ ] Build; commit.

### Task 5: Restore this PC from a backup file
Files: Create `src/components/common/admin/RestoreFromFilePanel.jsx`; Modify `BackupPanel.jsx`.
- [ ] File picker (.json/.json.gz) and "newest file in backup folder"; verify; preview; Admin PIN confirm + typed phrase `RESTORE n RECORDS INTO THIS PC`; bulkAdd missing (insert-only) in slices; result summary.
- [ ] Build; commit.

### Task 6: System health screen, tab, shortcut, dot
Files: Create `src/components/common/admin/SystemHealthPanel.jsx`, `src/components/common/SystemHealthHost.jsx`; Modify `AdminDashboard.jsx` (first tab in Data Care), `src/App.jsx` (Ctrl+Alt+Q), `AppHeader.jsx` (dot), `src/index.css` (animations).
- [ ] Panel per the agreed mock (bar, 4 cards, detail panels, collapsed device table, reduced motion); host overlay; Admin-only gating.
- [ ] Build; preview-check render; commit.

### Task 7: Job status reporting (GitHub jobs)
Files (bsm-backups repo): Create `scripts/report_status.py`, `tests` via `scripts/test_report_status.py`; Modify both workflows (extra non-fatal step using `dexie-cloud import`).
- [ ] Build import zip rows for `systemStatus` (`cloudBackup`, `restoreTest`, `sheetAudit`, `history`); test locally and on the scratch database (import, export, compare).
- [ ] Commit and push (workflows inactive failures are non-fatal).

### Task 8: Tools
Files: Modify `tools/gap-recovery/gap.mjs` (read `.json.gz`, folder, `meta.pending`), `tools/restore/restore.mjs` (option 3 accepts folder), Create `tools/device-file/verify.mjs`; Modify Drive receiver script (device mode, trim to 45).
- [ ] Rehearse: build a device file from a real export, verify, corrupt and re-verify, gap preview on the scratch database.
- [ ] Commit.

### Task 9: Docs, version, final verification
- [ ] Update activity log, handoff, app-flow, backend-schema, TDD, runbook, plan doc; bump version; `node --test`, `vite build`; push.
