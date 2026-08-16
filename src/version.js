// Single source of truth for the app's version label, shown small and
// muted at the bottom of the Login page. Scheme: MAJOR.MINOR<letter>-BUILD<letter>
//   MAJOR  - bumps only for a fundamental architecture rebuild (rare).
//   MINOR  - bumps when a genuinely new feature domain lands, or an
//            existing major system gets fundamentally reworked.
//   <letter> right after MINOR - a distinct, substantial sub-thread of
//            work within that era, not big enough to be its own MINOR.
//   -BUILD - one round of related work/feedback within that sub-thread.
//   trailing <letter> after BUILD - a tiny same-day iteration within
//            that round (not currently used - reserved for e.g. several
//            quick follow-up tweaks in one sitting).
//
// History (see docs/activity-log.md and git log for full detail):
//   1.0    - Foundation (recovered post-reset rebuild - schema, forms, reports)
//   1.1    - Cloud Sync Hardening (Dexie Cloud live, precision fixes, durable serials)
//   1.2    - Milling Operations feature + cross-device sync root-cause fix
//   1.3    - Sync integrity marathon + full-screen pile layout + animation system
//   1.4    - Beginning Balance / reporting cutoff concept introduced
//   1.5    - Rolling balance rework, repeatable beginning-balance lines, unwithdrawn/potential monitoring
//   1.6    - UI polish marathon (nav pill, Total Branch, real save/update/delete animations)
//   1.7a   - Completion animation overhaul (authority complete/uncomplete, cereal Total flip)
//   1.7b-1 - reportingCutoffDate extended app-wide + new pile lifecycle/historical layout
//            system + fixed pile deletion cascading into transaction deletion
//   1.7b-2 - Unwithdrawn/potential-inventory math now also respects reportingCutoffDate
//   1.8    - Admin-only manual complete/uncomplete for Authorities AND MO/TMO on the
//            Monitoring page - new feature domain, not a continuation of the
//            pile-lifecycle/cutoff thread above, so it gets its own MINOR rather than
//            another 1.7 sub-letter
//   1.8-1  - Fixed the pending Authority Number picker's scope (was offering
//            completed-only numbers) + added search to the Completed AI/SIA modal
//   1.8-2  - Fixed a real Dexie transaction race that silently reverted admin
//            MO/TMO mark-done on the next sync; fixed a genuine crash opening a
//            completed MO/TMO's detail view; added Sheet STATUS write-back for
//            admin mark-done/undone - all follow-up rounds within the same 1.8
//            era, not a new MINOR
//   1.8-3  - Completed MillingOrderDetail now compares expected (from actual
//            issued) vs actual recovery inline, amber/green bordered
//   1.8-4  - Completed MO/TMO sort now falls back to the Sheet's own
//            "Date of Milling" column when an order has no local
//            transaction date, instead of arbitrary order
//   1.8-5  - Fixed Purity/Moisture Content never auto-filling when editing a
//            pile's beginning balance - they were saved to the pile record
//            but never to its own seed transaction, which is what the edit
//            form actually reads from (current)
export const APP_VERSION = '1.8-5'
