# Risk Sweep Audit — 2026-09-08

Scope: full-app review of bsm-app (offline-first React + Vite, Dexie.js/IndexedDB with
Dexie Cloud sync) beyond the duplicate-record protection, reversal-ordering, error-boundary,
and offline/service-worker hardening already landed earlier this session. Analysis only — no
code was modified.

## Executive summary

The codebase shows real engineering discipline: incremental pile-balance writes are guarded
against negative/drift results with an automatic full-recompute fallback, save/void/delete
handlers are wrapped in `db.transaction('rw', db.tables, ...)`, network calls have timeouts
and retries, and PDF/report code contains no HTML-injection surface. The most serious
remaining risks are not in that already-hardened core logic — they are (1) an **unauthenticated
serverless endpoint** that hands out full read/write credentials to the entire shared Dexie
Cloud realm to anyone who finds its URL, (2) **unsalted, un-rate-limited PIN hashing** for a
tiny keyspace, stored in a table that syncs to every device, and (3) the same class of
cached-running-total drift risk that was already fixed for authority balances still being
present, unfixed, for pile `currentBags`/`currentKilos` under concurrent offline multi-device
edits, and for manually-typed transaction serial numbers. None of these are theoretical edge
cases — each has a concrete input/timing sequence that produces a wrong or exploitable outcome,
detailed below.

---

## 1. Data integrity

### 1.1 [High] Pile `currentBags`/`currentKilos` can silently diverge across two offline devices editing the same pile
**File:** `src/utils/pileLedger.js:70-118` (`applyTransactionToPile`), `:125-151` (`reverseTransactionFromPile`)

`applyTransactionToPile` reads `pile.currentBags`/`currentKilos` with `db.piles.get(...)`,
computes `rawBags = pile.currentBags + delta`, then writes it back. This is a classic
read-modify-write, not an atomic increment. It is correctly serialized *within* one device's
own `db.transaction('rw', ...)` call, but Dexie Cloud sync does not turn two independent
devices' local read-modify-writes into a merge of deltas — it resolves conflicting field
values with a per-record/per-property last-write-wins.

**Failure scenario:** Warehouse Supervisor A (tablet, offline) creates a WSR adding 100 bags
to Pile X (currentBags 500 → 600, written locally). Warehouse Assistant B (different tablet,
also offline, hasn't yet pulled A's change) creates a WSI on the same Pile X for 50 bags,
computed from B's own stale local read (currentBags 500 → 450). When both devices regain
connectivity and sync, the `transactions` table itself is fine (both rows have distinct ids
and are proper CRDT-style adds), but `piles.currentBags` for Pile X ends up as whichever
device's sync landed last — either 600 (losing B's -50) or 450 (losing A's +100). The pile's
displayed running total is now wrong until something calls `recalculatePileCurrentState`
(only triggered by a transiently-negative delta, a beginning-balance edit, or an admin
re-open/close) — normal use never re-derives it from source transactions, so the drift can
persist indefinitely and silently understate or overstate real stock on hand.

**Recommended fix:** Either (a) stop treating `currentBags`/`currentKilos` as authoritative
for anything safety-critical — always re-derive from `computeHistoricalPileState`/
`computeCurrentPileStatesBatch` at the moments that matter (stock-availability checks before
allowing an issuance) rather than trusting the cached field, or (b) detect this class of
conflict directly: after every sync completes, re-run a lightweight consistency check
comparing the cached total against a fresh recompute for piles touched since the last check,
and auto-heal (or flag to the admin) any mismatch. AdminHomeStocks.jsx already demonstrates
awareness of this exact problem (it deliberately avoids the cached field via
`computeCurrentPileStatesBatch`) — the same distrust should extend to the availability checks
in `StockFormBase.jsx` (`src/components/forms/StockFormBase.jsx:905-906, 986-987`), which
still read `selectedPile.currentBags`/`currentKilos` directly.

### 1.2 [High] Manually-entered serial numbers can collide across two offline devices for the same warehouse+type
**File:** `src/utils/serialNumber.js` (whole file), `src/services/transactionPreload.js`

Serial numbers are fully user-editable (per the file's own header comment) and uniqueness is
only checked against whatever transactions this device currently knows about — either the
local `serialCounterCache` table (explicitly excluded from Dexie Cloud sync,
`src/db/dexie.js:867`) or a scan of locally-cached transactions. `transactions.id` (not
`serialNo`) is the actual Dexie primary key, so nothing in the schema enforces
`(type, warehouseId, cerealCategory, serialNo)` uniqueness at the storage layer.

**Failure scenario:** Two devices assigned to the same warehouse, both offline (or one just
not yet caught up on sync), independently open the WSR tab. Both see "suggested next serial:
#51" (because neither has pulled the other's most recent save yet) and both save a WSR with
serial `#51`. Both are valid, distinct transaction rows (`id` differs) and both sync
successfully — no error is raised anywhere, unlike the duplicate-*import* protection already
built for Sheets-sourced data. The warehouse now has two different documents claiming the
same serial number, which is a real-world audit/reporting problem (NFA stock statements are
organized by serial) and nothing in the app surfaces this to a user or admin.

**Recommended fix:** Add a periodic (or sync-triggered) duplicate-serial sweep, mirroring the
existing dedup sweeps in `googleSheetsBridge.js`/`transactionPreload.js` for authorities —
detect `(type, warehouseId, cerealCategory, serialNo)` collisions among `Active` transactions
after every sync and surface them in the admin Error Log / a dedicated panel for manual
reconciliation, since automatically picking a "winner" is not safe (both may be legitimate,
independently-created documents needing manual renumbering).

### 1.3 [Medium] `recalculatePileCurrentState`'s O(n) fallback runs unindexed date-range work on every trigger, but no cap on frequency
**File:** `src/utils/pileLedger.js:608-628`, called from `applyTransactionToPile`/`reverseTransactionFromPile` whenever a transiently negative delta occurs (backfilled/out-of-order entries — described in the code as a "real, confirmed scenario", so not rare)

Because backfilled/out-of-order entries are explicitly called out as a real, recurring
scenario, any warehouse whose staff routinely enter documents out of chronological order
(e.g. catching up on a backlog) will trigger a full transaction-history scan-and-recompute
(`computeHistoricalPileState`) on every single save for that pile, not just occasionally. This
is currently bounded by one warehouse's one pile's transaction count, which is fine today, but
years of accumulated transactions per long-lived pile combined with routine backfilling could
make every such save noticeably slower over time (see also §3.1).

**Recommended fix:** No urgent action needed at current data volumes; worth adding a lightweight
timer/log around this fallback path (or reusing the existing error-log infrastructure) so a
future slowdown is diagnosable, and worth revisiting once real per-pile transaction counts are
known (see §3 for the general growth-driven performance concern).

### 1.4 [Low] `calculateAverageWeightPerBag`/similar guard division by zero, but not every division site was checked for negative-input propagation
**File:** `src/utils/calculations.js:74-78` (this one is fine — `bags <= 0` guarded)

No unguarded division-by-zero site was found in `calculations.js` itself. This is listed as a
Low/informational item because the guard pattern is inconsistent in spirit (some functions
coerce with `Number(x) || 0` which silently turns `NaN`/invalid strings into 0 rather than
rejecting bad input, e.g. `calculateNetKilos`, `calculateMtsFromSackWeight`). A malformed
numeric input (e.g. a pasted value with stray characters that `stripFormatting` doesn't fully
clean) degrades silently to 0 rather than surfacing a validation error, which could let a
zero-value transaction save when the user actually intended a real number. Recommend an
explicit "did this field actually parse?" check at form-submit time for the few fields that
feed pile-balance math (grossKilos, numberOfBags), rather than relying on the calculation
helpers' permissive coercion.

---

## 2. Security

### 2.1 [Critical] `/api/dexie-cloud-tokens` is a completely unauthenticated endpoint that mints full read/write credentials to the shared realm
**File:** `api/dexie-cloud-tokens.js:32-143`

The handler checks only `req.method === 'POST'` and that server-side env vars are configured —
there is no API key, shared secret, origin/referer check, or CORS restriction visible anywhere
in the file. It accepts an arbitrary `public_key` (or `refresh_token`) from the request body and
proxies a `client_credentials` token request to Dexie Cloud using the server's own
`CLIENT_ID`/`CLIENT_SECRET`, requesting `scopes: ['ACCESS_DB', 'IMPERSONATE']` and
`claims.sub: 'bsm-app-service@system.local'` — i.e. it will issue a valid access token for the
one shared service account that owns every warehouse's real inventory data, to *any* caller who
can reach the URL.

**Failure scenario:** Once the app's Vercel deployment URL is known (trivial — it's the app's
own production URL, discoverable from the browser's own network tab, a leaked link, or just
guessing the project's default `*.vercel.app` domain), anyone can `curl -X POST
https://<app>.vercel.app/api/dexie-cloud-tokens -d '{"public_key":"<any-generated-keypair>"}'`
and receive a live `accessToken`/`refreshToken` for the shared account, then call the Dexie
Cloud REST/sync API directly to read or write every warehouse's transactions, piles, and
authorities — completely bypassing PIN login. There is no rate limit, so this is also trivially
scriptable for repeated abuse (token exhaustion, or just continuous exfiltration).

**Recommended fix:** Require the caller to already be a legitimate app session before minting a
token — e.g. have the client also send a short-lived signed value proving it just completed a
successful local PIN check (the server can't verify the PIN itself since PINs never leave the
device by design, but it can verify a nonce/HMAC the client computes only after `login()`
succeeds), or at minimum add an `Origin`/`Referer` allowlist plus IP-based rate limiting on the
Vercel function, and rotate the current client secret since it must now be treated as
effectively public (any past caller already has working tokens).

### 2.2 [High] PINs are unsalted SHA-256 over a tiny keyspace, stored in a table that syncs to every device
**File:** `src/utils/pinHash.js:1-23`, `src/db/dexie.js:20-25` (`users` table is not in
`unsyncedTables`, so it syncs via Dexie Cloud)

The file's own comment acknowledges the no-salt/no-iteration tradeoff on the assumption that
the threat model is "someone glancing at IndexedDB in DevTools." That threat model undersells
two things now true of this app: (a) `window.__DEBUG_DB__` (§2.3) plus the unauthenticated
token endpoint (§2.1) mean the `users` table's hashed PINs are reachable by a remote attacker,
not just someone with physical DevTools access, and (b) SHA-256 with no salt over a 4-8 digit
numeric PIN is reversible in well under a second by brute force (at most 10^8 candidates,
achievable at billions of hashes/sec on commodity hardware, or instantly via a precomputed
rainbow table since there's no salt to defeat it). Once the `users` table is exfiltrated via
either path above, every user's real PIN is recoverable, and because PIN reuse across users on
a shared numeric scheme is likely, this also gives strong hints for guessing.

**Recommended fix:** Add a per-user random salt (a public value, no secrecy needed) stored
alongside `accessCode`, and use a slow KDF (PBKDF2 via Web Crypto, or scrypt/argon2 if a small
JS implementation is acceptable) — the login-time cost is trivial for a single interactive PIN
check but makes offline brute-forcing meaningfully more expensive, especially combined with
closing §2.1.

### 2.3 [Medium] `window.__DEBUG_DB__` exposes the entire live database to any script running in the page
**File:** `src/db/dexie.js:16-18`

The comment argues this adds no new access since DevTools' own Application tab can already
inspect IndexedDB directly — true for a *user* opening their own DevTools, but not equivalent
for a **web-based attack**: any XSS (even a future one introduced by a dependency, not
necessarily this app's own code) or a malicious/compromised browser extension with page-script
access can now trivially read and write `window.__DEBUG_DB__.users`,
`.transactions`, etc. directly from injected JS, with no DevTools needed at all — this is a
materially larger attack surface than "DevTools already lets you look," since it doesn't
require the attacker to already have a foothold that lets them open DevTools, only one that
lets them run JS in the page. Given no XSS vector was found in this app's own code (§ below),
this is a defense-in-depth gap rather than an active hole today, but it removes a layer that
would otherwise limit the blast radius of a future dependency-introduced XSS.

**Recommended fix:** Gate this behind an explicit opt-in (e.g. only attach it when a
`?debug=1` query flag or a `localStorage` developer flag is set), or restrict it to
`import.meta.env.DEV` builds only, rather than exposing it unconditionally in production.

### 2.4 [Low] No XSS surface found, but the global `window.fetch` override is unscoped and permanent
**File:** `src/db/dexie.js:963-991`

Not a vulnerability by itself, but worth flagging: `window.fetch` is monkey-patched for the
lifetime of the page to intercept every request (not just Dexie Cloud's) and inspect
`response.ok`/body text. Any other library or future code path that also wraps `fetch` (or
expects to fully control its own request/response lifecycle, e.g. a streaming API) can
interact with this in surprising ways, and a `url.includes('dexie.cloud')` substring check is
technically spoofable by a same-page malicious script constructing a URL containing that
substring to trigger the auto-relogin path, though the actual impact of doing so is minimal
(it only calls `db.cloud.login()`, not exposing anything new). Low severity, noted for
completeness since the task asked for "anything else real."

---

## 3. Performance / scale

### 3.1 [Medium] `computeHistoricalPileState`/`computeCurrentPileStatesBatch` are full transaction-table scans, filtered in memory
**File:** `src/utils/pileLedger.js:485-596` and the single-pile equivalent above it

`computeCurrentPileStatesBatch` fetches every `Active` WSR/WSI/WTS transaction across every
pile in the app in one `.toArray()` call, then groups and sums in memory — this avoids N+1
per-pile queries (good, and explicitly called out in its own comment as the reason it exists),
but it is still an unbounded full-table read that grows linearly forever with the app's total
transaction history. At NFA's real scale (many warehouses, years of daily WSR/WSI/WTS/ESR/ESI
documents), this table will eventually reach tens or hundreds of thousands of rows, and
`AdminHomeStocks.jsx` calls this on every load (`src/pages/AdminHomeStocks.jsx:110`) with no
caching/memoization visible — every admin dashboard visit re-scans the entire history.

**Recommended fix:** Add a Dexie index-backed date-range filter to the initial query (e.g. only
fetch transactions since each warehouse's effective cutoff date, rather than everything then
filtering in memory) — the `[type+warehouseId+serialNo]` compound index already exists; a
`date`-inclusive variant would let this become a genuinely bounded query instead of a
whole-table scan, or memoize per-session with cheap invalidation (last-write timestamp check).

### 3.2 [Medium] Google Sheets sync applies row updates one at a time (N+1 write pattern), not batched
**File:** `src/services/googleSheetsBridge.js:760-926` (per-row `for` loops calling
`upsertAiAuthority`/`upsertSiaAuthority`, each doing its own `db.authorities.get`/`.update`/`.add`)

Each AI/SIA row from the Sheet triggers its own independent read + write against
`db.authorities`, rather than batching reads (`bulkGet`) and writes (`bulkPut`/a single
`db.transaction`). This is a periodic background sync, not a hot render path, so it's Medium
rather than High — but as the Sheet's row count grows over years, sync duration grows
linearly with per-row IndexedDB round-trip overhead rather than the much cheaper cost of a few
batched operations, and will eventually become the dominant cost of a login-time sync,
directly working against the responsiveness this app needs on low-end warehouse tablets.

**Recommended fix:** Batch the initial existence lookups with `db.authorities.bulkGet(...)` and
wrap the whole per-source sync loop in one `db.transaction('rw', db.authorities, ...)` (or use
`bulkPut` after computing all updates in memory) instead of one Dexie call per row.

### 3.3 [Medium] Single 1.7MB JS bundle with no code-splitting on low-end Android tablets
**File:** `vite.config.js` (no `build.rollupOptions.output.manualChunks`, no route-based
`React.lazy` found in `src/App.jsx`/route definitions)

Every route (forms, reports, admin panels, PDF generation libraries) ships in one JS bundle
that must be parsed and executed before the app is interactive. On the class of device this
app explicitly targets (low-end Android tablets in a warehouse, likely with slower CPUs and
less RAM than a typical developer's test device), single-bundle parse/compile time and initial
JS execution can meaningfully delay first paint/interactivity, especially on a cold
service-worker cache (first install) before the PWA's own caching helps on repeat visits. This
is a real, user-facing "the app feels slow to open" risk at the actual deployment hardware
target, not just a build-warning nitpick.

**Recommended fix:** Route-level code splitting via `React.lazy`/dynamic `import()` for
report/PDF-generation and admin-only screens (rarely needed at first load), keeping the login
screen and the most common stock-entry forms in the initial chunk; PDF/report libraries in
particular are good candidates to defer since they're only needed when a report is actually
generated.

---

## 4. UX / workflow gaps

### 4.1 [Low] Stock (WSR/WSI/WTS) vs Sack (ESR/ESI) forms remain two separately-maintained near-duplicate implementations
**File:** `src/components/forms/StockFormBase.jsx` (3,526 lines) vs
`src/components/forms/SackFormBase.jsx` (1,666 lines)

Both forms independently implement serial handling, dedup checks, confirm-dialog-gated
delete/void, and pile/customer autofill, each with its own copy of similar logic rather than a
shared base. This isn't a functional bug today (both are independently well-hardened per the
session's prior work), but it is a standing maintainability/consistency risk: a future fix
applied to one (e.g. another reversal-ordering correction) has to be remembered and
re-applied to the other by hand, and any behavioral drift between the two would confuse a user
who works with both document types expecting the same interaction patterns. Not urgent to
refactor now, but worth flagging before either file grows further.

### 4.2 [Low] No visible undo after a successful Void — only a separate manual "Unvoid" action requiring the user to know it exists
Both `StockFormBase.jsx` and `SackFormBase.jsx` have Void and a separate Unvoid path (per the
prior hardening work), which is good, but nothing in the immediate post-void UI (toast/
confirmation) surfaces an inline "Undo" affordance — a user has to already know Unvoid exists
and navigate back to the same document to use it. For a non-technical warehouse user this is
a discoverability gap more than a data-safety one (the data itself is recoverable), worth a
low-effort toast-action ("Voided. Undo") if the toast library supports action buttons.

---

## 5. Deployment / ops risk

### 5.1 [High] No handling anywhere for a Dexie schema-migration failure on a real user's device
**File:** `src/db/dexie.js` (32 versioned `.upgrade()` callbacks, several performing real data
transformations — hashing PINs in v16, backfilling `cerealCategory` in v24, etc.), `src/main.jsx`
(no top-level try/catch or error boundary around app bootstrap; `db.open()` is never called
explicitly with a `.catch`, so it relies on Dexie's implicit open-on-first-query)

If any `.upgrade()` callback throws for a specific real user's data shape (e.g. a record with an
unexpected null/malformed field that a `.modify()` callback doesn't defensively handle), Dexie
rejects the database open entirely — on that device, every future `db.<table>` operation fails,
which in practice means the whole app becomes unusable for that user (login itself queries
`db.users`). Nothing in `main.jsx`/`AuthContext.jsx` catches this at the top level, there is no
"corrupted local DB — reset local cache and re-sync from cloud" recovery path exposed to a
non-technical user, and the existing `SectionErrorBoundary`/error-log infrastructure (built for
in-app runtime errors) never gets a chance to run if the database itself fails to open before
React even renders past the login screen.

**Recommended fix:** Wrap the app's initial `db.open()` (or first real query) in an explicit
try/catch at the top of `main.jsx`, and on failure render a minimal, dependency-free fallback
screen offering: (a) a "Reset local data and re-sync from cloud" action (safe specifically
because this app is designed to be fully re-derivable from Dexie Cloud once online — the local
DB is a cache, not the sole copy, for every synced table), and (b) a way to still see/report the
raw error (e.g. via `navigator.clipboard` or a visible text block) since the existing
`errorLogs` table can't be written to if the database itself won't open.

### 5.2 [Medium] Diagnostic console logging left permanently active in production, including on every login attempt and every sync state change
**File:** `src/db/dexie.js:828-831, 914-916, 937-947`; `src/context/AuthContext.jsx:64-80`

Several blocks are explicitly labeled "TEMPORARY DIAGNOSTIC LOGGING... Remove once the
connection is confirmed stable" but remain active unconditionally in what appears to be the
current production code path — including logging the total row count of the `users` table and
whether a login attempt matched a `uid` on every single login (`AuthContext.jsx:67-76`), and
the Dexie Cloud `userId` on every `currentUser` change (`dexie.js:946`). None of this leaks a
PIN or password directly, but it is unbounded production log noise that will make the console
harder to use for genuinely new issues, and confirms internal state (record counts, matched
uid) to anyone with page-script access (compounds with §2.3/§2.4).

**Recommended fix:** Now that cross-device sync has apparently stabilized (per the recent
commit history), remove or gate these behind a dev-only flag as the comments themselves already
say to do.

### 5.3 [Low] Google Apps Script backend is a single, quota-bound point of failure for AI/SIA sync and transaction backup
**File:** `docs/apps-script-full-replacement.js`, referenced by `googleSheetsConfig`/
`sheetSources` in `src/services/googleSheetsBridge.js`

Google Apps Script Web Apps are subject to daily execution-time and trigger quotas tied to the
owning Google account. The app already has good client-side resilience (timeouts, retries,
offline queuing per the existing hardening), but there is no visible monitoring/alerting for
the *server* side of this — if the Apps Script quota is exhausted or the script's deployment
is revoked/needs re-authorization (a known Apps Script Web App behavior after certain edits),
every device would silently degrade to "AI/SIA data may be stale" with no operator-facing
signal beyond `lastSyncedAt` quietly stopping to advance. Low severity because the app already
degrades gracefully to offline-cached data rather than breaking, but worth an admin-visible
staleness warning (e.g. "AI/SIA data hasn't refreshed in over N days") rather than relying on
someone noticing `lastSyncedAt` in a settings screen.

---

## Findings index (severity-sorted)

| # | Severity | Area | Summary |
|---|----------|------|---------|
| 2.1 | Critical | Security | Unauthenticated token endpoint grants full realm access |
| 1.1 | High | Data integrity | Pile currentBags/currentKilos race across offline devices |
| 1.2 | High | Data integrity | Manually-typed serials can collide across offline devices |
| 2.2 | High | Security | Unsalted SHA-256 PINs, tiny keyspace, table syncs everywhere |
| 5.1 | High | Ops | No handling for a Dexie migration failure on a real device |
| 1.3 | Medium | Data integrity | Backfill-triggered full pile recompute has no frequency cap |
| 2.3 | Medium | Security | window.__DEBUG_DB__ unconditionally exposed in production |
| 3.1 | Medium | Performance | Full transaction-table scan on every Admin Home load |
| 3.2 | Medium | Performance | Sheets sync writes authorities one row at a time |
| 3.3 | Medium | Performance | Single 1.7MB bundle, no code-splitting, low-end tablet target |
| 5.2 | Medium | Ops | Permanent diagnostic console logging in production |
| 1.4 | Low | Data integrity | Permissive NaN-to-0 coercion on a few balance-feeding fields |
| 2.4 | Low | Security | Global unscoped window.fetch override (informational) |
| 4.1 | Low | UX | Stock vs Sack forms remain separately-maintained duplicates |
| 4.2 | Low | UX | No inline undo affordance immediately after Void |
| 5.3 | Low | Ops | Apps Script backend has no staleness alerting |
