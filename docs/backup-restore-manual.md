# BSM App: Backup and Restore Manual

Version 2026-10-19 (app 1.10-402). Written for the Admin. Every step says exactly what to click or type.
If you are ever unsure in an emergency: **stop, do not clear or log out any device, take a screenshot, and get help.**

---

## 1. What protects your data (and what you must do)

| Layer | Where it lives | How often | Who does it |
|---|---|---|---|
| The live database | Dexie Cloud (what every device syncs with) | continuous | automatic |
| Nightly cloud backup | GitHub, private repository `bsm-backups` (a checked `.zip` every night, about 04:00) | every night | automatic |
| Copy on Google Drive | Your Drive folder `BSM App - Daily Database Backups` | every night | automatic |
| Copy on your PC | `C:\Users\DjArVee\Documents\GitHub\bsm-backups\backups\2026\` | every day 9 AM and at sign-in | automatic (task "BSM backup watch") |
| In-app backup | GitHub, repository `ArVeeBSM`, branch `backups` | about once a day while someone is signed in | automatic |
| Each office PC's own file | Folder `C:\BSM-Backup` on that PC, and Google Drive `Device Backups` | every day, only when the PC is idle | automatic after the one-time folder click |
| The Google Sheet | the monthly production and PR Sheets | on every save | automatic |
| Monthly restore test | the newest backup is loaded into a practice database and compared | 2nd of every month | automatic |

**What you do:** nothing every day. Look at System health (section 2) now and then. Everything else is for emergencies.

---

## 2. The two-minute check (do it weekly)

1. On the Admin PC press **Ctrl + Alt + Q** (or Settings, Admin Dashboard, Data Care, System health).
2. Read the bar and the line under it. **Green = fine. Amber = look at it. Red = act. Grey = nothing reported yet.**
3. Tap each card to open its list:

| Card | Healthy looks like | If amber or red |
|---|---|---|
| Backups | "Passed" within the last day, Drive delivered | Open GitHub, repository `bsm-backups`, tab **Actions**. If the last "Daily database backup" run is red, click it and read the failed step. Run it again with **Run workflow**. |
| Restore test | "Passed" this month | A failed test means the newest backup did not load back identically. Do not rely on that backup; run **Daily database backup** again and ask for help. |
| Devices | every device synced recently, nothing waiting | A device behind: open the app on it with internet. "Waiting to send" entries stay safe on that device until it syncs. |
| Data checks | 0 errors | Read the line; see section 6 for the Sheet findings. |

4. A device with no backup folder shows "no folder yet": ask that office to click the **Choose folder** banner once (section 7).

---

## 3. Where everything is

| What | Where |
|---|---|
| This manual | `C:\Users\DjArVee\BSM-Safety\BSM-Backup-and-Restore-Manual.html` (open in Chrome or Edge, print to PDF if you like) and `docs\backup-restore-manual.md` in the app folder |
| Newest nightly backups | `C:\Users\DjArVee\Documents\GitHub\bsm-backups\backups\2026\bsm-YYYY-MM-DD.zip` |
| Old hand-made exports and practice databases | `C:\Users\DjArVee\BSM-Safety\` |
| The restore tool | `C:\Users\DjArVee\Documents\GitHub\claude bsm app\bsm-app\tools\restore\restore.mjs` |
| Logs and safety exports the tool writes | folder `restore-logs` inside the folder you started the tool with |
| One-time setup guide (Drive script, Vercel, PC folders) | `C:\Users\DjArVee\BSM-Safety\SETUP-DRIVE-AND-RESTORE-TEST.md` |
| Backup watch log | `C:\Users\DjArVee\BSM-Safety\check-backup.log` |
| Technical plan and history | `docs\backup-and-restore-plan.md`, `docs\restore-runbook.md`, `docs\activity-log.md` |

---

## 4. Emergency: what is wrong?

| What you see | Go to |
|---|---|
| One PC lost or damaged its own data, or is a replacement PC | **4A** |
| A few records are missing or wrong, the rest is fine | **4B** |
| The database is badly damaged, gone, or the data is wrong everywhere | **4C** |
| Everyone sees "cannot connect" but nothing is damaged | **4D** |
| You rebuilt the database and want to go back to the old one | **4E** |

### 4A. One PC lost its data (works with no internet)

1. Sign in on that PC as **Admin**.
2. Go to **Settings, Admin Dashboard, Data Care, Backup**.
3. Scroll to **Restore this PC from a backup file**.
4. Press **Use a file from this PC's backup folder** and click the newest file (the date is in its name). If the folder is not available, press **Choose a backup file** and pick a `.json.gz` file from the PC's backup folder, from Google Drive (`Device Backups`, the folder of that PC), or an older "Export All Data" `.json` file.
5. Read the check. It must say **File check passed**. If it says the file cannot be used, choose another (older) file.
6. Read the numbers: how many records this PC is missing, and (in amber) how many entries that device still had waiting to send. A file from another database is refused.
7. Type the phrase it shows (for example `RESTORE 41 RECORDS INTO THIS PC`) and press **Restore**.
8. When it says **Restore finished**, leave the PC open and online for a few minutes so it syncs. The app recalculates totals by itself.

The restore only **adds** missing records. It never deletes or overwrites anything.

### 4B. A few records are wrong (compare first, then repair)

You need the restore tool. Open **PowerShell** (Start menu, type PowerShell, Enter) and run:

```powershell
cd "C:\Users\DjArVee\Documents\GitHub\claude bsm app\bsm-app"
git -C "C:\Users\DjArVee\Documents\GitHub\bsm-backups" pull
node tools/restore/restore.mjs --backups "C:\Users\DjArVee\Documents\GitHub\bsm-backups" --cwd "C:\Users\DjArVee\Documents\GitHub\claude bsm app\bsm-app"
```

The top of the screen shows the database id: **zv432njdm is the live database.** Check it before typing anything.

1. Type **0** and Enter (compare a backup with the database; changes nothing). Choose the backup date when asked. Read the table: it says what the backup has that the database lacks, and what differs.
2. If you decide to repair, type **1**. Follow the steps: a checklist (type `READY`), the backup is checked, a **safety export of the database is saved first**, a preview is shown, then you must type the phrase `RESTORE INTO zv432njdm` exactly. It adds and updates records only; it cannot be undone automatically (that is why the safety export exists).
3. After it finishes, open the app, check Home and one report, then run option **5** (section 6).

### 4C. The database is badly damaged or gone: rebuild into a NEW database

This never touches the old database. Allow about an hour. **Do the steps in order.**

**Step 1: before you start**
1. Tell everyone to **stop entering data**. Nobody clears, reinstalls or logs out a device.
2. Refresh the backups: in PowerShell run `git -C "C:\Users\DjArVee\Documents\GitHub\bsm-backups" pull`.
3. Make sure you can sign in to **manager.dexie.cloud** with the Dexie owner e-mail (arvee.dev.apps@gmail.com); the tool will e-mail you a one-time code.

**Step 2: start the tool** (same three PowerShell lines as 4B). Type **2** and Enter.
1. Tick the checklist by typing `READY`.
2. Choose the newest backup. It must pass its check (a failed backup is refused).
3. The tool saves a safety export of the current database (skipped if it cannot be reached).
4. It creates a new database: type the Dexie e-mail and then the code that arrives in that mailbox.
5. When asked for the web address(es) the app runs on, type `https://arvee-bsm.vercel.app`.
6. It loads the backup and then compares the new database with the backup record by record. **Anything but an exact match stops the rebuild and changes nothing.** Write down the new database address it shows (like `https://zabc12345.dexie.cloud`) and the folder it created: it holds `dexie-cloud.json` and `dexie-cloud.key`.

**Step 3: switch the system to the new database** (this is where the database address changes; details in section 5)
1. Vercel: set the four values and redeploy.
2. GitHub: update the three backup secrets.
3. Test with ONE device before telling everyone.

**Step 4: recover the newest entries** (only if entries were made after the backup you used)
1. On each device that was in use: sign in as Admin, **Settings, Admin Dashboard, Data Care, Backup, Export All Data**. Or take the newest `.json.gz` file from that PC's `C:\BSM-Backup` folder (or from Google Drive, `Device Backups`). Put all these files in one folder.
2. In the restore tool type **3** and give that folder. Damaged files are skipped with the reason. For each PC only its newest file is used. The preview shows what the new database lacks; conflicts are listed and left alone. Type the phrase it shows to add the missing records.

**Step 5: every device gets the new database**
A device stays tied to the database it first synced with, and the new database refuses it until it is cleared. On **each** device, in this order:
1. **First** Export All Data (Admin, Backup) so nothing is lost.
2. Clear this site's data: in Chrome or Edge go to Settings, Privacy and security, Site settings, **View permissions and data stored across sites**, search `arvee-bsm`, press the bin icon, confirm. (An installed app uses the same data.)
3. Open the app and sign in again. It downloads everything from the new database.
4. If the device had entries waiting to send, restore its device file (4A) or let the Admin merge it (Step 4).

**Step 6: check**
1. System health shows the new database id at the top.
2. Run restore tool option **5** (Google Sheet check, section 6).
3. Open Home, Piles and Reports on one device and compare with yesterday.
4. Keep the old database untouched until you are sure.

### 4D. Everyone cannot connect, nothing damaged

Nothing to restore. Devices keep working offline and sync by themselves when the database is reachable again. Do **not** clear, reinstall or log out any device. Check Dexie Cloud status and your internet.

### 4E. Go back to the old database

Only right after a rebuild. In Vercel set the four values back to the old database (`zv432njdm` and its key), redeploy, and in GitHub restore the three backup secrets. Anything entered on the new database since the switch must be recovered with option 3 first.

---

## 5. Changing the database address (step by step)

**When:** only after a rebuild (4C), when the new database has a new address. **Nothing needs doing today.** No code is edited; you change settings and redeploy.

1. Have the new address and key ready: the folder the restore tool created has `dexie-cloud.json` (the address, like `https://zabc12345.dexie.cloud`) and `dexie-cloud.key` (the client id and client secret; keep this file private).
2. Go to **vercel.com**, open the BSM app project, then **Settings**, then **Environment Variables**.
3. Add or change these four values (tick **Production**, press **Save** each time):

| Name | Value |
|---|---|
| `VITE_DEXIE_CLOUD_DB_URL` | the new address |
| `DEXIE_CLOUD_DB_URL` | the new address |
| `DEXIE_CLOUD_CLIENT_ID` | the clientId from `dexie-cloud.key` |
| `DEXIE_CLOUD_CLIENT_SECRET` | the clientSecret from `dexie-cloud.key` |

4. Open **Deployments**, click the three dots on the newest one, press **Redeploy**, wait until it says **Ready** (about 2 minutes). Variables only apply to a new deployment.
5. **GitHub** (the nightly backup has its own copy of the address and key): open github.com/arveedev/bsm-backups, **Settings, Secrets and variables, Actions**. Update `DEXIE_DB_URL` (the new address). Create a backup client for the new database with the Dexie manager (**manager.dexie.cloud**, the new database, **Clients**, add a service client with all scopes) and update `DEXIE_BACKUP_CLIENT_ID` and `DEXIE_BACKUP_CLIENT_SECRET`. Then open **Actions, Daily database backup, Run workflow, tick force**, and check it turns green. *(Creating the backup client in the Dexie manager has not been rehearsed yet; the first time, do it together with whoever is helping you.)*
6. Open the app on one device, press Ctrl+Alt+Q: the top line shows `Database <new id>`. That confirms the app is on the new database.
7. Each device must then be cleared once (4C Step 5).

If you only set `VITE_DEXIE_CLOUD_DB_URL` the app and the token function both use it, but keep `DEXIE_CLOUD_DB_URL` equal to it so nothing is confusing later.

---

## 6. Checking the Google Sheet against the app (restore tool option 5)

Reads only. Run the tool (4B lines), type **5**.
1. Choose **1** (the database in this folder, a fresh read-only copy) or **2** (a backup file).
2. Choose **1** (last 7 days, a few minutes) or **2** (everything since the reporting start, 10 to 20 minutes).
3. Read the result. Each finding is explained in plain words. Common ones:
   - *Missing from the Sheet*: open that document or PR in the app and save it again so it is re-sent.
   - *Values differ*: open the PR, check it, correct it in the app.
   - *No Sheet source for this month*: add one in Admin, Reports and Sheets.
4. Fix what is listed in the app, then run the check again until it says nothing was found.

---

## 7. One-time setup items

- **Drive copy of the nightly backup and of every PC:** follow `SETUP-DRIVE-AND-RESTORE-TEST.md`, sections A and C.
- **Each office PC's backup folder:** on every PC with Chrome or Edge, the first time it signs in a green banner appears: press **Choose folder**, in the window click **This PC, Local Disk (C:)**, the folder **BSM-Backup** (press **New folder** and name it exactly `BSM-Backup` if it is missing), press **Select Folder**, then **Edit files** when the browser asks. After that nothing else is needed.
- **Windows notices** from the backup watch task are not relied on; use System health.

---

## 8. Words used here

- **Database:** the one shared copy of all data in Dexie Cloud.
- **Backup:** a checked `.zip` copy of the whole database made every night.
- **Device file:** a `.json.gz` copy of what one PC holds, made by that PC.
- **Restore:** putting backup data back. Here it only adds missing records.
- **Rebuild:** making a brand new database from a backup.
- **Sync:** a device and the database sharing their changes.

---

## 9. When you ask for help, send

1. A screenshot of the screen.
2. The newest file in the `restore-logs` folder (inside the folder you started the tool from).
3. What you did just before it went wrong.
