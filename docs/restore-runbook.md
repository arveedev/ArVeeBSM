# BSM Restore Runbook

Built 2026-10-16 (tools in `tools/restore/restore.mjs` and `tools/gap-recovery/gap.mjs`). Companion to
`backup-and-restore-plan.md`. This is the page to open when something is wrong with the data.

## 1. Start it

On your PC, in PowerShell, in the repository folder:

```powershell
node tools/restore/restore.mjs --backups "C:\Users\DjArVee\BSM-Safety" --cwd "<folder that holds the dexie-cloud.json and dexie-cloud.key of the database you want to fix>"
```

- `--backups` is the folder where the backup zips are (named like `bsm-2026-10-04.zip`; sub-folders are searched).
- `--cwd` decides **which database the tool works on**. The screen always shows that database's id at the top. The
  production database is `zv432njdm`; the practice databases are `z1wnhq0k3` and `z5kaft79m`. Check the id before you type anything.
- Every question is answered by typing. `Ctrl+C` stops safely at any time before a write.

## 2. The rules it keeps

- It **never deletes** a record.
- It **never writes** without a safety export of the database first, a preview you approve, and a phrase you type
  that contains the database id.
- Each screen is tagged **READS ONLY**, **WRITES TO NEW DATABASE** or **WRITES TO THE LIVE DATABASE**.
- A backup that fails its own check (a required table missing or empty, no access setup, a changed file) is refused.
- Logs and safety exports are saved in a `restore-logs` folder inside the `--cwd` folder. Keep them.

## 3. Which option

| Situation | Option |
|---|---|
| I only want to know how a backup differs from the database | **0** Check (changes nothing) |
| A few records are missing or wrong, the rest is fine | **1** Repair in place (adds and updates only; cannot be undone automatically) |
| The database is badly damaged or gone | **2** Rebuild into a new database (the old one is never touched) |
| The database was lost and the newest entries exist only on devices | **3** Recover from devices, **after** option 2 and **before** any device is cleared |
| The new database turned out wrong | **4** Switch back (instructions) |
| The Google Sheet may be out of step | **5** Check the Sheet against the database or a backup (reads only; built 2026-10-19) |
| The cloud is just unreachable | **6** Nothing to restore; wait |
| Anything else | **9** Stop and get help |

When unsure, use option 0 first: it changes nothing.

## 4. Option 2 in short (the serious one)

1. Checklist, then choose and check the backup.
2. Safety export of the current database (skipped if it is unreachable).
3. A new database is created: you type your Dexie manager e-mail and the one-time code that is mailed to it.
4. The app's web address is allowed on it (you type it), the backup is loaded, and the new database is compared with the
   backup record by record. Anything but an exact match **stops** the rebuild; nothing is switched.
5. **You** then switch the system: four values in Vercel (`DEXIE_CLOUD_DB_URL`, `DEXIE_CLOUD_CLIENT_ID`, `DEXIE_CLOUD_CLIENT_SECRET` and the app's own address `VITE_DEXIE_CLOUD_DB_URL`), then redeploy. No code edit is needed any more (v1.10-402; before that the address was written in `src/db/dexie.js`). System health shows the database id the app is using.
6. **GitHub too:** the nightly backup uses its own copy of the address and key. In the bsm-backups repository (Settings, Secrets) update `DEXIE_DB_URL`, `DEXIE_BACKUP_CLIENT_ID` and `DEXIE_BACKUP_CLIENT_SECRET` for the new database (create a backup client for it first), then run "Daily database backup" once. Until then the nightly job keeps backing up the old database.
7. Each device must then run Admin > Backup > Export All Data, clear its local data once and sign in again. A device
   stays tied to the database it first synced with and the new one refuses it until it is cleared (found in the rehearsal
   of 2026-10-16). **Do option 3 first** if entries were made after the backup.

## 5. What was rehearsed (2026-10-16, practice databases only)

| Option | Result |
|---|---|
| 0 Check | A backup vs a database: reported the one extra record (a test account) and nothing else |
| 1 Repair | Two records were deliberately damaged; the preview found exactly those two; a wrong phrase stopped it; the right phrase restored both (2 of 2 match, 0 other records changed) |
| 2 Rebuild | Into a database holding the backup: identical, 12 of 12 sample records matched; refused when the "new" database was the same as the old one |
| 3 Recover | Preview on a real device export: 0 missing (already recovered), conflicts listed and untouched |
| Creating the database | Done by hand on 2026-10-16 (`npx dexie-cloud create`, e-mail code); the tool starts the same command and you answer it |

Not rehearsed: option 2 creating a database from inside the tool, and option 2 on a damaged live system. The monthly
automatic restore test (plan phase 6b) is built and running; option 5 (Sheet check) is built, see section 8.

## 6. If something looks wrong

Stop, keep the screen text and the `restore-logs` folder, and do not run anything else. The safety export taken before every
write is the way back (option 2 with that file as the backup gives an exact return).

## 7. Device files (the PCs' own backups) - added 2026-10-19

Each office PC saves a daily checked file `bsm-<device>-<id>-<date>.json.gz` in its backup folder (and a copy in the Admin's Drive, folder `Device Backups`). They are the third source of truth after the cloud and the nightly backups.

- **Check files:** `node tools/device-file/verify.mjs <file or folder>` says PASS or FAIL in plain words (checksum, counts, database id, who made it, entries that were still waiting to send). Never restore from a FAIL.
- **A PC lost or damaged its own data:** on that PC, Admin > Data Care > Backup > Restore this PC from a backup file (works offline), choose the newest file. It adds only what is missing.
- **The cloud lost entries:** option 3 above now accepts a folder of device files: for each PC only the newest file is used, damaged files are skipped with the reason, and a device that had entries waiting to send is flagged. Same insert-only rules and typed phrase as before.
- **Rehearsed 2026-10-19 on the practice database zwz12553b:** device files built from real exports verified; a flipped byte, a cut-short file, a non-gzip file and an edited-but-valid-gzip file were all refused; the gap preview read a device file and found 72 missing records; applying them inserted 72 of 72 with 0 existing records changed or removed and the per-table counts growing by exactly those numbers. The in-app restore was rehearsed in a real browser database: 2 deleted records came back, a locally changed record was left alone, and a file from another database was refused.

## 8. Option 5: check the Google Sheet (added 2026-10-19)

Reads only. Choose the database in the folder (a fresh read-only export) or a backup file, then "last 7 days" (a few minutes) or "everything since the reporting start" (10 to 20 minutes). It runs the same audit as the nightly job (`sheet_audit.py` in the bsm-backups repository, found automatically or with `--audit-script <path>`), looks up the documents and Purchase Receipts in the real Sheet, and prints each finding with what it means and what to do about it in plain words. Nothing is written to the Sheet or the database. Use it after any restore: fix what it lists in the app, then run it again until it says nothing was found. Rehearsed 2026-10-19 on the practice database against the live Sheet (both modes; it reported the practice copy's stale entries and the PR that differs in price).
