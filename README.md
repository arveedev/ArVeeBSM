# BSM App

Offline-first warehouse stock management PWA. Tracks WSR / WSI / WTS / ESI / ESR
transactions, AI / SIA authority balances, and pile-level milled rice inventory.

## Setup

This scaffold was generated without running `npm install` (no network access
in the build sandbox). To get running locally:

```bash
npm install
npm run dev
```

Then open the printed local URL — the dark theme should load with placeholder
routes for `/login`, `/`, `/piles`, `/reports`, and `/settings`.

## Project status — Phase 6 complete + Phase 7 groundwork (data model v9)

- [x] Vite + React scaffold, Tailwind dark theme palette (Section 5.3)
- [x] Directory blueprint (Section 5.2)
- [x] Router with `/login`, `/`, `/piles`, `/reports`, `/settings` placeholders
- [x] Global `<Toaster />` configured per Section 2.3 (no `alert()`/`confirm()`)
- [x] Dexie schema v6 — `users`, `piles`, `transactions`, `authorities`,
      `provinces`, `warehouses`, `varietyTypes`, `sackTypes`, `signatories`,
      `reportConfig`, `transactionTypes`, `googleSheetsConfig`
      (Section 3.2 + revisions)
- [x] Firestore gateway (`src/services/firebase.js`)
- [x] Background sync worker — pushes unsynced transactions on reconnect (`src/services/syncWorker.js`)
- [x] PIN keypad login (`src/pages/Login.jsx`)
- [x] AuthContext — in-memory session, PIN lookup against `db.users` (`src/context/AuthContext.jsx`)
- [x] ProtectedRoute — redirects to `/login` if unauthenticated, supports `requireRole` (`src/components/common/ProtectedRoute.jsx`)
- [x] AdminDashboard at `/admin` (admin-only) — tabbed config panel: Provinces,
      Warehouses, Users, Varieties, Sack Types, Transaction Types, AI/SIA,
      Signatories, Google Sheets (`src/pages/AdminDashboard.jsx`)
- [x] WarehouseContext — tracks the "currently selected facility" for
      Admins/multi-warehouse users (`src/context/WarehouseContext.jsx`)
- [x] BottomNav with centered FAB — Home, Piles, Reports, Settings
      (`src/components/layout/BottomNav.jsx`)
- [x] TransactionModal — bottom-sheet selector, WSR/WSI top row, ESR/ESI
      middle row, WTS full-width bottom row (`src/components/common/TransactionModal.jsx`)
- [x] Home dashboard — facility selector + pile summary matrix (`src/pages/Home.jsx`)
- [x] AdminHome — province/category subtotals, warehouse breakdown, and
      age-grouped stock tables (`src/pages/AdminHome.jsx`)
- [x] Serial number handling — user-typed with a system-suggested 8-digit
      starting value (e.g. `11760001`) and a -/+ stepper, uniqueness
      checked per document type (`src/utils/serialNumber.js`)
- [x] **StockFormBase** (WSR/WSI/WTS) — Serial No.; Date (tap-anywhere
      picker); a linked-document field directly below Date (**WSI No.**,
      optional, on WSR — **AI No.**, deducts from `authorities`, on
      WSI/WTS); Customer Name ("Name" placeholder), with RSBSA + Gender
      fields appearing directly below it when Nature of Transaction is
      Procurement; Nature of Transaction, Pile ID, Variety Type, and MTS
      Sack Code+Condition (all sorted alphabetically, MTS auto-selects when
      only one condition exists); Number of Bags, Gross Kilos; Net Kilos
      auto/manual toggle (fixed alignment) + average weight per bag; Age
      (value+unit); a required single Condition choice (GQ/TRD/INF/PD/TD);
      a Procurement-only Farmers Organization toggle for the cooperative
      case, revealing a multi-member section when switched on
      (`src/components/forms/StockFormBase.jsx`)
- [x] **SackFormBase** (ESR/ESI) — Serial No.; Date; a linked-document field
      directly below Date (**ESI No.** on ESR, **SIA No.** on ESI —
      deducts from `authorities`); Customer Name; Nature of Transaction;
      repeatable Sack Code + Condition + Pieces lines via "Add line"
      (condition auto-selects when a sack code has only one configured)
      (`src/components/forms/SackFormBase.jsx`)
- [x] Every stock/sack form: single header row with a circular red **×**
      close button top-right, one full-width **Save** button at the bottom
      — no separate Cancel button
- [x] Save-without-closing: after a successful save, the form stays open,
      the serial auto-increments by 1, and shared fields (date, linked-doc
      no., customer, pile, MTS selection, variety, age, condition,
      transaction type) are retained for the next document in the same
      batch
- [x] AI/SIA deep-link — tapping an authority row in the Admin Dashboard's
      AI/SIA tab opens the matching WSI/ESI form pre-filled via
      `window.openTransactionForm` (`src/components/common/admin/AuthoritiesInfoPanel.jsx`)
- [x] Delete confirmations across every admin panel (`src/components/common/ConfirmDialog.jsx`)
- [x] Alphabetical sorting across every admin list
- [x] Hover/tap animations across nav, buttons, and form controls
- [x] **Google Sheets bridge** (`src/services/googleSheetsBridge.js`) — one
      Web App URL pointing at the user's EXISTING Apps Script (this app
      does not generate or deploy a script of its own) fronting a
      spreadsheet with separate named sheets for AI allocations, SIA
      allocations, and FOUR backup logs split by document type (Receipts/
      WSR, Issues/WSI, Sacks Receipts/ESR, Sacks Issues/ESI); pulls AI/SIA
      data into `db.authorities` (AI keyed by its own `aiNumber`, SIA keyed
      by its own, separate `siaNumber` — never shared) and pushes a backup
      row per transaction once it syncs to Firestore, matching the user's
      existing receipts sheet column-for-column for WSR
- [x] Admin Dashboard "Google Sheets" tab — configure the URL + sheet
      names, manual "Sync Now", last-synced timestamp
      (`src/components/common/admin/GoogleSheetsPanel.jsx`)
- [x] Periodic + on-reconnect AI/SIA sync worker, runs automatically once
      logged in (`startAuthoritySyncWorker` in `src/services/syncWorker.js`)
- [x] Bridge contract documented for the user's *existing* Apps Script
      deployment — this app does not generate or deploy its own script;
      see "Phase 6 — Google Sheets bridge" below for the exact
      request/response shapes to add as new functions alongside whatever
      that script already does
- [ ] Phase 7: Piles spatial map + BinCard
- [ ] Phase 8: PDF/image reports

> **Document-type split:** WSR/WSI/WTS are "stock" documents (kilos + bags,
> tied to a Pile) using `StockFormBase`; ESR/ESI are "sack" documents
> (pieces only, no pile, no kilos) using `SackFormBase`. Both share one
> `transactions` table, but stock-only fields (e.g. `pileId`, `grossKilos`)
> and sack-only fields (e.g. `sackLines`) are simply left unset on
> documents of the other kind.

> **Note:** `/admin` is a new route added in Phase 3 (not in the original
> Section 1.3 list) so the Admin Dashboard from Step 3.3 is reachable. Admins
> see a link to it from the Settings page.

### Data model revisions (post Phase-3 review)

- **User roles** are now Title Case: `Admin` | `Warehouse Supervisor` |
  `Warehouse Assistant` (was `admin` | `supervisor`).
- **Users** no longer have `supervisorInitials`. They now have `name` (full
  name, for reports/signatures) and `nickname` (shown in the welcome toast
  and on the Home/warehouse page).
- **`users.assignedWarehouses`** is now an array of `warehouses.warehouseId`
  values (multi-entry indexed as `*assignedWarehouses`) — one user can be
  assigned to multiple warehouses. **`Admin` users implicitly have access to
  every warehouse** regardless of this list (stored as `[]`); the Users tab
  hides the warehouse picker for Admins and shows a note instead.
- **New admin-configurable tables:**
  - `provinces` — `{ provinceId, code, name }`. A province can have multiple
    warehouses.
  - `warehouses` — `{ warehouseId, code, name, provinceId }`. e.g. code
    `050501`, name `ALB-TABACO GID`.
  - `varietyTypes` — `{ varietyId, category, name }`. `category` is `Rice`
    or `Palay`; each category has its own set of varieties.
  - `sackTypes` — `{ sackTypeId, category, code, weights: { BN, SH, US } }`.
    Every sack type has exactly three fixed conditions — **B**rand **N**ew,
    **S**econd **H**and, **U**nserviceable — each with its own configurable
    weight in kg, e.g. code `PPRE50`, category `Palay`, weights
    `{ BN: 0.095, SH: 0.102, US: 0.11 }`. **Weights are optional** — any
    condition can be left blank (stored as `null`) and filled in later.
  - `signatories` — one record per warehouse (keyed by `warehouseId`),
    storing only `certifiedCorrectPosition`. The "Certified Correct" *name*
    is derived at render time from whichever user(s) have the
    `Warehouse Supervisor` role for that warehouse — only the position
    (e.g. "PCO/Acting WS") is configured per warehouse.
  - `reportConfig` — a single global record (`id: 'global'`) applied to
    every report regardless of warehouse: `verifiedCorrect` (an array of
    `{ name, position }` — supports multiple signatories), `auditedByName`
    / `auditedByPosition`, and `notedByName` / `notedByPosition`.
- **Variety name placeholders** are now category-dependent: `WD1` for
  `Rice`, `PD` for `Palay`.
- **AI/SIA allocations are no longer entered manually.** They're issued via a
  centralized Google Sheet and retrieved per warehouse (Phase 6). The
  `authorities.referenceNumber` field is renamed to `aiNumber` to match the
  Sheet's "AI Number" column. The Admin Dashboard's "AI / SIA" tab is now a
  read-only info panel.

### Signatories tab — how it works

The Signatories tab has two sections:

- **Certified Correct** — grouped by *Warehouse Supervisor*, not by
  warehouse. Each supervisor (sorted alphabetically by name) gets one
  collapsible row showing their assigned warehouse names; expanding it
  reveals a single editable Position field (e.g. "PCO/Acting WS") that
  applies to every warehouse that supervisor is assigned to — no need to
  configure the same person's title once per warehouse. The *name* itself
  is always read-only, pulled from the Users tab.
- **Verified Correct / Audited By / Noted By** — global, identical on every
  report regardless of warehouse. Verified Correct supports multiple
  signatories via "Add signatory"; Audited By and Noted By are single
  name/position pairs (Noted By's position is free text, so it can say
  "Branch Manager" or "Acting Branch Manager"). One **Save** button
  persists all three.

There is no "Prepared By" line — it was an earlier addition based on an
ambiguous 5th line in the sample report image, and has been removed per
clarification.

### Data model revisions (v5 — Phase 5 redesign from real NFA documents)

Phase 5 was substantially redesigned partway through after reviewing actual
NFA "Empty Sacks Issue", "Empty Sack Receipt", "Warehouse Stock Issue", and
"Warehouse Stock Receipt" sample documents. Key differences from the
original Section 5 sketch:

- **Document-type split.** WSR/WSI/WTS are "stock" documents — kilos and
  bags, tied to a Pile — built on `StockFormBase`. ESR/ESI are "sack"
  documents — pieces only, no pile, no kilos — built on `SackFormBase`.
  Both still share the one `transactions` table (same `id`/`type`/
  `serialNo`/`status`/`date`/`isSynced`), but each only populates the
  fields relevant to its own kind.
- **Serial numbers are user-controlled, not system-generated.** Real NFA
  serials are plain numbers (sometimes letter-prefixed) printed on
  pre-numbered paper pads, e.g. `B11766626`, `0111965`, `1729564` — not the
  `[Warehouse]-[Type]-[Initials]-[Counter]` compound pattern originally
  sketched in Section 3.1. The serial is now the *first* field on every
  form: the system suggests a starting value (one higher than the highest
  existing serial for that document type), but the user can freely
  overtype it. A **−/+** stepper next to the field nudges the trailing
  numeric run by 1 (preserving any letter prefix) so a user working through
  a physical pad of pre-numbered forms can navigate without retyping.
  Uniqueness is enforced per document **type** only — the WSR pool, the WSI
  pool, etc. — not scoped by warehouse. See `src/utils/serialNumber.js`.
- **Save-without-closing.** After a successful save on a stock or sack
  form, the form does *not* close. The serial auto-increments by 1 and
  fields likely to repeat across a batch — date, customer name, pile, MTS
  sack+condition selection, variety, age, condition flags, transaction
  type — stay populated, so the next document only needs the
  per-transaction numbers re-entered.
- **MTS is derived, not typed.** Instead of a free-number MTS input, the
  user picks a combined **Sack Code + Condition** option (e.g.
  "PPRE50 - BN"), sourced from the Sack Types admin config and filtered to
  the selected Variety's category. MTS = that sack's configured weight ×
  Number of Bags, computed automatically.
- **Net Kilos auto/manual toggle is per-transaction.** Some warehouses only
  track bags *or* kilos for a given transaction, so each stock form has its
  own toggle: when on, Net Kilos = Gross Kilos − MTS (Section 4.1); when
  off, Net Kilos is typed directly.
- **Net Bags and Milling Recovery are gone from the form.** In their place,
  a small read-only line under Net Kilos shows the *average weight per
  bag* (Net Kilos ÷ Number of Bags).
- **Age is a value + unit pair** (`ageValue`, `ageUnit`: `Days` or
  `Months`) rather than a single day count — `normalizeAgeToDays()`
  converts it for any aggregate/age-bucket logic (e.g. Admin Home),
  treating 1 month as 30 days.
- **Condition is a required single choice** (`condition`: one of `GQ`,
  `TRD`, `INF`, `PD`, `TD`) on stock documents only — sack documents
  (ESR/ESI) don't carry a condition field. The user must pick one before
  saving.
- **Farmers Organization is a toggle, conditional and multi-member.** A
  switch (off by default) reveals the section; it's only meaningful when
  Nature of Transaction is "Procurement" but isn't hard-locked to it.
  Supports adding multiple members (each with Name, RSBSA ID, Gender) via
  "Add member" — `farmerCoops` is an array.
- **New `transactionTypes` table** — `{ transactionTypeId, name }` — the
  admin-configurable "Nature of Transaction" list (Milling, Procurement,
  Transfer, Sales, etc.), independent of the WSR/WSI/WTS/ESI/ESR document
  type. Configured in the Admin Dashboard's new "Transaction Types" tab.
- **Sack documents (ESR/ESI) use repeatable lines**, not a single
  sack/condition/quantity triple: `sackLines` is an array of
  `{ sackTypeId, condition, pieces }`, and the user can add as many rows as
  needed via "Add line". ESR carries a `linkedDocNo` referencing its ESI
  No.; ESI's `linkedDocNo` doubles as its SIA No. (stored in the indexed
  `siaNumber` field too).
- **AI/SIA deep-linking.** `authorities` now supports bags-only,
  kilos-only, or both (`totalAllocationBags`/`totalAllocationKilos`,
  `totalIssuedBags`/`totalIssuedKilos`) since real allocations aren't
  always defined in both units. Tapping an AI or SIA row in the Admin
  Dashboard's AI/SIA tab calls `window.openTransactionForm(type, prefill)`
  — a small global hook `App.jsx` exposes — opening the matching WSI/ESI
  form with name, variety/sack, bags, and kilos pre-filled. Saving a WSI
  with an AI No. (or an ESI with a SIA No.) deducts from that authority's
  balance even if the user typed the number manually instead of using the
  deep link, since per clarification the net kilos/pieces actually issued
  is what matters, not how the form was reached.

### Form refinements (v5.1 — second pass after document review)

A follow-up round of fixes once the v5 forms were reviewed against the
real sample documents more closely:

- **WSR no longer has an AI No.** field — it has an optional **WSI No.**
  field instead (purely informational, doesn't affect any authority
  balance). WSI and WTS keep the **AI No.** field, which deducts from
  `db.authorities` as before. Both fields are now positioned directly
  below Date rather than near the bottom of the form, and `StockFormBase`
  derives which label/behavior to use from the document `type` rather than
  a prop.
- **Serial suggestion uses a plain 8-digit starting value** (`11760001`)
  as the fallback instead of `1`, matching real NFA serial ranges. If a
  prior document of that type already exists, the suggestion is still one
  higher than the highest existing serial, same as before.
- **Date field opens its picker on a tap anywhere in the field**, not just
  the small calendar icon, via `e.currentTarget.showPicker?.()` on click.
- **Customer Name placeholder is just "Name"** (was a sample company name
  before, which read like a default value rather than an example).
- **Dropdowns are sorted alphabetically**: Nature of Transaction, Pile ID,
  Variety Type, and the MTS Sack Code + Condition list (sorted by sack
  code, then condition).
- **MTS auto-selects when a sack code has only one available condition** —
  e.g. if `PPMG50` only has a Brand New weight configured, picking
  `PPMG50` immediately selects "PPMG50 - BN" instead of requiring the user
  to open a second dropdown with one option in it. Same behavior on the
  ESR/ESI sack-line rows.
- **Auto-compute Net Kilos toggle UI fixed** — the switch knob was
  overflowing its track; it's now a standard inline flex toggle that stays
  contained.
- **Condition is required before saving** (previously optional).
- **ESR/ESI use "Add line"** instead of "Add sack line" for the
  repeatable-row button label.
- **Single full-width Save button, Close button moved to the top-right.**
  Every stock/sack form now has one header row (title + warehouse on the
  left, a circular **×** close button on the right) and one large **Save**
  button spanning the full width at the bottom — there's no separate
  Cancel button anymore; closing without saving is done via the **×**.

### Form refinements (v5.2 — Farmers Organization & close button)

- **RSBSA and Gender are now tied to the individual named in Customer
  Name**, not a separate members list. When Nature of Transaction is
  Procurement, two extra fields — RSBSA and Gender — appear directly below
  Customer Name. Both can be left blank, but the inputs are always present
  for a Procurement transaction (stored on the transaction as
  `farmerRsbsa`/`farmerGender`, `null` on non-Procurement transactions).
- **The "Farmers Organization" toggle is now Procurement-only and serves a
  narrower purpose**: it's hidden entirely unless Nature of Transaction is
  Procurement, and represents the less common case where the procurement
  is from a *cooperative* rather than an individual. Switching it on
  reveals the multi-member list (Name/RSBSA/Gender per member,
  add/remove) — entirely separate from the individual Customer
  Name/RSBSA/Gender fields above it. If the user switches Nature of
  Transaction away from Procurement after enabling this toggle, it
  automatically resets so stale cooperative data can't leak into an
  unrelated save.
- **Close (×) button is now red/crimson** on both `StockFormBase` and
  `SackFormBase`, matching the destructive/dismissive nature of closing
  without saving.

## Firebase setup (required for Phase 2 sync)

1. Create a Firebase project and enable Firestore.
2. Copy `.env.example` to `.env.local` and fill in your project's config values
   (Project Settings → General → Your apps → SDK setup and configuration).
3. Apply the Firestore security rules from PRDD Section 5.4.

## Testing the Phase 2 verification gate

With `npm run dev` running, open the browser console. `src/utils/devTools.js`
exposes helpers (dev builds only):

```js
// 1. Seed a mock transaction (isSynced: false) into local Dexie
await seedMockTransaction()

// 2. Confirm it persisted locally
await db.transactions.toArray()

// 3. In DevTools → Network, set throttling to "Offline", then seed another
//    record — it will persist locally but stay isSynced: false.
await seedMockTransaction()

// 4. Switch back to "Online" (or "No throttling"). The sync worker listens
//    for the `online` event and runs automatically, or trigger it manually:
await processSyncQueue()

// 5. Re-check — both records should now show isSynced: true, and the
//    matching documents should appear in your Firestore `transactions`
//    collection.
await db.transactions.toArray()
```

## Testing the Phase 3 verification gate

> **Schema changed to v4** — if you're updating from an earlier version,
> reset your local database first: open DevTools → Application →
> IndexedDB → right-click **BSMDatabase** → Delete database → refresh the
> page. Otherwise old records may have stale field names/values (e.g.
> lowercase roles) that no longer match the new checks.

"Type an invalid PIN... must throw a toast warning. Enter a valid registered
PIN... must direct you to the home dashboard."

1. With `npm run dev` running, the app should load straight to `/login`
   (you'll be redirected here automatically — there's no logged-in user yet).
2. **Invalid PIN:** Tap any 6 digits on the keypad (e.g. `000000`). You
   should see a red "Invalid access PIN" toast, and the dots reset.
3. **Bootstrap an account:** since the `users`, `provinces`, and `warehouses`
   tables start empty, open the browser console and run:
   ```js
   await seedAdminUser()
   ```
   This creates province `ALB` (Albay), warehouse `050501` (ALB-TABACO GID),
   and an admin account with PIN `123456`, name "Juan Santos", nickname "Juan".
4. **Valid PIN:** Tap `1 2 3 4 5 6` on the keypad. You should see a green
   "Welcome, Juan" toast and land on the Home page (`/`), which greets you
   as "Welcome back, Juan."
5. **Settings:** Tap **Settings** in the bottom navigation bar (this uses
   client-side routing so the in-memory session survives — typing the URL
   directly will reload the page and log you out). You should see your
   session info (`Juan · Admin`, `Juan Santos`, `All Warehouses`),
   a link to **Admin Dashboard**, and a **Logout** button.
6. **Admin Dashboard tabs:** On `/admin`, you'll see tabs: Provinces,
   Warehouses, Users, Varieties, Sack Types, AI / SIA, Signatories.
   - **Provinces:** Add a second province (e.g. code `CAM`, name
     "Camarines Sur"). Try editing it, then deleting it.
   - **Warehouses:** Add a warehouse under a province (e.g. code `050502`,
     name "CAM-PILI GID", province `CAM`). Edit and delete should work.
   - **Users:** Add a new user — PIN `654321`, role `Warehouse Supervisor`,
     name "Maria Reyes", nickname "Maria", and check the box for warehouse
     `050501`. It should appear in the list showing `050501` as its access.
     Try editing it (e.g. check a second warehouse too), then deleting it
     (re-add it afterward since the next steps use it).
   - **Varieties:** Add a variety under `Rice` (e.g. "NSIC Rc 222") and one
     under `Palay` (e.g. "NSIC Rc 480"). They should appear grouped by
     category.
   - **Sack Types:** Add a sack type — category `Palay`, code `PPRE50` —
     and fill in only the BN weight field (`0.095`), leaving SH and US
     blank. Save — the list should show `BN: 0.095kg · SH: —kg · US: —kg`.
     Edit it later to fill in the rest.
   - **AI / SIA:** Should show the explanatory note and "No allocations
     synced yet" (this is read-only — populated in Phase 6).
   - **Signatories:** Under "Certified Correct", find the row for warehouse
     `050501` — its Name field should show "Maria Reyes" (from the
     Warehouse Supervisor you just created in the Users tab). Set its
     Position to `PCO/Acting WS` and tap **Save** on that row. Under
     "Verified Correct, Audited By, Noted By", add one or two entries to
     Verified Correct (e.g. "Geraldine Ballete" / "Accountant III"), fill in
     Audited By (e.g. "Bernadeth Añonuevo" / "State Auditor III") and Noted
     By (e.g. "Al Martin Menes" / "Acting Branch Manager"), then tap the
     bottom **Save**. Refresh the page and confirm everything reloads
     correctly.
7. **Logout + role check:** Go to Settings and tap **Logout** — you should be
   sent back to `/login`. Log in with the new supervisor PIN (`654321`).
   You should reach Home greeting "Maria", but visiting `/admin` directly
   should redirect you back to `/` since that account's role is
   `Warehouse Supervisor`, not `Admin`.

## Testing the Phase 4 verification gate

"Tap the central interactive action button; the bottom-sheet flyout
interface menu must open smoothly. Tap outside the modal element space
boundaries or click the Cancel option button; the layout overlay must hide
instantly."

1. Log in (PIN `123456` for Admin, or `654321` for the supervisor seeded in
   Phase 3). You should land on Home with the **bottom navigation bar**
   visible — Home, Piles, a green circular **+** button in the center,
   Reports, and Settings.
2. **Open the action sheet:** Tap the green **+** FAB. A bottom sheet should
   slide up smoothly with the heading "Select Form" and five buttons: WSR,
   WSI, WTS, ESI (top row) and ESR (centered below).
3. **Tap outside to close:** Tap anywhere on the dark backdrop above the
   sheet. It should disappear instantly.
4. **Cancel to close:** Reopen the sheet (tap **+** again), then tap
   **Cancel**. It should disappear instantly.
5. **Select a form type:** Reopen the sheet and tap **WSR**. The sheet
   should close and a toast should read "WSR form — coming in Phase 5" (the
   actual forms are built next phase).
6. **Bottom nav routing:** Tap **Piles**, **Reports**, and **Settings** in
   the bottom bar — each should navigate without a full page reload (no
   flicker, session persists) and the active tab's icon/label should turn
   neon green.
7. **Home dashboard data:** Go back to Home. Run this in the console to seed
   sample pile data for warehouse `050501`:
   ```js
   await seedMockPiles()
   ```
   Refresh the page. Home should now show two summary cards — **Total
   Bags** (950, the sum of `currentBags` across the three seeded piles) and
   **Total Net Bags** (0, since no transactions exist yet) — followed by a
   list of the three piles (Pile A-1, Pile A-2, Pile B-1) each showing their
   cereal type, bag count, and age in days.
8. **Total Net Bags with a transaction:** Run this in the console:
   ```js
   const piles = await db.piles.toArray()
   await seedMockTransaction({ pileId: piles[0].pileId, status: 'Active', numberOfBags: 100 })
   ```
   Refresh the page — **Total Net Bags** should now read `100`.
9. **Multi-warehouse selector:** If you're logged in as Admin and have more
   than one warehouse configured (e.g. you added `050502` earlier), a
   dropdown should appear above the summary cards letting you switch the
   "currently selected facility" — switching it should update the piles
   shown (it'll be empty for any warehouse other than `050501` until you
   seed piles there too).

> **A note on the summary cards:** "Total Bags" is the sum of
> `piles.currentBags` for the selected warehouse (the "total counted volume
> metric"). "Total Net Bags" is the sum of `numberOfBags` from that
> warehouse's *Active* transactions — the bags actually recorded via
> WSR/WSI/WTS forms, used here as the "overall inventory metric". It'll
> read 0 until transactions are created. Per-pile age (Section 4.2) is
> still shown on each pile card. Piles themselves don't yet have an
> admin/UI flow to create or edit them (that's Phase 7), hence the
> `seedMockPiles()` dev helper for now.

## Testing the Phase 5 verification gate

> **Schema changed to v5** — reset your local database first: DevTools →
> Application → IndexedDB → delete **BSMDatabase** → refresh, then run
> `await seedAdminUser()` again.

1. Seed the lookups the forms depend on:
   ```js
   await seedFormConfig()      // Transaction Types, Varieties (WD1/PD), Sack Types (PPMG50/PPRE50)
   await seedMockPiles()       // sample piles in warehouse 050501
   await seedMockAuthority()   // one sample AI + one sample SIA
   ```
2. **Stock form — WSR:** Tap the **+** FAB → **WSR**. Confirm the header
   shows the "WSR" title with a circular **×** close button at the
   top-right (no separate Cancel button anywhere). The Serial No. field
   should be pre-filled with a suggestion like `11760001` and have
   **−**/**+** buttons beside it — tap **+** a couple of times and confirm
   the number increments by 1 each time. Tap anywhere in the Date field
   (not just the calendar icon) and confirm the native date picker opens.
   Directly below Date, confirm there's a **WSI No.** field (not "AI
   No.") — leave it blank, it's optional on WSR. Confirm the Customer Name
   field's placeholder just says "Name". Open the Nature of Transaction,
   Pile ID, and Variety Type dropdowns and confirm their options are
   alphabetically sorted; pick "Milling", a Pile, and variety **PD**.
   Under "MTS — Sack Code & Condition", confirm only **PPRE50** options
   appear (Palay-only, since PD is a Palay variety) — pick `PPRE50 - BN`.
   Enter `100` bags and `5050` Gross Kilos. Net Kilos should auto-show
   `5040.50` (100 × 0.095 = 9.5 MTS, 5050 − 9.5), with "Average weight per
   bag: 50.41 kg" beneath it. Confirm the "Auto-compute Net Kilos" toggle
   knob sits neatly inside its track (not overflowing) — toggle it off,
   confirm the field becomes editable, then back on to confirm it
   recalculates. Try tapping **Save** without picking a Condition — it
   should be blocked with an error toast; pick a Condition (e.g. GQ) and
   **Save** again.
3. **Save-without-closing:** After saving, the form should *stay open*,
   show a success toast with the serial number, and the Serial No. field
   should have auto-incremented by 1. Date, WSI No., Customer Name, Nature
   of Transaction, Pile, Variety, MTS selection, and Condition should all
   still be filled in — only Number of Bags and Gross Kilos should have
   cleared, ready for the next document in the batch. Tap the **×** in the
   top-right to close.
4. **Procurement farmer toggle:** Reopen a WSR. Confirm "Farmers
   Organization" appears as a section with a toggle switch, off by
   default. Switch it on — one member's Name/RSBSA/Gender fields should
   appear. Tap "Add member" to confirm a second member row appears, each
   independently removable (except the last one). Toggling it back off
   should hide the section again.
5. **WSI/WTS — AI No. instead of WSI No.:** Open a **WSI** or **WTS**
   form and confirm the field directly below Date is labeled **AI No.**
   (not "WSI No.").
6. **AI deep-link:** Go to `/admin` → **AI / SIA** tab. You should see the
   seeded AI (`26219637`) and SIA (`0111965`) rows with their remaining
   bags/kilos. Tap the AI row — it should close the admin dashboard view
   and open a **WSI** form directly, with AI No. `26219637`, Customer Name,
   variety, Number of Bags (`250`), and Gross Kilos (`12978`) all
   pre-filled. Pick a Condition and **Save**, then go back to the AI/SIA
   tab — the AI's remaining balance should have decreased.
7. **Sack form — ESI:** Tap **+** → **ESI**. Confirm the field directly
   below Date is labeled **SIA No.**. Fill Serial No., Date, Customer Name
   ("Name" placeholder), Nature of Transaction (sorted alphabetically).
   Under "Sack Lines", pick a sack code — if that code has only one
   configured condition (e.g. `PPMG50` with only a BN weight), confirm its
   Condition dropdown auto-fills without you having to open it. Enter a
   pieces count, then tap "Add line" (not "Add sack line") to add a second
   row with a different sack code/condition. Confirm "Total pieces"
   updates to the sum. Enter the SIA No. (`0111965`) and tap the single
   full-width **Save** button at the bottom. Check the AI/SIA tab again —
   the SIA's remaining pieces should have decreased.
8. **ESR linking:** Open an **ESR** form and confirm its linked-document
   field (directly below Date) is labeled "ESI No." (not "SIA No." like
   the ESI form).
9. **Duplicate serial rejection:** Open a new WSR, manually type in a
   serial number that you already used in step 2, and tap **Save** — you
   should see an error toast like "Serial ... is already used for a WSR
   document" and the save should be blocked. Changing it to an unused
   number should allow the save to proceed.

## Phase 6 — Google Sheets bridge

One Apps Script Web App URL — the user's EXISTING script, not one this app
deploys — fronts a single spreadsheet containing six named sheets (the
names are all admin-configurable, defaults shown):

- **AI** — Authority to Issue allocations (stock docs: WSR/WSI/WTS),
  referenced by its own **AI Number**
- **SIA** — Sack Issuance Authority allocations (sack docs: ESR/ESI),
  referenced by its own, separate **SIA Number** — AI Number and SIA
  Number are distinct fields and are never shared between the two record
  types, even though both ultimately track an "authority" balance in this
  app's `authorities` table
- **Receipts backup (WSR)** — defaults to `DATA_ENTRY`, matching the
  user's existing receipts sheet name and column shape exactly (see below)
- **Issues backup (WSI)** — new sheet, same column shape as Receipts with
  "AI #" in place of "WSR #" / "Batch No"
- **Sacks Receipts backup (ESR)** and **Sacks Issues backup (ESI)** — new
  sheets, pieces-based shape (no kilos/bags columns, since sack documents
  don't have them)

Configure the URL and every sheet name in the Admin Dashboard's **Google
Sheets** tab.

> **This app does not generate, deploy, or ship its own Apps Script.**
> The Google Sheet already has its own Apps Script running on it with
> functions for other purposes, and that script must not be touched,
> overwritten, or replaced. `src/services/googleSheetsBridge.js` only
> *calls* whatever Web App URL is configured — it describes the contract
> this app needs, so the script's maintainer can add matching functions
> alongside whatever already exists, rather than this app prescribing a
> full script to paste in.

### Matching your existing receipts sheet column-for-column

The user's existing receipts sheet (sample name `DATA_ENTRY`) has these
columns, in this order:

```
Timestamp | Date | Transaction | Variety | Bags | Net Kilos |
Warehouse Name | Customer Name | Province | Net Bags | WH Code | WSR # |
Batch No | Col_15
```

A few things worth calling out, confirmed from a real data sample:

- **`Timestamp`** is when the row was actually *written* (server time);
  **`Date`** is the date typed into the form — these can differ, and both
  are preserved.
- **`Net Bags` = `Net Kilos / 50`**, matching `calculateNetBags()` in
  `src/utils/calculations.js` exactly — even for Procurement/Palay rows,
  where the math still checks out (e.g. 6204.025 kg / 50 = 124.0805).
- **`Col_15` is the age column, but it's only ever populated when age was
  entered in MONTHS.** A blank `Col_15` means the original entry's age was
  in days (and isn't recorded in this column at all); a value like `8`
  means "8 months old". This app's `pushTransactionBackup()` reproduces
  this exact behavior: `Col_15` is set to `transaction.ageValue` only when
  `transaction.ageUnit === 'Months'`, and left blank otherwise.
- **`WH Code`** and **`Province`** are the warehouse's facility code and
  province code, not their full names — `Warehouse Name` carries the full
  name separately.

`pushTransactionBackup()`'s WSR row shape matches every one of these
columns exactly, so it can append directly into the user's real
`DATA_ENTRY` sheet (or whatever it's renamed to in the admin config)
without any restructuring on the sheet side.

### New sheets needed (Issues + Sacks)

The user doesn't yet have sheets for WSI (issues), or for ESR/ESI (sack
receipts/issues) — three new tabs need to be added to the spreadsheet,
named whatever is configured in the admin tab's corresponding fields:

- **Issues backup (WSI)** — identical columns to the receipts sheet above,
  except `WSR #` is replaced with `AI #` (an issuance is linked to an
  Authority to Issue, not a prior WSI), and there's no `Batch No`
  equivalent (that was specific to milling receipts).
- **Sacks Receipts backup (ESR)** and **Sacks Issues backup (ESI)** — since
  sack documents track pieces, not kilos/bags, these use a related but
  simpler shape:
  ```
  Timestamp | Date | Transaction | Warehouse Name | Customer Name |
  Province | WH Code | Pieces | ESI # (on ESR) or SIA # (on ESI)
  ```

The exact contract this app expects (see the full header comment in
`src/services/googleSheetsBridge.js` for the canonical version, including
`buildBackupRow()` which builds each shape above):

```
GET  {webAppUrl}?action=fetchAuthorities&sheet={sheetName}&type=AI
  -> { status: "SUCCESS", rows: [ { aiNumber, assignedWarehouseCode,
       customerName, varietyName, totalAllocationBags,
       totalAllocationKilos }, ... ] }

GET  {webAppUrl}?action=fetchAuthorities&sheet={sheetName}&type=SIA
  -> { status: "SUCCESS", rows: [ { siaNumber, assignedWarehouseCode,
       customerName, sackCode, condition, totalAllocationBags,
       totalAllocationKilos }, ... ] }

POST {webAppUrl}  body: { action: "appendTransaction", sheet: sheetName,
       row: { ...one of the four shapes above, depending on document type... } }
  -> { status: "SUCCESS" }
```

If the existing script uses different action names, parameter names, or
response shapes than the above, the request-building/response-parsing in
`googleSheetsBridge.js` is the side that should change to match it — not
the other way around.

### How the backup actually runs, end to end

This is the full path a transaction takes, so it's clear nothing touches
the Sheet except through one narrow, well-tested function:

1. A WSR/WSI/WTS/ESR/ESI form is saved — this writes to the local Dexie
   `transactions` table immediately (works fully offline), with
   `isSynced: false`.
2. `processSyncQueue()` (Phase 2's existing sync engine, runs on load and
   whenever connectivity returns) finds that record and `setDoc`s it to
   Firestore. **Firestore is the primary cloud store** — this step alone
   is what makes the data durable in the cloud.
3. Only *after* the Firestore write succeeds, `syncWorker.js` makes one
   best-effort call to `pushTransactionBackup(tx, context)`, which looks
   up the transaction's pile/warehouse/province/variety/transaction-type
   names, builds the row shape for that document's type via
   `buildBackupRow()`, and does a single `fetch(..., { method: 'POST' })`
   to the configured Web App URL with `{ action: 'appendTransaction',
   sheet: <the right sheet name>, row: {...} }`.
4. If that POST fails for any reason (offline, bad URL, the script errors
   out, anything) it's caught and logged to the console — it does **not**
   retry indefinitely, does **not** mark the transaction as unsynced
   again, and does **not** affect the Firestore result the user sees as a
   toast. The backup is best-effort and secondary by design.
5. Nothing in this app ever calls anything on the Sheet except this one
   POST shape (to append a row) and the `fetchAuthorities` GET (to read
   AI/SIA rows) — there's no delete, no update-in-place, no formatting
   change, no script-modification call anywhere in the codebase. The
   existing script's other functions are never invoked or referenced.

**Pulling AI/SIA data:** `syncAuthoritiesFromSheets()` fetches both the AI
and SIA sheets in one pass and upserts matching records into
`db.authorities` — AI rows matched/keyed by `aiNumber`, SIA rows
matched/keyed by `siaNumber`. Existing `totalIssuedBags`/`totalIssuedKilos`
are preserved across re-syncs, since issuance is tracked locally as
WSI/ESI forms are saved, not re-derived from the Sheet. This runs three
ways: once immediately when a user logs in, on a 5-minute interval in the
background (`startAuthoritySyncWorker` in `src/services/syncWorker.js`),
and again whenever the browser regains connectivity — plus a manual "Sync
Now" / refresh button in both the Google Sheets tab and the AI/SIA tab
itself.

All bridge calls degrade gracefully: if no URL is configured, or the
device is offline, or the script returns something unexpected, the
relevant function returns a typed `{ ok: false, reason }` rather than
throwing — important since this can run unattended in the background.

### Testing the Phase 6 verification gate

> **Schema changed to v8** — reset your local database first: DevTools →
> Application → IndexedDB → delete **BSMDatabase** → refresh, then run
> `await seedAdminUser()` again.

Without changes to the existing Apps Script, you can still verify the UI
plumbing:

1. Go to `/admin` → **Google Sheets** tab. Enter any syntactically valid
   URL (e.g. `https://example.com/test`), leave every sheet name at its
   default, and tap **Save** — you should see a success toast, and the
   "Last synced" line should still read "Never" (saving config doesn't
   trigger a sync by itself).
2. Tap **Sync Now**. Since `https://example.com/test` doesn't implement
   the expected endpoints, you should see a "Sync failed" error toast
   (this confirms the request path runs and fails gracefully rather than
   crashing the page).
3. Go to the **AI / SIA** tab — confirm a refresh icon button appears next
   to the section header, and a "Last synced: Never" line beneath the
   description. Tapping it should produce the same graceful failure toast
   as step 2, since it calls the same underlying sync function.
4. **With the real script updated:** once whoever maintains the existing
   Apps Script has added the `fetchAuthorities`/`appendTransaction`
   actions described above, configure the real Web App URL, add a row to
   the AI sheet with a warehouse code that matches one of your configured
   warehouses (e.g. `050501`) and a variety name that matches one of your
   configured varieties (e.g. `PD`), then tap **Sync Now**. You should see
   a success toast like "Synced 1 AI and 0 SIA record(s)", and the new
   allocation should appear in the AI/SIA monitor on Home, tappable into a
   pre-filled WSI form exactly like the `seedMockAuthority()`-created ones.
5. **Backup logging:** with the same real deployment configured, save a
   WSR. Once the Phase 2 sync queue picks it up (near-instant if already
   online), check your real `DATA_ENTRY` sheet — a new row should appear
   matching the columns described above, including a blank `Col_15` if you
   entered the age in Days, or a number if you entered it in Months.

## Phase 7 groundwork — live pile totals, variety lock, customer directory, AI/SIA on Home

A round of fixes once real usage surfaced several Phase 5/6 gaps: piles
never actually updated when transactions saved against them, Home's
totals used the wrong formula, AI/SIA had no user-facing home, and there
was no customer memory across forms. Schema bumped to **v8**.

- **Piles are now variety-locked, and totals are LIVE, not re-derived.**
  `piles` gains `varietyId` (kept alongside the existing `cerealType` —
  both matter, neither replaces the other) and `currentKilos` (alongside
  `currentBags`). `src/utils/pileLedger.js` exports
  `applyTransactionToPile()`, called right after every WSR/WSI save:
  WSR adds `numberOfBags`/`netKilos` to the pile's running totals; WSI
  subtracts them. **WTS does not yet move pile totals** — per
  clarification, WTS is actually a distinct "in-warehouse" document with
  its own receipt AND issue sides in one document (both with their own
  bags/kilos), customer being the warehouse supervisor — that hasn't been
  designed or built yet, and is flagged as outstanding work below, not
  silently faked with the current single-sided form.
- **Selecting a Pile on a stock form auto-selects and locks its Variety**
  (`StockFormBase.jsx`) — since a pile can never mix varieties, the
  Variety Type field becomes read-only the moment a Pile is chosen,
  showing that pile's actual variety.
- **"New Pile" option in the Pile ID dropdown** opens
  `src/components/forms/NewPileDialog.jsx`, an inline sub-form (Pile Name,
  Category, Variety) that creates the pile on the spot, adds it to
  `db.piles`, and auto-selects it back on the parent transaction form —
  no need to leave the WSR/WSI/WTS form to set up a pile that doesn't
  exist yet.
- **Customer Name autocomplete** (`src/components/forms/CustomerNameAutocomplete.jsx`
  + `src/utils/customerDirectory.js`) — once 3+ characters are typed, up
  to 6 matching names are suggested from a `customers` directory built
  automatically as forms are saved. Picking a suggestion (or typing an
  exact existing name) auto-fills RSBSA + Gender if on record, and
  auto-enables the Farmers Organization toggle (with its saved member
  list) if that name was previously recorded as a cooperative — the app
  remembers, per name, whether it's an individual or a coop, exactly as
  requested.
- **Save-without-closing now retains ONLY:** date, Nature of Transaction,
  Pile, Variety, MTS selection, Age + unit, and Condition. Every other
  field (Customer Name, RSBSA, Gender, linked doc no., bags, kilos,
  Farmers Organization toggle + members) clears, and focus/scroll jumps
  back to the Customer Name field so the next entry can start typing
  immediately (`scrollToCustomerName()` in `StockFormBase.jsx`, using a
  `forwardRef`-exposed `.focus()` on the autocomplete component).
- **Home's "Total Net Bags" formula was wrong and is now fixed**: it was
  summing a transaction bag-count field; it's now `(sum of every pile's
  currentKilos in this warehouse) / 50`, shown to 2 decimal places. "Total
  Bags" remains the live sum of `currentBags`.
- **Home's pile cards now show Variety (not just category), current Bags,
  and current Kilos** per pile, alongside the existing age display.
- **AI / SIA Monitor on Home** (`src/components/common/AuthorityMonitor.jsx`)
  — previously AI/SIA only existed inside the Admin Dashboard's AI/SIA
  tab, which is Admin-only by route and therefore invisible to the
  Warehouse Supervisors/Assistants who actually need it. It now also
  appears on Home, above the Piles list, scoped to ONLY the warehouses
  the logged-in user can access (`WarehouseContext.accessibleWarehouses`).
  Tapping a row auto-switches the selected warehouse first if needed
  (`setCurrentWarehouseId`), then deep-links into a pre-filled WSI (AI) or
  ESI (SIA) form, same as the admin panel's existing behavior. AI rows
  show Customer Name + Nature of Transaction; SIA rows show the same, and
  critically use **"pieces"** as the unit label instead of "bags" (sacks
  are counted as pieces) — this was also fixed in the Admin Dashboard's
  AI/SIA tab itself.
- **Admin Home now reads live pile totals**, not a re-derivation from
  transaction history — this is why seeded mock pile data (e.g. the 950
  bags from `seedMockPiles()`) now shows up immediately in every Admin
  Home table, even with zero transactions recorded. Net Bags is rounded to
  exactly 2 decimals everywhere on the page.
- **Admin Home gained a 4th section, "Pending AI / SIA"**, listing every
  non-Complete authority across all warehouses (type, reference number,
  warehouse, customer, remaining balance, status) — so admins retain a
  cross-warehouse view even though the day-to-day AI/SIA monitor now lives
  on each user's Home page, scoped to their own warehouses.
- **`seedMockPiles()` now sets realistic `currentKilos` and links each
  seeded pile to a real `varietyId`** (via `seedFormConfig()`'s WD1/PD
  records), so the live-totals math has something correct to show
  immediately after seeding.

### Outstanding from the prior round (now resolved)

- ~~WTS redesign~~ — still genuinely deferred (see below, unchanged).
- ~~`SackFormBase.jsx` lacked customer-autocomplete~~ — **done this round**,
  see below.

## Phase 7 — warehouse-scoped serials, series navigation, admin monitoring, tabbed AI/SIA

A second round of fixes, all from live testing feedback. Schema bumped to
**v9**.

- **Every warehouse now keeps its own document series, per type.**
  `transactions` gains an indexed `warehouseId` field (previously only
  reachable indirectly via `pileId`, and sack documents had no warehouse
  link at all). `src/utils/serialNumber.js` was rewritten so
  `suggestNextSerial`, `isSerialTaken`, and the new `findTransactionBySerial`
  are all scoped to `(type, warehouseId)` — switching the warehouse on a
  form now correctly switches which serial pool applies, instead of
  treating every warehouse's WSR/WSI/WTS/ESR/ESI numbers as one shared
  pool (which could both falsely block a legitimate serial and falsely
  allow a duplicate across warehouses).
- **Series back-navigation, with Update/Delete.** Both `StockFormBase.jsx`
  and `SackFormBase.jsx` now have a `<` / `>` stepper around the serial
  field (replacing the old `-`/`+`). Stepping to, or directly typing, a
  serial that already has an Active document for the current `(type,
  warehouse)` loads that document's full data into the form and swaps the
  footer from **Save** to **Update** (green) and **Delete** (red):
  - **Update** reverses the transaction's OLD effect on its pile (and any
    linked AI/SIA balance), saves the edited fields, then re-applies the
    NEW effect — so pile totals and authority balances always reflect
    only the corrected values, never double-counted.
  - **Delete** reverses the effect, asks for confirmation via
    `ConfirmDialog` (never a native `confirm()`), then removes the
    transaction entirely — freeing that serial number for a fresh entry,
    exactly as requested.
  - `src/utils/pileLedger.js` gained `reverseTransactionFromPile()`, the
    inverse of `applyTransactionToPile()`, used by both Update and Delete.
- **Admin Monitoring page** (`src/pages/AdminMonitoring.jsx`) replaces the
  Piles tab for Admins specifically — an admin has no warehouse of their
  own, so a piles list was never useful to them. `BottomNav.jsx` is now
  role-aware: Admins see "Monitor" (Radar icon, `/monitoring`), everyone
  else still sees "Piles". The Monitoring page has AI/SIA tabs showing
  every authority across every warehouse — full Milling/Remilling/Test
  Milling monitoring is planned but explicitly NOT built yet.
- **Tabbed AI/SIA monitor on Home** (`AuthorityMonitor.jsx` rewritten) —
  AI and SIA are now separate top-level tabs, each with its own
  Pending/Completed sub-tabs. A checkbox on the left of each row lets the
  user manually mark an allocation "Completed" even if it isn't fully
  issued against (some AI/SIA don't need full documentation to be done);
  unchecking it from the Completed tab moves it back to Pending. This is
  tracked via the new `authorities.manuallyCompleted` field, independent
  of the balance-derived Pending/Complete/Over-Issued status.
- **Admins can now switch warehouses from inside a transaction form.**
  `StockFormBase.jsx` and `SackFormBase.jsx` both show a warehouse
  selector in the header whenever more than one warehouse is accessible
  (which for Admins means every warehouse) — switching it resets
  Pile/Variety/MTS selection and exits any in-progress series edit, since
  those are all warehouse-scoped. The selector is now on its own row below
  the title, not crammed next to the close button.
- **Every list that can be sorted, is sorted** — warehouse switchers (Home,
  both form headers), the Pile ID dropdown, Variety Type, Nature of
  Transaction, Sack Code — all alphabetical.
- **Mock piles always have a variety now.** `seedMockPiles()` is
  self-sufficient: if `WD1`/`PD` variety records don't exist yet, it
  creates minimal versions itself instead of silently seeding a pile with
  a blank `varietyId` (which broke the pile's variety lock).
- **Pile age bug fixed.** The actual bug: `applyTransactionToPile()` never
  touched a pile's `initialAgeValue`/`dateOfReceipt` at all — only
  `currentBags`/`currentKilos` — so entering "1 day" on a WSR had no way
  to reach the pile's displayed age. Per clarification, pile age is now
  treated as its own directly-editable property (not auto-derived from
  whatever a WSR's age field says), with a dedicated **Edit Age** dialog
  (`EditPileAgeDialog.jsx`, opened by tapping the age on any pile card) —
  "disregarding everything else," since a separate department sometimes
  handles age determination.
- **Pile card redesign** (Home) — row one: Pile Name (left, tappable —
  opens the WSR/WSI/WTS menu) and Age (right, tappable — opens Edit Age).
  Row two: Net Bags (left) and Net Kilos with average weight per bag
  (right), formatted exactly as `"1,509.24 kg (52.04)"` with no extra
  label text, both to 2 decimals.
- **Pile action menu repositioned.** `PileActionSheet.jsx` is no longer a
  bottom sheet (which hid WTS below the nav bar) — it's now a compact
  popover anchored directly beneath the tapped pile card, three buttons
  (WSR/WSI/WTS), no explanatory subtext.
- **Condition buttons are now full-width** — a 5-column grid spanning the
  whole form width instead of small wrapped pills, per request for better
  visibility.
- **Customer autocomplete is now genuinely universal.** `SackFormBase.jsx`
  (ESR/ESI) had fallen behind `StockFormBase.jsx` with a stale,
  unscoped serial implementation — it's been fully rewritten to match:
  same `CustomerNameAutocomplete`, same address field, same warehouse-
  scoped serial logic, same series back-navigation with Update/Delete.
- **"WS" / "Acting WS" customer suggestions.** Typing a Customer Name
  starting with "WS" or "Acting WS" (case-insensitive) now searches
  `db.users` for Warehouse Supervisors instead of the regular customer
  directory (`searchWarehouseSupervisors()` in `customerDirectory.js`),
  suggesting `"WS {name}"` / `"Acting WS {name}"`. Selecting one
  auto-fills Address from that supervisor's assigned warehouse(s) —
  joined with `"; "` if assigned to more than one. This required adding
  `address` to the `warehouses` table and to the Admin Dashboard's
  Warehouses panel.
- **Available stock shown on issuances, with the right kind of limit.**
  Selecting a Pile on a WSI form now shows that pile's available bags and
  kilos right below the quantity inputs. Net Kilos is **hard-capped** —
  the save/update is blocked if it would exceed the pile's available
  kilos, since kilos is what warehouses are actually accountable for.
  Number of Bags alone only gets a **soft amber warning**, not a block,
  since some transaction types legitimately exceed the bag count without
  exceeding the kilos. Editing an existing WSI through series navigation
  correctly accounts for that entry's own already-deducted amount, so
  re-saving it unchanged doesn't falsely trip the limit.
- **Autocomplete dropdown aesthetics improved** — avatar-style initials
  circles (or a building icon for WS suggestions, a people icon for
  cooperatives), subtle dividers between rows, a proper elevation shadow,
  and address shown as muted subtext under the name.

### Outstanding from this round

- **WTS redesign is still not built.** It needs its own form (not a reuse
  of `StockFormBase`) with a receipt side and an issue side, each with
  their own bags/kilos, and the warehouse supervisor as the implicit
  customer. Until it exists, WTS transactions save normally but do not
  move any pile's running totals — this has come up consistently across
  sessions and remains intentionally deferred.
- **AI sheet's Note1/Note2/Note3 long-press detail and SIA's multi-sack-
  type parsing** (splitting strings like `"4 BN / 144 US / 876 SH / 6014
  BN / 193 US"` into separate sack-type groups by detecting which
  condition code repeats) are deferred until real Google Sheet connection
  testing is underway, per explicit instruction — `rawSiaAllocation` is
  stored as-is in the meantime and shown verbatim in both monitoring
  views.
- **Milling / Remilling / Test Milling / Test Remilling monitoring** on
  the new Admin Monitoring page is planned but not built — AI/SIA only,
  for now.

### Testing this round's fixes

> **Schema changed to v9** — reset your local database first: DevTools →
> Application → IndexedDB → delete **BSMDatabase** → refresh, then run
> `await seedAdminUser()` again.

1. `await seedFormConfig()` then `await seedMockPiles()` then
   `await seedMockAuthority()`.
2. Log in as the seeded Admin — confirm the bottom nav shows **Monitor**
   (not Piles), and `/monitoring` shows AI/SIA tabs with the seeded
   records.
3. Open a WSR. Confirm the warehouse selector sits on its own row below
   the title (not crammed beside the close button). Note the suggested
   Serial No., save it, then reopen WSR — the suggested serial should be
   one higher, scoped to that specific warehouse.
4. Tap `<` on the serial field to step back to the one you just saved —
   confirm the form loads that document's full data and the footer shows
   **Update** (green) / **Delete** (red) instead of Save. Change the
   Gross Kilos and tap **Update** — confirm the pile's totals reflect only
   the new value (not double-counted). Tap `<` again, then **Delete** —
   confirm a confirmation dialog appears, and after confirming, the pile's
   totals reverse correctly and that serial is free again.
5. On a pile card on Home, tap the pile name — confirm a small WSR/WSI/WTS
   menu appears directly under that card (not hidden below the nav bar).
   Tap the age — confirm an Edit Age dialog opens; set a new value and
   confirm the pile card updates immediately.
6. Confirm a pile card shows `"{bags} net bags"` on the left and
   `"{kilos} kg ({avg})"` on the right of the second row, both to 2
   decimals, no extra label text.
7. Start typing `WS` in any Customer Name field — confirm Warehouse
   Supervisor users are suggested (if any are seeded) instead of the
   regular customer directory, and selecting one fills in that
   supervisor's warehouse address.
8. Open a WSI, select a pile with stock — confirm "Available on {pile}: …
   bags · … kg" appears below the quantity fields. Enter a Net Kilos value
   higher than available — confirm Save is blocked with an error. Enter a
   Number of Bags higher than available but keep Net Kilos within range —
   confirm it saves with only a soft amber warning shown.
9. Open an ESR or ESI — confirm Customer Name now has the same
   autocomplete behavior as WSR, and the same `<`/`>` series navigation
   works.

## Phase 7 — monitoring placement, true per-warehouse series, AI/SIA detail, progress display fix

A third round, fixing several things that only showed up under real use.

- **AI/SIA monitor moved off Home entirely.** It was meant to live only on
  a dedicated monitoring page, not the main dashboard. Admins already had
  `/monitoring`; regular users now get the same content on the existing
  `/piles` route (`Piles.jsx` now renders `AuthorityMonitor`, replacing
  its old unbuilt-spatial-map stub). `BottomNav`'s second tab is "Monitor"
  for everyone now, pointing at `/monitoring` for Admins and `/piles` for
  everyone else.
- **Each warehouse's serial series now genuinely starts independent.**
  `suggestNextSerial`'s fallback changed from an arbitrary
  `'11760001'` constant to `'1'` — a brand-new warehouse with no prior
  documents of a given type starts that series at 1, not inheriting a
  number that implied continuity with some other warehouse's range.
- **Fixed the actual age bug.** The real defect was in
  `EditPileAgeDialog`: it only ever accepted a number of *days*, so
  entering "7" meant 7 days, not 7 months — which is why a 7-month-old
  Palay pile was landing in the "0–6 months" bucket on Admin Home. The
  dialog now has a Days/Months unit selector, exactly like every
  transaction form's Age field, and converts via `normalizeAgeToDays`
  before storing — `initialAgeValue` on a pile is now reliably stored in
  real days. (A normal WSR's Age field still does NOT touch the pile's
  age — that remains exclusively the Edit Age dialog's job, per the
  original clarification — this was confirmed working correctly already.)
- **Bag-count display priority now differs by audience.** On Home (user-
  facing), a pile card's second row leads with the actual bag count and
  shows net bags as smaller parenthetical subtext — warehouse staff
  physically count bags, so that's the number they need first. Admin Home
  was already 100% net-bags-based throughout (it never showed raw bag
  counts), so it needed no change there; only the Home summary cards
  were adjusted so "Total Net Bags" renders visibly smaller/secondary
  next to "Total Bags".
- **Warehouse Supervisors with multiple assigned warehouses now produce
  one suggestion row per warehouse**, not one row with every address
  silently joined together. `searchWarehouseSupervisors()` returns e.g.
  "WS John Jones — ABACORP A" and "WS John Jones — ABACORP B" as distinct
  picks (only when the supervisor has 2+ assignments — a single-warehouse
  supervisor still shows as one plain row), each carrying only that one
  warehouse's address, so the right address always gets written.
- **AI rows now show their variety; SIA rows now show sack type +
  condition.** Both `AuthorityMonitor.jsx` (user) and `AdminMonitoring.jsx`
  (admin) display the AI's linked variety name/category, and the SIA's
  `sackTypeRaw` (plus the raw allocation string, e.g. "PPRE50 — 65 bn / 17
  sh") as a subtext line.
- **AI authorizes NET kilos, not gross — fixed at the source of the bug.**
  Tapping an AI row used to prefill the opened WSI form's *Gross* Kilos
  field with the AI's authorized figure, which is wrong: that figure is
  already net. It now prefills Net Kilos directly and switches Auto-
  compute Net Kilos off, so the value isn't silently overwritten by a
  Gross/MTS calculation the user hasn't entered yet.
- **SIA rows now pre-fill the ESI form's actual sack lines** where
  possible. New `src/utils/siaParsing.js` resolves a SIA's
  `sackTypeRaw`/`rawSiaAllocation` into real `{ sackTypeId, condition,
  pieces }` lines for the common single-sack-type case (matching the
  sheet's `"PPRE50"` + `"65 bn / 17 sh"` shape exactly). True multi-sack-
  type allocations (`"PPRE50/PPMG50"` with the duplicate-condition-code
  split) are still explicitly deferred per earlier instruction — when
  unresolvable, the ESI form shows the raw allocation string as a banner
  instead of silently leaving the form blank with no explanation.
- **Progress display fixed everywhere AI/SIA balances are shown** (Home's
  monitor, the Admin Monitoring page, and the Admin Dashboard's AI/SIA
  config tab). The old display showed *remaining*/total — which made a
  freshly-issued allocation with nothing used yet look identical in shape
  to a fully complete one (`250/250` either way, just meaning different
  things depending on which number was "remaining"). It now always shows
  **issued / total** as a large, color-coded headline figure (white while
  pending, neon green at exactly Complete, crimson if Over-Issued)
  instead of a small subtext line with a separate "Pending" label — the
  number itself communicates status now, so the redundant text label was
  removed.

### Testing this round's fixes

> No schema version change this round — v9 remains current. A fresh
> reseed is still recommended to pick up the corrected `seedMockAuthority`
> fields: `await seedMockAuthority()` again is enough, no full database
> reset required.

1. Go to Home — confirm there is **no** AI/SIA section anywhere on the
   page anymore. Go to the second bottom-nav tab ("Monitor") — for a
   regular user this should be `/piles` showing the AI/SIA monitor; for
   an Admin it should be `/monitoring`.
2. Open WSR on a warehouse with zero prior WSR documents — confirm the
   suggested serial is `1`, not a large placeholder number.
3. Tap the seeded AI's row in the monitor — confirm the opened WSI form's
   **Net Kilos** field already shows `12978.00` with Auto-compute Net
   Kilos switched OFF (not Gross Kilos prefilled). Confirm the Pile ID
   dropdown only lists piles matching the AI's variety.
4. Tap the seeded SIA's row — confirm the opened ESI form's Sack Lines
   section already has a line filled in (PPRE50, with whatever condition
   that sack type has configured, 487 pieces) rather than starting blank.
5. On the monitor, confirm the AI row shows its variety name underneath
   the customer name, and the SIA row shows "PPRE50" underneath its
   customer name. Confirm the right-hand figure reads **"0.00 / 12978.00
   kg"** (large, white) for the freshly-seeded AI — not a number that
   could be mistaken for "fully issued."
6. Open a pile's Edit Age dialog, enter `7` with the unit set to
   **Months**, save — go to Admin Home and confirm that pile now appears
   under the Palay "6.1–12 months" bucket, not "0–6 months".
7. On Home, confirm a pile card's second row shows the actual bag count
   prominently with net bags as smaller parenthetical text next to it
   (not the other way around).
8. If you have a Warehouse Supervisor user assigned to 2+ warehouses, type
   "WS" + part of their name in any Customer Name field — confirm two (or
   more) separate suggestion rows appear, each tagged with a different
   warehouse, and selecting one fills in only that warehouse's address.

## Structure

```
src/
├── assets/
├── components/
│   ├── common/
│   │   ├── ProtectedRoute.jsx
│   │   ├── ConfirmDialog.jsx
│   │   ├── TransactionModal.jsx
│   │   ├── AuthorityMonitor.jsx   # tabbed AI/SIA monitor on Home, per-user scoped
│   │   ├── PileActionSheet.jsx    # WSR/WSI/WTS popover anchored to a pile card
│   │   ├── EditPileAgeDialog.jsx  # direct pile age override
│   │   └── admin/
│   │       ├── shared.js
│   │       ├── ProvincesPanel.jsx
│   │       ├── WarehousesPanel.jsx       # warehouses now carry an address
│   │       ├── UsersPanel.jsx
│   │       ├── VarietyTypesPanel.jsx
│   │       ├── SackTypesPanel.jsx
│   │       ├── TransactionTypesPanel.jsx
│   │       ├── AuthoritiesInfoPanel.jsx
│   │       ├── SignatoriesPanel.jsx
│   │       └── GoogleSheetsPanel.jsx
│   ├── layout/
│   │   └── BottomNav.jsx   # role-aware: Admin sees Monitor, others see Piles
│   ├── forms/
│   │   ├── shared.js
│   │   ├── SerialNumberField.jsx
│   │   ├── CustomerNameAutocomplete.jsx  # autocomplete + WS-supervisor suggestions
│   │   ├── NewPileDialog.jsx             # inline "New Pile" creation sub-form
│   │   ├── StockFormBase.jsx     # WSR/WSI/WTS — warehouse-scoped serials,
│   │   │                         # series back-nav w/ Update/Delete, stock caps
│   │   ├── SackFormBase.jsx      # ESR/ESI — same treatment as StockFormBase
│   │   ├── WSRForm.jsx
│   │   ├── WSIForm.jsx
│   │   ├── WTSForm.jsx
│   │   ├── ESIForm.jsx
│   │   └── ESRForm.jsx
│   └── cards/        # BinCard, DailySummaryCard
├── context/
│   ├── AuthContext.jsx
│   ├── SettingsContext.jsx
│   └── WarehouseContext.jsx
├── db/
│   └── dexie.js
├── pages/
│   ├── Login.jsx
│   ├── Home.jsx
│   ├── AdminHome.jsx
│   ├── AdminMonitoring.jsx   # Admin-only cross-warehouse AI/SIA monitor
│   ├── Piles.jsx             # regular-user AI/SIA monitor (was an unbuilt spatial map stub)
│   ├── Reports.jsx
│   ├── Settings.jsx
│   └── AdminDashboard.jsx
├── services/
│   ├── firebase.js
│   ├── syncWorker.js
│   └── googleSheetsBridge.js  # calls the EXISTING Apps Script Web App —
│                               # see "Phase 6 — Google Sheets bridge" above
└── utils/
    ├── calculations.js     # Net Kilos / MTS / Avg weight per bag / Age / Authority status
    ├── serialNumber.js     # Serial suggest/step/uniqueness, scoped per (type, warehouseId)
    ├── pileLedger.js       # applyTransactionToPile() / reverseTransactionFromPile()
    ├── customerDirectory.js # autocomplete + WS-supervisor suggestions + address
    ├── siaParsing.js        # resolves SIA sack-type/condition/pieces for ESI prefill
    └── devTools.js         # Dev-only console helpers for testing
```

## Environment variables

See `.env.example` and the Firebase setup section above.
