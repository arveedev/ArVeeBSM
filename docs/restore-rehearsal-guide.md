# Restore Rehearsal: Where We Are and How to Do the Rest

Companion to `backup-and-restore-plan.md` (Section 9). Written 2026-10-16. Everything here happens on the
**throwaway database** (`z1wnhq0k3`) and on your PC. **Nothing in this guide touches production
(`zv432njdm`).**

## 1. Where the rehearsal stands

| Plan step | What it proves | State |
|---|---|---|
| 1-4 Throwaway database, import a real backup, counts and round-trip | The backup file is a faithful copy | **Done 2026-10-05** (32 tables matched exactly) |
| 6 Balances, serials, duplicates | The restored data gives the same answers | **Done 2026-10-08** in the app's calculations (76 pile balances, SDO cash). The INIT- serial note was fixed in v1.10-388 |
| **8 Gap recovery (R3)** | Records newer than the backup can be added without touching anything else | **Done 2026-10-16, mechanically** (Section 2). The real-device version is still open (Section 5) |
| 5 Sign in with a PIN on an app copy pointed at the throwaway | The app really works on the restored database | **Open** (Section 3) |
| 7 A device that used the old database, switched | What users see when the database address changes | **Open** (Section 4) |
| 9 Record the results | The proof is written down | **Open** (Section 6) |

The throwaway database now holds the 2026-10-04 backup **plus** the 732 records gap recovery inserted
(Section 2). That is fine for steps 5 and 7. If you want it exactly as the backup, re-import
`bsm-2026-10-04.zip` into a new throwaway database.

## 2. The gap recovery tool (built)

File: `tools/gap-recovery/gap.mjs`. Two commands, run from the repository folder in PowerShell.

**Rules it enforces:** insert-only (an existing record is never overwritten); only `transactions`,
`purchaseReceipts`, `cashLedgerV2`, `cashDenominationCounts`, `pileLayoutBoxes`, `pileLayoutHistory`; conflicts
are listed and never resolved by the tool; safety export first; a typed phrase that names the target database;
proof afterwards that nothing that existed changed.

```powershell
# 1. PREVIEW - reads files only, writes nothing to any database. Saves a plan file.
node tools/gap-recovery/gap.mjs preview --restored <export of the restored database> --device <device file> [--device <another>] --plan gap-plan.json [--list]

# 2. APPLY - safety export, re-check, typed phrase, import ONLY the missing records, verify.
node tools/gap-recovery/gap.mjs apply --plan gap-plan.json --cwd <folder holding the TARGET's dexie-cloud.json and dexie-cloud.key> [--dry]
```

- `--restored` is an export of the restored database (`npx dexie-cloud export restored.zip`, run in the target's folder).
- `--device` is an **Export All Data** file from a device (`.json`). A Dexie Cloud export (`.zip`) also works, which is how
  this was rehearsed today (Section 2.1).
- `apply --dry` does everything except the import. Use it first.
- The typed phrase is `INSERT <n> RECORDS INTO <database id>`. Read the database id on the screen before typing.

### 2.1 What was rehearsed on 2026-10-16

Restored database = the 2026-10-04 backup in the throwaway. "Device" = the live cloud export of 2026-10-15 (newer).

| Result | Value |
|---|---|
| Missing records found | 732 (transactions 450, purchase receipts 201, cash ledger 30, pile layout boxes 40, pile layout history 11) |
| Inserted into the throwaway | 732 of 732 |
| Existing records changed or removed | **0 and 0** |
| Per-table counts grew by exactly the inserted numbers | Yes (7,538 to 8,270 objects) |
| Running preview again | 0 missing (safe to repeat) |
| Conflicts reported and left alone | 1,769 (see below) |

The 1,769 conflicts are real differences between the October 4 copy and today (the Sheet-import repair filled in
`varietyId`, `cerealCategory`, `varietyNameRaw` and `createdAt` on older records). They show why the tool never picks a
winner: applying the older or the newer copy blindly would have changed them. They were left exactly as they were.

## 3. Step 5: sign in on a copy of the app pointed at the throwaway

You do the PIN sign-in (I cannot enter a PIN).

1. Make sure the rehearsal copy is current. The copy in `C:\Users\DjArVee\BSM-Safety\rehearsal\app` was made on
   2026-10-08. To rehearse the current app, copy `src`, `public`, `index.html` and `package.json` from the repository
   into that folder (keep its `vite.config.js`, `token-server.cjs` and `node_modules`).
2. Start it. In the Claude desktop app use the launch entry **rehearsal-throwaway** (port 5174), or in PowerShell:
   `node C:\Users\DjArVee\BSM-Safety\rehearsal\app\start-rehearsal.mjs`.
   It refuses to start unless the database is the throwaway one.
3. Open `http://localhost:5174` in a **private/incognito window** (so nothing is shared with the real app), sign in with
   your own PIN (the throwaway holds your real users).
4. Check, and write down yes / no for each:
   - Home shows the warehouses; Piles shows piles with balances.
   - Reports: open a Stock Report for one week and compare two figures with the real app.
   - Entry form: the suggested next WSR and WSI serials are the numbers you expect (no INIT- number).
   - Admin dashboard opens (Ctrl + Alt + A) and Stock Desk opens (Ctrl + Alt + D).
   - Wait about 5 minutes signed in: no repeated error messages, and the error log (Admin > System) has no new entries.
5. Pass condition: sign-in works, balances and serials are right, no duplicate transactions appear.

Do **not** save or enter any real transaction there.

## 4. Step 7: a device that used the old database, switched to a new one

This is what users would see if the cloud database is ever rebuilt (R2). It needs **two** throwaway databases, because
the point is a browser that has already synced with one and is then pointed at the other.

1. Create a second throwaway: `npx dexie-cloud create` in a new empty folder (it will ask for the Dexie manager e-mail
   and send a one-time code). Import the 2026-10-04 backup into it (`npx dexie-cloud import <zip>`), and whitelist
   `http://localhost:5174` (`npx dexie-cloud whitelist http://localhost:5174`).
2. In an incognito window open the rehearsal app against the **first** throwaway, sign in, let it sync, and make one
   harmless change (add a logistics item, then leave it).
3. Stop the rehearsal app. Edit `C:\Users\DjArVee\BSM-Safety\rehearsal\dexie-cloud.json` (and the matching entry in the
   `dexie-cloud.key` file) so the app points at the **second** throwaway. Start it again and reload the **same**
   incognito window (do not close it).
4. Write down what happened, exactly: an error screen? asked to sign in again? the old data still shown? the harmless
   change from step 2 present in the second database afterwards (`npx dexie-cloud export` and look)?
5. Pass condition: you know the answer and it is written in the runbook. There is no "wrong" outcome here; the point is
   to learn it before it matters. (The plan, Section 8.5, lists the small code change that makes the address configurable.)

## 5. Step 8 with a real device file (the missing half of gap recovery)

Today's run used a cloud export as the stand-in for a device. The real thing uses what a device really holds:

1. On a real device that was used recently (phone or PC), open the app, **Admin > Backup > Export All Data**. A `.json`
   file downloads. Move it to your PC, for example into `C:\Users\DjArVee\BSM-Safety\devices\`.
2. Make the throwaway "older" than that device: re-import `bsm-2026-10-04.zip` into a fresh throwaway (or reuse the
   second throwaway from Section 4, which already has exactly that backup).
3. Preview (reads only):
   `node tools/gap-recovery/gap.mjs preview --restored <export of that throwaway> --device <the device .json> --plan gap-plan.json`
4. Read it: the MISSING numbers should be records entered after October 4; conflicts are listed and will not be applied.
5. Apply with `--dry` first, then for real, typing the phrase it prints.
6. Pass condition: inserted = found, **changed 0, removed 0**, counts grew by the inserted numbers, and running the
   preview again says 0 missing.
7. Then do Section 3 on that throwaway: balances, serials, no duplicates.

For a **planted conflict** test (plan, Section 9 step 8): in the throwaway, change one record that also exists on the
device (for example edit a purchase receipt's remark in the rehearsal app), run the preview again, and confirm that
record is listed under conflicts and is untouched after the apply.

## 6. Step 9: record the results

Copy this block into `backup-and-restore-plan.md` (Section 9.2 "Rehearsal log") or send it to me and I will add it:

```
Date:
Step:                      (5 sign-in / 7 device switch / 8 gap recovery with a real device)
Throwaway database:
Backup used:               (file name and date)
Device file used:          (name, device, exported at)
Result per check:          (yes / no for each line in the section)
Anything unexpected:
Pass or fail:
```

## 7. If something goes wrong

- **The tool stops with "phrase did not match":** nothing was written. Run it again and type exactly what it shows.
- **"changed" or "removed" is not 0, or counts do not match:** stop. The safety export is in the target folder's
  `gap-logs`. Do not continue; tell me the log file name.
- **Wrong folder:** the phrase names the database id (`z1wnhq0k3` is the throwaway; **`zv432njdm` is production, never
  use it here**). If you ever see `zv432njdm` in the phrase while rehearsing, stop and do not type it.
- **Any doubt about production:** nothing in this rehearsal needs the production `dexie-cloud.key`.
