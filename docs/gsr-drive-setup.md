# GSR to Google Drive: one-time setup and the scratch-folder test

You do this once. Nothing in it can touch your backups: the GSR has its own script, its own password and its own folder.

## Part A. Make a scratch folder (for the test)

1. Open Google Drive (drive.google.com) with the Google account that should own the GSR files.
2. Click **New** > **New folder**. Name it `GSR-TEST`. Click **Create**.
3. Open the folder. Look at the address bar: `https://drive.google.com/drive/folders/XXXXXXXXXXXX`. Copy the part after `folders/` (the `XXXXXXXXXXXX`). This is the **folder id**. Keep it in Notepad.

## Part B. Put the script on Google

1. Open script.google.com (same Google account). Click **New project**. Rename it `BSM GSR to Drive` (click "Untitled project" at the top).
2. Delete everything in the editor. Open the file `tools\gsr\gsr-drive.gs.js` of the app (in the `bsm-app` folder), select all, copy, and paste it into the editor. Click the disk icon (**Save**).
3. Click the gear icon (**Project Settings**) on the left. Scroll to **Script Properties** > **Add script property**. Add two:
   - Property `GSR_TOKEN`, value: a long random text of your own (30 or more letters and numbers). Keep a copy in Notepad.
   - Property `GSR_ROOT_FOLDER_ID`, value: the folder id from Part A.
   Click **Save script properties**.
4. Click **Deploy** (top right) > **New deployment**. Click the gear next to "Select type" and choose **Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Click **Deploy**.
5. Google asks you to authorize: click **Authorize access**, choose your account. If it says "Google hasn't verified this app", click **Advanced** then **Go to BSM GSR to Drive (unsafe)** (it is your own script) and **Allow**.
6. Copy the **Web app URL**. It must end in `/exec`. Keep it in Notepad.
7. Paste that URL in a new browser tab. You should see `{"ok":true,"service":"bsm-gsr-drive","folder":"GSR-TEST"}`. If you see anything else, stop and tell me what it shows.

## Part C. Tell the app where the script is

1. Open vercel.com > your BSM project > **Settings** > **Environment Variables**.
2. Add two variables (Environment: Production, and Preview if you use it):
   - `GSR_SCRIPT_URL` = the Web app URL from Part B step 6 (ending in `/exec`).
   - `GSR_SCRIPT_TOKEN` = the same random text you typed as `GSR_TOKEN`.
3. Go to **Deployments**, open the newest one, click the three dots > **Redeploy**.

## Part D. Run the test

1. Open the app as Admin. Open **Stock Desk** > **GSR report**.
2. Click **Test the Drive connection**. It should say "Google Drive reached. Designated folder: GSR-TEST".
3. Leave the dates as proposed (Monday: Friday to Sunday; other days: yesterday) or change them. Click **Prepare**.
4. Read the **Checks and tally** page. If it says "Must be fixed", the Create button stays off; send me the list.
5. Open the **PALAY INVENTORY** tab to see the sheet, then click **Create in Google Drive** and **Yes, create**.
6. When it finishes, it says "Created and verified: N of N values match" and gives two links: the GSR and its audit file. They are inside `GSR-TEST / 2026 / 10 OCTOBER`.
7. Open both. Check a few warehouse columns against the warehouse's own documents (this is the hand check). The GSR carries the yellow **FIRST RUN - HAND CHECK** label.

## Part E. When the test is good

1. Delete the files in `GSR-TEST` (select them, press Delete; Drive keeps them in the Trash for 30 days).
2. Create the real folder `NEWGSR` in Drive, copy its folder id, and in the Apps Script project change the script property `GSR_ROOT_FOLDER_ID` to it (Project Settings > Script Properties > edit > Save). No redeploy is needed. From then on the files go to `NEWGSR / 2026 / 10 OCTOBER`.
3. When you are satisfied with the hand check, untick **Label files "FIRST RUN - HAND CHECK"** on the GSR report screen.

## If something goes wrong

- **"GSR Drive is not set up yet"**: Part C was not done, or the redeploy was not done.
- **"drive refused: bad token"**: the `GSR_TOKEN` in the script and `GSR_SCRIPT_TOKEN` in Vercel are not exactly the same.
- **"drive did not answer" / HTTP 405**: the `GSR_SCRIPT_URL` is not the exact `/exec` address (the same thing that went wrong with the backup script).
- **The files say NOT VERIFIED**: Google holds a value that differs from the app's. The screen lists the cells. Send me the list; nothing else is affected.
