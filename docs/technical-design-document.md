# BSM App — Technical Design Document

*Companion to `docs/updated-prd.md`. This document specifies HOW the
system will be built to meet that PRD's requirements — architecture,
key technical decisions with their rationale, and non-functional
requirements. Written before implementation begins; forward-looking
language throughout describes what the system shall do, not a
retrospective of what shipped.*

## 1. System Architecture Overview

The system is a single-page React application with no application
server of its own. Four layers, in order of what the app actually
depends on to function:

1. **Local data layer (required, always available)** — Dexie.js over
   IndexedDB. Every screen in the app reads from and writes to this
   layer exclusively. No component ever awaits a network call before
   rendering or accepting a save.
2. **Cloud sync layer (best-effort, invisible)** — Dexie Cloud, providing
   background multi-device synchronization of the local database. The
   app must be fully usable with this layer entirely absent (offline, or
   never yet connected).
3. **External system-of-record bridge (best-effort, one-way)** — a
   Google Apps Script Web App fronting the NFA branch's existing
   production spreadsheet. The app reads AI/SIA authority allocations
   and Milling/Test Milling orders from it, and writes a backup log of
   every transaction to it. This app is never the only place authority
   data can be seen, and the Sheet is never the only place a transaction
   is recorded — each system has its own independent, always-available
   copy of what it needs.
4. **Presentation shell (PWA)** — the compiled React/Tailwind bundle
   itself, precached by a Workbox-driven service worker so the app shell
   is available offline on a cold start, not only its data.

```
┌─────────────────────────────────────────────────────────────┐
│  Browser (device)                                            │
│  ┌───────────────┐   reads/writes    ┌────────────────────┐  │
│  │  React UI      │ ───────────────► │  Dexie (IndexedDB) │  │
│  │  (pages, forms,│ ◄─────────────── │  local database    │  │
│  │  reports)      │   live queries    └─────────┬──────────┘  │
│  └───────────────┘                              │ background   │
│                                                  │ sync (best-  │
│                                        ┌─────────▼─────────┐   │
│                                        │ Dexie Cloud addon │   │
│                                        └─────────┬─────────┘   │
└──────────────────────────────────────────────────┼─────────────┘
                                                     │ HTTPS (when online)
                              ┌──────────────────────┼───────────────────┐
                              │                       ▼                    │
                    ┌──────────────────┐   ┌──────────────────────┐       │
                    │ Dexie Cloud       │   │ Vercel serverless fn │       │
                    │ (hosted service)  │   │ /api/dexie-cloud-    │       │
                    │                   │   │ tokens.js            │       │
                    └──────────────────┘   └──────────────────────┘       │
                                                                            │
                    ┌───────────────────────────────────────────┐         │
                    │ Google Apps Script Web App                 │◄────────┘
                    │  (fronts the NFA production spreadsheet)   │  HTTPS
                    │  - AI / SIA sheets   (read-only)           │
                    │  - MO / TMO sheets   (read-only)           │
                    │  - backup log sheet  (app-writable only)   │
                    └───────────────────────────────────────────┘
```

## 2. Key Technical Decisions and Rationale

### 2.1 Offline-first architecture (Dexie/IndexedDB as the only data layer)

**Decision**: every page, form, and report reads exclusively from local
IndexedDB via Dexie; nothing in the render path ever blocks on a network
request.

**Rationale**: the primary user is a warehouse Supervisor or Assistant
working in a physical warehouse, frequently with no or intermittent
mobile signal. A design that required a live connection to record a
receipt or issuance would make the app unusable for its core job at the
exact moments it matters most (a truck at the gate, a farmer waiting to
be paid). Treating the network as an optional, best-effort layer
underneath a fully-functional local system — rather than the reverse —
is the single architectural decision every other decision in this
document follows from.

### 2.2 PIN-based login instead of accounts/passwords

**Decision**: users authenticate with a 4–6 digit PIN entered on an
on-screen keypad; there is no email, username, or password anywhere in
the user-facing login flow.

**Rationale**: warehouse staff include elderly and non-technical users on
a shared device, often standing rather than seated at a desk. A PIN
keypad is faster to use, requires no memorized string beyond a short
number, and matches the mental model of an ATM/door-lock code that this
user base already trusts. PINs are hashed (SHA-256, one-way, no
plaintext storage or comparison) before being written to or read from
Dexie — see 2.6.

### 2.3 Dexie Cloud as the sync layer, fronted by a shared service account

**Decision**: Dexie Cloud handles device-to-device data synchronization.
Every device authenticates to it as the same fixed service account via a
serverless token endpoint that holds the real client credentials — the
browser itself never sees them. PIN login (2.2) remains the app's real,
user-facing authentication; Dexie Cloud's own identity system is
invisible infrastructure underneath it, not a second login the user ever
interacts with.

**Rationale**: building and hosting a custom sync backend (conflict
resolution, per-device queueing, retry logic) is a substantial project of
its own; Dexie Cloud is purpose-built for exactly this shape of problem
(an IndexedDB-first app that needs eventual multi-device consistency) and
integrates directly with the schema already being written in Dexie's own
syntax. A shared service account (rather than Dexie Cloud's native
per-user email-OTP login) was chosen because the app's real access
control is the PIN system — introducing a second, independent identity
layer that end users would have to separately authenticate against would
undermine the whole point of PIN login being fast and simple.

`requireAuth` is explicitly set to `false`: Dexie Cloud's default
behavior refuses to run *any* operation — including purely local
reads/writes with nothing to do with syncing — until it holds a valid
auth token. Since the service account's token expires roughly hourly and
can only be refreshed over the network, `requireAuth: true` would freeze
the entire local database the moment connectivity drops, directly
violating the offline-first requirement in 2.1. `requireAuth: false`
means local reads/writes are never gated on network state at all; sync is
purely an additive background behavior layered on top.

### 2.4 Google Sheets as a read source and backup log, never a dependency

**Decision**: the NFA branch's existing production spreadsheet is
integrated in exactly two, structurally enforced one-way flows:
AI/SIA authorities and MO/TMO milling orders flow **from** the Sheet
**into** the app (read-only, the app never writes to these sheets);
every transaction the app creates flows **from** the app **into** a
dedicated backup log sheet (write-only from the app's perspective, never
read back as a source of truth for anything the app itself displays).

**Rationale**: the branch's existing spreadsheet-based workflow already
functions as their real system of record for authority allocations, and
rebuilding that as an app-native, admin-managed table would fork data
that's still actively maintained elsewhere by other staff. Making the
integration strictly one-way in each direction eliminates an entire class
of synchronization problem — conflict resolution — before it can exist:
there is never a case where the same field is legitimately writable from
both sides, so there is nothing to reconcile. A structural
**write-allowlist**, enforced independently on both the client
(`googleSheetsBridge.js`) and the Apps Script server, is the actual
mechanism that guarantees this in practice rather than merely by
convention — a bug in the app's own code can never accidentally write to
an AI/SIA sheet, because the write function checks the target sheet's key
against an explicit allowlist before every single call, and the same
check exists a second time server-side in case the client-side check is
ever bypassed.

### 2.5 Duplicate-prevention strategy for the Sheets backup

**Decision**: every transaction created in the app carries a `serialNo`
that is unique per (warehouse, document type). A record is only ever
appended to the backup sheet once, keyed by that serial; every later
edit updates the existing row (matched by serial) rather than appending
a new one. Writes are protected by a cross-tab lock (the Web Locks API)
so two browser tabs of the same device can never both push the same
pending record. A resync pull is single-flight, so an overlapping second
sync pass can never re-import a not-yet-local row twice.

**Rationale**: the Sheet backup exists to be a trustworthy audit log an
NFA office can open directly. A duplicate or missing row there
undermines that trust more than almost any other kind of bug in the
system, and — as the real build history in `docs/activity-log.md` and
`src/version.js` shows — duplicate-record races were found and
re-found from multiple different root causes over the app's life
(overlapping sync passes, multi-tab pushes, stale local caches racing a
fresh cloud pull). The design goal is therefore not merely "prevent the
known cases" but structural: a serial-keyed upsert plus a hard
single-flight guard at every point a write can originate closes the
category of bug, not just each individual instance of it.

### 2.6 PIN storage and comparison

**Decision**: PINs are hashed with SHA-256 (Web Crypto API, no external
library) before being written to Dexie, and every login comparison
hashes the entered PIN and compares hash values — nothing in the app
ever holds, displays, or pre-fills a stored PIN in plaintext.

**Rationale**: a plaintext PIN sitting in IndexedDB is trivially visible
to anyone with DevTools access to the device, which is a real and
foreseeable threat model for a shared warehouse tablet. A full
password-hashing scheme (bcrypt/scrypt-style salting and iteration) is
deliberately not used — the actual threat is casual/local inspection,
not a remote attacker running an offline brute-force campaign against a
short numeric PIN, so a single fast hash pass is the right complexity
level for this specific case.

### 2.7 Reversal-ordering and atomicity for running balances

**Decision**: a pile's `currentBags`/`currentKilos` and an authority's
issued totals are maintained as live running totals, updated
incrementally by each transaction's own apply/reverse effect (a receipt
adds, an issuance subtracts) rather than recomputed by summing the
entire transaction history on every render. Editing or voiding a
transaction always reverses its OLD recorded effect first, then applies
the NEW one — never a blind overwrite. Any incremental update that would
drive a running total negative automatically falls back to a full
recompute from actual transaction history for that one pile, rather than
clamping or silently drifting.

**Rationale**: summing potentially thousands of historical transactions
on every page render does not scale acceptably on the low-end Android
devices this app targets. The incremental approach is O(1) per save
instead of O(n), but only remains correct if every code path that
changes a transaction's recorded values also correctly reverses the old
effect before applying the new one — this is why `pileLedger.js`
centralizes apply/reverse as the one place this logic lives, rather than
letting each form re-implement it. The negative-total fallback exists
because the incremental approach's correctness depends on transactions
being applied in a consistent order relative to their own history; a
backfilled or out-of-order entry can violate that assumption, and a
silent floor-at-zero clamp (the original approach) discards the
resulting shortfall permanently instead of surfacing it — a full
recompute is the only way to recover the true total once the fast path's
assumption has been broken.

### 2.8 Multi-year Sheet sources

**Decision**: the Sheets integration supports more than one configured
spreadsheet source at once, each with its own URL and effective date
range (`sheetSources`), rather than a single fixed URL.

**Rationale**: the branch's real operational practice is to start a
fresh spreadsheet copy each year rather than letting one sheet grow
unbounded. A hard-coded single URL would force a disruptive
reconfiguration (and a hard cutover with no overlap) every January. A
date-ranged source list lets a sync or report spanning a year boundary
query every overlapping source and merge results, so an authority issued
in December still has real remaining balance to issue against in
January without the app ever losing track of it.

## 3. Non-Functional Requirements

### 3.1 Offline capability

- Every screen must render and every form must accept and save a
  transaction with the device fully offline, with no degraded feature
  set beyond "the sync indicator shows pending" — data entry itself is
  never gated on connectivity.
- The app shell itself (compiled JS/CSS/HTML, icons, and the
  self-hosted Inter web font) must be available on a fully offline cold
  start, not only previously-visited routes — achieved via Workbox
  precaching with a navigateFallback to `index.html` for client-routed
  deep links.
- Sync must resume automatically the instant connectivity returns,
  without requiring the user to manually retry, and must additionally
  retry on a periodic background timer as a safety net independent of
  the browser's own online/offline events (which are not always
  reliable signals on mobile networks).

### 3.2 Performance targets

- Running totals (pile balances, authority balances) must update in
  O(1) time per transaction save on the common path; a full recompute
  is an explicit, rare fallback, not the default behavior.
- Bulk data fetches (transaction preload, authority sync) must batch
  across every warehouse a user needs in as few network round-trips as
  the Sheets backend supports, rather than one request per warehouse —
  a user with several assigned warehouses must not multiply the app's
  network call count by their warehouse count.
- A first-time full preload of a warehouse's transaction history should
  complete once per (warehouse, document type) combination; every
  subsequent login performs a lightweight incremental "anything new
  since last time" check instead of a full re-pull.

### 3.3 Data integrity guarantees

- A transaction is never physically deleted from local storage — only
  marked `Cancelled` — so any report or pile-state reconstruction as of
  a past date remains possible indefinitely.
- A pile's variety, once set, is permanent for that pile's lifetime;
  correcting a genuine data-entry mistake creates a new pile rather than
  mutating an existing pile's identity.
- A record synced in from the Sheet into a local record that already
  has real, locally-completed data only ever fills in fields the Sheet
  schema actually carries a value for — a field the Sheet doesn't track
  at all can never overwrite genuine local data with a blank.
- Every Dexie schema version bump ships with a tested `.upgrade()`
  migration wherever existing local data needs to be reshaped or
  backfilled; a schema change must never silently corrupt or discard a
  user's already-recorded, not-yet-synced data.
- Kilos figures are rounded to a fixed 3-decimal precision at every
  point a running total is written, not only at initial computation —
  repeated floating-point addition/subtraction across a pile's full
  transaction history is expected to otherwise accumulate visible drift
  over time.

### 3.4 Cross-device consistency

- A transaction saved on one device must reach every other device
  assigned to the same warehouse, and the Sheets backup log, without a
  duplicate ever appearing on either side — see 2.5.
- The local schema registered with Dexie Cloud must never have an
  existing table's primary key structure changed in place; a structural
  key change requires deleting the old table and introducing a
  genuinely new table name in a later schema version, since Dexie Cloud
  treats an in-place primary-key change on an already-registered table
  as an illegal operation and will reject the entire sync request over
  it.

### 3.5 Accessibility and device targets

- Primary target device class: low-to-mid-range Android phones and
  shared tablets, in portrait orientation, frequently on a poor or
  absent mobile connection.
- Every interactive numeric input must be usable one-handed with large
  touch targets; native OS date pickers and native `<select>` chrome are
  avoided in favor of the app's own custom-styled equivalents for visual
  and behavioral consistency across the Android/iOS/desktop browsers
  this PWA can be installed on.

## 4. Deployment and Operations

- **Hosting**: Vercel, serving the built static SPA plus one serverless
  function (`/api/dexie-cloud-tokens.js`) that holds the Dexie Cloud
  service account's real client credentials server-side.
- **Sync backend**: Dexie Cloud's hosted service
  (`https://zv432njdm.dexie.cloud`).
- **External integration**: a Google Apps Script Web App the user
  already owns and deploys independently of this codebase; this app
  only ever calls its published URL.
- **Diagnostics**: sync-state and current-user changes are logged to the
  console with a distinguishable prefix, and the raw HTTP response body
  of any failed Dexie Cloud request is captured and exposed
  (`lastSyncErrorDetail`) for on-screen display in Settings — necessary
  because Dexie Cloud's own `syncState.error` has been observed to
  surface as an uninformative empty object, and most field devices have
  no practical DevTools access to inspect the console directly.
