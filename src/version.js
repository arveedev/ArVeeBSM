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
//            form actually reads from
//   1.8-6  - Inline, blur-triggered duplicate pile-name checker (green
//            check / amber warning) on both the New Pile dialog and the
//            Settings Create/Edit Pile panel, scoped per-warehouse, with
//            a fresh re-check right before save in case the inline
//            warning was ignored
//   1.8-7  - Pile layout box "assigned since" now uses the pile's own
//            dateOfReceipt/as-of date instead of the date it was
//            clicked in the UI, so historical layout views correctly
//            show a backdated beginning balance; PDF export box colors
//            now match the on-screen colors exactly; full-screen pile
//            layout now fades in/out instead of snapping
//   1.8-8  - Full-screen pile layout's fade replaced with a rotate+zoom
//            entrance/exit, gated on the auto-fit scale actually being
//            measured first so it no longer visibly snaps mid-animation
//   1.8-9  - Fixed four real mobile-only full-screen pile layout bugs:
//            Add Pile/Cancel controls going permanently invisible (the
//            round 1.8-8 measurement gate never resolving in time on
//            some phones), the grid not filling 100% of the screen (a
//            missing min-h-0 on a nested flex column), the app header
//            flashing through on ConfirmDialog close (a z-index tie
//            with AppHeader), and the exit animation spinning further
//            instead of reversing the entrance
//   1.8-10 - Fixed the Add Pile button being clipped to an unreachable
//            sliver on the right in full-screen portrait mode (the
//            controls row sits at the box's PRE-rotation top edge,
//            which becomes the VISUAL RIGHT edge once rotated - needed
//            real clearance there, including safe-area-inset-right, not
//            just p-3); fixed the grid visibly "zooming in" for a
//            moment right as the exit animation started (the auto-fit
//            measurement effect fired one frame after exit began,
//            reading the still-full-screen DOM with already-flipped
//            normal-view math - now deferred until the real post-exit
//            DOM swap actually happens)
//   1.8-11 - User reported round 1.8-10's fixes showed no visible
//            change on their phone - hardened the whole mechanism
//            rather than re-guessing: switched 100vh/100vw to 100dvh/
//            100dvw (plain vh/vw can be taller than what's actually
//            visible on mobile, which is a plausible root cause of
//            content genuinely extending past the real screen, not
//            just being tightly spaced); replaced the guessed-duration
//            exit timer with the real `animationend` event so the DOM
//            never swaps before the animation has actually finished;
//            replaced the guessed post-exit remeasure delay with a
//            containerVersion state that only changes when the grid's
//            DOM node is actually reattached, so remeasurement fires at
//            the true right moment instead of a hardcoded number of ms
//   1.8-12 - Buttons/boundary box confirmed fixed on device. Simplified
//            the full-screen exit animation per explicit request -
//            plain slide-out instead of mirroring the rotate+zoom
//            entrance
//   1.8-13 - Full-screen pile layout exit now fades out (reusing the
//            existing plain fade instead of the slide), the normal
//            page fades back in once it settles, and AppHeader/
//            BottomNav now slide back into view in step with it - a
//            new chromeHidden flag (PageHeaderContext) lets Piles.jsx
//            ask App.jsx to hide/reveal them, reusing the exact same
//            slide mechanism already used while a transaction form is
//            open
//   1.8-14 - Exit animation is now slide+fade together (not fade
//            alone, which wasn't what was asked for). More importantly:
//            the grid's own bordered box is now hidden THE INSTANT
//            Back/exit is tapped (hideGridDuringExit, cleared via a new
//            onExited callback once the exit animation genuinely
//            finishes) - eliminates the split-second flash of a wrong/
//            mid-recalculation grid size during the closing transition
//            entirely, rather than trying to out-time it
//   1.8-15 - Fixed a real bug on the Home Stocks tab: a variety whose
//            entire stock sat in a single age bucket (e.g. only ever
//            received within the last 0-3/0-6 months, no older stock
//            yet) showed no expand arrow and no age-group detail at
//            all, since the detail row only ever rendered for MORE
//            THAN one bucket - now shows the single bucket too, so the
//            age group a variety's stock belongs to is always visible
//   1.8-16 - Two real bugs. (1) Home Stocks' sack-weight separation for
//            Rice/Palay read piles.mtsSackTypeId, which only reflects
//            whichever weight a pile was first CREATED with and is
//            never updated by later receipts - now computed from the
//            pile's actual transaction history instead
//            (computePileStockBySackWeight, pileLedger.js), so a pile
//            that genuinely received more than one sack weight over
//            its lifetime now separates correctly. By Products stays
//            unseparated, unchanged, per an earlier explicit request.
//            (2) The exported weekly report's beginning-balance figure
//            summed EVERY isInitialBalance transaction warehouse-wide
//            with no check that the pile it belongs to still exists -
//            deleting a mistakenly-created pile (its transactions are
//            deliberately kept forever) meant that phantom pile's old
//            seed balance kept permanently inflating every future
//            report for that variety. Reports.jsx now filters to only
//            piles that still exist today, matching the same "pile
//            existence" fix already applied to the per-pile
//            computeHistoricalPileState (current)
//   1.8-17 - MO/TMO Monitor: fixed the Pending list's sort (now
//            descending by MO/TMO number) and fixed orders that had
//            older transactions being wrongly hidden from both the
//            Pending and Completed lists; fixed a self-lockout when
//            unchecking a completed MO/TMO; MO/TMO completion is now
//            manual-only, with an amber border flagging an order
//            that's fulfilled but not yet confirmed complete
//   1.8-18 - Input form polish: Trial's amber "required" border no
//            longer shows for By Products; WSR Age now defaults to 1
//            day; Date field scrolls to top and gets focus right
//            after Save/Update/Delete on every input form
//   1.8-19 - By Products pile creation and picker: variety is no
//            longer required when creating a By Products pile (new
//            piles default to 1 day age); the By Products Pile ID
//            picker no longer shows the variety name in parentheses
//            (kept for every other cereal type); pile beginning
//            balance now supports one line per variety for By
//            Products, with Age required on the New Pile dialog;
//            fixed the By Products Pile ID picker silently excluding
//            valid piles when starting a new transaction
//   1.8-20 - Auto-compute Net Kilos no longer switches off on its
//            own anywhere in the app - only ever via the user's own
//            toggle
//   1.9    - Multi-pile WSI issuance: a single stock issuance can now
//            draw from more than one pile, with full edit/update/
//            void/unvoid reconciliation against pile stock and the
//            authority balance, per-line field parity (MC/MTS/Gross
//            Kilos/auto-compute/Net Kilos with labels), per-line
//            stock validation, and Reports/PDF grouping so the extra
//            piles combine into one row instead of showing as
//            separate, confusing entries - a genuinely new feature
//            domain, not a continuation of an existing thread
//   1.9-1  - Fixed a production crash (ReferenceError) on "Issue
//            from another pile" introduced by 1.9's initial release -
//            a helper function was declared after the code that
//            first called it
//   1.9-2  - Fixed the root cause of duplicate rows appearing on
//            Reports (the background Sheet sync had no guard against
//            two overlapping runs, so each could import the same row
//            twice); fixed the additional-pile card's layout on small
//            screens; existing multi-pile records now correctly
//            reload their recorded age instead of showing 0
//   1.9-3  - This version label wasn't actually being kept up to date
//            with every release, and sat far enough below "by ArVee"
//            that a short viewport could only ever show one of the
//            two - both now update together and sit right on top of
//            each other. "Issue from another pile" (and the extra
//            pile cards it reveals) moved on the WSI form to sit
//            right after the primary pile's own Net Kilos and before
//            Age, instead of up near the Pile ID picker - by the
//            time the user reaches that point they already know
//            whether the one pile covers the issuance
//   1.9-4  - Round 1.9-3's Login fix still wasn't visible on a real
//            phone - it was position: absolute, which pins to the
//            bottom of the login container itself, and that
//            container can genuinely be taller than the visible
//            viewport on a real device. Switched to position: fixed,
//            which pins to the actual viewport instead
//   1.9-5  - Three real bugs on the input forms (WSR/WSI/ESR/ESI).
//            (1) A record imported from historical Sheet data starts
//            flagged needsCompletion: true so its "pulled from
//            historical Sheet data" banner shows - saving/updating it
//            never cleared that flag, so the banner kept reappearing
//            forever even after the real data was filled in and
//            saved. (2) Auto-advancing to the next serial right after
//            a save showed it as a blank new entry unconditionally,
//            even when that serial already had real data (local or
//            historical Sheet) - now checks first, same as manually
//            stepping forward already did. (3) Selecting an authority
//            from the in-form AI/SIA picker never carried its OR
//            Number into the OR # field for non-Milling transaction
//            types (SALES in particular) - only opening the form via
//            a Monitor-page prefill did
//   1.9-6  - CRITICAL: fixed the Google Sheets backup writing 3, sometimes
//            12+ duplicate rows per transaction, plus rows going
//            missing/delayed. Root cause: the Apps Script appendTransaction
//            action did a blind, unconditional appendRow with no check for
//            whether a row for that serial already existed, and no lock
//            protected it against concurrent requests - so ANY retry (a
//            lost response, a WTS two-sided partial failure, two devices
//            racing on the same not-yet-synced transaction) wrote another
//            row, forever, with nothing stopping it. Made appendTransaction
//            idempotent (overwrites an existing row for that serial instead
//            of blindly appending) and wrapped the whole doPost in
//            LockService so concurrent requests can't race each other's
//            read-then-write. Also added a 30s periodic safety-net retry to
//            the client-side push queue (syncWorker.js), which previously
//            had no periodic retry at all - only on save or reconnect - so
//            a failed push could sit stuck indefinitely with no other
//            trigger, explaining the reported sync lag. REQUIRES REDEPLOYING
//            the updated docs/apps-script-full-replacement.js to the live
//            Apps Script Web App - editing this repo file alone does not
//            fix the live backup sheet - CONFIRMED REDEPLOYED
//   1.9-7  - Serial number suggestion/navigation is now date-aware
//            instead of purely magnitude-based. suggestNextSerial
//            previously suggested one higher than the highest-numbered
//            serial EVER recorded, regardless of which booklet was
//            actually in current use - so a new booklet starting lower
//            than an older one's numbers never got suggested, forcing a
//            manual retype every session. Next/Previous navigation had
//            the matching problem: stepping past the last document of an
//            exhausted booklet guessed serial±1, found nothing, and
//            dead-ended instead of jumping to the real next document in
//            a differently-numbered booklet. Both now follow actual
//            chronological usage order (compareByRecency: document date,
//            then real save time for same-day series changes, falling
//            back to numeric magnitude only for historical data that
//            predates this) - a new createdAt timestamp on every newly
//            created transaction resolves same-day series boundaries
//            that date alone can't (current)
export const APP_VERSION = '1.9-7'
