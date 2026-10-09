# Stock Desk: Google Sheet export setup

The Stock Desk (formerly Inventory Reports) can send its tables to a Google Sheet. It uses its
own Apps Script web app and its own spreadsheet, so it can never touch the AI/SIA
sheets, the transaction backup sheets, or your existing Daily Inventory sheet.

## One-time setup (about 5 minutes)

1. Create a **new, empty Google Spreadsheet** (for example "BSM Inventory Reports").
   Do not reuse your current Daily Inventory sheet. Keep the old one as a reference.
2. In that spreadsheet: **Extensions > Apps Script**. Delete the sample code and
   paste the whole of `docs/inventory-sheet-export-script.js`. Save.
3. *(Optional, recommended)* **Project Settings > Script Properties > Add property**:
   name `EXPORT_TOKEN`, value any password you choose. If set, the app must send the same token.
4. **Deploy > New deployment > Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Copy the **Web app URL** it gives you.
5. In the BSM App: **Admin Dashboard > System > Sheet Export**. Paste the URL (and the
   token if you set one), tap **Test connection**. You should see the spreadsheet name.
6. Open the **Stock Desk** (the quiet icon on Home > Stocks) as an Admin. On Daily inventory,
   Summary or Age monitoring, tap **Google Sheet**. The button is Admin only; Visitors keep Excel.

## What gets written

Each tap rewrites these tabs (and only these):

| Tab | Content |
|-----|---------|
| `SUMMARY` | Stock as of the chosen date, net bags, per warehouse, variety and age bracket, province subtotals |
| `YYYY-MM` (e.g. `2026-10`) | The daily ledger from the first of that month to the chosen date, net bags |
| `WAREHOUSE_AGE_MT` | Stock as of the chosen date in MT with the fine rice brackets (0-3, 3.1-6, 6.1-9, 9.1-12, over 12) |
| `DATA_CHECK` | Overrides in use, shortages, approximate ages, unassigned documents |

The ADD and LESS values in the month tab carry a cell note listing the documents behind them (document, customer, pile, amount).

The script refuses any other tab name, so a bad request cannot overwrite your other tabs.

## Test it safely first

1. Make the spreadsheet a **copy** first (File > Make a copy) and deploy the script on the copy.
2. Run the export, then compare each tab with the screen and with the Excel file.
3. Only when the numbers agree, point the app at the real reporting spreadsheet.

## Updating the script later

After changing the script, **Deploy > Manage deployments > Edit > Version: New version**.
The web app URL stays the same.
