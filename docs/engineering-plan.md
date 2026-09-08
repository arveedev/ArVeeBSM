# BSM App — Engineering Plan

*Companion to the other five planning documents. This document lays out
the phased build plan the team will follow, with milestones, anticipated
risk areas, and the testing/rollout approach. Phases below are
sequenced by dependency (schema and auth before forms, forms before
sync, sync before reporting) and are expected to run with real warehouse
staff as continuous field testers from Phase 2 onward — this plan
explicitly budgets for iteration rounds driven by that live feedback,
not just first-pass delivery.*

## Phase 1 — Foundation

**Goal**: a working local-first shell — schema, login, and routing —
with nothing yet talking to a network.

- Stand up the Dexie (IndexedDB) database and its initial schema:
  `users`, `piles`, `transactions`, `authorities`.
- PIN-based login against local `users` records (accessCode initially
  plain, hashing to follow once the login flow itself is proven).
- Vite + React + Tailwind project scaffold; the neutral/brand color
  tokens and dark theme established from the start, since every later
  screen depends on them.
- Basic routing shell (Login, Home, protected-route gating).

**Milestone**: a user can log in with a PIN and reach a Home screen
backed entirely by local data, offline, on a real device.

**Risk anticipated**: getting the Dexie schema's *shape* right early is
cheaper than fixing it later, but perfect foresight isn't realistic —
the plan accepts that most tables will need at least one structural
revision once real form requirements are understood (this is exactly
what happened; see Phase 2 below), and budgets schema versioning as an
ongoing discipline (every change ships with a tested `.upgrade()`
migration) rather than a one-time Phase 1 deliverable.

## Phase 2 — Core Stock Forms and Admin Configuration

**Goal**: the full data-entry surface (WSR/WSI/WTS/ESR/ESI) and the
admin configuration model those forms depend on.

- Admin configuration tables: provinces, warehouses, variety types, sack
  types, transaction types, signatories, report config.
- Multi-warehouse user assignment; Title Case role naming
  (Admin/Warehouse Supervisor/Warehouse Assistant, later extended with
  MPO III and every role's "Acting" variant).
- The stock/sack form split: WSR/WSI (kilos/bags, tied to a pile) vs.
  ESR/ESI (pieces only, sack lines, no pile) — built as one
  `transactions` table with type-conditional fields rather than
  separate tables, based directly on real NFA paper document samples
  (Empty Sacks Issue, Empty Sack Receipt, Warehouse Stock Issue/Receipt).
- User-controlled serial numbers (system-suggested starting value,
  uniqueness enforced per document type).
- First working report generation (jsPDF/jspdf-autotable), validated
  directly against the real paper forms.

**Milestone**: a warehouse Supervisor can record a real day's WSR/WSI/
WTS/ESR/ESI activity end-to-end and export a matching PDF report,
entirely offline.

**Risk anticipated**: the true shape of "one document type" only became
clear from real sample documents, not from a spec written in advance —
expect the transaction schema to be revised more than once as
additional real-world fields surface (moisture content, farmer
cooperative membership, batch/trial numbers) well after this phase
otherwise looks "done."

## Phase 3 — Admin Dashboard Depth and Report Fidelity

**Goal**: the full admin configuration surface, and reports that match
the real paper forms exactly, not approximately.

- Branch → Province → Warehouse hierarchy (branch membership derived
  through province, never stored directly on the warehouse — an
  explicit correction after an earlier, simpler attempt required
  keeping two fields in sync by hand).
- Full report set: Summary, Statement of Receipts, Recapitulation of
  Receipts, Statement of Issues, Recapitulation of Issues (stocks);
  Warehouse MTS Report, Statement of MTS Issues/Receipts, Weekly
  Recapitulation of Empty Sack Issues/Receipts (sacks) — each matching
  the real REGION/PROVINCE/CODE/WHSE header block and five-signatory
  sign-off exactly.
- Customer directory + autocomplete, built up automatically from saved
  forms rather than admin-entered.
- Beginning-balance concept: an `isInitialBalance` flag on synthetic
  seed transactions, excluded from statement/recap line items but
  included in beginning-balance math.

**Milestone**: every report category renders correctly for a real
warehouse's real historical data, byte-for-byte matching what a
hand-prepared paper form would show for the same period.

## Phase 4 — Cloud Sync and Offline Hardening

**Goal**: multi-device consistency without compromising the offline-first
guarantee established in Phase 1.

- Dexie Cloud integration: shared service account via a serverless
  token endpoint, `requireAuth: false` so local operations never block
  on network state.
- Background sync worker for the Google Sheets transaction backup log;
  cross-tab Web Locks coordination to prevent duplicate pushes from two
  tabs of the same device.
- PIN hashing correction and migration (an early gap where hashing was
  introduced without migrating already-stored plaintext values — every
  existing user would otherwise be locked out permanently; the fix
  detects un-hashed values by length and migrates them in place).
- Serial number durability: an explicit `serialCounters` /
  `serialCounterCache` performance cache layered over (never replacing)
  a scan-based fallback against real transaction history.
- Full-screen pile layout mode; the app's general animation system
  (page transitions, nav pill, toasts) established as a reusable
  pattern rather than per-screen one-offs.

**Milestone**: two devices, each recording transactions for the same
warehouse while briefly offline, converge to an identical, non-duplicated
transaction history once both reconnect.

**Risk anticipated (materialized, see activity-log.md)**: cross-device
sync correctness is genuinely hard to get right the first time. Expect
at least one root-cause investigation into transactions silently never
reaching other devices — the real cause found was a Dexie Cloud
constraint (an already-registered table's primary key can never be
changed in place; doing so gets the *entire* sync request rejected, not
just that one table) that had nothing to do with the `transactions`
table itself despite that being where the symptom appeared. Budget
dedicated investigation time for sync bugs specifically — they tend to
have non-obvious, structurally distant root causes rather than being
fixable by inspecting the feature that appears broken.

## Phase 5 — Authorities (AI/SIA) and Sheets Integration

**Goal**: live, one-way integration with the branch's existing
production spreadsheet for authority data, with zero conflict-resolution
surface.

- Google Sheets bridge: AI/SIA read-in, transaction backup write-out,
  enforced by a structural write-allowlist on both client and Apps
  Script server.
- SIA architecture correction: one record per SIA number with a
  `sackLines` array (not one record per sack-type+condition
  combination) — the compact "PPMG50/PPRE50 + 65bn/17sh" string format
  used earlier was found to be genuinely ambiguous and to overflow
  columns unpredictably.
- Warehouse/customer alias tables, since the Sheet's own nicknames
  frequently don't match this app's canonical names (typo'd spelling
  variants resolved via aliasing; genuinely different entities never
  merged).
- Multi-year sheet sources — supporting more than one spreadsheet/date
  range at once, since the branch's real practice is a fresh copy every
  year.
- Balance/status derivation (Pending/Complete/Over-Issued) always from
  real issued-vs-allocated figures, with a manual-complete admin
  override for authorities that will never balance perfectly on paper.

**Milestone**: an authority entered in the production spreadsheet is
visible in the app within one sync cycle, and every WSI/ESI issued
against it correctly and immediately updates its displayed balance, with
no admin action required for the common case.

## Phase 6 — Milling Operations and Pile Lifecycle

**Goal**: two structurally distinct milling tracks (private millers vs.
NFA-owned facilities), plus real pile-of-life lifecycle handling.

- `millingOrders` (MO/TMO), synced read-only from the Sheet, mirroring
  the existing authorities pattern.
- `ricemillAllocations` / `privateMillerAllocations` for NFA-owned vs.
  private-miller tracking — genuinely different authorization models
  (a single Regional Authority Number per NFA facility vs. one number
  shared unequally across several private millers).
- `facilityType` on warehouses (Warehouse / Ricemill / Mechanical
  Dryer), changing what that facility's own Home page and the
  cross-warehouse Monitor present.
- Pile lifecycle: `zeroedDate` auto-set/cleared based on live totals
  (tolerance-based, not strict equality, to absorb floating-point
  drift); auto-vacate eligibility after a grace period; historical pile
  layout reconstruction via `pileLayoutHistory`.
- Root-cause fix for pile deletion cascading unintentionally into
  transaction deletion.

**Milestone**: an NFA-owned Ricemill's Home page correctly shows
Issuance vs. allocation and a recovery percentage for a real Regional
Authority Number, and a private miller's Test Milling trial history is
correctly tracked across up to three trials without restricting how
those trials map to transactions.

## Phase 7 — Reporting Depth, Reconciliation, and Cross-Cutting Fixes

**Goal**: the long tail of correctness work that only surfaces once the
system is under sustained real use — rolling balances, unwithdrawn/
potential-inventory monitoring, and a large volume of field-reported
fixes across every earlier phase.

- Reporting cutoff date concept (`reportingCutoffDate` /
  `effectiveCutoffDate`), extended app-wide so a report period, an
  unwithdrawn-stock calculation, and a pile's own math all respect the
  same effective start date consistently.
- Rolling balance rework and repeatable beginning-balance lines.
- Unwithdrawn/potential-inventory monitoring on Home and Admin Home.
- Multi-pile WSI issuance (a single issuance drawing from more than one
  pile).
- A sustained field-testing and code-audit cadence — the real project
  history (`src/version.js`, 1.9-x era) shows dozens of targeted fixes
  found this way: duplicate-record races under increasingly specific
  conditions, serial-navigation edge cases, PDF export field-width and
  truncation issues, warehouse/customer name-matching gaps, and
  performance fixes surfaced by real data volume rather than synthetic
  testing.
- Data Start Date (global reporting floor) and Error Log (admin-visible,
  cross-device error capture) as operational/support tooling, added
  once the app was in daily real use and needed to be supportable
  remotely.

**Milestone**: the app is in daily production use across multiple
warehouses with no open data-integrity bug, and every NFA report type
has been validated against a real signed paper counterpart.

## Testing and Rollout Approach

- **No dedicated automated test suite is assumed as a blocking gate** —
  the realistic validation loop for this app is direct use by real
  warehouse staff against real transaction volume, since the domain
  rules (NFA report formatting, authority balance semantics, milling
  authorization models) are themselves sourced from real paper
  documents and real spreadsheet data, not a written spec that exists
  independently of them. Each phase's milestone above is the acceptance
  bar, verified by using the app to do the actual job it replaces.
- **Schema changes are the one place regression risk is highest** and
  are treated accordingly: every Dexie version bump is expected to ship
  with an explicit `.upgrade()` migration when existing data needs
  reshaping, and to be sanity-checked against a device carrying real,
  already-synced data before being considered safe to ship — a schema
  mistake that reaches production risks locking every existing user out
  or silently corrupting their data, not just breaking a new feature.
- **Sync correctness is verified across at least two physical devices**
  sharing a warehouse assignment, deliberately including a
  poor-connectivity or offline interval in the test, not just a
  same-network happy path.
- **Report output is verified against the real, physical paper form**
  it's meant to replace — a report that is numerically correct but
  visually diverges from the paper form (wrong header fields, wrong
  signatory block, truncated long values) is not considered done.
- **Rollout is continuous and incremental**, not phase-gated behind a
  big-bang release — each phase's milestone is usable in the field as
  soon as it lands, and the 1.x point-release changelog convention
  (`src/version.js`) exists specifically to make an ongoing stream of
  small, dated fixes and features legible to whoever is field-testing
  the app at any given time, rather than batching changes into
  infrequent large releases.
