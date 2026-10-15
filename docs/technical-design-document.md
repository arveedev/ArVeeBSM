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

### 2.9 SDO's cash tables are a new, dead-table-cautionary case, not an exception to 2.5's discipline

**Decision**: `cashLedgerV2` replaced an early `cashLedger` design that
used a Dexie native auto-increment key — the only such key anywhere in
this schema. The dead `cashLedger` table stays declared, forever,
exactly as it shipped, and is added to `unsyncedTables` defensively even
though nothing writes to it any more.

**Rationale**: an auto-increment key can't guarantee global uniqueness
across offline devices before it reaches the sync server, which broke
Dexie Cloud sync for the entire app, not just this one feature — the
same class of risk 3.4 already documents for `serialCounterCache`,
confirmed a second time via a real production incident. The recovery
path is the same rule stated there: a structural primary-key change is
a **new table name** in a later schema version, never an in-place
redefinition of an existing one — IndexedDB rejects that outright at
the database layer (a harder failure than the Dexie Cloud sync-request
rejection 3.4 describes, since it prevents the local database from even
opening), and the first emergency attempt at this exact fix demonstrated
that concretely.

### 2.10 Sheet-sync failures are logged, never toasted, to the regular user

**Decision**: a push to the Google Sheets backup log that's still
failing after one immediate inline retry is written to the admin-only
`errorLogs` table (`refId` identifying the specific record, `resolved`
starting false) instead of surfacing a `toast.error` to whichever user
happens to be using the device at that moment. The moment that same
record's push succeeds on a later automatic retry, the same log entry
is updated (`resolved: true`, `resolvedAt`) rather than a new one
being added or the original simply vanishing.

**Rationale**: the sync worker already retries a failed push
indefinitely, automatically, every `BACKUP_QUEUE_RETRY_INTERVAL_MS`
(30s) — most "failures" a regular user would see were a transient
connection blip already resolved by the time they read the toast,
which trained the alarm to be ignored while still causing real,
reported worry each time it fired. Moving this to a channel only an
admin actively looks at (and only when they're actually diagnosing
something) removes the false alarm without removing the underlying
information — the admin can still see exactly which record failed, on
which device, and whether it ultimately self-corrected.

### 2.11 CSS entrance animations must release, not hold, the properties they touch

**Decision**: any `@keyframes` animation meant to play once on mount
(a page/element entrance) is written with **no `forwards` or `both`
fill-mode** unless that element will never again need its `transform`/
`opacity` set by anything else afterward. `backwards` remains safe to
use (it only affects the state *before* a delayed animation starts, not
after it ends).

**Rationale**: a CSS Animation's held final-frame value (under
`forwards`/`both`) sits at a higher cascade priority than an ordinary
inline `style` or CSS transition on the same property, and silently
wins over it — discovered directly when a page's exit animation (an
inline-style `transform` applied on a later user action) stopped taking
effect on an element whose entrance animation had finished with a held
fill-mode still technically "active." The fix generalizes past that one
screen: any entrance/exit pair sharing a transform-driven element on
this app must be designed with which one, if either, actually needs to
hold its final state — and default to neither holding, since letting an
animation naturally release control back to the base cascade is what
lets a later, unrelated piece of code still move that same element.

### 2.12 Reactive live-query computations are decoupled from Dexie's per-write auto-tracking once they're expensive

**Decision**: a `useLiveQuery` wrapping a computation that reads tables
beyond the one it conceptually "owns" — a rollup that walks every pile's
own transaction history across every warehouse, or a scan across every
warehouse's own MO/TMO orders — is not left to re-run directly off
Dexie's automatic per-write dependency tracking once that computation is
expensive enough to matter. Instead, the shared
`useDebouncedLiveCompute` hook (`src/utils/useDebouncedLiveCompute.js`)
takes over: a lightweight row-count signal (e.g. `db.transactions.count()`
combined with whatever other counts the computation's own result
actually depends on) drives a debounced recompute, the computation
function itself is re-captured fresh on every render (so it always reads
the latest live data without the caller needing its own manual "keep
this in a ref" plumbing), and the debounce is paired with a **generous**
hard maxWait — tens of seconds, not single-digit seconds — so a
recompute is guaranteed on a bounded schedule no matter how continuous
the underlying write traffic is, without turning into a near-continuous
background recompute loop of its own.

**Rationale**: `useLiveQuery` re-invokes its querier function on every
write to *any* table the function touches during execution, not only the
table the query is conceptually about — Admin Home's warehouse stock
rollup, and separately MillingMonitor's admin-wide order-fulfillment
scan, both re-ran in full on every single incoming Dexie Cloud sync
write, sometimes dozens of times in a row during a sync burst, while the
loading indicator (`state === undefined`) only ever showed once, since
`useLiveQuery` keeps rendering its previous result while a new one
computes; a legitimately-still-settling page looked frozen instead. A
device with genuinely continuous sync traffic (confirmed directly on
both iPhone and Android) exposed two further failure modes, each from an
earlier attempted fix, before the current shape was settled: (1) a plain
"wait for quiet" debounce whose own effect depends on the live table
data directly never gets its quiet window at all, because the data's
changing identity restarts the debounce before it can elapse — a full
livelock, not merely a slow settle; (2) an initial 5-second maxWait,
while it did close that livelock, turned out to be its own regression —
on a device whose sync traffic never truly goes quiet, a 5-second maxWait
means the expensive computation fires on an effectively permanent
5-second loop for as long as that page stays open, reported as the whole
app "freezing"/slow to respond to taps (real contention: the same main
thread and IndexedDB connection every tap needs). A single shared hook,
reading live data through a ref that's re-captured every render instead
of as an effect dependency, plus a hard-but-generous maxWait, closes all
three failure modes at once: the computation can no longer be
cancelled-and-restarted mid-flight by unrelated table churn, it is
guaranteed to eventually run even if the underlying traffic never truly
goes quiet, and it does so on a cadence loose enough not to itself become
the performance problem.

A third confirmed instance, in `NfaMillingMonitor.jsx`'s admin-wide
Ricemill recovery computation, surfaced a fourth failure mode the
debounce/maxWait fix alone doesn't cover: a component that intentionally
stays mounted in the background across tab switches (to preserve its own
local state, e.g. an open search or expanded row) keeps recomputing on
its debounced cadence even while a *different* tab is the one actually
being looked at — and since that background write can be triggered by
the very action the user is performing on the visible tab (marking an
authority complete is itself a `db.authorities` write, which
`NfaMillingMonitor` also reads), the two land on the main thread at the
same moment, reported as dropped frames on the visible tab's own
animation. Any caller of `useDebouncedLiveCompute` that stays mounted
while inactive must freeze its own `changeSignal` to a constant while
inactive (not pass a fixed `active` flag into the hook itself, which
doesn't know about visibility) — see `MillingMonitor.jsx`'s and
`NfaMillingMonitor.jsx`'s own `active`-gated `changeSignal` for the
established shape of this.

A fifth confirmed instance, in `AdminMonitoring.jsx`'s own top-level
`db.authorities.toArray()` query (the AI/SIA tabs' data source), needed a
genuinely different fix rather than another application of
`useDebouncedLiveCompute`. That hook's change-detection signal is a row
**count**, which only changes on insert/delete — but almost every
meaningful write to `db.authorities` is a field mutation on an *existing*
row (an issuance decrementing totals, a completion toggle), so a
count-based signal would silently go stale on exactly the interactions
this page most needs to reflect immediately (the admin's own "mark
complete" tap chief among them). Fixed instead with React's
`useDeferredValue`: the query itself stays a plain, always-fresh
`useLiveQuery`, so data freshness is unaffected — but the array is wrapped
in `useDeferredValue` before any of the page's own heavy
filter/dedupe/sort derivation runs on it, so React schedules that
re-render work at lower priority instead of synchronously in the same
frame as a higher-priority update (the `completingId`-driven row
animation). This decouples render *priority* from data *freshness*,
which is the right tool specifically when the data must stay immediately
consistent (ruling out debounce) but the derived render work is
expensive enough to compete with an animation for frame budget — a third
distinct remedy for the same underlying `useLiveQuery`-reactivity family,
alongside batching (§2.12 point 1) and `useDebouncedLiveCompute`
(everywhere else in this section). Requires `ReactDOM.createRoot` (React
18 concurrent rendering), already in use app-wide.

### 2.13 A full pull that returns zero or suspiciously few rows must not advance the sync cursor

**Decision**: `runAuthoritiesSync` (`src/services/googleSheetsBridge.js`)
only writes a fresh `lastSyncedAt` for a Sheet source when either (a) the
request sent a `modifiedSince` filter (a routine delta pull, where zero
new/changed rows is the normal, expected outcome), or (b) a full pull (no
`modifiedSince` — a Force Resync, or a source's first-ever sync) actually
returned at least one AI or SIA row. A full pull that comes back with
zero rows for both AI and SIA leaves `lastSyncedAt` unset instead of
being marked "synced as of now," so the very next periodic sync tick
retries the same full pull automatically.

**Rationale**: the Apps Script bulk-fetch echo-redirect flakiness already
documented in `fetchWithRetry`'s own code comment (2.4/2.8's sync
mechanism relies on this same fetch path) doesn't always surface as a
thrown error — an affected attempt can come back as a syntactically valid
`{status: 'SUCCESS', rows: []}` response, which `fetchAuthorityRows`
correctly treats as success, not failure. Before this decision, the
sync loop wrote `lastSyncedAt: now` unconditionally after every pass
regardless of row count, so a single unlucky empty full pull permanently
poisoned that source: every later delta pull's `modifiedSince` filter is
relative to that new cursor, and can structurally never again catch a row
whose real last-modified timestamp falls before it — exactly the rows
the failed full pull existed to catch in the first place, with no error
ever surfaced anywhere to explain why. Confirmed against a real
production report: six specific AI/SIA authority numbers for one
warehouse (PHF SHED, its mechanical dryer transactions) stayed at
`assignedWarehouse: null` indefinitely, including after the user manually
ran Force Resync, while a direct fetch of the identical Apps Script URL —
bypassing the app's own retry logic entirely — proved the underlying
sheet data and warehouse-alias matching were both already correct. This
isolated the bug specifically to the sync loop's own cursor bookkeeping,
not to data or alias resolution, and the fix targets exactly that: leave
the cursor where it was on a suspicious empty full pull rather than
trusting it, so the same self-healing "the escape hatch is always still
there" property 2.4/2.8 already rely on for Force Resync keeps holding
even through this specific flavor of transient failure. Confirmed fixed
directly on the reporting device: a Force Resync's retries visibly hit
the same known echo-redirect 404s in console, self-healed on a later
automatic retry (per `fetchWithRetry`'s existing 6-attempt budget), and
landed a real full pull (`aiCount: 1306, siaCount: 241`) — PHF SHED's six
AI/SIA records then appeared under Authority Monitor as expected.

**Extension**: the same echo-redirect response layer could in principle
also hand back a genuine, valid-looking `{status: 'SUCCESS', rows: [...]}`
response that's merely *truncated* rather than fully empty — not observed
directly, but nothing about the zero-rows check above would catch it,
since any non-empty result skips past it and advances `lastSyncedAt`
regardless of how incomplete the result actually is. Each sheet source
now also remembers its row count from its last full pull that wasn't
itself flagged suspicious (`lastFullPullRowCounts`, a plain extra field
on the source record — no Dexie schema/version bump, same pattern as
`dateProcured` on a beginning-balance line). A later full pull whose AI
or SIA row count comes back under half of that source's own remembered
baseline is treated the same as the zero-rows case: `lastSyncedAt` is
left unset so the next tick retries, rather than silently accepting a
partial pull as complete. AI and SIA are judged independently (one sheet
can be legitimately much smaller than the other), and a source with no
prior baseline yet — a first sync, or a sheet that's always been small —
is never flagged, since there is nothing real yet to regress from. The
50% threshold is deliberately loose: tight enough to catch a response
that's lost the bulk of its rows to truncation, loose enough to tolerate
a sheet that's legitimately shrunk (e.g. a fresh year's copy starting
smaller than the prior year's).

### 2.14 A transaction's variety, not its stored category, decides its cereal tab

**Decision**: when a transaction's stored `cerealCategory` disagrees with
its variety's category, the variety's category wins in serial lookup and
tab selection (`isCategoryCompatible`), and an admin Data Repair tool
rewrites the stored value on confirmation.

**Rationale**: the original category-less fallback could file a record
under the wrong tab, and gating the fallback alone left already-corrupted
records behind, which kept reopening as Update forms. The variety is
chosen deliberately by the user and is permanent per pile; the category is
derived. Repair is scan-first because applying the rule to a record whose
variety was itself mistaken would only move the error.

### 2.15 Warehouse moves: previewed, selective, and re-synced rather than rewritten

**Decision**: Move Records (and the per-transaction move offered from the
Authority Review screen) share one planner/executor. The planner is a
pure dry run returning blockers and warnings; the executor applies the
result in one Dexie transaction (create missing destination piles, re-point
`warehouseId`/`pileId`/WTS pile ids, move linked Purchase Receipts, write
the audit entry), then recomputes both sides' pile balances and serial
counters from the real ledgers. Moved records are marked `isSynced:false`
so the existing sync queue calls `updateTransactionBackup` (matched by
serial) with the new warehouse's context.

**Rationale**: reusing the established retry-and-failure-logging path
avoids a second Sheet-writing mechanism. Recomputing from ledgers, rather
than adjusting running totals, avoids the lost-update gap documented in
§2.7. Sack records (ESR/ESI) are excluded because sack inventory is per
warehouse and is not part of this move. A serial change on move reuses the
serial rename path, which leaves the old Sheet row for manual cleanup.

### 2.16 Authority change detection is derived, not stored per user

**Decision**: the sync appends a small `changeLog` entry to an authority
only when a material field changes on an authority that Active
transactions use, and stamps `missingFromSheetAt` only after a complete,
non-suspicious full pull (same completeness checks as §2.13), refusing to
flag if more than 15% of a source's authorities appear missing. Whether a
transaction needs review is computed live by comparing that stamp with the
transaction's `authorityAckAt`/`createdAt`; no per-user notification rows
exist. Every helper swallows its own errors.

**Rationale**: stored alerts would need a new synced table, per-user
targeting, and deduplication across devices that each run the sync;
deriving them from two plain fields needs no schema bump and cannot
duplicate. The noise guards (ignore null/value backfills, ignore
authorities nothing uses, mass-missing refusal) exist because a false alarm
here would reach every warehouse user. Acknowledging stamps one field and
nothing else; every corrective action is a user-initiated edit of a single
transaction. Rejected alternatives: app-authored authorities written to the
Sheet (the admin must keep editing the Sheet), and automatic migration on
renumber (silent integrity risk in production). Open question: a stable ID
issued at the Sheet root would remove the need for any of this.

### 2.31 Inventory lots are computed, never stored (Daily Inventory and Age Monitoring)

**Decision**: stock by age is derived on demand by rebuilding every pile's
receipts as lots (one lot per WSR, beginning-balance line or transfer-in, each
with its own receipt date) and issuing the oldest lot of the pile first
(`src/utils/inventoryLots.js`). Transfers carry the original lot dates. A
beginning balance is the pile's opening stock and is applied first. Age is
counted in calendar months: whole months between the receipt date and the report date (April 1 to October 1 is exactly 6.0), plus the days since the last monthly anniversary as a fraction of a 30.44-day month. A lot received exactly 6 months ago is therefore still in the 0-6 bracket; the former plain 30.44-day count made it 6.01 and moved it a bracket early. Age brackets in the stock tables are worked out on the 1st of the month so a move shows in the next month, except that an opening balance dated the last day of a month keeps its brackets through the month it opens. An Admin's opening-balance override is worked into the lots (a lower balance takes the difference out of the lots in that bracket, a higher one adds a lot of that age to a pile of the same warehouse and cereal), so a correction ages and is used up like real stock. The Data check runs a self-check on every open (summary equals ledger ending, each day starts where the day before ended, every day balances, no negative balance, typed balances show as typed, Combined equals separate, ages agree with an independent count) so a wrong figure is caught by the app, not by eye.
Beginning-balance lots age from the readable date in "Date Received" (the first
date of a range, the 1st of a month-only text), else from the pile date, and
that fallback is listed as approximate.

An authority always deducts in full: the part its named age bracket could not supply is deducted anyway as a negative "shortfall" lot of that
bracket (placed in an open pile of the authority's warehouse, preferring one of the same variety), and WSI / transfer draws never take from it.

**Rationale**: a stored snapshot table would need a schema version on a synced
database and would go stale whenever an old record is corrected. Computing from
the same records and the same inclusion rules as `computeHistoricalPileState`
(start dates, closed piles) means the reports agree with the pile balances by
construction; on the 2026-10-08 backup the rebuilt balance matched the stored
balance on 75 of 77 piles (the two exceptions are empty piles that keep leftover
kilos in the app). One pass over about 3,400 transactions takes milliseconds.
Rejected: replaying the Sheet logs (the old approach: duplicates, guessed ages,
manual QA re-entry).

### 2.32 One table model for screen, Excel, PDF and Google Sheet

**Decision**: each report builds a neutral table model (`inventoryReport.js`,
`procurementStatus.js`, `millingLiquidation.js`); the screen, the Excel file, the
PDF and the Apps Script payload all render that model.

**Rationale**: the screen and the exports cannot disagree. The Google Sheet export
uses its own Apps Script and its own spreadsheet and posts only finished numbers;
it is separate from the AI/SIA bridge so the bridge's write allowlist stays intact.
The only data writes in the whole feature are explicit saves of the optional
`reportConfig` fields (milling prices, signatories, sheet export URL).

### 2.33 A WTS issued from several piles is several ordinary WTS records

**Decision**: a WTS taken from more than one pile of the same warehouse into one receiving pile is saved the way a
multi-pile WSI is: the first pile stays the document's own record, and each extra issuing pile is its own ordinary
two-sided WTS record (serial `<serial>-A`, `-B`, ..., shared `groupSerialNo`) with its own issued and received numbers
into the same receiving pile (`src/utils/wtsGroup.js`, used by `WTSForm.jsx`). Save, update, void, un-void and delete
act on the whole group in one Dexie transaction; opening an extra record opens the group's primary; Next / Previous skip
the extra records.

**Rationale**: no schema change and no reader changes: pile balances, the pile ledger, bin cards, Sheet sync and the Stock
Desk (where each issuing pile's lots reach the receiving pile with their own receipt dates) already read ordinary WTS
records, and Reports and the PDF already combine records sharing a `groupSerialNo`. Rejected: issued-only sibling records
with one received total (one-sided records, and the Stock Desk would need group-aware lot carrying); one record holding a
list of issuing piles (changes the shape every reader depends on).

### 2.34 Excel exports are built from what the PDF printed, not from a second set of calculations

**Decision**: each PDF generator accepts an optional `capture` array. `src/utils/pdfCapture.js` wraps `autoTable` and `cap()`
so that, next to everything a generator prints, it records the same content as plain data: title lines, headings, info
lines, tables (head, body, foot) with the printed column widths, indent, page size and column alignment, reconciliation
rows and signatories. `src/utils/reportExcel.js` (ExcelJS, imported only when Export is chosen) turns that record into the
workbook. A single `saveReport({ kind })` writes the PDF or the Excel. The Pile Layout, which is a floor plan and not a
table, has its own builder fed by the same `boxDetailEntries()` the PDF uses.

**Rationale**: the Excel file always shows exactly the rows and totals the PDF shows, with no second calculation that could
drift. Printed millimetres convert to Excel column widths, so the sheet prints at the PDF's proportions. Rejected:
re-deriving each report for Excel (two sources of truth, which is what produced an Excel that "looked nothing like" the
PDF in the first versions).

### 2.35 Excel formulas are written only where they reproduce the printed figure

**Decision**: after the cells are placed, `reportExcel.js` looks for relationships in the numbers themselves and writes a
formula only where it gives the printed value on every row it applies to: totals (`SUBTOTAL(9, ...)` so a filtered sheet
re-totals; a "TOTAL" or "SUB-TOTAL" row inside the body counts as a total, not only a footer), Ending = Beginning +
Receipts - Issues, running balances, and any column that equals A - B or A x B of columns to its left (Net Wt = Gross - MTS,
Equivalent Net Wt = Net Wt x ENW Factor, Amount = Kilos x Unit Cost), rounded to the printed decimals. Blank rows (a
cancelled PR) are skipped. On the Stock Report the Summary receipts / issues and the Recapitulation figures are `SUMIFS`
over the Statement sheets, and the grand total adds the activity totals. `fullCalcOnLoad` makes Excel recompute on open.

**Rationale**: a formula that silently changed the report would be worse than a plain number, so each is verified against the
printed value first and left as a number when it does not match. Targets must be to the right of their operands, which makes
circular references impossible. An early version only looked at footer rows and skipped any column with a blank cell, so
real exports (whose totals were body rows and which contained cancelled PRs) came out with no formulas at all.

### 2.36 The logistics inventory is a stored, synced table, printed with the Stock Report

**Decision**: `logisticsItems` (Dexie v45, synced; see backend-schema) holds one row per pallet, platform scale or other
logistical / semi-expendable item of a warehouse, with add / edit / delete in the Logistics Inventory modal opened from Home.
The modal does no exporting. `generateNfaReport` takes `logisticsItems` and, only when the list is not empty, adds a last
page (`addLogisticsPage` in `pdfGenerator.js`) with the three tables under the Stock Report's header, period and signatories.
Because it is an ordinary captured page, the Excel export includes it as a sheet with no extra code.

**Rationale**: the figures are an inventory that persists and changes by small edits, and the report is part of the weekly
stock submission rather than a separate document. The first version kept typed values in the browser's local storage (neither
synced nor backed up), the second exported its own PDF from the modal; both were replaced. A table is read by the daily GitHub
backup and the device download automatically (both read `db.tables`) and syncs through Dexie Cloud. It is deliberately not in
the Google Sheets sync.

### 2.37 DV and BUR are drawn from the Abstract's data

**Decision**: `src/utils/sdoDvBurPdfGenerator.js` draws the Disbursement Voucher (four identical A4 pages) and the Budget Utilization Request and
Status (one A4 holding two identical copies above and below a dashed cut line), five pages in all, from the PRs of the Abstract export. Payee is
the SDO, amount is the total of the paid PRs, particulars are "TO: REPLENISHMENT OF CPF FOR THE PAID PR #first TO last", plus
" DATED ..." only when the SDO's own `dvDatedText` setting is on (default off). Signatories are the Abstract's.

**Rationale**: the voucher cannot disagree with the Abstract it replenishes. Exact column proportions of the paper forms are
drawn from the originals; a stray vertical line through the BUR's "Balance" heading and a missing JEV No. / Date column on the
DV were both found by comparing the printout with the original side by side.

### 2.38 Tab order is an explicit chain where the DOM order would mislead

**Decision**: on the WSR/WSI form the Customer group sits before the Stock Details group in the desktop DOM, so Tab from MTS
(the last field of Stock Details) is handled by an explicit chain: Nature of Transaction, Customer Name, Address, then the
procurement fields, each stopped at only while empty, then Number of Bags. Shift+Tab walks the same chain backwards.

**Rationale**: the earlier chain assumed an authority pick had always filled Nature of Transaction and Customer Name and skipped
straight to Address, which left a blank Nature of Transaction unreachable by keyboard.

### 2.39 The login logo timeline

**Decision**: the logo opens large and centred (measured from an untransformed slot so its resting position is exact), builds
its two triangles and notch, holds a beat, then shrinks into its place over 700 ms; the other elements keep their own
entrance animations, delayed by one shared variable so they start as the logo begins to shrink. `prefers-reduced-motion`
removes all of it.

**Rationale**: one coordinated entrance instead of a logo effect competing with the rest of the screen.

### 2.40 MO/TMO completion is a synced decision, not a flag in a local cache

**Decision**: `millingOrders` is rebuilt from the Sheet on every sync and is not synced, so a manual "mark done" kept only
there never left the device (the best-effort write of DONE to the Sheet fails offline). The decision is now a row in
`millingOrderCompletions` (Dexie v46, synced, keyed like `millingOrders`: `type::number`, `completed` true / false).
`src/services/millingCompletion.js` writes the row and the local flag together, copies synced rows onto the local cache
whenever they change (a live query, so a change from another device applies at once), merges them inside the Sheet sync's
rebuild so they win over a local flag, and on first run uploads completions the device had marked before the table existed.

The app's decision is final and the Sheet follows it: once an order has a decision row, the Sheet's STATUS value can neither
complete nor reopen it in the app (the cache keeps the Sheet's own value apart as `sheetStatusRaw` and reads the decision as
`sheetStatus`). Whenever the Sheet disagrees with a decision, `pushCompletionsToSheet()` writes it (DONE, or blank for a
reverted order), on every change, on start and every minute while online, until the write succeeds. Completion is manual-only: an order nobody marked done in the app is pending whatever the Sheet's STATUS cell says (older
versions wrote DONE to the Sheet by themselves, and those cells had been listing orders as completed with no check mark, and
bringing a reverted order straight back).

**Rationale**: one device showed many finished mills while the others still listed them as pending. Rejected: syncing
`millingOrders` itself (a cache that is cleared and rebuilt wholesale on each pull would fight the sync).

### 2.41 Everything an admin enters must live in a synced table

**Decision**: a table that holds data entered by people is never excluded from sync and never keyed by a compound key. The
private-miller shares of a Regional Authority Number were the one such table that was not synced (compound primary key, which
Dexie Cloud cannot sync, so each device kept its own copy). They now live in `privateMillerShares` (Dexie v47, key
`<regional number>::<ricemill>`, synced); `src/services/legacyMigrations.js` uploads whatever a device already held in the old table
once. The province that receives Cash in Bank moved from browser storage to the shared report settings (`reportConfig.procurementBank`).
What stays device-only is only what can be rebuilt: the serial counters, the preload state, and the Sheet cache `millingOrders`
(whose completion state is synced separately, §2.40).

**Rationale**: a user on several devices, and an admin looking at everyone's work, must see the same data; a local-only copy looks
correct on the device that made it and silently differs everywhere else.

### 2.42 Escape closes the topmost modal, through one stack

**Decision**: `src/utils/useEscapeClose.js` keeps a stack of open overlays and one window listener hands each Escape to the
most recently opened one only. Every modal, sheet and dialog registers its own close routine (the one that plays its exit
animation), including ConfirmDialog, the export dialog and the calendar, so a confirmation over a dialog, or a calendar inside it,
closes alone. Entry forms and the Stock Desk keep their own Escape rules.

### 2.43 The Stock Desk opens from anywhere

**Decision**: `StockDeskHost` is mounted once in the app shell; the Home icon and Ctrl + Alt + D (on any page) both ask it to open the
Stock Desk, for an Admin or a Visitor who has a screen shared.

### 2.44 Purchase Receipt numbers follow a check-digit series

**Decision**: a PR number is a serial, a hyphen and one check digit equal to the serial modulo 7 (5798006-4, 5798009-0, 5798030-0).
`suggestNextPrSerial` takes the SDO's latest issued number and suggests the next serial with its own check digit; a typed number whose
digit does not fit gets a warning (nothing is blocked), and a bare serial is completed on leaving the field.

### 2.45 A recompute keeps the previous result on screen

**Decision**: `useDebouncedLiveCompute` takes `keepPrevious`; the MO/TMO monitors use it so marking an order done does not empty and
refill the whole list while the status is recomputed.

### 2.46 Derived totals are recomputed from the synced transactions, never trusted from a stored number

**Decision**: an authority's issued bags / kilos and a pile's balance are stored on synced rows for fast reading, but they are derived
data. Each device recomputes them from the synced transactions (`src/services/derivedTotalsSync.js`) after any change to the
transactions, whenever it reaches the cloud's `in-sync` phase, and every five minutes, and writes only a value that differs. The recompute is
gated by `isCloudSyncFullyCaughtUp()` (phase exactly `in-sync`), and the older sweeps (the Sheet sync's authority recompute, the pile
sweep in the transaction preload) are gated the same way. New authorities get the deterministic id `AI::<number>` / `SIA::<number>`.

**Rationale**: a form save moves these totals with a read-modify-write, so two devices saving against the same authority before they had
synced lost one side's change, and a device that had not finished pulling recomputed a LOWER total from fewer transactions and synced it to
everyone. The result was an authority that one user saw as used and another as still available. Every device computing the same function of the
same synced transactions converges; waiting for `in-sync` keeps a device with a partial copy from writing a wrong number. Random ids let two
devices that first saw the same Sheet row create two authority records, one of which a dedupe pass then deleted, taking its issued total with it.

### 2.47 A closed pile's leftover net kilos move to another pile as a 0-bag transfer

**Decision**: when a pile is closed with no bags left but net kilos still in its ledger, those kilos are moved to an open pile of the same variety
and cereal in the same warehouse by an ordinary WTS record with 0 bags (`utils/closingResidue.js`): issued from the closed pile, received by
the destination, dated the pile's closing date, serial `RESIDUE-<7 digits>` taken from the closed pile's id, flagged `isClosingResidue`
and marked synced so nothing is written to the Google Sheet. The record's id is `residue::<closed pile id>`, so repeating the move changes
nothing. A warehouse's reporting start (override) date is respected: a pile closed on or before it has no residue and is left alone, and
the ledger it is computed from uses the same cutoff. Re-opening a pile deletes its residue record. Closing from any screen goes through
`closePileWithResidue`, which picks the open pile holding the most stock; Admin > Closing Residue scans piles that were closed earlier
and moves them with a destination chosen per pile. In the Stock Desk lots, a closed pile keeps its leftover as a 0-bag lot with its
original receipt date and the residue transfer carries that lot to the destination, so the stock keeps its age. The record carries the dominant sack weight and condition (by net kilos) of the source on its issued side and of the destination on its received side, so the kilos join the pile's existing stock group.

**Rationale**: closing a pile zeroes it, so its leftover kilos disappeared from every pile-level view while the warehouse statement still
counted them and the two stopped tallying. An ordinary transfer needs no new calculation anywhere: pile balances, BIN Cards (labelled
CLOSING RESIDUE with the other pile's name), the Stock Report and the Stock Desk read it as they read any transfer, and it nets to zero at
variety level. Using the closing date keeps earlier reports unchanged.

### 2.48 The opening balance is a frozen snapshot; authorities always deduct in full

**Decision**: saving the Daily inventory Opening balance stores the whole balance of that day (`inventoryOpening.cells`, every cell as shown, with `full: true`). At report time every computed cell on that day that is not in the list is brought to nothing and every listed cell is brought to its typed value (`withOpening`), worked into the lots so it ages and is used up; documents dated after the day add and take as usual. An override without `full` (saved before this decision) keeps the earlier partial behaviour. With a frozen opening, a pile's beginning balance (INIT row) dated after the opening day is ignored by these reports, because it is not a document. The Stock Desk deducts an authority's full authorized amount (or what it issued if more) from its date whether or not it was completed.

**Rationale**: a partial override left every other cell computed from the history before the opening day, so any later change to that history (a Sheet authority dated in the past, an edited amount, a back-dated document, an authority completion) moved balances the owner had already fixed, and they had to be corrected again each day. A snapshot cuts the history: the opening day is a fixed figure and only later documents move it. An authority completed after the fact is no reason to give stock back: once authorized, the stock is committed.

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
- Any "is this field currently visible" check must use
  `window.visualViewport`'s height where available, not
  `window.innerHeight` — most mobile browsers do not shrink the layout
  viewport when the on-screen keyboard opens, only the visual one, so a
  check against the wrong one can misjudge a field as visible while the
  keyboard is actually covering it.

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
