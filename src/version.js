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
export const APP_VERSION = '1.9-37'
