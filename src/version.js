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
//            that date alone can't
//   1.9-8  - Fixed a real regression from 1.9-7: forward serial
//            navigation could get stuck even though data existed
//            beyond it. findAdjacentTransaction only knows about
//            transactions already synced to THIS device - falling back
//            straight to suggestNextSerial when it found nothing
//            skipped the Sheet lookup checkAndLoadSerial still does for
//            real historical/imported data not yet preloaded locally,
//            silently dead-ending forward navigation on data that
//            genuinely existed. Backward navigation was unaffected
//            (its fallback already preserved the numeric-guess+Sheet-
//            lookup path). Forward now tries that same numeric-guess
//            fallback first, only reaching suggestNextSerial if nothing
//            is found locally OR on the Sheet
//   1.9-9  - CRITICAL: found and fixed the actual cause of duplicate
//            transactions reappearing with blank Pile ID/MC/MTS.
//            checkAndLoadSerial's local lookup is scoped by
//            cerealCategory - a record whose category was ever
//            mismatched or missing was invisible to it forever, a false
//            "not found locally" that led straight into importing a
//            SECOND copy from the Sheet (which has no Pile ID/MC/MTS
//            columns at all, so every such duplicate arrived stripped
//            of exactly those fields). Both checkAndLoadSerial and
//            findAdjacentTransaction now fall back to an uncategorized
//            lookup before ever creating a new record, self-healing the
//            mismatch in place. Also bumped the existing dedup-merge
//            migration (v6 -> v7) to clean up duplicates this already
//            created on affected devices, using the same proven
//            field-level merge already in place from earlier rounds
//   1.9-10 - Two features. (1) Milling/Test Milling/Remilling/Test
//            Re-Milling transactions now show their batch or trial
//            number beside the customer name on the Reports page and
//            the exported weekly stock/sack statement PDFs, e.g. "Dens
//            Marketing Corp, Batch 3" - a shared
//            customerNameWithMillingRef helper (calculations.js) keeps
//            both surfaces consistent. (2) Admin-settable miller/
//            customer nicknames (new customerAliases table, mirroring
//            warehouseAliases exactly) - e.g. "Dens RM" on the AI/SIA
//            sheet resolves to the customer's real name "Dens Marketing
//            Corp" the moment authority data syncs in, so every
//            downstream use (input-form auto-fill, displayed/exported
//            reports, and what gets written back to the backup sheets)
//            is automatically correct with no separate translation
//            needed anywhere else. Manually typing a known nickname
//            directly into the Customer Name field also resolves it.
//            Managed from the existing Customers admin panel
//   1.9-11 - Trial number selection on Test Milling/Test Re-Milling
//            transactions (WSR/WSI/ESR) no longer disables/marks
//            "used" a number already selected on another transaction
//            under the same TMO. Per explicit request: a single trial
//            number legitimately spans more than one transaction (one
//            combined receipt covering all three trials, one per
//            trial, or - especially on By Products - one separate
//            transaction per variety/sack type all under the same
//            trial) - removed the takenTrialNumbers restriction
//            entirely rather than trying to guess which reuse patterns
//            should be allowed. Batch numbers (Milling/Re-Milling) were
//            already a free-typed field with no such restriction
//   1.9-12 - NFA Ricemill Regional Authority Number tracking, several
//            real bugs fixed together: (1) the AI/SIA sync read a
//            "Regional Authority Number" column that doesn't exist by
//            that name on the real sheet (the real header is
//            "AUTHORITY") - every allocation always showed 0 used
//            regardless of real activity; (2) "used" was computed from
//            a WSI transaction linked to a Milling-type AI, a link the
//            entry form has no field to create - confirmed the real,
//            only-visible usage event is the TRANSFER-type AI's own
//            recorded allocation instead; (3) the "palay in / rice out"
//            recovery breakdown now shows real totals per section,
//            sorted by date, with the AI # shown, and "palay in" is
//            derived from a new admin-set daily milling input capacity
//            (Net Bags/day) × how many days actually had rice-out
//            activity, since the AI sheet only ever records one lump-
//            sum milling authorization, not a daily log; (4) NFA
//            Ricemill Allocations (ricemillAllocations table) was
//            explicitly excluded from Dexie Cloud sync since it was
//            first added, so admin-entered allocations never appeared
//            on any other device - re-enabled sync for it specifically
//            (its single-value primary key is sync-compatible, unlike
//            privateMillerAllocations' compound key, which stays
//            excluded on purpose)
//   1.9-13 - Three real bugs/gaps from live field testing: (1) a pile's
//            running Net Kilos total could drift by a few grams over its
//            lifetime (plain JS float addition/subtraction with no
//            rounding at each step), which could make a WSI reject an
//            issuance for the pile's OWN exact remaining amount ("Pile
//            only has 49.310" when it genuinely had 49.315) - every
//            place a pile's running total gets updated now rounds to 3
//            decimals each time, and the stock-limit comparison itself
//            also tolerates a few grams either way. (2) The same float
//            drift meant a pile could sit at a near-zero (not exactly
//            zero) balance forever, never satisfying the strict
//            equality check that hides a depleted pile from every pile
//            picker - now tolerance-based too. (3) Adding another pile
//            to a WSI now auto-fills that pile's Gross Kilos with
//            whatever value exactly completes the linked authority's
//            remaining balance (accounting for the primary pile and any
//            other additional piles already filled in), recalculated
//            live as Bags or sack code change - only while that pile's
//            own Auto-compute Net Kilos toggle is on.
//   1.9-14 - Five more field-testing reports: (1) serial Next/Previous
//            stepping could skip a real document or jump into the wrong
//            booklet on a day two series were both in use - root cause
//            was every Sheet-imported record having no createdAt at all
//            (the Sheet has no timestamp column), which made the
//            recency comparator fall back to raw serial-number magnitude
//            inconsistently between different pairs in the same sort -
//            genuinely non-transitive, so V8's sort could produce a
//            scrambled order. Comparator fixed to always use a
//            consistent ranking, and Sheet-imported records (both new
//            imports and everything already on-device) now get a real
//            ordinal from the Sheet's own row order as a stand-in
//            createdAt, preserving the true order two booklets were
//            actually used in. (2) Statement of Weekly Receipts/Issues
//            and the MTS Statement PDFs sorted by raw serial magnitude
//            alone, mixing different dates/series together - now sorted
//            date-then-series, matching in-app navigation order. (3) An
//            extra one-time duplicate-record cleanup pass, covering
//            duplicates created after the last such pass already marked
//            itself done on a given device - the direct cause of both a
//            stale "pulled from historical Sheet data" banner on a
//            record that was really already fully encoded in-app, and a
//            false "serial already in use" when updating one. (4) The
//            Test Milling Trial 3 completion popup is removed - Test
//            Milling now works exactly like regular Milling: fulfillment
//            is informational only, and actually marking a TMO complete
//            is manual-only via the Milling Operations monitor's own
//            toggle.
//   1.9-15 - Unwithdrawn-stock display fixes on the Warehouse Inventory
//            screen: (1) the "Potential" figure could run off the right
//            edge of its card in Net Bags mode instead of wrapping.
//            (2) An AI authority's typed bags count and its kilos
//            figure can disagree with each other on the same real Sheet
//            record (they're two separately-typed fields) - previously
//            silent, now flagged directly on that authority's card in
//            the unwithdrawn drill-down when the two differ by more
//            than 5%, showing both numbers so it's obvious which
//            authority needs checking against the Sheet.
//   1.9-16 - Serial navigation: backfilling a skipped document number
//            (encoding it AFTER a later document, once its paperwork
//            finally arrives) made Next/Previous oscillate between the
//            two and made the auto-suggested next serial land on a
//            number that already existed - confirmed, reproduced case.
//            Root cause: the recency comparator sorted same-booklet
//            documents by when they were TYPED INTO THE APP, not by
//            their own printed number - correct for reconciling two
//            genuinely different booklets active the same day, wrong
//            for catching up on one booklet's own gaps out of order.
//            Same booklet (same non-numeric prefix) now always sorts by
//            its own printed number; only different-prefix documents on
//            the same day fall back to real entry order. Every form's
//            initial serial suggestion on load also now double-checks
//            itself the same way Next/Previous already does, so a wrong
//            suggestion self-corrects immediately instead of only on
//            the next manual visit to that serial.
//   1.9-17 - Pile depletion fixes: (1) a pile could end up with a
//            genuinely negative running total (not just float drift) -
//            e.g. after an admin edits a beginning balance down below
//            what's already been issued against it - and stayed fully
//            selectable forever, since the auto-close check only ever
//            caught near-exactly-zero values, never negative ones.
//            Any zero-or-negative total now counts as depleted, and the
//            stored total itself is floored at zero (there's no such
//            thing as negative physical stock). Once flagged, the
//            existing entry-form filtering (already date-aware, unaffected)
//            correctly hides it going forward. (2) A closed pile's name
//            couldn't be reused for a new pile - every duplicate-name
//            check treated a closed pile the same as an open one. A
//            closed pile's name is now vacant, same as its layout box.
//   1.9-18 - "Close Pile" moved from an Admin-only Settings panel into
//            the Pile Layout screen itself, per explicit request - every
//            user managing their own warehouse's layout can now close a
//            depleted/done pile directly from that pile's own detail
//            popup (tap a pile -> Close Pile), right alongside Export
//            BIN Card, instead of needing Admin access to Beginning
//            Balances just to mark a pile done. Re-opening a closed
//            pile stays in Admin (a rarer, correction-style action).
//   1.9-19 - Every digit app-wide now renders at a fixed width
//            (font-variant-numeric: tabular-nums, set once globally on
//            body) instead of each digit's own natural width - numbers
//            no longer visibly shift/wobble as they update, and align
//            cleanly wherever they're stacked in a column. Only affects
//            0-9 characters, so ordinary text is untouched.
//   1.9-20 - Home Stocks' Overview screen could show an impossible
//            negative bags count in a variety's age-bucket breakdown
//            (confirmed, reported case: a pile with 1 real bag on hand
//            showed as -13 in its age bucket). Root cause: Home Stocks
//            recomputes each pile's stock fresh from its full raw
//            transaction history rather than trusting the pile's own
//            already-correct running total, and that fresh recompute
//            had no floor - unlike every other pile-total computation
//            in the app, which was already fixed to never go negative.
//            Both remaining unclamped spots (computeHistoricalPileState,
//            computePileStockBySackWeight) now floor at zero too. This
//            fixes the impossible negative display; the underlying
//            mismatch between a pile's running total and its full
//            transaction history (a transaction whose Number of Bags
//            doesn't match its Net Kgs, or a stray transaction that
//            never went through the normal apply-to-pile path) is a
//            data issue in that specific pile's history that still
//            needs finding by hand.
//   1.9-21 - Reverts the per-weight-bucket clamp added in 1.9-20's
//            computePileStockBySackWeight fix - confirmed, reported
//            regression: it made totals wildly WORSE (a real ~14 bags
//            rendered as 3,326), not better. A single pile's own
//            transactions can legitimately resolve to different weight
//            buckets over its life, so one bucket going negative while
//            another is correspondingly positive is a real, NEEDED
//            offset - the pile's true total only comes out right once
//            every bucket is summed together. Clamping each bucket
//            BEFORE that sum discarded the offset instead of preserving
//            it. The "no impossible negative number" fix is now applied
//            only at the very last step - the actual displayed text on
//            Home Stocks - never to any number still being summed into
//            something else, so nothing upstream can be corrupted by it
//            again. This does not make the total CORRECT (that still
//            needs the real bad transaction found and fixed by hand) -
//            it only guarantees the screen can no longer show an
//            impossible negative or a wildly inflated number either way.
//   1.9-22 - The "Bags/Kgs don't match" warning added in 1.9-20 was
//            firing on FILLERS/REBAGGING/BAGGING/RECLASSIFICATION
//            authorities - confirmed directly: those genuinely record
//            bags with zero matching kilos on purpose (repacking bags
//            is a real bag-count change that doesn't move any rice), so
//            a mismatch there was never a data error. No longer flagged
//            for these transaction types.
//   1.9-23 - Found via a live data comparison (Pile List vs a direct
//            console query) after two earlier wrong guesses: a CLOSED
//            pile's real transaction history was still leaking into
//            Home Stocks' Overview screen. closePile() zeroes a pile's
//            balance "regardless of its sign or size" specifically so
//            nothing further needs reconciling from that point on, but
//            Home Stocks' age-bucket breakdown recomputes each pile's
//            stock fresh from its full raw history every time and had
//            no idea the pile was ever closed - so a closed pile's real
//            (possibly messy) pre-closure total kept showing up there,
//            even though Pile List correctly showed 0. Both recompute
//            functions (computeHistoricalPileState,
//            computePileStockBySackWeight) now respect closedDate: on
//            or after it, they return zero immediately without
//            touching that pile's history at all; a backdated "as of"
//            report from before the close date is unaffected.
//   1.9-24 - Closing a pile now lets the user pick the close date,
//            instead of always stamping today - per explicit request, a
//            pile that actually finished a few days ago should be able
//            to report its real close date. Available both from the
//            Pile Layout screen and Admin's Beginning Balances panel.
//   1.9-25 - Settings' Create Pile section can now edit an existing
//            pile's name (and variety/purity/dates) - the underlying
//            edit logic already existed but had no pile list or Edit
//            button ever wired up to trigger it. Per explicit request,
//            renaming lives only here, not on Piles.jsx or Beginning
//            Balances - Close/Delete stay where they already were.
//   1.9-26 - Settings' pile-rename list no longer shows closed piles -
//            per explicit request, that list would otherwise only grow
//            longer forever as more piles get closed. A closed pile
//            still shows on Piles.jsx and Beginning Balances.
//   1.9-27 - Encoding a batch of transactions for one date no longer
//            requires reselecting that date after every save. The
//            transaction date field used to silently snap back to
//            today every time the form advanced to the next entry -
//            per explicit request, it now stays on whatever date the
//            user picked for the rest of that encoding session, only
//            resetting to today when the form is actually closed and
//            reopened. Fixed in every transaction form (WSR/WSI/ESI/
//            ESR via StockFormBase, sack forms via SackFormBase, WTS).
//   1.9-28 - Four WTS (Warehouse Transfer) bugs found via a real report
//            and a live encoding session:
//            1. The weekly stock report showed a WTS's SACK condition
//               (BN/SH/US - only meant for the tare-weight lookup) as
//               if it were the stock's own condition, creating a bogus
//               extra "BN" row with numbers that double-counted against
//               the real GQ row. Reports now use WTS's own Stock
//               Condition field (Good/Part Damaged/Damaged) instead,
//               mapped to the same GQ/PD/TD scale every other form uses.
//            2. WTS had no real "customer" field, so every receipt/
//               issue list and report always showed the placeholder
//               "Warehouse Transfer" instead of a real name. Now stores
//               and shows whoever was logged in and saved it, the same
//               way the exported PDF already credits the current user
//               as "Certified Correct".
//            3. WTS's AI No. field was a bare text box - the only
//               transaction form without a Browse button into the
//               pending-AI picker every other issuance-side form has.
//               Added.
//            4. The real bug behind "the wrong series shows up on a
//               completely different form": suggestNextSerial/
//               findAdjacentTransaction sort transactions by recency
//               (date, then save time), and an old imported record with
//               a missing date could never lose that comparison against
//               a real, freshly-dated one - once such a record won,
//               nothing could ever out-rank it again, so a stale legacy
//               serial kept resurfacing as "next" even right after
//               saving a real, correctly-numbered document. Fixed at
//               the comparison itself (serialNumber.js).
//   1.9-29 - Two follow-up WTS fixes from the same report:
//            1. The "Warehouse Transfer" name fix in 1.9-28 used
//               whoever was logged in and saving - per explicit
//               correction, WTS records now look up the actual
//               Warehouse Supervisor (or Acting Warehouse Supervisor)
//               assigned to that warehouse instead (same lookup
//               Piles.jsx's own BIN Card export already uses), only
//               falling back to the logged-in user if no supervisor is
//               configured for that warehouse yet.
//            2. Root-caused the real duplicate WTS records behind the
//               "duplicated entry in both Receipts and Issues" report:
//               unlike every other transaction form, WTS's own Save/
//               Update ran its async uniqueness check BEFORE locking
//               the button, leaving the exact race window a rapid
//               double-tap needs to pass validation twice in parallel
//               and create two real records sharing one serial number -
//               already fixed everywhere else, just never carried over
//               to WTS. Locks immediately now, same as every other
//               form. Does not clean up duplicates already created
//               before this fix - those still need a manual Delete.
//   1.9-30 - Found the REAL cause of the "duplicated entry in both
//            Receipts and Issues" report, via a live data check: it
//            was never duplicate records or a rendering bug. WTS
//            deliberately writes its own backup rows into the SAME
//            Google Sheets WSR and WSI use (so a WTS's contribution is
//            visible on both real statements, matching the paper
//            document) - but it was writing the bare WTS serial number
//            into those sheets' own WSR #/WSI # identifying column. WTS
//            keeps a fully independent number series from WSR/WSI, so
//            it can land on the same number a real WSR or WSI already
//            uses - and once it did, any serial lookup or full sync for
//            that WSR/WSI number matched the WTS's row instead (or as
//            well), importing it as a phantom local WSR/WSI transaction
//            with no pile, no customer, no real save time. Confirmed
//            live: one real WTS had produced two bogus WSR rows and two
//            bogus WSI rows this way. Fixed by prefixing what WTS
//            writes to that column (still fully traceable back to the
//            exact WTS by a human reading the sheet) so it can never
//            collide with a real WSR/WSI serial again, and by having
//            every import path (single-serial lookup and full preload)
//            explicitly skip rows carrying that prefix. Does not
//            retroactively fix the specific sheet rows this already
//            happened to before this fix - those still need a manual
//            cleanup (see chat for the exact records affected).
//   1.9-31 - Two WS/MPO name fixes, per explicit request:
//            1. WTS's supervisor-credited name (added in 1.9-28/29) now
//               always carries the "WS "/"Acting WS "/"MPO III "/
//               "Acting MPO III " prefix, same convention used
//               everywhere else a Warehouse Supervisor or MPO III user
//               is credited - previously it showed the bare name with
//               no prefix at all. Also now falls back to an assigned
//               MPO III/Acting MPO III user if no WS is assigned.
//            2. Picking an AI/SIA authority whose own customerName is a
//               WS/MPO reference (an inter-warehouse transfer) never
//               auto-filled the address, unlike manually typing "WS"
//               and picking a suggestion - it only ever set the bare
//               name. Now resolves and fills the address the same way,
//               on every form with an Authority picker (WSR/WSI/ESR/
//               ESI).
//   1.9-32 - Follow-up per explicit feedback: 1.9-31's authority-pick
//            address auto-fill could silently guess wrong for a WS/MPO
//            person assigned to more than one warehouse. Now only
//            auto-fills when there's exactly one real match (or the
//            current warehouse itself narrows it to one) - otherwise
//            it opens the same suggestion dropdown a manual "WS" type
//            shows, so the user picks the right warehouse/address
//            themselves instead of getting a guessed one.
//   1.9-33 - Fixed why WS/MPO matching kept missing real people, per
//            explicit example: the real Authority sheet data often
//            abbreviates the first name ("WS V. Balaoro", "Acting WS F.
//            Reason") instead of spelling it out ("Vevencio Balaoro",
//            "Florante Reason") - a plain substring search can never
//            match that shorthand. Matching now also recognizes a
//            fully-typed "V. Balaoro"/"V Balaoro" form word-for-word
//            against the real name (each word either exact or a
//            single-letter initial), on top of the existing live
//            substring search - fixes this both for picking an
//            authority (1.9-31/32) and for manually typing "WS"/"MPO"
//            in the Customer Name field.
//   1.9-34 - 1.9-33's initials guess still can't handle every real
//            name (a middle name/initial breaks the word-count-must-
//            match rule) - per explicit suggestion, added a proper
//            admin-managed alias instead, the same mechanism customer
//            nicknames already use for this exact problem. Settings >
//            Users now has a "Sheet Aliases" field for Warehouse
//            Supervisor/Acting WS/MPO III/Acting MPO III users - e.g.
//            "V. Balaoro" for "Vevencio Balaoro" - checked first
//            (authoritative, no guessing) before the word/initials
//            match, for both authority picking and manual "WS"/"MPO"
//            typing.
//   1.9-35 - Fixed a real over-eager guess in 1.9-31/32: picking an
//            authority for a WS/MPO person assigned to more than one
//            warehouse silently auto-filled the address whenever the
//            currently selected warehouse happened to be one of their
//            assignments, without ever asking. Per explicit feedback,
//            this must never be assumed - it now always opens the
//            suggestion list for the user to pick from whenever there's
//            more than one real candidate, full stop.
//   1.9-36 - Fixed a double-scrollbar showing whenever the Authority
//            picker (or New Pile dialog) is open on WSR/WSI/ESR/ESI/
//            WTS - the form itself is still a real, independently
//            scrollable element sitting behind that fixed overlay, so
//            its own native scrollbar kept rendering right next to the
//            picker's own list scrollbar. Locked while either is open.
//   1.9-37 - MC (Moisture Content) was silently optional on any FILLERS
//            transaction, even for Rice/Palay - per explicit
//            correction, FILLERS was never meant to exempt MC the way
//            it exempts pile/sack/age (a rebagging operation still has
//            a real moisture reading); only By Products genuinely has
//            no MC concept. MC is now required for Rice/Palay
//            regardless of transaction type.
//   1.9-38 - Three changes:
//            1. 1.9-37 was wrong, per explicit correction - FILLERS and
//               REBAGGING genuinely don't have a real MC reading (both
//               move existing bags around, not a fresh receipt/issue).
//               MC is now optional on every bag-repacking type
//               (FILLERS/REBAGGING/BAGGING/RECLASSIFICATION) again, on
//               top of By Products - not just FILLERS like before 1.9-37.
//            2. Home's Pile List: weight now reads "306,209.060 Net kg"
//               instead of "Net 306,209.060 kg" (matching the number-
//               first convention used everywhere else in the app), net
//               bags moved to their own line below the bags count
//               instead of crammed onto the same line, and each pile's
//               variety is now a colored badge (Rice/Palay/By Products
//               each get their own color, same scheme used elsewhere)
//               instead of small gray text easy to skim past.
//            3. Admin/Visitor Monitoring: each AI/SIA authority card now
//               shows a progress bar under its numbers, filled to
//               issued/allocated - full green when complete, dimmer
//               green while in progress, red if over-issued.
//   1.9-39 - 1.9-38 put the progress bar in the wrong place, per
//            explicit correction - moved off the AI/SIA authority cards
//            entirely and onto the NFA tab's Regional Authority Number
//            cards instead (NfaMillingMonitor.jsx / Admin Dashboard's
//            Miller Allocations panel - both share AllocationUsageSummary
//            in RicemillRecoveryDetail.jsx, so one change covers both),
//            filled to used/total.
//   1.9-40 - Data-integrity fixes from a full 3-agent code audit
//            (sync/backup, reports/pages, forms/pile ledger):
//            1. ESR/ESI (SackFormBase) was missing the double-tap save
//               lock WSR/WSI/WTS already got - fixed the same way.
//            2. Updating an existing WSR/WSI could silently save with
//               a missing AI link, sack type, age, or an incomplete
//               extra-pile line - the Update button only checked "is
//               something saving," not the full canSave rule set a NEW
//               entry is held to. Now gated the same way Save is.
//            3. Every save/update/delete across all three forms now
//               groups its transaction-record write together with its
//               pile/authority/SIA balance effect in one atomic Dexie
//               transaction - previously these were separate,
//               independently-committed writes, so the app closing or
//               losing power mid-save could leave the transaction
//               record and the real stock level permanently
//               disagreeing, with no automatic fix.
//            4. The incremental pile-balance math (apply/reverse, both
//               StockFormBase/pileLedger.js and WTSForm.jsx) used to
//               silently clamp a transiently negative running total to
//               zero and discard the shortfall - a real risk with
//               backfilled/reordered entries. It now falls back to a
//               full recompute from actual history in that specific
//               case only, so nothing is silently lost, without paying
//               that cost on every normal save.
//            5. Delete/Void/Unvoid confirmations across all three forms
//               now lock the same way Save does (both in the handler
//               and by disabling ConfirmDialog's own confirm button),
//               closing the same rapid-double-tap window Save was
//               already fixed for.
//   1.9-41 - Performance + one more data-integrity fix from the audit:
//            1. Home Stocks' and Piles' per-pile stock recompute
//               (computePileStockBySackWeight/computeHistoricalPileState,
//               looped over every pile in the warehouse) was keyed on
//               the `piles` array itself, which is a fresh reference on
//               ANY pile field change anywhere in the warehouse (an age
//               edit, a metadata save, even the new self-heal fallback
//               from the fix above) - tearing down and re-running the
//               full per-pile recompute for EVERY pile in the warehouse
//               on every such write, not just when a pile's real stock
//               changed. Now keyed on the stable set of pile IDs
//               instead, so unrelated pile writes no longer trigger it.
//               (A genuine new transaction still recomputes every pile,
//               since they're batched into one query - fully isolating
//               that needs each pile split into its own subscription, a
//               larger restructuring not done here.)
//            2. computePileStockBySackWeight re-fetched the entire
//               sackTypes table on every single pile in that same loop -
//               now fetched once and passed in.
//            3. Changing a variety's category in Settings now cascades
//               the new category onto every existing transaction for
//               that variety - previously only new transactions used
//               it, so an older transaction's own frozen cerealCategory
//               could silently land under the wrong cereal-type section
//               in reports after a reclassification.
//   1.9-42 - New: Data Start Date (Admin Dashboard > System) - a single
//            global override date that applies everywhere every
//            warehouse's own individual "Reports Start Date" already
//            does, at once, instead of setting it warehouse by
//            warehouse. Everything dated before it stops showing in
//            Reports (statements + beginning balance), Home Stocks,
//            Pile List/Layout, BIN Card export, and Unwithdrawn/
//            potential-inventory math - built entirely on the same,
//            already-proven reportingCutoffDate mechanism (whichever of
//            the per-warehouse date and this global one is later wins),
//            not a new filter. A pile's real total on/after the
//            override date still comes from whatever beginning balance
//            is entered for it in Settings > Beginning Balances, same
//            as reportingCutoffDate already required - this does not
//            compute one automatically. Does NOT affect Sheet preload/
//            import or manual serial-number lookup/navigation in the
//            transaction forms - those still see full history.
//   1.9-43 - Two follow-up performance fixes, per explicit request to
//            finish #6 and #7 from the earlier audit where safely
//            possible:
//            1. Home Stocks' per-pile stock-by-weight recompute now
//               runs as one genuinely independent Dexie subscription
//               PER PILE (PileWeightSubscriber), instead of one single
//               query covering every pile in the warehouse at once. A
//               save against one pile now only re-triggers that pile's
//               own subscription - every other pile's already-computed
//               figures are left alone, instead of the whole warehouse
//               recomputing on every single save anywhere in it.
//            2. The AI/SIA Sheet sync (runs every 5 minutes) no longer
//               does its own separate "does this authority already
//               exist?" database query for every single incoming row -
//               the existing AI/SIA authorities are now fetched ONCE
//               per sync run and kept as an in-memory lookup, updated
//               as each row is processed so a later row still correctly
//               sees what an earlier row in the same run just wrote
//               (needed for the existing duplicate-row cleanup logic to
//               keep working correctly). Same end result, same
//               dedup/merge behavior, far fewer database reads.
//            The MO/TMO full-refetch-every-cycle issue is intentionally
//            NOT touched - fixing it correctly needs delta-fetch support
//            added to the already-deployed Apps Script itself (confirmed
//            it currently has none), which can't be safely verified
//            end-to-end from here without risking what already works.
//   1.9-44 - Fixed Reports > Summary's period picker opening on the
//            wrong month - e.g. on Sep 3, From/To already correctly
//            defaulted to today (Sep 3), but the month header and
//            quick-pick buttons (1-7/8-15/etc.) below it still opened
//            on August, since they ran their own separate "first few
//            days of a new month -> show last month" guess with no
//            idea an actual date was already selected. Now opens on
//            whatever month the real starting selection is already in
//            when one exists (Summary); Stock Statement/Pile Layout,
//            whose period starts genuinely blank, keep the original
//            guess unchanged.
//   1.9-45 - Fixed a follow-up to 1.9-44: navigating months with the
//            ‹/› arrows only changed the header/quick-pick button
//            labels to the new month - the actual selected From/To
//            (and everything computed from it, like Summary's whole
//            card) silently stayed on the OLD month. Now, when the
//            current selection matches one of the shown presets (e.g.
//            "1-7"), navigating months carries that same slot forward
//            into the new month too, so the header, buttons, and
//            content all move together instead of drifting apart.
//   1.9-46 - Fixed a real duplicate-record bug: if local device storage
//            ever got cleared/reset (browser storage eviction, cache
//            clear, reinstall) and someone looked up an old serial
//            number before that record had finished re-syncing down
//            from the cloud, the app would import a second, blank
//            (Pile/MTS-less) copy straight from the Sheet backup -
//            leaving two records with the exact same serial, one
//            complete and one perpetually stuck asking to be
//            completed, and blocking Update with a false "already
//            used" error. Serial lookups now recognize when both
//            copies exist, treat the complete one as canonical, and
//            quietly delete the leftover blank copy.
//   1.9-47 - Two follow-ups to 1.9-46, since "wait for it to load" isn't
//            useful advice if there's no way to tell when that's done:
//            (1) a sync status icon now sits in the header on every
//            screen (tap it for a plain-language status) - solid green
//            once your data is fully caught up with the cloud, spinning
//            amber while it's still loading in, gray offline, red on a
//            real error. (2) WSR/WSI and Sack forms now refuse to import
//            a blank Sheet-backup placeholder for a serial at all while
//            this device's own sync is still catching up, showing
//            "Still syncing your data - please wait a moment" instead -
//            closing the specific race 1.9-46 could only clean up after
//            the fact, so it now can't happen in the first place.
//   1.9-48 - The header sync icon now actually moves: spins while data
//            is loading in, and settles into a plain cloud with a small
//            green checkmark badge once caught up, instead of only
//            changing color on an otherwise-static icon.
//   1.9-49 - Two follow-ups to the sync icon, per feedback that it was
//            still confusing: (1) "pushing" (uploading your own recent
//            changes) now counts as actively syncing too, matching what
//            Settings' own sync card already called "Syncing..." -
//            previously that specific moment showed a static checkmark
//            with no motion at all, which read as broken since a
//            syncing notification was visibly happening elsewhere at
//            the same time. (2) Replaced the spin with a pulse: fast
//            (0.6s) while actively syncing, slow and steady (2.5s) once
//            caught up - a resting heartbeat instead of a dead icon,
//            not just two static colors.
//   1.9-50 - The badge's own pulse (scaling/fading in place) read as a
//            dropped connection, not activity - per feedback, replaced
//            with a proper outward ripple: the icon and the corner dot
//            both stay solid, and a ring expands out from the dot and
//            fades, the standard "live" sonar-ping look. Fast (0.8s)
//            amber ripple while actively syncing, slow (2.5s) green
//            ripple with a checkmark on the dot once caught up.
//   1.9-51 - Per feedback, moved the checkmark inside the cloud icon
//            itself (instead of a separate corner dot) and made the
//            ripple ring expand around the whole icon rather than just
//            that dot - reads as one unified "cloud" indicator instead
//            of an icon plus a small badge glued to its corner.
//   1.9-52 - Found and fixed a new duplicate-record race during live
//            testing (distinct from 1.9-46's): the background bulk
//            preload takes a snapshot of local data before fetching the
//            Sheet, and a save that finishes - and backs up to the
//            Sheet - in that same window was invisible to the snapshot,
//            so the preload imported it a second time as a blank
//            placeholder. Confirmed live: a freshly-saved WSR was
//            duplicated within seconds, on one device, no multi-device
//            timing needed. Preload now self-heals any such duplicate
//            it created, using the same "real record wins over a blank
//            Sheet placeholder" rule as 1.9-46's fix.
//   1.9-53 - Found and fixed a real bug during live testing: voiding or
//            deleting a receipt (WSR, or a WTS's received side) AFTER
//            some of its stock had already been issued elsewhere could
//            leave the pile's balance completely unchanged, silently
//            undoing what should have been a real reduction. Cause:
//            the pile-effect reversal ran BEFORE the transaction was
//            actually marked cancelled/deleted in the database, and its
//            own fallback recompute (used when a plain subtract would
//            go negative) reads live status from the DB - so it still
//            counted the record being voided/deleted as active. Fixed
//            in both forms that touch pile stock (WSR/WSI, WTS) by
//            writing the cancel/delete first, then reversing the pile
//            effect - ESR/ESI never touch pile stock, so unaffected.
//   1.9-54 - A deep code review (not live testing) found the SAME
//            reversal-ordering bug from 1.9-53 in three more places it
//            had been missed: (1) Update on a WSR/WSI/WTS has the
//            identical issue - editing a document could silently
//            double-count its old amount if the pile needed a full
//            recompute mid-edit. Fixed with a new "apply the net
//            change in one step" approach instead of reverse-then-
//            apply, so there's nothing left to double-count either way.
//            (2) Delete never checked whether a document was already
//            voided before reversing its effect - deleting an already-
//            voided WSR/WSI/WTS/ESI subtracted its pile or authority
//            balance a SECOND time. Now skipped when already Cancelled,
//            matching what Void already did correctly. (3) Un-voiding a
//            multi-pile issuance wasn't wrapped as one all-or-nothing
//            save, so an interruption partway through could leave some
//            of its piles un-voided and others stuck. Also fixed a
//            separate bug in the background Sheet sync: its duplicate-
//            record check didn't account for Rice and Palay keeping
//            separate serial numbers, so a warehouse with the same
//            number in both could cross-contaminate their data on sync.
//   1.9-55 - Strengthened duplicate-record protection, per a follow-up
//            request to close it off for good rather than patch it
//            again next time it resurfaces. The cleanup pass that
//            already ran on every background sync now catches ANY
//            duplicate it finds (not just the one specific shape it
//            used to), merging the most complete copy instead of just
//            deleting - and, unlike the four one-time fixes before it
//            this app has needed for this same bug class, this one
//            never "expires": it keeps checking on every single sync,
//            forever, instead of only once. Also added one more check
//            right at the moment a new record is about to be saved
//            during sync, querying the real database instead of a
//            slightly-stale snapshot, to make the odds of a duplicate
//            slipping through in the first place even smaller.
//   1.9-56 - Admin Dashboard > Stocks > Age Grouping: on a phone, this
//            table's real figures were getting cut off at the edge
//            (e.g. a total showing "10,055.4" instead of "10,055.45")
//            since every age bracket got squeezed onto one line
//            regardless of how many there were. Redesigned for narrow
//            screens using the six-move method (Rank/Stack/Slot/Label/
//            Reveal/Breakpoint): each warehouse is now a card showing
//            its name and total up front, with the full age-bracket
//            breakdown one tap away instead of crammed in - a small red
//            dot flags a warehouse with stock past its oldest bracket,
//            since ageing stock is worth noticing without expanding
//            every card. Tablet/desktop is unchanged - the original
//            table already had room to breathe at that width.
//   1.9-57 - Admin Monitoring > NFA tab: fixed real duplicate rows in
//            the Issuance/Receipt breakdown (the same date/AI#/amount
//            showing twice) - caused by the same sync-race duplicate-
//            authority-record bug already guarded against elsewhere on
//            this page, just missing here; now shares one fix
//            (dedupeAuthoritiesByRef) with that other spot instead of
//            two separate copies of the same logic. Also gave that
//            Issuance/Receipt list a phone-friendly card layout (it
//            needed sideways scrolling on a real narrow screen before;
//            tablet/desktop keep the original aligned table) and a
//            Sort & Filter control per Regional Authority Number - sort
//            by date or by Net Kgs, or narrow to a date range - opened
//            from a small button above each expanded number's list.
//   1.9-58 - Closed the actual root cause behind 1.9-57's duplicate AI/
//            SIA records, after an app-wide check requested to make
//            sure this class of bug is really gone for good. The
//            existing cleanup only ran for a specific AI/SIA number
//            when that number's row was still present in the current
//            5-minute sync's fetch from the Sheet - a number whose row
//            later got archived/moved/removed on the Sheet itself
//            (normal once NFA staff are done with it) could leave a
//            stale duplicate that no future sync would ever touch
//            again. Added a full-table sweep that now runs at the
//            start of every single sync regardless, checking every
//            authority already in the app's database - not just the
//            ones in this round's Sheet fetch - so a stale duplicate
//            can no longer survive more than one sync cycle no matter
//            how it got there. Also verified the separate outbound path
//            (this app's own transaction records backing up TO the
//            Sheet) was already solid: it has a real server-side lock
//            plus a same-serial-number check before adding any row, so
//            two devices racing to back up the same record converges to
//            one row, not two.
//   1.9-59 - Polish pass on 1.9-57's NFA Sort & Filter modal, per direct
//            feedback that the mobile list and the button both looked
//            off. The date range now uses the app's own calendar date
//            picker (matching every other date range in the app)
//            instead of the plain native date field, and picking a From
//            date auto-opens the To picker the same way Reports' own
//            period pickers do. The mobile Issuance/Receipt list is now
//            a tighter divider-separated list instead of a card sitting
//            inside a card, and the Sort & Filter button moved to the
//            right and picked up the app's standard button styling
//            instead of floating on its own as a small, out-of-place pill.
//   1.9-60 - Fixed the actual desktop/tablet layout bug in that same
//            table, confirmed against a real screenshot at v1.9-59: Net
//            Kgs values were wrapping onto a second line ("5,000.000"
//            then "kg" below it) because the numeric columns were
//            missing the "never wrap" rule the text columns already
//            had, and Issuance had an ugly empty gap between Date and
//            Net Bags from a leftover unlabeled filler column copied
//            over from Receipt's layout. Issuance now gets its own
//            3-column layout without that filler, and every column
//            (text and numbers both) is now set to never wrap.
//   1.9-61 - Replaced the NFA Issuance/Receipt table's whole approach on
//            desktop/tablet, after 1.9-60's fix still looked wrong -
//            it technically aligned correctly, but sat as a narrow,
//            fixed-width island with a huge empty gap next to it on a
//            wide screen, since it sized itself to its own content
//            instead of the space actually available. Rebuilt it as a
//            real table using the exact same pattern already proven on
//            Admin Dashboard > Stocks > Age Grouping (the reference the
//            request pointed at directly) - same Th/Td helpers, same
//            row dividers, same bold double-bordered Total row - so it
//            now fills the available width the same natural way that
//            table already does, instead of a second, different-looking
//            approach for the same kind of data.
//   1.9-62 - NFA Issuance/Receipt: bumped the mobile card list's text
//            from small to base size, per direct feedback that it was
//            hard to read on a phone (dates, AI #s, and the "used of /
//            issued / received" summary lines above the list). Also
//            added tabular-nums everywhere a number shows in this view,
//            desktop table included, so digits keep a fixed width and
//            line up cleanly instead of shifting per-digit.
//   1.9-63 - App-wide tabular-nums pass, plus three more layout fixes
//            found from live feedback. tabular-nums (fixed-width digits,
//            so a number never visually jitters as it updates) is now
//            applied everywhere the app shows a formatted weight, bag
//            count, or percentage - Age Grouping, Piles, Sacks,
//            Milling/Ricemill monitors, Authority lists, Reports,
//            Beginning Balances, unwithdrawn/potential-stock badges, and
//            more. Also: the Reports Summary card's Net Kilos figure was
//            wrapping onto two lines on some values ("13,591.706" then
//            "kg" below it) - widened its column and dropped the
//            redundant "kg"/"MT" suffix since the label above it already
//            says the unit. The Admin Monitoring AI/SIA list now shows
//            Issued and Authorized as two short stacked lines instead of
//            one wide "issued / authorized" line, freeing up room for
//            the left side, which also got a general text-size bump for
//            phone readability. And the NFA detail's "issued → received"
//            summary line no longer breaks alignment against its
//            percentage once it wraps on a phone - the two now stack
//            instead of sitting side by side.
//   1.9-64 - PDF export: the Statement of Receipts/Issues and Statement
//            of MTS tables' DATE column now shows just the month and
//            day on each row ("Aug 17"), with the year moved up into
//            the column header ("DATE (2026)") instead of repeating on
//            every row - only when the whole exported period falls in
//            one year; a period that happens to cross a year boundary
//            still shows the year per row, so nothing is ever lost.
//            Also fixed the header row's bottom border reading as thin
//            despite being set to a thick line - the row directly below
//            it draws its own thinner border right at that same
//            boundary and was visually winning out. Every table now
//            redraws that specific line thicker, explicitly, after
//            the header renders, so it reads as solid black no matter
//            what's below it.
//   1.9-65 - Admin Monitoring AI/SIA list: the "of [authorized amount]"
//            subtext under Issued was too small after 1.9-63's stacking
//            change (was text-xs), per direct feedback that the whole
//            right side had become hard to read. Bumped it up a size,
//            and bumped the Issued figure itself up too so it reads as
//            the clear headline number it's meant to be, not the same
//            size as the row's own label text next to it.
//   1.9-66 - Fixed the MO/TMO detail modal (Monitoring > Milling) ending
//            with zero space below its last block whenever "more
//            details" was expanded. Its fixed header section had no
//            bottom padding, relying on the scrollable Transaction
//            History section right below it to pick up the spacing -
//            but that section is deliberately hidden while more details
//            is open (the two are mutually exclusive), so there was
//            nothing left to provide any gap at all, and the last card
//            sat flush against the modal's own edge. Bottom padding now
//            only drops to zero when that scrollable section is actually
//            there to continue it.
//   1.9-67 - MO/TMO detail modal's Stocks tab: each WSI/WSR trial card
//            now shows Net Bags (weight ÷ 50) instead of the raw
//            weight itself, next to the physically counted Bags field -
//            same derived-unit convention already used in the NFA
//            Ricemill monitor, so the two can be compared directly
//            (they can legitimately differ, since one is counted by
//            hand and the other is computed from the weight).
//   1.9-68 - Corrected 1.9-67: the Net Bags swap belonged on the MO/TMO
//            modal's Issued/Received summary cards at the top (that's
//            what the follow-up screenshot pointed at), not the
//            per-trial cards further down - those are reverted back to
//            showing raw Net Kgs. Also, in the PDF export: widened the
//            VARIETY CODE column (it was breaking mid-word - "VARIET"/
//            "Y"/"CODE" - at the old width), enlarged the DATE header's
//            font, and made the header border's redraw fill the whole
//            cell outline instead of just its bottom edge, so it reads
//            as a solid, unambiguous black rectangle all the way around
//            each header cell.
//   1.9-69 - Two PDF export fixes, both from the same live-export
//            screenshot: GROSS/NET KILOS values were wrapping mid-
//            number ("6,250.375" as "6,250.37" / "5") - 1.9-68's
//            VARIETY CODE column widening had eaten directly into their
//            width budget. Per direct feedback, that column is back to
//            its original width with a smaller header font instead
//            (fixing the "VARIETY" word-break without taking space from
//            anything else), and a few other columns that had more
//            fixed width than they actually needed (NATURE, FROM WHOM,
//            serial, linked doc) were trimmed back, giving GROSS/NET
//            real breathing room again.
//   1.9-70 - PDF export: widened the FROM WHOM ISSUED/RECEIVED NAME
//            column, which was wrapping long customer names/addresses
//            onto 4-5 lines per row. Every column is now a fixed width
//            sized against real longest values (rather than mixing
//            fixed and auto-sized columns) - DATE/NATURE/serial/OR#/
//            BAGS each had more room than their own short values ever
//            need, trimmed back to fund the wider name column, without
//            touching GROSS/NET KILOS' own width this time.
//   1.9-71 - PDF export: fixed the table no longer filling the full
//            page width on a By Products report (no MC% column) - the
//            previous round made GROSS/NET KILOS a flat fixed width,
//            which stopped them from stretching into whatever space is
//            left over whenever an optional column (MC%) isn't present.
//            Back to auto-width for those two, which is what correctly
//            fills the page - they no longer wrap either now that every
//            other column is trimmed to what it actually needs.
//   1.9-72 - Fixed the real bug behind "AI shows 0kg issued despite a
//            genuine active WSI document existing for it": the balance-
//            adjustment functions (adjustAuthorityBalance/
//            adjustSiaBalance) looked up which authority record to
//            update with a plain "first match" query - if a duplicate
//            authId existed for that number at that exact moment (a
//            real, confirmed sync-race case), the update could land on
//            the wrong copy, and a later duplicate cleanup keeping the
//            OTHER copy as canonical then silently lost it. Both now
//            consolidate duplicates first, so there's only ever one
//            record left to update. Also added a self-healing sweep,
//            recalculateAuthorityIssuedTotals, run every sync: it
//            recomputes every authority's issued totals directly from
//            its own real transactions, so an authority already thrown
//            out of sync by this bug (or any other cause) repairs
//            itself on the next cycle instead of needing a manual fix.
//   1.9-73 - PDF export: GROSS/NET KILOS were left auto-width in the
//            previous round to fix the full-page-width bug, but that
//            meant they soaked up ALL the leftover space - visibly too
//            wide for their typically short values, cramping the rest
//            of the table by comparison. They're now a modest fixed
//            20mm each (comfortable for even the largest realistic
//            value), and FROM WHOM NAME is the auto-width column
//            instead - it's the one that actually benefits from
//            unpredictable extra room (long customer names, farmer
//            co-op addresses), and it's what now keeps the table
//            filling the full page in every case.
//   1.9-74 - PDF export footer: removed the printed export date (it
//            just showed today's date on every export, not anything
//            about the report itself), and moved "Page X of Y" to the
//            right corner instead of sitting centered next to "BSM by
//            ArVee".
//   1.9-75 - PDF export: fixed NATURE OF TRANS ACTIVITY being too
//            narrow for "TEST MILLING" to fit on one line (it was even
//            wrapping its own header into 3 lines) - widened it back
//            up. That wrap was also the actual cause of a real row
//            splitting across a page break (part of it printed at the
//            bottom of one page, the rest at the top of the next) -
//            fixed at the root by removing the wrap, plus added an
//            explicit backstop (rowPageBreak: 'avoid') so a tall row
//            can never split across pages regardless of cause.
//   1.9-76 - Admin Dashboard > Stocks: fixed the Data Start Date
//            override having no effect here at all, found after direct
//            testing showed moving it from Aug 1 to Sep 1 changed
//            nothing. Root cause: this page read each pile's
//            currentBags/currentKilos directly (its own comment called
//            this "the live running total"), completely bypassing the
//            cutoff-aware calculation the per-warehouse Home Stocks
//            page already uses. Now goes through a new batched version
//            of that same calculation (computeCurrentPileStatesBatch in
//            pileLedger.js) - built batched rather than one-call-per-
//            pile, since this page needs it across every pile in the
//            app at once, not just one warehouse's worth.
//   1.9-77 - Error handling audit, per direct request. Two real gaps
//            found and fixed:
//            (1) No page-level error boundary existed - a render crash
//            in ANY page (Home, Reports, Settings, Admin Dashboard,
//            etc.) blanked the entire app with no recovery except a
//            hard reload, since only 3 small spots (forms, Alerts
//            panel, Milling monitor) were ever wrapped. Every route is
//            now wrapped in SectionErrorBoundary (a new `fullPage` mode
//            added to it, since its existing copy - "the rest of the
//            page is unaffected" - is simply false for a whole-route
//            crash); bottom navigation stays usable either way, so
//            there's always a way out instead of a dead blank screen.
//            (2) Every save/update/delete/void/unvoid handler in
//            StockFormBase.jsx, SackFormBase.jsx, and WTSForm.jsx had
//            NO error handling at all - an unexpected throw anywhere
//            inside (a Dexie error, a bug in any of the many awaited
//            helper calls) left the Save button stuck disabled forever
//            with zero feedback, no error shown, no way out short of
//            closing and reopening the form. All 15 handlers across the
//            three forms now wrap their work in try/catch/finally: a
//            failure shows a clear toast and logs the real error, and
//            the button is always guaranteed to re-enable either way.
//   1.9-78 - Two additions, per direct follow-up on the error-handling
//            audit:
//            (1) Offline app-shell caching - added a real service
//            worker (vite-plugin-pwa) precaching the app's own HTML/JS/
//            CSS, so closing the app fully while offline and reopening
//            it no longer depends on the browser's own opportunistic
//            cache. Data (Dexie/IndexedDB) already worked offline; this
//            covers the app shell itself, the missing piece for a
//            device with no signal at all.
//            (2) Admin Error Log (Admin Dashboard > System > Error Log)
//            - every error the app catches (a failed form save/update/
//            delete/void, or a page-level crash) now writes a record
//            with the real technical detail (message, stack, context,
//            timestamp) to a shared table, browsable by any admin from
//            any device - not just console.error output nobody was
//            looking at. The user still only ever sees the same plain
//            "Save failed" toast; this is what lets an admin actually
//            diagnose what happened afterward instead of relying on a
//            secondhand description.
//   1.9-79 - Error Log now records WHO and WHICH DEVICE, per direct
//            follow-up ("how would the admin know...?") - it previously
//            only showed what failed and when. Every entry now shows
//            the logged-in staff user's name and role (or "Not logged
//            in" if the crash happened before login), plus a
//            recognizable device label ("Chrome on Android") backed by
//            a persistent per-device ID generated once and kept in that
//            browser's own storage - so the same tablet erroring
//            repeatedly is now identifiable as the same device, not
//            five unrelated-looking entries.
//   1.9-80 - Fixed the logo (and every favicon/app icon) not loading
//            offline, confirmed by direct testing of the new offline
//            service worker. The precache list was left at the plugin's
//            own default, which only covers JS/CSS/HTML - every static
//            image in public/ (logo, favicons, icons, the manifest
//            itself) was silently excluded. Broadened the precache glob
//            to include ico/png/svg/webmanifest too - went from 6
//            precached files to 15, everything the app shell actually
//            needs is now cached.
//   1.9-81 - Closed the last offline gap, per direct follow-up ("make
//            sure everything works offline"): the app's font (Inter)
//            was loaded from Google's CDN via a live @import - not
//            something a service worker can precache at all, since it's
//            an external request, not one of the app's own files. A
//            device that had never been online (or whose browser
//            evicted the font from its own cache) would silently fall
//            back to a system font offline. Self-hosted it instead
//            (@fontsource/inter) so the actual font files are bundled
//            and precached like everything else - trimmed to just the
//            latin/latin-ext subsets and woff2 only (dropping unicode
//            ranges like Cyrillic/Greek/Vietnamese this app never
//            renders, and the older woff format every supported browser
//            already has woff2 for), keeping the precache addition to
//            about 200KB instead of the 1MB+ an unfiltered install
//            would have added. Also confirmed no other external runtime
//            dependency exists anywhere in the app - everything it
//            needs to run is now part of its own precached bundle.
//   1.9-82 - CRITICAL SECURITY FIX, found by a full-app risk sweep:
//            /api/dexie-cloud-tokens had NO check on the caller at all
//            - any POST request with a public_key got back a live write
//            token for the shared service account (ACCESS_DB +
//            IMPERSONATE scope), meaning anyone who found this URL
//            could read or change every warehouse's real inventory
//            data, no PIN required. Added a shared-secret header check
//            (x-bsm-app-key, matched against a new VITE_APP_SHARED_KEY
//            env var) - not a complete fix on its own (anything shipped
//            to the browser is technically extractable), but closes off
//            casual/automated discovery of the bare endpoint, which is
//            the realistic threat here. Fails safe (no-op) until that
//            env var is actually set in Vercel - see the admin's own
//            instructions for the value to use.
//   1.9-83 - The four remaining findings from the risk-sweep audit
//            (docs/risk-sweep-audit-2026-09.md), all self-healing/
//            additive fixes, none touching normal save/login behavior
//            for a healthy account:
//            1. Pile balances can drift from their true value under
//               concurrent offline edits on two devices (the same
//               reversal-ordering bug class already fixed for AI/SIA
//               authority totals). Added recalculatePileStatesForWarehouses
//               (pileLedger.js), a periodic self-healing sweep (every 5
//               minutes, via transactionPreload.js) that recomputes each
//               pile's true bags/kilos from its full transaction history
//               and corrects the cached total only when it actually
//               differs - a no-op on healthy data, never a one-time fix.
//            2. Manually-typed serial numbers can collide across two
//               offline devices (same warehouse/serial/category, two
//               genuinely different real transactions). The existing
//               duplicate-cleanup pass (dedupeDuplicateTransactions) used
//               to merge (and delete) ANY two records sharing that key,
//               assuming they were always the same event synced twice -
//               correct for that case, but would have silently destroyed
//               one side's real data on an actual collision. Added
//               looksLikeSameEvent (date/customer/amount comparison) to
//               gate the existing merge: a real match merges exactly as
//               before, a genuine mismatch is left completely untouched
//               and flagged in the admin Error Log instead, for a human
//               to resolve by renumbering one of them.
//            3. PINs were hashed (SHA-256) but never salted - a 6-digit
//               PIN only has 1,000,000 possibilities, cheap for a generic
//               precomputed rainbow table to crack, and the users table
//               syncs to the cloud, not just this device. Added a fixed
//               app-specific salt (pinHash.js); every account is upgraded
//               to the salted hash automatically the next time its real
//               PIN is entered at login - no PIN reset needed, no
//               lockout, nothing for anyone to do.
//            4. No recovery path existed if the local database itself
//               failed to open (corrupted IndexedDB, a schema-migration
//               upgrade throwing) - previously a permanent blank screen
//               on every reload. main.jsx now opens the database
//               explicitly before rendering and shows a plain-language
//               recovery screen (DbOpenErrorScreen.jsx) with a Reset
//               local data & reload option if it fails - most data
//               re-downloads from the cloud either way.
//   1.9-84 - Two follow-ups from the risk-sweep fixes, per explicit
//            request:
//            1. Admin-only "Rename serial #" on WSR/WSI/ESR/ESI/WTS -
//               changes an already-saved record's serial number in
//               place, keeping every other field untouched. Needed
//               because retyping the Serial No. field always means
//               "find or start a different document" (it resets the
//               whole form) - there was no actual way to fix a real
//               serial collision (see 1.9-83) other than deleting the
//               record and retyping it from scratch. A multi-pile WSI's
//               linked extra-pile records rename together as one group
//               (serialRename.js), so nothing is left pointing at a
//               stale groupSerialNo.
//            2. Found and fixed a real bug in the existing Admin >
//               System > Backup panel (full-database JSON export,
//               already built) while reviewing it for this request: its
//               table list was a hardcoded array that had quietly gone
//               stale - customerAliases, userAliases, and errorLogs
//               were all added to the schema after this list was last
//               updated, so "Export All Data" was silently skipping
//               them with no indication anything was missing. Now reads
//               the table list live from db.tables, so a future new
//               table is included automatically. Also added error
//               handling (a failed export previously failed silently).
//   1.9-85 - Automatic off-Dexie-Cloud database backup, per explicit
//            request: a real disaster-recovery copy of the whole
//            database, not depending on an admin remembering to click
//            Export. Any logged-in device now silently checks a
//            shared, synced timestamp (db.reportConfig) and, throttled
//            to once every 24 hours globally (not per device), builds
//            the same full-table dump the manual Export button already
//            produces and POSTs it to a new Vercel serverless function
//            (api/backup-to-github.js), which commits it to this app's
//            own GitHub repository under backups/ - a copy that lives
//            completely outside Dexie Cloud, so a serious incident
//            there wouldn't be the only place the data exists. Keeps
//            the last ~30 days, pruning older ones automatically.
//            REQUIRES a new Vercel env var (GITHUB_BACKUP_TOKEN, a
//            GitHub personal access token scoped to just this repo's
//            Contents permission) before it actually works - fails
//            safe (logs the failure, nothing else breaks) until that's
//            set, same rollout pattern as the shared app key. Admin >
//            System > Backup now shows the last automatic backup time
//            and a link to view backups on GitHub, alongside the
//            existing manual Export All Data button (unchanged).
//   1.9-86 - Admin > Beginning Balances (Piles tab) now has a "Date
//            Received"/"Date Procured" field (labeled per cereal type,
//            same convention already used on the exported pile layout
//            and Settings > Create/Edit Pile) - previously only
//            editable from Settings, meaning a full beginning-balance
//            correction needed switching between two different panels
//            to also fix this one field. Same underlying pile.dateProcured
//            field, not a new one - editing it here or in Settings now
//            updates the same value either way.
//   1.9-87 - CRITICAL fix to yesterday's automatic backup feature: it
//            was committing straight to main, the same branch this
//            app's own code lives on - within a day it had already
//            collided with a normal development push (two unrelated
//            histories fighting over the same branch tip) and would
//            have added a multi-megabyte JSON file to every future
//            `git pull` on this repo forever. Backups now write to a
//            dedicated "backups" branch instead (created automatically
//            the first time it's needed), which can never conflict
//            with real development work again. The polluting commits
//            already on main were reverted; the backup data itself was
//            never at risk, only which branch it landed on.
//   1.9-88 - Three fixes from direct feedback:
//            1. Beginning Balances' edit form now shows the pile's
//               variety next to its name for Rice/Palay (e.g. "Test
//               Pile 1 (WD1)") - previously invisible there entirely
//               (only By Products showed a variety, via its own
//               editable per-line picker), even though the pile list
//               above the form already showed it. Rice/Palay's variety
//               is locked at pile creation and isn't editable from
//               here, so this is read-only confirmation of which
//               variety you're correcting.
//            2. Removed three explanatory captions per explicit
//               request (Beginning Balances' own description, its
//               "add a separate line..." hint, and Settings > Create
//               Pile's "for onboarding stock already on hand..." line).
//            3. Found and fixed a real resource-contention bug behind
//               a report of slower serial lookups: yesterday's
//               automatic backup worker (backupWorker.js) reads every
//               table in full when it runs, but - unlike the existing
//               transaction sync worker - never checked whether a
//               form had paused background sync while open for
//               exactly this reason. It now respects that same pause
//               signal (isTransactionSyncPaused, syncWorker.js), so it
//               can no longer compete with an open form's own local
//               IndexedDB lookups for a serial. Whether this was the
//               specific cause of the reported WebSocket disconnect
//               error is not confirmed - unlike the lookup slowness,
//               that trace points at Dexie Cloud's own realtime
//               connection, which this fix does not directly touch -
//               but closing off a real, unguarded source of main-
//               thread/IndexedDB contention is a genuine improvement
//               either way.
//   1.9-89 - Follow-up to 1.9-88's contention fix, per a further report
//            that serial lookup was still slow: found a real gap in
//            that fix - the pile-balance recalc sweep only checked
//            whether background sync was paused BEFORE its own preload
//            cycle started, not right before the expensive recalc
//            itself runs a few steps later. A form opening (pausing
//            sync) partway through an already-in-flight cycle wasn't
//            caught, so the recalc could still run concurrently with a
//            freshly-opened form's own serial lookup. Re-checks the
//            pause flag immediately before starting the recalc now,
//            closing that gap for the common case. Split the pause
//            flag itself into its own module (syncPauseState.js) so
//            this and the backup worker can both read it without a
//            circular import through syncWorker.js - no behavior
//            change for the three forms that already pause/resume it,
//            their import path is unchanged.
//            Also looked into the two console errors reported
//            alongside this: the AbortError from syncMillingOrdersFromSheets
//            is pre-existing, intentional behavior (an 8-second timeout
//            on every Google Sheets call, specifically so a slow/cold
//            Apps Script response can never hang the UI - see
//            googleSheetsBridge.js's fetchWithTimeout) - it means that
//            one sync attempt was too slow and got cut short, not a new
//            bug. The other error (reportAllChanges / reading
//            'startTime') traces to an anonymous injected script, not
//            this app's own bundle - this project has no analytics or
//            web-vitals package at all, so it's most likely a Vercel
//            dashboard feature (Speed Insights/Analytics) or a browser
//            extension, neither of which this codebase can see or fix.
//   1.9-90 - Found and fixed the real cause of a serial lookup
//            wrongly showing "pulled from historical Sheet data" on a
//            record the user had genuinely created in-app, plus the
//            2-3 second delay before anything showed on what's
//            supposed to be an instant offline-first lookup. Root
//            cause, in WSR/WSI/ESR/ESI's checkAndLoadSerial: whenever
//            this device's own one-time historical Sheet preload for
//            that (warehouse, type) hadn't finished yet (common right
//            after login, especially for an admin with many accessible
//            warehouses), "not found locally" triggered a live network
//            fetch of the Sheet as a fallback - slow, AND wrong for a
//            record that actually already exists as a normal, synced
//            Dexie Cloud transaction that simply hasn't been pulled
//            down to THIS specific device yet: the Sheet has a backup
//            row for every transaction regardless, so it "found" the
//            record and imported it fresh as an incomplete historical
//            stub, even though the real, complete local version was
//            never actually missing - just not-yet-synced here. Now
//            simply waits for preload to finish on its own (it does,
//            within moments, via the existing 30-second background
//            cycle) instead of racing a live network call - once
//            preload genuinely completes, "not found" is trusted as
//            definitive. Fixed identically in both StockFormBase.jsx
//            and SackFormBase.jsx (WTSForm.jsx never had this pattern).
//   1.9-91 - Found and fixed the real cause of a genuinely different
//            bug than 1.9-90's - the "pulled from historical Sheet
//            data" banner showing on a record that DID already have
//            real Pile ID and MTS Sack values filled in (confirmed via
//            screenshot: the banner and the actual filled-in fields
//            were visible on the same loaded record at once). Root
//            cause, in transactionPreload.js's duplicate-cleanup merge
//            (dedupeDuplicateTransactions, plus its three older one-
//            time predecessors earlier in this file): the merge only
//            ever fills a survivor's BLANK fields from a duplicate
//            record, never touches needsCompletion itself (a non-blank
//            boolean, so "only fill blanks" always skipped it) - so a
//            record that started as an incomplete Sheet-imported stub
//            could get its real Pile/MTS values merged in from a
//            genuine local duplicate, yet keep showing the banner
//            forever afterward, since nothing ever recomputed the flag
//            against what the record actually has now. Added
//            clearStaleNeedsCompletion, which does exactly that -
//            wired into fresh merges going forward, AND into a general
//            per-row healing pass that runs every sweep cycle, so any
//            record already sitting in this stale state self-corrects
//            the next time preload touches its warehouse, not just new
//            merges from here on.
//   1.9-92 - Toast overhaul, batch 1 of the animation set worked
//            through with the user (toast #1's edge-strip color and
//            swipe-to-dismiss already existed - confirmed while
//            starting this work):
//            1. Default toast durations raised from react-hot-toast's
//               own defaults (2s success / 4s error - reported as too
//               fast to actually read) to 5s success / 6s error, set
//               once at the <Toaster> level.
//            2. Toast #10 - every Save and Update confirmation across
//               WSR/WSI/ESR/ESI/WTS now shows a SavedReceipt: the
//               real bags/kilos (or pieces, or issued/received bags
//               for WTS) counting up from 0, instead of just a plain
//               "saved" message.
//            3. Toast #2 - a progress-style toast (an indeterminate
//               sweep, not a fake timed fill, since a fetch() upload
//               has no real byte-level progress to report) now shows
//               for the automatic daily GitHub backup and the Admin >
//               Google Sheets "Sync Now" button - deliberately NOT
//               added to the continuous 30s/5min background polling
//               cycles, which stay silent by design to avoid spam.
//   1.9-93 - Animation batch 2: login, boot, and dashboard.
//            1. Concept A - each PIN dot now pops as it lands, and a
//               wrong PIN shakes the whole dots row once (on top of
//               Login's own existing fly-in/fly-out entrance/exit,
//               which only plays before/after typing and never
//               overlaps with this).
//            2. Concept W - a soft breathing pulse on the app logo is
//               shown the instant the page loads, before db.open()
//               even starts, replacing what used to be a blank flash
//               while the database opens.
//            3. Concept B - the dashboard's headline Total figures
//               (Admin Home Stocks' Rice/Palay totals, plus Home
//               Stocks' Total Bags/Total Net Bags summary cards) now
//               count up from their previous value instead of
//               snapping to the new one, via a new shared
//               CountUpNumber component.
//   1.9-94 - Animation batch 3: dialogs, empty states, menus, toggles,
//            warehouse switching.
//            1. Concept J - every ConfirmDialog now gets the same
//               scale+fade entrance/exit - previously only the
//               warning-style (icon-present) ones animated at all, a
//               plain Delete confirmation just snapped into existence.
//            2. Concept E - "No data available yet" (the shared Empty
//               component, plus Beginning Balances' matching lines)
//               now fades and scales in with a small icon, instead of
//               appearing flat with zero motion.
//            3. Concept I - Beginning Balances' "More options" popover
//               (the only one of its kind in the app - confirmed by
//               search) now scales and fades in from its anchor corner
//               instead of appearing instantly.
//            4. Concept K - Settings' Auto Age Monitoring toggle now
//               uses the same spring-overshoot curve already used
//               elsewhere (toast pop-in, the bottom-nav pill) instead
//               of a plain linear slide. KG/MT and dark/light turned
//               out to already be a different control shape (a
//               segmented pill and an icon button, not a sliding
//               thumb), so this concept only applies to this one real
//               toggle switch.
//            5. Concept L - Home Stocks' entrance animation (already
//               existed for its own KG/MT and Net Bags toggles) is now
//               also keyed on the current warehouse, so switching
//               warehouses replays it too instead of numbers silently
//               swapping in place.
//   1.9-95 - Animation batch 4: void transition fix, reusable button
//            morph.
//            1. Concept S - WSR/WSI/ESR/ESI/WTS's void styling had
//               transition-opacity only, so the border/padding change
//               on Void applied as an instant snap even though opacity
//               already faded smoothly. Now transition-all, covering
//               every property that className swaps.
//            2. Concept F - new reusable MorphButton component (a
//               button that morphs spinner -> the same spring
//               checkmark every success toast already uses, in place)
//               - wired into Admin > Visitor Access's Save button as
//               the first concrete example, replacing its separate
//               success toast (redundant once the button itself
//               confirms). More admin panel saves to follow as their
//               own pass - there are many, each needs its own
//               validation-failure case checked so a failed save can
//               never show the checkmark.
//   1.9-96 - Fixed three real regressions from the last two animation
//            batches, all confirmed live:
//            1. The PIN dot pop animation used a "both" fill-mode,
//               which permanently pins a CSS Animation's own transform
//               value on an element for as long as its class stays
//               applied - since the pop's class never comes off once a
//               dot is filled, this silently blocked the exit fly-out
//               from ever moving the dots again (animations win over
//               transitions on the same property while "holding").
//               Removed the fill-mode - confirmed live, dots now fly
//               out correctly on a successful login.
//            2. The "by ArVee"/version block never had any exit
//               animation at all (not a regression - it just never had
//               one) - now flies down and fades with everything else,
//               composed carefully with its own centering transform
//               (inline style.transform replaces, not adds to, a
//               Tailwind transform class).
//            3. The "Welcome back" toast passed a custom `style` object
//               that AnimatedToast (the app's one custom toast
//               renderer) never actually reads - it was silently doing
//               nothing, so this toast rendered as a themed-but-generic
//               'blank' toast, not the tuned neon design in the
//               original code. Switched to toast.success, which gets
//               the same real edge-strip + checkmark treatment every
//               other success toast has.
//            Also: found and fixed the real cause of a reported 5s
//            serial-lookup delay - checkAndLoadSerial's "wait for
//            preload" refusal (added last round to stop wrongly-
//            imported historical stubs) checked preload-completeness
//            ONCE and gave up, so the very first lookup after login
//            (for an admin with many warehouses, preload can
//            genuinely take a few seconds) always failed with a
//            message the user then had to notice and manually retry.
//            Now polls for up to 4s instead - the common case (preload
//            finishes within that window) resolves the lookup
//            automatically once it does, no manual retry needed.
//            Also upgraded the login preload toast and its "done"
//            state to the same SyncProgressToast component already
//            used for the GitHub backup and Sheets sync, instead of a
//            plain unstyled loading line.
//   1.9-97 - Animation batch 5: the four remaining picked concepts.
//            1. Stamp of approval - AI/SIA "mark complete" checkbox
//               (AdminMonitoring.jsx) now drops in and stamps itself
//               into place with a squash-bounce and a brief ring pulse
//               on the moment of the tap, instead of the checkmark
//               just appearing.
//            2. Concept U - Reports' Export PDF button now holds a
//               brief "Ready" checkmark state after a successful
//               export instead of snapping straight back to "Export
//               PDF" with only a separate toast as confirmation.
//            3. Concept R - Pile Layout boxes now get a slow amber
//               glow when their pile's stock is past its variety's own
//               oldest AGE_BUCKETS bracket (the same bucket
//               definitions Home Stocks' own age grouping already
//               uses) - this flagging didn't exist anywhere in Pile
//               Layout before. Scoped to the main grid view for now,
//               not yet the full-screen variant.
//            4. Concept V - the NFA Issuance/Receipt breakdown's
//               mobile list now animates rows sliding to their new
//               position when Sort & Filter changes the order (FLIP
//               technique), instead of an instant re-render with no
//               indication of what moved.
//   1.9-98 - Broadened two already-picked concepts to more places:
//            1. Concept B (count-up) - Admin Home Sacks' per-condition
//               pieces figures now count up too, not just the
//               dashboard headline totals from the last round.
//            2. Concept F (MorphButton) - wired into three more direct-
//               save admin panels (Provinces, Branches, Transaction
//               Types), each losing its separate success toast in
//               favor of the button's own checkmark morph. Confirmed
//               live: click-to-checkmark-to-"Saved" all fire correctly,
//               no regressions. Many more admin panels still have a
//               plain Save button (Varieties, Sack Types, Users,
//               Customers, Warehouses, Sheet Sources, Signatories,
//               Ricemill Allocations) - not yet converted, a real
//               remaining scope item, not an oversight.
//   1.9-99 - Fixed a real, reported bug: SyncProgressToast (toast #2)
//            rendered its own icon/spinner INSIDE the message content,
//            on top of AnimatedToast's own icon (which already renders
//            one per toast type, and already switches it automatically
//            from spinner to checkmark when a call site moves from
//            toast.loading to toast.success on the same id) - so every
//            sync toast showed two stacked spinners, then two stacked
//            checkmarks. SyncProgressToast now renders text/progress-bar
//            only, no icon of its own. Confirmed live: every toast now
//            shows exactly one icon.
//            Also broadened concept B (count-up) much further per
//            explicit request ("every numerical value that loads up or
//            refreshes"): every per-province row, per-category
//            breakdown figure, per-warehouse row, and per-age-bucket
//            figure on Admin Home Stocks now counts up, not just its
//            two headline totals from before. Same for Home Stocks'
//            per-variety and per-age-bucket figures. Deliberately left
//            alone: Home Stocks' cereal-type Total card, which already
//            has its own dedicated 3D flip animation for exactly this
//            kind of value change - stacking count-up on top of an
//            element that also remounts on flip would reset the count
//            to 0 every time and fight the existing animation instead
//            of complementing it.
//   1.9-100 - Fixed a real, reported bug: the MO/TMO Number dropdown on
//            WSR/WSI/ESR/ESI/sack forms only showed real options when
//            the Customer Name field held the EXACT text the miller's
//            own MO/TMO Google Sheet uses for them (e.g. "DENS RM"),
//            which is often just a nickname/alias, not their real
//            registered name ("Dens Marketing Corporation") the field
//            normally shows once resolved via customerAliases. Typing
//            the resolved real name (the expected, normal case) found
//            nothing; only typing the raw sheet alias worked. Root
//            cause: the match compared millingOrderOptions.ricemillName
//            against customerName as plain trimmed/lowercased text, with
//            no alias resolution on either side. Both sides are now
//            resolved through the same customerAliases map
//            (canonicalName, reusing buildCustomerAliasMap from
//            customerDirectory.js) before comparing, so the dropdown
//            matches regardless of whether the alias or the real name is
//            currently typed. Fixed in both StockFormBase.jsx and
//            SackFormBase.jsx; WTSForm.jsx has no ricemillName matching
//            of its own, so it was unaffected.
//   1.9-101 - Three real, reported gaps in how a pile's stock is shown,
//            all sharing one root cause: a pile's flat currentBags/
//            currentKilos/varietyId fields (and the exported PDFs/BIN
//            Card built from them) can't reflect a pile that genuinely
//            holds more than one thing at once.
//            1. A Rice/Palay pile that received stock under more than one
//               sack weight/condition (e.g. some bags at 50kg BN, some at
//               25kg SH) only ever showed ONE combined total everywhere -
//               the Pile Layout grid box itself, its hover/tap popup, the
//               Pile List page, and both PDF exports. Every one of those
//               now lists each sack-weight/condition group directly (own
//               Bags/Net Kg, stacked on separate lines), plus a bold
//               TOTAL once there's more than one group - a single-group
//               pile (the common case) is completely unchanged.
//            2. A By Products pile can hold a genuine mix of varieties at
//               once (piles.varietyId is null/unreliable for By Products -
//               the real mix only ever existed by aggregating each
//               transaction's own varietyId, never actually read back out
//               anywhere) - only one, often blank, variety ever displayed.
//               By Products now always lists every variety it actually
//               holds (grid box, popups, Pile List, both PDF exports, and
//               the BIN Card's new VARIETY column), each with its own
//               Received date (since, per explicit confirmation, varieties
//               genuinely can be received on different days) - unlike
//               Rice/Palay, which keeps exactly ONE shared Procured/
//               Received date for the whole pile, never per group.
//            3. Beginning Balances' repeatable lines already had their
//               own "As of" date - the free-text Date Received/Procured
//               field was still a single value shared across the whole
//               pile. Per explicit confirmation this only matters for By
//               Products (Rice/Palay genuinely has one procurement date
//               for the whole pile) - By Products now gets a per-line
//               Date Received field instead of the shared one; Rice/Palay
//               is untouched.
//            New computePileStockBreakdown (pileLedger.js) is the shared
//            source of truth for all of this - computePileStockBySackWeight
//            (Home Stocks' existing per-weight breakdown) is now a thin
//            wrapper around it, provably unchanged for that caller.
//            BIN Card's per-row REMARKS column (sack weight/condition) was
//            added for every pile, not just multi-group ones, so the
//            ledger itself always explains which group a receipt/issue
//            belongs to.
//   1.9-102 - Follow-up per direct feedback with real screenshots: 1.9-101's
//            multi-group breakdown looked "not professional" and "crowded"
//            - the exported Pile Layout PDF in particular rendered every
//            shared field, group heading, and group figure as the same
//            plain gray label:value line, so a group heading (e.g. "DKA:")
//            was visually indistinguishable from an ordinary field. Both
//            the exported PDF and the on-screen grid box (only the box
//            itself - the hover/tap popup and Pile List already had this)
//            now draw a bold heading + thin divider rule above each group
//            and a bold Total row at the bottom, so groups read as
//            distinct sections. The PDF also folds each group's Received
//            date (By Products only) into its heading line instead of a
//            separate row, trading one row of height for the same
//            information. Bags and Net Kg stay on their own stacked lines
//            in every case, per explicit confirmation this shouldn't be
//            re-combined onto one line.
//   1.9-103 - Follow-up per direct feedback with real screenshots again:
//            1.9-102's headers/dividers were a real improvement but the
//            breakdown still looked crowded, text sitting right against
//            the box border with no breathing room - confirmed in the
//            screenshots (the exported PDF's text nearly touching the box
//            edges, and the on-screen grid box's own value text visibly
//            wrapping mid-value, e.g. "kg" landing on its own line and
//            spilling past the box). Two real fixes: (1) the on-screen
//            compact box's multi-group breakdown now renders each stat as
//            its own centered, truncating line (matching how the plain
//            single-group box already worked) instead of a label:value
//            row with no width guard, which is what was wrapping mid-
//            value. (2) The exported PDF gets real padding (2mm -> 3mm),
//            a little more side margin, and slightly taller rule/heading
//            spacing, so groups have actual room around them instead of
//            being packed edge-to-edge.
//   1.9-104 - Fixed a real, reported bug: users had to close and reopen
//            the app 3-5 times before a new deploy actually showed up.
//            Root cause, confirmed by reading vite-plugin-pwa's own
//            generated output: nothing in this app ever imported the
//            plugin's virtual:pwa-register module, so it fell back to
//            its own bare injected registerSW.js, which only calls
//            navigator.serviceWorker.register() - no update checking, no
//            reload once a new service worker actually takes over. A new
//            SW could sit "waiting" indefinitely, only getting a real
//            chance to activate on a genuinely full close of every open
//            instance, and even then nothing told the next launch's
//            already-loaded JS to reload and fetch the new bundle.
//            main.jsx now calls registerSW() itself (workbox-window under
//            the hood), which checks for an update on load and reloads
//            the page automatically the moment a new version activates -
//            matches the existing registerType: 'autoUpdate' config, no
//            user-facing prompt. workbox-window does NOT poll for updates
//            on its own (confirmed by reading its source) - added an
//            explicit visibilitychange listener that asks the browser to
//            check the real sw.js every time the app becomes visible
//            again, which is what actually covers "reopen the app" and
//            should now show a new version within one open, not several.
//   1.9-105 - 1.9-104's service-worker-level auto-update fix wasn't
//            enough on its own - reported still stuck on 1.9-103 after
//            several tries, confirming SW update timing can genuinely get
//            stuck on some devices/browsers even with that mechanism in
//            place. Added a real, visible backstop: a new
//            public/version.json (regenerated from src/version.js on
//            every dev/build via the new sync-version.cjs, wired into
//            predev/prebuild the same way check-imports.cjs already is)
//            that the running app polls every 15 minutes and every time
//            it becomes visible again, fetched with cache: 'no-store'
//            plus a cache-busting query param so it always reflects
//            what's actually deployed, not a stale cached copy. A
//            mismatch against the running bundle's own APP_VERSION shows
//            a persistent "A new version is available" toast with an
//            explicit Update now button (UpdateChecker.jsx,
//            AnimatedToast.jsx's new UpdateAvailableToast) - a real,
//            actionable notice instead of silently hoping the service
//            worker sorts itself out.
//   1.9-106 - Three changes, per explicit request:
//            1. New shrink-away search animation (ShrinkFilterRow) -
//               a non-matching row shrinks/fades away and grows back in
//               live as the user types, instead of just vanishing/
//               reappearing instantly. Wired into the two searches that
//               already existed: Admin Monitoring's AI/SIA pending list,
//               and the Completed AI/SIA modal (the other filters there -
//               month/year/regional/warehouse - stay instant, only the
//               live-typed text search animates). The Completed MO/TMO
//               modal and the MILLING/NFA monitors have no search box at
//               all currently - not touched here.
//            2. Fixed a real, reported bug: every By Products variety on
//               Home Stocks' Overview tab showed as a blank "—" line
//               instead of its real name, even when a pile held more
//               than one genuine variety. Root cause: the per-variety
//               grouping read the PILE's own varietyId field, which is
//               null/unreliable for By Products (the real mix only
//               exists per-transaction - same root cause already fixed
//               for Pile Layout). PileWeightSubscriber now reads the
//               full computePileStockBreakdown (variety + sack weight)
//               instead of the weight-only computePileStockBySackWeight
//               wrapper, and By Products groups by each transaction's
//               own varietyId instead of the pile's. Rice/Palay's
//               existing behavior (including "never separate by sack
//               weight for By Products") is unchanged - confirmed same
//               figures, just resolved through the fuller data now.
//               AdminHomeStocks.jsx has no per-variety breakdown at all
//               (Rice/Palay included), so there was nothing to fix there.
//            3. Settings > Classifier name field now suggests names
//               already saved on other warehouses as you type (reusing
//               the exact suggestion-dropdown pattern Customer Name
//               already uses), so a name doesn't get re-typed as a
//               slightly different variant by accident.
//   1.9-107 - Search added to the two Monitoring tabs that never had one
//            (MILLING and NFA, plus their own Completed views), and every
//            monitoring search broadened to match multiple fields at
//            once instead of just one reference number - per explicit
//            request: customer, authority number, warehouse, AI/SIA
//            number, MO/TMO number, ricemill name, O.R. number, remarks/
//            notes. New shared monitoringSearch.js is the one place that
//            defines "broad" for every screen:
//            - AI/SIA (Admin Monitoring's list + Completed AI/SIA modal):
//              now also matches customerName, regionalAuthorityNumber,
//              orNumber, remarks, note1/note2, sourceWarehouse, and the
//              linked warehouse's code/name - not just aiNumber/siaNumber.
//            - MILLING/Test Milling (new search box on the pending list
//              + Completed Milling modal): db.millingOrders itself has no
//              customerName/orNumber/notes of its own (confirmed against
//              the sync writer) - matches o.number/o.ricemillName/
//              o.receivingWarehouse plus every one of those fields from
//              the AI/SIA authority the order links to.
//            - NFA (new search box): matches the Regional Authority
//              Number itself plus every AI number that actually moved
//              stock under it (from the already-computed recovery
//              breakdown), covering "search by AI number" here too.
//            Every one of these uses the same ShrinkFilterRow animation
//            from the previous round - non-matching rows shrink away and
//            grow back in live as you type, not an instant filter.
//   1.9-108 - Fixed a real, reported bug: tapping the "Update now" toast
//            button (added in 1.9-105) gave no feedback at all and then
//            silently landed on the PIN login screen, which read as the
//            app freezing/crashing. Not actually a bug in the reload
//            itself - AuthContext.jsx deliberately never persists the
//            logged-in session ("held in React state only... a fresh
//            page load requires re-entering the PIN," its own top
//            comment), so any reload, this one included, was always
//            going to land back on Login - that's by design, the toast
//            just never said so. UpdateAvailableToast now disables the
//            button and swaps to a spinner + "Updating…" the instant
//            it's tapped (visible feedback for the brief window before
//            the page actually unloads, and blocks a double-tap), and
//            states upfront that updating signs the user out, so landing
//            on Login now reads as expected instead of something having
//            gone wrong.
//   1.9-109 - Follow-up fixes to the search work from the last two
//            rounds, per direct feedback with real screenshots:
//            1. Fixed real "weird gaps" between search results -
//               root cause: the parent list used Tailwind's space-y-*
//               (a fixed margin-top on every row regardless of state),
//               so a collapsed (non-matching) row's CONTENT correctly
//               shrank to ~0px but its MARGIN stayed in full, leaving
//               real empty space stacked between every collapsed row.
//               ShrinkFilterRow now carries its own conditional margin
//               instead (zero while collapsed) and every list dropped
//               its space-y-* - a collapsed row's total footprint is
//               now genuinely zero, so matches sit flush together.
//            2. Searching while scrolled down never brought the results
//               into view - every monitoring search now scrolls back to
//               the top (of the page, its own card, or its own modal,
//               whichever applies) the moment a search actually STARTS
//               (empty -> non-empty), not on every further keystroke.
//            3. Search text now resets when switching tabs (Admin
//               Monitoring's AI/SIA/MILLING/NFA tabs, and MILLING's own
//               MO/TMO tab) - MillingMonitor/NfaMillingMonitor stay
//               mounted the whole time (a deliberate, unrelated fix from
//               an earlier round to avoid a flash of empty state), so
//               their search text was silently surviving a tab switch
//               instead of starting fresh.
//            4. Every search box's placeholder just says "Search" now -
//               the old ones described a narrow one-field search
//               ("Search AI number for reconciliation…") that stopped
//               being accurate once the previous round broadened every
//               search to match customer/warehouse/OR No./etc, so it
//               read as a stale, irrelevant hint.
//            5. Fixed a separate, real gap reported the same day: the
//               Unwithdrawn detail modal (tap an "unwithdrawn" badge)
//               showed far less per AI than the Monitoring list it's
//               drilled down from - a truncated one-line customer name
//               and nothing else. Now also shows the full customer name
//               (wraps instead of cutting off), the assigned warehouse,
//               the date, and OR No./Remarks/Note - reusing the same
//               authorityExtraDetails helper AdminMonitoring.jsx's own
//               row already uses, instead of a separate, thinner display.
//   1.9-110 - Fixed a real, serious bug found via direct phone testing:
//            the app was force-reloading itself the INSTANT a new
//            service worker activated, with zero say from the user -
//            no toast, no confirmation, potentially mid-search or
//            mid-reconciliation. Root cause: registerType: 'autoUpdate'
//            (vite.config.js) makes vite-plugin-pwa's own registerSW()
//            reload automatically on activation - this is also exactly
//            why the "Update now" toast (added two rounds ago) never
//            got a chance to show on a real phone: the silent
//            auto-reload usually already happened (often within seconds
//            of opening the app) before UpdateChecker.jsx's own
//            version.json poll ever found a mismatch to report, since
//            the device was already on the new version by then. Switched
//            to registerType: 'prompt' - the service worker now installs
//            a new version and sits WAITING, and nothing ever reloads
//            until the user's own tap on "Update now" calls the real
//            update function (new src/services/appUpdate.js, wired
//            through main.jsx/UpdateChecker.jsx) - a plain reload
//            fallback still fires a few seconds later on the rare
//            chance the service worker itself wasn't ready in time, so
//            the button always does something.
//            Three smaller follow-ups, all per direct feedback:
//            1. The "scroll to top on search" fix from last round only
//               fired once (empty -> non-empty) - not enough, per
//               feedback that continuing to type needs to keep bringing
//               the (changing) results into view too. Now scrolls on
//               every real change to the search text, everywhere it was
//               added.
//            2. Removed the "Updating will sign you out" subtext under
//               the Update now button - the notification text plus the
//               button alone are enough.
//            3. Fixed a real, reported bug: a page's subtitle (e.g.
//               "Welcome back, JP.") could get clipped down to
//               "Welcome…" on a narrow phone, since `truncate` cut it to
//               one line regardless of how little room was actually
//               left next to the header's icon row. Now wraps onto a
//               second line instead - the header's own height already
//               adjusts dynamically via a ResizeObserver, so nothing
//               below it overlaps.
//   1.9-111 - Fixed the real bug behind 1.9-110's own "Update now" fix
//            not working - confirmed live: tapping it repeatedly kept
//            the app stuck on 1.9-109, restarting each time without
//            ever landing on the new version; only a full close of the
//            app let it actually update. Root cause: the fallback
//            reload timer added alongside "Update now" (a plain
//            window.location.reload() a few seconds after tapping, in
//            case there was nothing to skip-wait on yet) raced against
//            the real skipWaiting -> activate -> controlling sequence -
//            downloading and installing the new service worker
//            genuinely took longer than that timer on a real
//            connection, so the fallback fired FIRST and reloaded back
//            into the still-old, still-controlling service worker
//            before it had finished taking over. Removed that timer
//            entirely - applyUpdate() alone now drives the reload,
//            whenever the real activation actually completes, however
//            long that takes. Also: the button's spinner/"Updating…"
//            state is now guaranteed to actually paint before any of
//            that work starts (a double requestAnimationFrame), which
//            was the other half of "no feedback, just freezes" on a
//            fast enough browser.
//   1.9-112 - Two more real, reported bugs in the update flow:
//            1. Desktop: tapping "Update now" did nothing. Root cause:
//               public/version.json (a small static file) can report a
//               mismatch well before the ACTUAL new service worker - a
//               much bigger download that has to fetch, parse, and
//               precache everything - finishes installing, so
//               registration.waiting often wasn't populated yet at the
//               exact moment the toast appeared and got tapped, and
//               applyUpdate() had nothing to act on. appUpdate.js's
//               applyUpdate() now actually WAITS for a real waiting
//               worker to exist (checking every 300ms, up to 20s -
//               comfortably longer than a normal install) before
//               sending skip-waiting, instead of assuming one was
//               already there; only falls back to a plain reload if
//               that genuinely never happens within the wait window
//               (unlike the earlier short-timer version of this
//               fallback, 20s can't be racing a real install that was
//               ever going to finish in time).
//            2. Mobile: the update notice didn't show at all. Added a
//               second, independent trigger for the same toast: the
//               service worker's own authoritative "I found a real
//               waiting update" signal (registerSW's onNeedRefresh,
//               wired through appUpdate.js's new onUpdateAvailable),
//               alongside the existing version.json poll - either one
//               firing shows the notice, so a network/caching quirk
//               affecting one path doesn't leave the user with no
//               notice at all.
export const APP_VERSION = '1.9-112'
