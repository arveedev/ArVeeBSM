# Report Builder (read-only report and pivot table maker) - plan

Status: PLAN FOR APPROVAL (2026-10-20). Nothing is built. Interactive sample (made-up records): https://claude.ai/artifact/1FLM4GZtwckpGkcCAwZxeY

## 1. What it is, and the rules it must keep
A tool where a person picks any data the app holds, and builds their own list, table or pivot table from it: search, filter, sort, group, total, compare, save the layout, and export to Excel, PDF, CSV or the clipboard. It is meant for **reconciliation** and as another way to look at the app's data.

Rules, in order of importance:
1. **Read-only, with no way to write.** It never creates, edits or deletes a record. This is built in (section 5), not only a promise on the screen.
2. **The same numbers as the rest of the app.** Where a figure is worked out by a rule (stock on hand, stock by age), the Builder uses the Stock Desk's own calculation and never a second one.
3. **Flexible.** Any field of any source can be a row, a column, a total, a filter or a sort.
4. **Nothing sensitive.** PINs, access codes, tokens and settings secrets are never offered as fields.
5. **Fast and correct on a phone and a PC**, online or offline (it reads the data already on the device).

## 2. Who can use it
| Who | Gets | Sees |
|---|---|---|
| **Admin** | The Builder | Everything |
| **Analyst (new role)** | The Builder; otherwise the same screens as a Visitor (read-only) | Everything (all warehouses) |
| **Warehouse staff** (Supervisor, Assistant, MPO III, acting) | The Builder | Only their own assigned warehouses, enforced in the data layer, not just hidden on screen |
| **SDO** | Not in this version (decision 2) | |
| **Visitor** (access code) | Not by default; the Admin may switch it on | Everything, read-only |

- **Why a new role, not the Visitor:** a Visitor signs in with a shared access code and is not a person in the app, so there is nowhere to save "my layouts" and no way to say who exported what. An Analyst is a real user with their own PIN (like every other user): it behaves like a Visitor everywhere (same read-only Home, no entry forms, no auto-logout) and additionally gets the Tools area.
- Implementation: add `'Analyst'` to `ROLES` (`admin/shared.js`), treat it like `Visitor` in the places that currently test `role === 'Visitor'` (route guards in `App.jsx`, `AdminHome`, preload `isBroadAccessRole`, auto-logout exemption, device backup/status exemptions) and give it the Builder entry. A small helper `isReadOnlyViewer(role)` replaces the scattered checks so the two roles cannot drift apart.
- Entry points: Admin / Analyst: an icon beside the Stock Desk icon and the shortcut Ctrl + Alt + R. Staff: a "Reports" card in Settings. The Admin chooses, per role, who gets the tile (`reportConfig.toolsAccess`, same pattern as `inventoryReportsAccess`).

## 3. Data sources
The Builder reads **flattened rows** built from the app's tables (names resolved: warehouse, province, variety, customer, user). A field allow-list per source keeps secrets out.

| Source | Reads | Fields (examples) |
|---|---|---|
| Documents | `transactions` (WSR, WSI, WTS, ESR, ESI) | date, serial, document, transaction type, warehouse, province, facility type, pile, cereal, variety, farmer / customer, authority no., MO / TMO, bags, gross / net kg, amount, status, entered by, created / updated |
| Authorities | `authorities` | date, AI / SIA no., type, customer, warehouse, variety, authorized, issued, balance, status, regional authority no., age group, source warehouse |
| Purchase receipts | `purchaseReceipts` | date, PR no., WSR no., farmer, address, RSBSA, warehouse, variety, bags, kg, unit cost, amount, SDO, payment, status |
| Piles | `piles` | pile, warehouse, cereal, variety, received, bags, kg, closed on, status |
| Cash ledger | `cashLedgerV2`, `cashDenominationCounts` | date, reference, type, SDO, amount, running balance |
| Milling | `millingOrders`, `ricemillAllocations`, milling authorities | MO / TMO, ricemill, GMR, receiving warehouse, batch, status |
| Logistics | `logisticsItems` | warehouse, category, item, quantity |
| Customers, varieties, warehouses, sacks | reference tables | names, codes, province |
| **Stock Desk: Summary** (computed) | the Stock Desk engine (`buildSummary`) for a chosen date | warehouse, cereal, variety, age bracket, net bags / kg |
| **Stock Desk: Daily inventory** (computed) | `buildLedger` for a chosen period | per day: beginning, ADD, LESS, ending, by warehouse and variety |
| **Stock Desk: Age monitoring** (computed) | `buildAgeLists` | lots about to move to the next bracket, oldest stock |

Never offered: `users.accessCode`, tokens, `reportConfig` secrets, `deviceInfo`, error logs, realm / member tables.

## 4. Features
**Looking** : one global search over every field; filters with rules (text: is, is not, contains, starts with, does not contain, empty; number: = ≠ > ≥ < ≤ between; date: on, before, after, on or after, on or before, between), shown as removable chips; sort by clicking a header, shift-click for several levels; show / hide / reorder columns; a list view and a pivot view.

**Pivot**: any fields as Rows and Columns; several Values with Sum, Average, Count, Smallest, Largest, Different; dates grouped by day, week or month; subtotals; percentage of total, row or column; top 5 / 10 / 20; shading by size; click any number to open the exact records behind it (and export just those).

**Reconciliation**:
1. **Calculated fields**: field A (+ - × ÷) field B or a fixed number, saved with the layout (for example authorized minus issued).
2. **Highlight rules**: colour the cells that are greater than, less than, equal to or different from a value.
3. **Drill-down**: from any total to its records.
4. **Compare two sources (phase 4)**: choose two sources and a key (for example authority number: Authorities authorized vs the WSI documents issued on it; PR amount vs WSR weight x unit cost; Daily inventory ending vs Summary). The result lists matched rows, only-in-A, only-in-B and the differences, with a "show only differences" switch.

**Keeping**: save a named layout (private, or shared with the Admin / all Analysts); open it on any device; "Reset". Only the layout is saved, never records.

**Exporting**: Excel (.xlsx, via the `exceljs` already in the app) with a title, the source, the filters used and the date made; PDF (jsPDF + autotable, already in the app) landscape with page numbers; CSV; Copy to the clipboard for pasting into a Sheet. Exports contain every matching record, not only the rows on screen.

## 5. How it is built, and why it cannot change data
- **Engine** `src/utils/reportBuilder/` : pure functions only (no database import): `fields.js` (field definitions per source), `filter.js`, `search.js`, `aggregate.js`, `pivot.js`, `model.js` (the one table model that feeds the screen and every export, as the sample does), `reconcile.js`, `export*.js`. Tested with node (`tests/reportBuilder.test.mjs`).
- **Source adapters** `src/utils/reportBuilder/sources.js` : the only code that touches Dexie, and only `table.toArray()` / `where().toArray()` and the Stock Desk's pure builders. They return plain frozen arrays. A test greps the module tree and fails if anything under `reportBuilder/` imports a write method (`add`, `put`, `update`, `delete`, `bulkPut`, `bulkAdd`, `transaction('rw'`, `clear`) or the services that write.
- **The only thing the feature writes** is the user's own saved layout in `reportLayouts` (section 6), never a business record.
- **Staff scope**: the adapter takes `allowedWarehouseIds` (null for Admin / Analyst) and filters rows (and the Stock Desk inputs) before anything is shown, so a staff member's pivot cannot include another warehouse, even by searching or by drilling down.
- **Performance**: sources load when chosen; the screen shows the first 300 records of a list and the engine runs on a memoised copy; a pivot over many thousand rows is computed once per change (debounced). If a source ever exceeds ~100,000 rows the engine moves into a Web Worker (the pure design makes that a small change).
- **Stock Desk parity test**: for the same date, the Builder's "Stock by age" total per warehouse equals the Stock Desk Summary (same function, asserted).

## 6. Saved layouts: data model (schema v49)
`reportLayouts` (synced): `{ id, ownerUid, name, source, layout (JSON: mode, rows, cols, vals, filters, search, sort, hidden, order, calc, format, highlight), share: 'private' | 'admin' | 'analysts', createdAt, updatedAt }`.
- Private layouts belong to their owner's realm; shared ones are readable by the roles named; only the owner and the Admin can change or delete one.
- Included in the nightly backup automatically (it is a normal table); not in `RESTORE_EXCLUDED_TABLES`.
- A layout that names a field that no longer exists opens with that part dropped and a note, never an error.

## 7. Screens
- **Desktop / PC:** as the sample: fields and the Rows / Columns / Values / Filter boxes on the left; search, pivot / list switch, filter, columns and format on top; the result below; the records behind a number open under the table.
- **Phone:** the field boxes become a panel that slides over the result; the result scrolls sideways with the first column frozen; exports and saved layouts sit in a bottom sheet.
- Dark theme like the rest of the app; keyboard-friendly; the same animations and spacing as the Stock Desk.

## 8. Build order (each step tested and documented)
1. **Engine + Documents source**, list and pivot, search, filters, sorting, column control, the four exports. Entry for Admin.
2. **The other sources** (authorities, purchase receipts, piles, cash, milling, logistics, reference tables); **saved layouts** (`reportLayouts`, v49); **the Analyst role** and the staff scope.
3. **Stock Desk sources** (Summary, Daily inventory, Age); **calculated fields, highlight rules, drill-down**.
4. **Compare two sources** and sharing layouts.
Tests per step: engine unit tests, adapter tests with a fixture database, the no-write test, the staff-scope test, the Stock Desk parity test, a phone-width layout check, and exports opened to confirm the numbers.

## 9. Open decisions
1. **Role name**: "Analyst" (proposed). Another name is a one-word change.
2. **SDO**: leave out for now (proposed), or give the SDO a version limited to their own receipts and cash ledger.
3. **Visitor**: no access by default (proposed); the Admin can switch it on.
4. **Export log**: record who exported which source and when (a small read-event log for the Admin), or not. Proposed: yes, a simple log, since the Builder can show every record of a warehouse.
5. **Sharing**: private + share-with-Admin + share-with-Analysts (proposed), or private only.
6. **Extra sources** beyond section 3 that you want in the first version.
