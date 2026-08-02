# BSM App — Full Testing Checklist

This covers everything built and changed. Organized by area, roughly
in the order you'll likely want to test. Items marked **[LIVE SHEET]**
specifically need your real Google Sheet data and could not be
verified from this environment at all — these are the highest
priority to test first.

---

## 1. Google Sheets configuration — do this first

- [ ] **[LIVE SHEET]** Open Admin > Sheet Sources. Confirm the new
  **MO Sheet Name** and **TMO Sheet Name** fields are there (default
  "MO"/"TMO") — set them to match your actual sheet tab names if
  different.
- [ ] **[LIVE SHEET]** On your MO sheet, add a **STATUS** column at
  **column M** (leave blank for active rows). This is the only column
  the app will ever *write* to (typing "DONE" into it), and the only
  column it reads to decide whether to hide a row.
- [ ] **[LIVE SHEET]** Confirm your MO sheet's columns match: A =
  "MO No. [prefix]", C = letter, D = sequence number, E = ricemill
  name, G = "X of Y" batch, H = AI Number, I = SIA Number, L =
  Recovery %, M = STATUS (new).
- [ ] **[LIVE SHEET]** Same check for your TMO sheet (same columns,
  minus G/batch).
- [ ] **[LIVE SHEET]** Confirm column **J** on your AI and SIA sheets
  has the Regional Authority Number.
- [ ] Trigger a sync (should happen automatically on login, or wait
  ~5 min) and confirm no errors in the browser console.

## 2. Milling / Test Milling — the big one

- [ ] **[LIVE SHEET]** Create/find a WSI transaction, set Nature of
  Transaction to "Milling". Enter a real AI number that has a matching
  MO row on your sheet. Confirm: MO Number, Batch, and Customer Name
  (miller) all auto-fill and the MO Number field becomes **read-only**.
- [ ] Change the AI to one with no matching MO — confirm the
  MO/Batch/Customer fields **clear** rather than staying stuck on the
  old value.
- [ ] Try a WSR (receipt) for Milling — confirm MO Number is still a
  **selectable dropdown** here (not read-only), and fulfilled MOs are
  excluded from the list.
- [ ] Repeat both above for Test Milling / TMO, including the **Trial**
  dropdown — confirm an already-used trial number shows disabled.
- [ ] Record a WSR for Trial 3 with a nonzero amount — confirm the
  "Has Trial 3 been completed?" prompt appears. Test both **Not Yet**
  and **Yes, Complete** — both should save the transaction; only "Yes"
  should let the TMO become fulfilled once all 3 trials are recovered.
- [ ] **[LIVE SHEET]** After an MO's recovery is fully met, or a TMO's
  Trial 3 is confirmed, check the actual Google Sheet — confirm "DONE"
  appears in column M of the correct row, and **nothing else on that
  row changed**.
- [ ] Repeat the same Milling/Test Milling flow on the **Sacks**
  side (ESI/ESR) — same behavior expected.
- [ ] Open the **Milling Operations monitor** (shows on Home/Admin
  Home when any MO/TMO data exists) — check the MO/TMO tabs, the
  Show Completed toggle, the Regional Authority Number filter, and tap
  an entry to confirm the detail view shows miller, batch/trial,
  issued/received (stock AND sacks), and recovery shown as net bags.
- [ ] Confirm a miller's name shows up in Admin > Customers after a
  Milling transaction is saved.

## 3. NFA Ricemill / Private Miller allocations

- [ ] Admin > Miller Allocations. Add a Ricemill allocation (Regional
  Authority Number + total net kg). Confirm it appears with correct
  "used" / "remaining" figures once transactions exist against it.
- [ ] Add a Private Miller allocation (Regional Authority Number +
  ricemill name + share). Confirm two different millers under the same
  Regional Authority Number track independently.
- [ ] Set a warehouse's Facility Type to "Ricemill" or "Mechanical
  Dryer" in Admin > Warehouses — confirm the badge shows in the list.

## 4. Wet/Dry Palay tracking

- [ ] Record a WSR of a "wet" palay variety (code with W as the 2nd
  character, e.g. PW1-A) at a regular warehouse. Confirm the red
  notification appears on Home showing bags outstanding and elapsed
  time.
- [ ] Issue some of that wet palay out (WSI) — confirm the outstanding
  amount decreases correctly, and clears entirely once fully issued.
- [ ] Set a warehouse to Facility Type "Mechanical Dryer" and record
  wet-received / dry-issued transactions there — confirm the blue
  informational status card shows (not the red warning).

## 5. Procurement bags notification

- [ ] Record a WSR with Nature = Procurement, with an MTS Sack
  Type/Condition set. Confirm the amber notification appears on Home.
- [ ] Record a matching ESI (also Procurement type) with the same sack
  type/condition/piece count — confirm the notification clears for
  that specific combination.
- [ ] Try a mismatched piece count — confirm it shows the over/under
  wording correctly.

## 6. BIN Card

- [ ] From the Piles page, tap a pile with transaction history >
  Export BIN Card. Check: landscape orientation, pile name in all 4
  corners (upper-right larger), page X/Y in the lower right, full
  transaction history with running balance, receipts/issues correctly
  separated.
- [ ] Same from the pile list in Settings.
- [ ] Close a pile (Settings > pile list > ⋮ menu > Close Pile) with a
  nonzero balance — confirm the BIN Card shows a closing entry zeroing
  it out. Try Re-open Pile too.

## 7. Beginning Balances (separate admin panel)

- [ ] Admin > Beginning Balances > Piles tab. Edit an existing pile's
  balance — confirm this does NOT touch the pile's live current stock
  incorrectly; verify the recalculated total is correct afterward on
  the actual Piles page.
- [ ] Same for the Sacks tab, including the "As of" date field.

## 8. Pile Layout — fullscreen view

- [ ] On a phone (or narrow browser window), open Piles > Fullscreen
  View. Confirm the grid rotates to landscape and fills the screen,
  back button works, tapping a box shows details.
- [ ] Confirm the normal (non-fullscreen) layout no longer gets cut off
  vertically on a tall grid.

## 9. Everything else — quick pass

- [ ] OR# field shows on Sales transactions and on the stock issues
  report (not receipts, not sacks).
- [ ] Statement of MTS Receipts — column 4 now shows ESI data
  correctly.
- [ ] Age unit dropdown (Days/Months) on pile create — converts the
  number when switched, not just relabels it.
- [ ] Tap a partially-issued AI/SIA on the home monitor — confirm the
  "Add New Transaction" vs "View Transactions" choice appears.
- [ ] Check the bottom of any page on a phone with a notch/curved
  corners — content shouldn't be obscured by the nav bar.
- [ ] By Products color (amber/gold) — spot-check the pile layout
  grid, Home stock breakdown, and Authority Monitor all show it
  correctly instead of falling back to Rice's blue.
- [ ] New roles (Acting Warehouse Supervisor/Assistant, MPO III,
  Acting MPO III) selectable in Admin > Users.
- [ ] Net Bags by Province & Category card — branch total row appears
  below the table (Rice + Palay only).

## 10. Deployment (separate from feature testing)

- [ ] Confirm the production Vercel environment variables are set
  (DEXIE_CLOUD_* — currently only confirmed working in local dev).
- [ ] Whitelist the production domain for Dexie Cloud.
- [ ] Verify login → sync → cloud data flow works on the actual
  deployed site, not just local dev.
- [ ] Once confirmed working end-to-end in production, remove the
  `[DEXIE-CLOUD-DIAGNOSTIC]` console logging in `dexie.js` and
  `AuthContext.jsx` (left in deliberately for now, in case production
  debugging is still needed).

---

## If something breaks

Check the browser console first — most of what was fixed this session
involved either silent failures (now surfaced with visible errors) or
data that looked right but wasn't. `docs/activity-log.md` has the full
detailed history of every change if you need to trace something back
to when/why it was made.
