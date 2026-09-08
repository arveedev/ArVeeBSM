# BSM App — Backend / Data Schema

*Companion to `docs/technical-design-document.md`. This document
specifies the Dexie (IndexedDB) schema every table shall have, as a data
model design — current final shape, not a version history (the
version-by-version rationale already lives as inline comments in
`src/db/dexie.js`, currently at schema version 32). Field lists describe
the meaningful application fields on each record; every table also
carries whatever bookkeeping fields Dexie Cloud sync itself requires.*

## 1. Sync Model

Every table syncs via Dexie Cloud **except** the four listed in
`unsyncedTables`, which are deliberately per-device or structurally
incompatible with sync:

| Table | Why excluded |
|---|---|
| `serialCounterCache` | Per-device performance cache over the real source of truth (actual transaction history); its primary key has changed shape historically, which Dexie Cloud treats as an illegal schema change on an already-registered table if left syncing. |
| `preloadState` | Per-device bookkeeping of what's already been pulled from the Sheets backup onto *this* device; meaningless to share across devices. |
| `millingOrders` | A pure read-only cache re-fetched fresh from the Sheet by every device independently; nothing is lost by not syncing it. |
| `privateMillerAllocations` | Its primary key is a compound key (`[regionalAuthorityNumber+ricemillName]`); Dexie Cloud sync does not support multi-part primary keys. Re-enabling would require migrating to a synthetic single-field id first. |

Every other table listed below is a real, synced table. Primary keys on
synced tables are application-generated (`crypto.randomUUID()` or a
natural business key), never a Dexie auto-increment integer — Dexie
Cloud sync requires a value that is already globally unique before it
ever reaches the server.

## 2. Organizational Structure

### `branches`
| Field | Type | Notes |
|---|---|---|
| `branchId` (PK) | string | |
| `name` | string | e.g. "ALBAY BRANCH" |
| `address` | string | Printed on report headers |
| `region` | string | e.g. "V" — printed on the REGION field of every NFA report header |
| `provinceCode` | string | Cosmetic/display only |

### `provinces`
| Field | Type | Notes |
|---|---|---|
| `provinceId` (PK) | string | Indexed |
| `code` | string | Indexed. Short code, e.g. "ALB" |
| `name` | string | Indexed |
| `branchId` | string (FK → `branches.branchId`) | Indexed. The sole link connecting the branch/province/warehouse chain — a warehouse's branch is always derived through its province, never stored directly on the warehouse. |

### `warehouses`
| Field | Type | Notes |
|---|---|---|
| `warehouseId` (PK) | string | Indexed |
| `code` | string | Indexed. Facility code, e.g. "050501" |
| `name` | string | Indexed. e.g. "ALB-TABACO GID" |
| `provinceId` | string (FK → `provinces.provinceId`) | Indexed |
| `address` | string | Auto-fills a "WS <name>" customer suggestion's address |
| `facilityType` | string | Indexed. `'Warehouse'` \| `'Ricemill'` \| `'Mechanical Dryer'` — changes Home's own layout and what the milling monitor shows for it |
| `classifierName` | string | Signatory-only name (not a login user) shown on the Pile Layout report |

### `users`
| Field | Type | Notes |
|---|---|---|
| `uid` (PK) | string | Indexed |
| `accessCode` | string | Indexed. SHA-256 hash of the PIN — never plaintext |
| `role` | string | Indexed. `'Admin'` \| `'Warehouse Supervisor'` \| `'Acting Warehouse Supervisor'` \| `'Warehouse Assistant'` \| `'Acting Warehouse Assistant'` \| `'MPO III'` \| `'Acting MPO III'` \| `'Visitor'` (Visitor is not a real row here — it authenticates against `reportConfig.visitorAccessCode` instead) |
| `assignedWarehouses` | string[] (FK → `warehouses.warehouseId`) | Multi-entry indexed (`*assignedWarehouses`). Admin implies access to every warehouse regardless of this list — enforced in application logic, not the schema. |

## 3. Inventory

### `piles`
| Field | Type | Notes |
|---|---|---|
| `pileId` (PK) | string | Indexed |
| `warehouseId` | string (FK) | Indexed |
| `pileName` | string | Indexed |
| `cerealType` | string | Indexed. `'Rice'` \| `'Palay'` \| `'By Products'` — broad category, kept alongside `varietyId` since both matter independently in different views |
| `varietyId` | string (FK → `varietyTypes.varietyId`) | Indexed. Permanent for the pile's whole lifetime — a pile can never mix or change variety; correcting a mistake means creating a new pile |
| `currentBags` | number | Live running total, incrementally updated by every WSR/WSI/WTS transaction — never re-derived by summing history on render (see TDD §2.7) |
| `currentKilos` | number | Live running total, rounded to 3 decimals at every update |
| `dateOfReceipt` | string (ISO date) | Age anchor |
| `initialAgeValue` | number | Base age in days, combined with elapsed time since `dateOfReceipt` for current age — editable independently via its own dialog, never derived from a transaction form's own age field |
| `purity` | string | Free text |
| `moistureContent` | number | |
| `condition` | string | Sack condition |
| `dateProcured` | string | Free text — real procurement dates are ranges ("MAR 24 TO APR 4, 2025"), not a strict date |
| `zeroedDate` | string (ISO date) | Indexed. Silently set the moment the pile's running totals hit zero (within a small floating-point tolerance); cleared the moment either goes back above zero. Distinct from `closedDate`, which is a deliberate user action. |
| `closedDate` | string (ISO date) | Manual close, user-selected date |

### `sackInventory`
| Field | Type | Notes |
|---|---|---|
| `id` (PK) | string | |
| `warehouseId` | string (FK) | Indexed |
| `sackTypeId` | string (FK) | |
| `condition` | string | `'BN'` \| `'SH'` \| `'US'` (Brand New / Second Hand / Unserviceable) |
| `pieces` | number | A **snapshot**, not a log — represents stock on hand before any ESR/ESI transaction existed for that warehouse; never appears as a movement row itself. |

### `pileLayoutBoxes`
| Field | Type | Notes |
|---|---|---|
| `id` (PK) | string | |
| `warehouseId` | string (FK) | Indexed |
| `pileId` | string (FK, nullable) | Indexed. Null = a Vacant box, shown with just its own label |
| Grid geometry | number fields | Position/span within the fixed 24×20 grid |
| `assignedDate` | string (ISO date) | When the box's current occupant/geometry stint began — stamped on every reassignment or move |

### `pileLayoutHistory`
| Field | Type | Notes |
|---|---|---|
| `id` (PK) | string | |
| `warehouseId` | string (FK) | Indexed |
| `boxId` | string (FK → `pileLayoutBoxes.id`) | Indexed |
| `pileId` | string (FK, nullable) | Indexed |
| `occupiedTo` | string (ISO date) | Indexed. One row per **closed occupancy stint** — the box's full prior geometry, snapshotted right before any reassignment/move/vacate overwrites the live box row. Lets a past date's layout be reconstructed exactly (position and size, not just totals), unlimited hops back. |

### `varietyTypes`
| Field | Type | Notes |
|---|---|---|
| `varietyId` (PK) | string | Indexed |
| `category` | string | Indexed. `'Rice'` \| `'Palay'` \| `'By Products'` |
| `name` | string | Indexed. e.g. "PD1-A" — wet/dry palay state is derived from the code's own second character (W/D), never a separate field |

### `sackTypes`
| Field | Type | Notes |
|---|---|---|
| `sackTypeId` (PK) | string | Indexed |
| `category` | string | Indexed |
| `code` | string | Indexed |
| `weights` | object | Non-indexed. Fixed shape `{ BN, SH, US }` — a tare weight per sack condition, used to auto-derive MTS instead of a free-typed number |

## 4. Transactions

### `transactions`

A single table holds every movement type (WSR, WSI, WTS, ESR, ESI),
distinguished by `type`. Stock-only fields are simply left undefined on
sack documents and vice versa.

| Field | Type | Notes |
|---|---|---|
| `id` (PK) | string | Indexed |
| `type` | string | Indexed. `'WSR'` \| `'WSI'` \| `'WTS'` \| `'ESR'` \| `'ESI'` |
| `serialNo` | string | Indexed. Unique per (warehouse, type); for WSR/WSI, further scoped per cereal category. Fully user-controlled with a system-suggested starting value. |
| `status` | string | Indexed. `'Active'` \| `'Cancelled'` — never physically deleted |
| `date` | string (ISO date) | Indexed |
| `warehouseId` | string (FK) | Indexed. Present on every doc type (even sack docs, which have no `pileId`) — the field every warehouse-scoped serial/report query actually keys on |
| `pileId` | string (FK, nullable) | Indexed. Stock docs only |
| `isSynced` | boolean | Indexed. Whether this record has reached the Sheets backup log |
| `hasBeenBackedUp` | boolean | Distinct from `isSynced` — persists across a later edit that resets `isSynced` to false, so an edit updates the existing Sheet row instead of appending a duplicate |
| `isInitialBalance` | boolean | Indexed. Marks a synthetic beginning-balance seed row — excluded from statement/recap line items, included in beginning-balance math |
| `aiNumber` | string | Indexed. WSI's linked AI authority |
| `siaNumber` | string | Indexed. ESI's linked SIA authority |
| `moNumber` / `tmoNumber` | string | Indexed. Milling/Test Milling order reference |
| `batchNumber` | string | Indexed. Milling's per-miller sub-identifier under an MO |
| `trialNumber` | string | Indexed. Test Milling's 1/2/3 |
| `[type+warehouseId+serialNo]` | compound index | The real per-warehouse, per-type serial-uniqueness check |
| **Stock fields (WSR/WSI/WTS)** | | |
| `varietyId` | string (FK) | |
| `numberOfBags` | number | Actual physical bag count — a whole number, distinct from the derived Net Bags |
| `grossKilos` | number | The paper form's own recorded gross figure — never itself applied to a running total |
| `netKilos` | number | = Gross − (tare weight × bags); this is the value that moves pile/authority totals |
| `condition` | string | Sack condition |
| `moistureContent` | number | MC % |
| `mtsSackTypeId` / `mtsCondition` | string | Which sack type/condition the tare weight was derived from |
| `autoComputeNet` | boolean | Whether Net Kilos was computed automatically vs. manually overridden |
| `ageValue` / `ageUnit` / `initialAgeValue` | number/string | WSR's entered receipt age, propagated to the pile |
| `cerealCategory` | string | Rice/Palay/By Products — mirrors the variety's own category, used to scope serial series |
| `farmerCoops` | array | WSR/Procurement — one or more coop members |
| **WSI-specific** | | |
| Additional pile allocations | array | A single WSI issuance can draw from more than one pile — one primary pile plus any number of additional allocations, each carrying its own full field set, reconciled together on save/edit/void |
| **WTS-specific (dual-sided)** | | |
| `issuedPileId`, `issuedVarietyId`, `issuedCondition`, `issuedBags`, `issuedGrossKilos`, `issuedNetKilos` | | Issued side |
| `receivedPileId`, `receivedVarietyId`, `receivedCondition`, `receivedBags`, `receivedGrossKilos`, `receivedNetKilos` | | Received side |
| **Sack fields (ESR/ESI)** | | |
| `sackLines` | array of `{ sackTypeId, condition, pieces }` | One document can cover multiple sack types/conditions at once |
| `linkedDocNo` | string | Cross-reference field |
| **Common** | | |
| `transactionTypeId` | string (FK → `transactionTypes`) | Nature of Transaction |
| `customerName` | string | Free text, backed by the `customers` autocomplete directory |
| `needsCompletion` | boolean | Flags a record synced in from the Sheet that's missing fields only the app itself can supply |

### `serialCounterCache` *(unsynced)*
| Field | Type | Notes |
|---|---|---|
| `[warehouseId+type+cerealCategory]` (PK, compound) | | ESR/ESI/WTS use a fixed `'ALL'` placeholder for `cerealCategory` to keep the key shape consistent |
| `warehouseId`, `type` | indexed | |
| `prefix`, `digits`, `number`, `updatedAt` | | A pure performance cache over real transaction history — never the source of truth; self-heals via a scan-based fallback if missing or stale. Renamed from an earlier `serialCounters` table after a primary-key-shape change broke Dexie Cloud schema validation for the *entire* sync request, not just this table. |

### `preloadState` *(unsynced)*
| Field | Type | Notes |
|---|---|---|
| `[warehouseId+type]` (PK, compound) | | |
| `warehouseId`, `type` | indexed | |
| `complete`, `lastCheckedAt` | | Tracks whether a (warehouse, type) combination has had its full transaction history preloaded from the Sheet — full pull once, lightweight incremental check every login after. |

### `pendingSheetDeletions`
| Field | Type | Notes |
|---|---|---|
| `id` (PK) | string | |
| `serialNo`, `type` | indexed | An offline delete is an immediate hard local delete; this table remembers just enough to replay the deletion against the Sheet backup once back online, independent of the (already-gone) local transaction record. |

## 5. Authorities and Milling

### `authorities`
| Field | Type | Notes |
|---|---|---|
| `authId` (PK) | string | Indexed |
| `type` | string | Indexed. `'AI'` \| `'SIA'` |
| `aiNumber` | string | Indexed. Populated for AI, null for SIA |
| `siaNumber` | string | Indexed. Populated for SIA, null for AI |
| `assignedWarehouse` | string (FK) | Indexed |
| `status` | string | Indexed |
| `manuallyCompleted` | boolean | Indexed. Admin override — moves an authority to Completed without requiring `totalIssued >= totalAllocation`; never left stale once the authority becomes genuinely, factually complete |
| `regionalAuthorityNumber` | string | Indexed. NFA Ricemill / private-miller palay quota reference |
| `customerName`, `transactionTypeName` | string | |
| `totalAllocationBags` / `totalAllocationKilos` | number | Whichever unit(s) the real allocation was defined in — bags-only, kilos-only, or both |
| `totalIssuedBags` / `totalIssuedKilos` | number | Derived from actual linked transactions |
| `sackLines` | array | SIA only — one array covering every sack-type+condition combination the SIA number authorizes; matched by SIA number alone, never split into multiple records |
| `ageGroup`, `orNumber`, `note1`, `note2`, `remarks` | string | Extra sheet-sourced detail fields, surfaced via `authorityExtraDetails()` |

### `millingOrders` *(unsynced — read-only cache)*
| Field | Type | Notes |
|---|---|---|
| `orderId` (PK) | string | |
| `type` | string | Indexed. `'MO'` \| `'TMO'` |
| `number` | string | Indexed. Control number |
| `status` | string | Indexed |
| `manuallyCompleted` | boolean | Indexed. Same admin-override pattern as `authorities.manuallyCompleted`; explicitly re-merged from existing values on every full resync since this table is cleared and rebuilt wholesale on each sync, not upserted per record. |

### `ricemillAllocations`
| Field | Type | Notes |
|---|---|---|
| `regionalAuthorityNumber` (PK) | string | One NFA-owned Ricemill/Dryer maps to exactly one Regional Authority Number |
| `totalNetKgs` | number | Admin-set total palay allocation |
| `millingInputCapacityBags` | number | The mill's own configured daily processing rate — used to compute Issuance activity per date, since NFA-owned Ricemills have no per-day record on the authorizing sheet itself |

### `privateMillerAllocations` *(unsynced — compound key)*
| Field | Type | Notes |
|---|---|---|
| `[regionalAuthorityNumber+ricemillName]` (PK, compound) | | A Regional Authority Number shared across several private millers, each with its own, not-necessarily-equal share |
| `regionalAuthorityNumber` | indexed | |

## 6. Directories, Aliasing, and Configuration

### `customers`
| Field | Type | Notes |
|---|---|---|
| `customerId` (PK) | string | |
| `normalizedName` | string | Indexed |
| `name`, `rsbsa`, `gender`, `address` | string | |
| `isFarmerOrg` | boolean | |
| `farmerCoopMembers` | array | |

Built up automatically as WSR/WSI/WTS/ESR/ESI forms are saved — powers
autocomplete + auto-fill on every Customer Name field.

### `customerAliases`
| Field | Type | Notes |
|---|---|---|
| `alias` (PK) | string | The Sheet's short nickname, e.g. "Dens RM" |
| `customerId` (FK) | indexed | Real customer, e.g. "Dens Marketing Corp" |

### `warehouseAliases`
| Field | Type | Notes |
|---|---|---|
| `alias` (PK) | string | Every sheet-side spelling variant, e.g. "BSI-B" |
| `warehouseId` (FK) | indexed | Canonical warehouse, e.g. "BSI B" |

### `userAliases`
| Field | Type | Notes |
|---|---|---|
| `alias` (PK) | string | e.g. "WS V. Balaoro" |
| `uid` (FK) | indexed | Real user, e.g. Vevencio Balaoro |

### `signatories`
| Field | Type | Notes |
|---|---|---|
| `warehouseId` (PK) | string | |
| `certifiedCorrectPosition` | string | The only per-warehouse signatory field — the Certified Correct *name* is derived from that warehouse's assigned Warehouse Supervisor, only its position title is admin-configurable |

### `reportConfig`
| Field | Type | Notes |
|---|---|---|
| `id` (PK) | string | Singleton, always `'global'` |
| `verifiedCorrect` | array of `{ name, position }` | Supports multiple signatories |
| `auditedByName`, `auditedByPosition`, `notedByName`, `notedByPosition` | string | Global across every report |
| `visitorAccessCode` | string | SHA-256 hash of the shared Visitor PIN |
| `dataStartDate` | string (ISO date) | Global floor — see `effectiveCutoffDate()`, TDD §2.7-adjacent reporting logic |

### `transactionTypes`
| Field | Type | Notes |
|---|---|---|
| `transactionTypeId` (PK) | string | |
| `name` | string | Indexed. Admin-configurable "Nature of Transaction" — Milling, Procurement, Transfer, Sales, Sales (Bidding), Remilling, Test Milling, Test Re-Milling, Repiling, Dumping, PIK, Reclassification, Rebagging, Bagging, Fillers, Sample Weighing, Mech Drying, etc. |

### `googleSheetsConfig`
| Field | Type | Notes |
|---|---|---|
| `id` (PK) | string | Singleton, `'global'` |
| `webAppUrl`, `aiSheetName`, `siaSheetName`, `transactionsSheetName` | string | |
| `lastSyncedAt` | string (ISO timestamp) | Most recent successful AI/SIA pull |

### `sheetSources`
| Field | Type | Notes |
|---|---|---|
| `id` (PK) | string | |
| `dateFrom`, `dateTo` | string (ISO date) | Indexed. The date range this source is authoritative for — supports more than one spreadsheet/URL at once (a fresh copy each year); a query spanning a year boundary merges every overlapping source |
| `webAppUrl`, sheet names | string | Per-source config, same shape as `googleSheetsConfig` |
| `lastSyncedAt` | string | |

### `settings`
| Field | Type | Notes |
|---|---|---|
| `id` (PK) | string | Singleton, `'global'` |
| `autoAgeMonitoring` | boolean | Whether pile age advances automatically from elapsed time or is purely manual |
| Other per-device UI preferences | | Theme, unit display, etc. |

### `errorLogs`
| Field | Type | Notes |
|---|---|---|
| `id` (PK) | string | `crypto.randomUUID()` |
| `timestamp` | string (ISO) | Indexed |
| Error detail, user, device | | Captures form save/update/delete/void failures and `SectionErrorBoundary`-caught page crashes; deliberately synced (unlike the per-device caches above) so an admin can review what broke on any device from anywhere |

## 7. Entity-Relationship Summary

```
branches ──< provinces ──< warehouses ──< piles ──< transactions (WSR/WSI/WTS)
                              │                          │
                              │                          └──< transactions (ESR/ESI, no pileId)
                              ├──< sackInventory
                              ├──< pileLayoutBoxes ──< pileLayoutHistory
                              └──< users (assignedWarehouses, many-to-many)

varietyTypes ──< piles
varietyTypes ──< transactions

sackTypes ──< sackInventory
sackTypes ──< transactions (sackLines / mtsSackTypeId)

authorities (AI/SIA) ──< transactions (aiNumber / siaNumber, loose reference by value, not FK)
millingOrders (MO/TMO) ──< transactions (moNumber / tmoNumber, loose reference by value)
ricemillAllocations ──(regionalAuthorityNumber)── authorities

customers ──< transactions (customerName, loose reference by value)
warehouseAliases / customerAliases / userAliases → canonical warehouses / customers / users

reportConfig, googleSheetsConfig, settings — global singletons
sheetSources — one-or-many, date-ranged
```

Note that `transactions` references `authorities`/`millingOrders`/
`customers` by their own business-key value (AI number, SIA number, MO
number, customer name) rather than by internal primary key — this
mirrors how the source spreadsheet itself identifies these records, and
is what allows the one-way Sheets sync (TDD §2.4) to write a transaction
referencing an authority it has never itself fetched a local copy of.
