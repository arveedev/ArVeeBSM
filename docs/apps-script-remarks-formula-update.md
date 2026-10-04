# Apps Script update: automatic REMARKS formula (SUMMARY sheet)

**Changed file:** `docs/apps-script-full-replacement.js`
**What it does:** whenever the app writes a Purchase Receipt row to the monthly PALAY DELIVERIES
spreadsheet, the REMARKS cell of that row now gets the formula
`=IF(OR(K18="GID 2",K18="GID 2 A"),"CTD","ALB")` automatically (with that row's own number, and
pointing at the WHSE column by its header name).

**Safe by design**
- It only fills a cell that is **completely blank**. A formula or value that is already there,
  including one you typed or fixed by hand, is never changed.
- It only applies to the sheet named `SUMMARY`. Every other sheet is untouched.
- Nothing is deleted or moved. If a header named `REMARKS` or `WHSE` is missing, it does nothing.

The same script is used in every spreadsheet (CONTROL NUMBER and each monthly PALAY DELIVERIES file),
so update **each** one you want covered. The formula only matters in the monthly PALAY DELIVERIES files.

## Steps for EACH monthly file (September, October, and every new month)

1. Open the spreadsheet, then **Extensions → Apps Script**.
2. Open the file that holds the app's script (the one with `doGet` and `doPost`).
3. Select all of its code and delete it. Open `docs/apps-script-full-replacement.js` from the
   project, copy **all** of it, and paste it in. Save (Ctrl+S).
4. **Deploy → Manage deployments**, click the **pencil** on the existing deployment, set **Version** to
   **New version**, and click **Deploy**. Do **not** choose "New deployment": that creates a new address
   and the app would stop reaching the sheet until you update it in PR Sheet Sources.
5. **One time only, for rows already in the sheet:** in the editor's function drop-down choose
   `backfillFormulaColumns` and press **Run**. Approve the permission prompt if asked. Open
   **Execution log**: it should say `filled N cell(s)`. This fills REMARKS for the rows written before
   this update. It is safe to run again; the second run fills 0.
6. Check: in the SUMMARY tab, REMARKS should now show CTD or ALB on every row, and the next PR the app
   sends should get it automatically.

## For a brand-new month's file

Copy the previous month's spreadsheet (so it carries the script and headers), then create a **new**
Web app deployment (Deploy → New deployment → Web app → Execute as **Me**, access **Anyone**), copy the
address ending in `/exec`, and add it in the app under Admin → System → PR Sheet Sources. The address
must start with `https://script.google.com/macros/s/`, not with `docs.google.com`.
(The new daily audit will report an error if a source address is of the wrong kind.)
