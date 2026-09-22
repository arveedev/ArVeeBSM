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
//   1.9-113 - Fixed a real, reported bug: Admin Dashboard's "Net Bags by
//            Province & Category" table looked unprofessional on a real
//            phone - the Palay column ran close to the row's edge, and
//            the whole table didn't align, since its whitespace-nowrap
//            Province/Rice/Palay columns had no real room next to each
//            other at phone width. Same six-move-method card treatment
//            this page already uses for its Age Grouping breakdown: a
//            plain table at sm+ (unchanged), a per-province card below
//            sm (name on top, Rice/Palay figures below it instead of
//            squeezed beside it).
//   1.9-114 - Likely the REAL root cause behind "Update now" still not
//            working after three straight rounds of client-side fixes:
//            this repo had NO vercel.json at all, meaning every static
//            file - including sw.js itself - was served under Vercel's
//            own default caching. Per the Service Worker spec, a browser
//            is allowed to reuse a cached sw.js for up to 24 hours
//            unless the server explicitly says not to - meaning the
//            browser (or an intermediary) could simply never have
//            fetched the new sw.js at all within that window, no matter
//            what any of the client-side registerType/applyUpdate logic
//            did, since it never even saw the update existed. Added
//            vercel.json with explicit no-cache headers on sw.js,
//            workbox-*.js, registerSW.js, manifest.webmanifest,
//            version.json, and index.html (the files that genuinely
//            need to always be fetched fresh), plus long-lived immutable
//            caching for /assets/* (content-hashed by Vite, safe to
//            cache forever) and an explicit SPA rewrite so this doesn't
//            regress deep-link routing.
//   1.9-115 - Admin Dashboard's Stock Breakdown tab, per explicit
//            request: each warehouse now uses the same boxed-card
//            layout as the Province table above it, and the whole box
//            is tappable (not just a small pill inside it) to open that
//            warehouse's own Overview - same onWarehouseSelect
//            navigation already used elsewhere on this page. The
//            per-category Unwithdrawn button inside each box still
//            opens its own detail modal without triggering the card's
//            navigation (stopPropagation).
//   1.9-116 - Follow-up polish on the Stock Breakdown cards, per direct
//            feedback: the warehouse name is what the user is actually
//            looking for, not the province code - swapped which one is
//            highlighted/larger (warehouse name now bold + text-base,
//            province code now the small de-emphasized part), and
//            bumped the cereal type label and figure text sizes up
//            (figure now text-lg) for better legibility.
//   1.9-117 - Found the real bug behind "Update now does nothing" by
//            reading the actual generated dist/sw.js, not guessing:
//            skipWaiting was correctly gated behind a message listener
//            (registerType: 'prompt' handles that automatically), so
//            tapping the button WAS successfully activating the new
//            service worker every time - but clientsClaim was never
//            configured, so an activated worker never took control of
//            the already-open tab on its own. That meant
//            navigator.serviceWorker.controller never changed for the
//            page still open, so the 'controllerchange' event
//            appUpdate.js's reload logic waits for never fired - the
//            update was silently succeeding in the background on every
//            tap, with nothing ever telling the open page to reload and
//            show it. Added clientsClaim: true to vite.config.js's
//            workbox options - doesn't change WHEN a worker activates
//            (still only the user's own tap), only makes that
//            activation actually take effect on the open tab once it
//            happens.
//            Separate note on mobile still not showing the notice: the
//            previous round's vercel.json no-cache fix only affects
//            requests made AFTER it deployed - a phone that already had
//            an old sw.js response cached before that point keeps using
//            its own cached copy until that entry's original freshness
//            window naturally expires (standard HTTP cache behavior,
//            not fixable retroactively from the server side); a manual
//            hard-refresh once should clear it immediately.
//   1.9-118 - Large batch from direct user feedback after confirming the
//            mobile update flow now works (PC still needing a manual
//            close/reopen is a separate, still-open item):
//            - Bumped text sizes across Home Overview (Stocks + Sacks
//              tabs), the Activity tab's Pending list, Pile List, Settings,
//              and the Admin/Visitor Sacks tab (Province + Warehouse
//              views) - without losing any detail: truncate switched to
//              break-words wherever the underlying text could plausibly
//              be long (names, AI/SIA lines), left as-is (safe to bump)
//              wherever a column had no real overflow risk.
//            - Admin Dashboard > System tab: Verified Correct/Audited/
//              Noted By name+position fields now stack instead of
//              sitting side by side, per direct feedback that they were
//              unreadable on a phone.
//            - Admin Dashboard > Operations > Customers: same broad
//              search + shrink-away animation as Monitoring.
//            - Transaction Types can now be categorized as Receipt,
//              Issuance, or Both (default) - the Receipt/Issuance/WSR/WSI/
//              ESR/ESI picker on every receipt or issuance form now only
//              offers types suited to that direction, instead of the full
//              undifferentiated list, for a cleaner form. A type saved
//              before this change (no appliesTo yet) is treated as 'Both'
//              and keeps showing everywhere. Warehouse Transfer's own
//              picker (WTSForm.jsx) is left unfiltered - a transfer has
//              both an issued and a received side, so it doesn't map onto
//              a single direction.
//   1.9-119 - Per explicit request: Admin Dashboard > Verified Correct now
//            confirms before removing a signatory row, so an accidental
//            tap/click can't silently drop one - a still-blank row (never
//            typed into) skips the confirmation since there's nothing to
//            lose.
//   1.9-120 - Found the real bug behind the still-open PC issue ("Update
//            now" silently does nothing, and the update toast never
//            stops reappearing even after the user is genuinely on the
//            latest version) by reading vite-plugin-pwa's own
//            register.js source: registerSW()'s own returned update
//            function drives the reload through workbox-window's
//            internal, independently-tracked waiting-worker reference,
//            which only gets set if THAT library's own 'waiting' event
//            fired live in this tab - a separate value from the raw
//            registration.waiting this app already polls for. The two
//            can desync (most easily on desktop, where a tab can miss
//            that internal event), making the tap silently call into a
//            stale/empty reference - no reload, no error, and since the
//            update never actually applied, the next check correctly
//            reports the user is still behind. Fixed by never routing
//            through that wrapper again: appUpdate.js now posts the
//            skip-waiting message directly to the real
//            registration.waiting worker (confirmed against dist/sw.js
//            that its message listener accepts exactly this message,
//            since workbox-window sends the identical payload), and
//            reloads via this app's own 'controllerchange' listener
//            instead of relying on workbox-window's internal one.
//   1.9-121 - By Products stock display overhaul on HomeStocks.jsx (the
//            per-warehouse Stocks tab, including WarehouseDetailModal's
//            reuse of it), driven by a long round of reported issues:
//            - Every variety row (and the cereal Total) now shows its
//              bags and net kg in two fixed, aligned columns with the
//              unit named once in a header above, instead of repeating
//              "bags"/"Net Kgs" as inline text on every row - fixes a
//              reported "left side crowded, right side empty" layout
//              complaint.
//            - By Products varieties now show their own Unwithdrawn/
//              Potential figures directly (previously only the category
//              Total ever showed anything there) - root cause found by
//              reading the calculation chain: the per-variety-per-age-
//              bucket unwithdrawn map silently excludes any authority
//              whose ageGroup can't be resolved to a real bucket, and a
//              By Products AI practically never has one, so every
//              By Products variety's per-bucket figure was always empty.
//              Fixed by giving By Products its own flat, non-bucketed
//              unwithdrawn/potential row (the same real per-variety
//              total already powering the category Total), since age
//              bucketing was never a meaningful concept there anyway.
//            - By Products no longer runs any figure through kilos / 50
//              ("net bags") anywhere, on this page or in the unwithdrawn
//              drill-down modal - confirmed via direct request that By
//              Products bags don't have a standard 50kg weight, so that
//              conversion was producing a wrong bag count. The AI's own
//              typed bags/kilos are now what's shown directly.
//            - The drill-down modal's "Bags/Kgs don't match" warning no
//              longer fires for a By Products AI - it was built entirely
//              on the same 50kg-per-bag assumption above, so for By
//              Products it was comparing two numbers that were never
//              expected to agree, a false positive every time.
//            - Modal redesign, from several rounds of direct feedback:
//              each AI's own detail block (variety, warehouse, date, OR
//              No./Note) now always renders in full, full-width, never
//              truncated or dropped on a narrow screen; its Unwithdrawn
//              and Withdrawn figures moved into their own two-column row
//              underneath (previously only ever one or the other showed,
//              switching based on fully-withdrawn state).
//   1.9-122 - Data-integrity fixes to the unwithdrawn/potential math
//            app-wide, driven by a directly reported, confirmed real
//            inconsistency (a card showed "35 unwithdrawn" while that
//            same data's own drill-down modal showed "235"):
//            - Root cause: unwithdrawnStock.js derived "bags" from an
//              AI's own separately-typed bag-count field, which can be
//              left blank or typed as 0 while the kilos field (which the
//              Sheet/form actually enforces) is real - an AI with 0
//              typed bags but real kilos was showing as having NOTHING
//              unwithdrawn on that specific AI, silently dragging a
//              whole variety's or age-bucket's unwithdrawn total down
//              below its true figure. Net kg is now the single source
//              of truth everywhere a bag count is computed in that file
//              (new resolveBags() helper): a typed bag count is only
//              trusted when it's actually present, otherwise every bag
//              figure falls back to kilos / 50 - for every category,
//              including By Products (an estimate derived from a real,
//              always-present figure beats a hard 0 that hides real
//              stock). The "Bags/Kgs don't match" warning is removed
//              entirely (not just for By Products) - it would only ever
//              have been flagging normal bag-weight variance now.
//            - Admin Dashboard > Net Bags by Province & Category: the
//              branch TOTAL is now always exactly the sum of the
//              province rows shown above it - previously recomputed
//              independently from raw branch-wide figures, which could
//              come out LOWER than the rows' own sum whenever one
//              province's potential went negative (more unwithdrawn
//              than actual) and clamped to 0 for display, silently
//              dragging the independently-computed total down by that
//              same now-invisible excess. Confirmed, reported: Albay +
//              Catanduanes Rice not equalling the displayed Total.
//              Same fix, same reasoning already proven correct on this
//              page's own Age Grouping tab.
//            - Admin Dashboard > Stock Breakdown: the Actual/Potential
//              toggle now actually swaps each category's headline
//              figure - it previously always showed the plain actual
//              total regardless of which pill was selected, with
//              potential only ever visible as an easy-to-miss
//              annotation underneath (and only for By Products, since
//              Rice/Palay's own unwithdrawn amount happened to be 0 in
//              the reported case). Its unwithdrawn drill-down also now
//              correctly requests real bag counts for a By Products tap
//              (previously always requested the Rice/Palay net-bags
//              math, even here).
//            - HomeStocks.jsx's own cereal Total card now sums its
//              Potential figure from every row shown above it (same
//              root cause/fix as the Province table) instead of
//              independently recomputing actual-minus-unwithdrawn at
//              the whole-cereal-type level, which could diverge the
//              same way. (Superseded by 1.9-123 below - this approach
//              turned out to be wrong for this specific card; see that
//              entry for why and what replaced it.)
//   1.9-123 - Two more real, reported data-integrity bugs, found by
//            tracing a warehouse whose own per-warehouse Rice Potential
//            (641) disagreed with the SAME warehouse's Rice Potential
//            on the Province-level overview (0):
//            - 1.9-122's own "sum the rows' clamped potential" fix for
//              HomeStocks.jsx's cereal Total (see above) was itself
//              wrong: unlike the Province table (where every warehouse
//              belongs to exactly one province - summing province rows
//              always reconstructs the true total exactly), a cereal
//              Total's age-bucket rows do NOT cover every authority -
//              any AI whose ageGroup can't be resolved to a bucket is
//              structurally excluded from every bucket row by design
//              (computeUnwithdrawnByVarietyAge), so summing bucket rows
//              always undercounts real unwithdrawn stock, independent of
//              whether any bucket even needed clamping. This made the
//              Total's own Unwithdrawn and Potential badges stop adding
//              up to its own Actual figure (confirmed: 971 unwithdrawn +
//              641 potential = 1,612, not the 1,399 actual shown right
//              above them). Reverted to computing Potential once,
//              directly as Actual minus the Total's own (complete)
//              Unwithdrawn figure - the two badges on a Total card must
//              always add back up to the Actual figure beside them.
//            - Real root cause of the 641-vs-0 warehouse/province
//              mismatch: HomeStocks.jsx's own Total Unwithdrawn figure
//              was scoped only to varieties that currently have live
//              pile stock (matching which variety cards render on
//              screen) - an AI authorized against a variety with ZERO
//              current physical stock (fully drawn down, or authorized
//              ahead of ever being received) was silently excluded
//              there, while AdminHomeStocks.jsx's warehouse/province
//              views correctly count every authority in the category
//              regardless of live pile stock. Both now use the same,
//              complete scope - the Total may now show more Unwithdrawn
//              (and less Potential) than the visible variety cards
//              alone would suggest, which is correct: a real
//              commitment against this warehouse's category exists even
//              when there's no matching pile on screen right now to
//              attribute it to.
//   1.9-124 - Admin Dashboard's "Stock Breakdown — Warehouse & Category"
//            section had the exact same 50kg-bag-weight assumption the
//            By Products fixes earlier this session already removed
//            from HomeStocks.jsx and the drill-down modal: its By
//            Products figures were shown as kilos / 50 ("net bags")
//            exactly like Rice/Palay, which never matched the SAME
//            warehouse's own By Products total on HomeStocks.jsx (e.g.
//            Admin showed "2,873.69", HomeStocks correctly showed
//            "3,149" real bags, for the identical warehouse) - confirmed
//            directly from a side-by-side screenshot. By Products now
//            shows its real bag count here too (still converts to MT
//            correctly when that unit is selected, since weight itself
//            is never in question - only the bags-as-kilos/50 shortcut
//            was wrong). Still investigating a separate report that a
//            warehouse's own Rice Potential doesn't match its
//            contribution to the Province-level Potential overview -
//            traced the calculation chain and could not find a
//            remaining structural cause (both now read the exact same
//            underlying figures), so this may already be resolved by
//            the last two versions' fixes - re-verify against this
//            build specifically.
//   1.9-125 - Confirmed, reported real trap: a PC stuck on a build from
//            before 1.9-120's update-mechanism fix could tap "Update
//            now" 50+ times, close/reopen the app repeatedly, and never
//            get anywhere - the code running that tap WAS the broken
//            code, so no future fix could ever arrive through it (the
//            fix only exists in the new bundle the old bundle keeps
//            failing to fetch). That instance needed a one-time manual
//            browser fix (clearing site data). Added an escape hatch so
//            nobody has to do that by hand again: the update toast now
//            has a small secondary "Trouble updating? Force refresh"
//            link beneath the main button - unregisters every service
//            worker and clears every Cache Storage entry for this
//            origin, then reloads with a cache-busting URL. A genuinely
//            clean slate that can't get stuck the same way, regardless
//            of what state the stuck registration/precache was in.
//   1.9-126 - Found the real, structural cause of the Catanduanes Rice
//            mismatch (434.72 potential on the warehouse's own page,
//            0 on the Province overview) - both pages ultimately read
//            the same computeUnwithdrawnByVariety data, but only
//            HomeStocks.jsx resolved each pile's category through
//            `p.variety?.category ?? p.cerealType` (its own established
//            pattern, precisely because a pile's own stored cerealType
//            field can drift from its variety's real category - see
//            that file's own stockGroups comment). AdminHomeStocks.jsx
//            never did this - every category filter on this page (the
//            Province table, Stock Breakdown cards, Age Grouping) read
//            the pile's raw cerealType field directly. A pile whose
//            stored field had drifted was still counted as Rice
//            "actual" on HomeStocks.jsx (which trusts the variety) but
//            silently excluded from this page's own Actual total (which
//            didn't) - while the unwithdrawn side (keyed by variety
//            category, never the pile field) still counted it in full,
//            clamping Potential all the way to 0. Every category filter
//            on this page now resolves through the exact same
//            variety-first fallback chain HomeStocks.jsx already uses.
//   1.9-127 - The Catanduanes mismatch persisted even after 1.9-126, on
//            a confirmed-current build - per direct request, stopped
//            chasing individual discrepancies between two separately-
//            maintained calculations and unified them instead: new
//            warehouseCategoryStock.js is now the ONLY place either
//            page computes "how much Rice/Palay/By Products does
//            warehouse X actually have, and how much of that is
//            unwithdrawn" - built on computePileStockBreakdown, the
//            exact same per-pile function HomeStocks.jsx's own per-
//            warehouse page already calls, so the actual figure is
//            bit-for-bit the same calculation already shown and
//            trusted there, not a second implementation kept in sync by
//            hand. AdminHomeStocks.jsx's Province table and Stock
//            Breakdown section now both sum this shared function's own
//            per-warehouse output - there is exactly one calculation
//            left that could ever disagree with itself.
//   1.9-128 - The Catanduanes mismatch persisted even on 1.9-127 (both
//            the Province table and Stock Breakdown now read the same
//            shared warehouseCategoryStock data, and the warehouse
//            count for that province was independently confirmed
//            correct - Catanduanes genuinely has only one warehouse).
//            Rather than keep guessing at a bug that direct code review
//            can no longer explain, added a temporary, clearly-labeled
//            console diagnostic ('[STOCK DEBUG]') to
//            AdminHomeStocks.jsx, logging the exact per-warehouse
//            figures and the exact Province-row computation from the
//            live data - so the next step is reading real numbers
//            instead of forming another hypothesis to test blind.
//   1.9-129 - The diagnostic paid off: the math was never wrong.
//            Catanduanes province genuinely has THREE registered
//            warehouses (CTD-GID 2, CTD-GID 2 A, CTD-NFAO RM), not one
//            - confirmed directly from the live console output. GID 2
//            alone holds all of the province's physical Rice
//            (1,405.72 net bags), but combined AI authorizations
//            against all three warehouses total 1,907.47 net bags
//            unwithdrawn - genuinely more than physically exists
//            anywhere in the province right now, so Potential
//            correctly clamps to 0. The Province overview was right;
//            it only looked wrong because the Stock Breakdown section
//            hid GID 2 A and NFAO RM entirely (a warehouse - or one
//            category within it - with zero physical stock was
//            filtered out, even when it carried a real, active
//            unwithdrawn commitment), making the province total
//            unexplainable from what was on screen. Both filters (the
//            per-warehouse card, and the per-category row within it)
//            now also show whenever there's real unwithdrawn stock,
//            not only when there's physical stock - so a warehouse
//            authorized ahead of ever receiving anything is visible
//            with its own "0 actual, X unwithdrawn" line instead of
//            disappearing. Removed the temporary [STOCK DEBUG] console
//            logging now that it's served its purpose.
//   1.9-130 - Per explicit correction: NFAO RM is a Ricemill, not a
//            warehouse (the warehouses table already carries a
//            facilityType field precisely for this distinction -
//            NFA-owned Mechanical Dryers and Ricemills follow entirely
//            different rules, they're milling/drying process stops,
//            not warehouse stock). It should never have appeared as
//            its own "warehouse" card, and its outstanding AI
//            shouldn't have been subtracted from Catanduanes' Rice
//            Potential as if it were ordinary warehouse-held stock.
//            AdminHomeStocks.jsx and AdminHomeSacks.jsx now both filter
//            to facilityType 'Warehouse' (the implicit default for
//            every record predating this field) at the very first
//            point warehouses are loaded, so every listing and every
//            province/branch total on both pages only ever considers
//            real warehouses.
//   1.9-131 - Per explicit request: the update toast now behaves
//            differently by platform, since the interactive "Update
//            now" flow is confirmed working reliably on mobile but has
//            kept finding new ways to silently no-op on PC across
//            several real fixes. Mobile (touch devices, same
//            `(pointer: coarse)` check Piles.jsx already uses) keeps
//            the unchanged Update now button. PC instead gets a
//            passive notice naming the actual version available and
//            instructing a manual close/reopen - which always works
//            regardless of any service-worker-level bug, no button to
//            silently fail - with the "Force refresh" escape hatch
//            kept as a small secondary option for the rarer case where
//            a plain restart alone doesn't pick it up (a stale cached
//            copy the browser is still holding onto).
//   1.9-132 - Per explicit request: Admin Dashboard > Stock Breakdown
//            now groups warehouse cards under one province heading
//            each (ALB, then every ALB warehouse; CTD, then every CTD
//            warehouse) instead of repeating the province code inline
//            on every single warehouse card - a cleaner look with the
//            exact same information, matching the Province table's own
//            grouping above it.
//   1.9-133 - Per explicit request: AdminHomeSacks.jsx's own Warehouse
//            tab now uses the identical layout - one province heading
//            above that province's own warehouse cards, each card the
//            same boxed, tappable style as AdminHomeStocks.jsx's Stock
//            Breakdown - instead of a "PROVINCE · Warehouse" pill label
//            repeated per warehouse.
//   1.9-134 - Per explicit request: bumped text sizes across the Home
//            page's Age Grouping tab (Admin Dashboard) - the Total
//            Branch summary tiles, each province/category heading, and
//            the per-warehouse mobile card list (warehouse name, its
//            Total figure, the age-bucket breakdown once expanded, and
//            the section's own Total row) are all a step larger now,
//            without losing any detail.
//   1.9-135 - Admin Monitoring's regional-authority reconciliation box
//            (previously only appeared when picking a number from the
//            dropdown) now also appears from a plain search - whenever
//            every currently matched row shares one regional authority
//            number, that number drives the box exactly as if it had
//            been picked from the dropdown; if the search still spans
//            more than one, there's nothing unambiguous to summarize,
//            so it stays hidden. Per explicit request, it also now
//            shows Remaining (authorized minus issued) alongside
//            Issued, as two stat tiles, instead of only the issued
//            half of the picture.
//   1.9-136 - Redesigned Admin Monitoring's AI/SIA pending row (per
//            explicit direction, picked from a set of demos): details
//            now get the full row width instead of being squeezed
//            beside a narrow figures column, with a compact issued/
//            remaining strip underneath - a large bold issued figure
//            and a smaller amber remaining figure, a thin progress bar
//            between them, then the kg equivalent below (when the
//            record has both bags and kilos) - all sized up per direct
//            follow-up feedback for readability. Bags (or SIA pieces)
//            drives the primary line/bar whenever present, since it's
//            always there for both AI and SIA; a record with only a
//            kilos allocation falls back to kilos as the primary line.
//   1.9-137 - Three more real, reported fixes on the monitoring side:
//            - Admin Monitoring's reconciliation box now also appears
//              from a plain search that doesn't happen to share one
//              regional authority number - it summarizes whatever's
//              currently matched either way, labeled by the shared
//              number when there is one, or by how many distinct
//              authorities matched when there isn't.
//            - Switching tabs on Admin Monitoring now also resets the
//              regional-authority dropdown and the open reconciliation
//              panel, not just the search text - a number picked on one
//              tab almost never exists on another, so leaving it set
//              was silently filtering the new tab down to nothing and
//              reading as a blank/broken tab instead of a leftover
//              filter from the tab just left.
//            - AuthorityMonitor.jsx (the user Home page's own Activity
//              tab pending list) gets the identical row redesign Admin
//              Monitoring's own pending list got last version - it had
//              been missed there.
//   1.9-138 - Fixed a real reported bug: tapping a pile's age on the Pile
//            List to open the Edit Age dialog could render it low/off-
//            position (overlapping the bottom tab bar) instead of
//            centered on screen. EditPileAgeDialog used a plain `fixed`
//            overlay without portaling to document.body, so the page-
//            transition wrapper's transform (animate-page-forward/back)
//            became its containing block instead of the real viewport -
//            the exact issue already documented and fixed this way on
//            every other fixed-overlay modal in the app (ConfirmDialog,
//            CompletedMillingModal, etc). Now portals to document.body
//            like the rest, so it always centers on the true screen.
//   1.9-139 - Pile List card redesign (Home > Piles > Pile List), agreed
//            through several rounds of demos:
//            - No icon - a thin left accent bar colored by the pile's
//              cereal type (Rice=blue, Palay=neon, By Products=amber)
//              instead, matching the existing variety-badge colors.
//            - Age moves to its own bold, color-coded figure on the
//              right of the header row (still tappable to open Edit
//              Age) - color follows a fixed, per-cereal-type gradient
//              scale (green->yellow->amber->red), not a per-warehouse-
//              relative one, so a pile's color reflects its true
//              absolute age tier and stays comparable to every other
//              pile of the same type. Rice/By Products max out (full
//              red) at 6 months, Palay at 24 - their genuinely
//              different shelf lives - see AGE_GRADIENT_MAX_DAYS/
//              ageGradientColor in calculations.js.
//            - One generic newest/oldest gradient legend bar shown once
//              above the whole list (no numbers on it, since the scale
//              differs per cereal type underneath).
//            - Bags/Net Kg are now boxed tiles; tapping either reveals
//              net bags / kg-per-bag-avg stacked underneath, replacing
//              the old always-visible subtext line.
//            - The existing multi-group sack-weight/variety breakdown
//              (chevron-expand for Rice/Palay, always-shown for By
//              Products) is unchanged in behavior, just reskinned to
//              sit inside the new card frame.
//   1.9-140 - Header + avatar system, first pass of the Settings UX
//            redesign agreed through many rounds of demos:
//            - New custom avatar system, per real login user (not
//              Visitors, who get a static default): pick a background
//              (50 solid + 25 gradient, utils/avatarOptions.js),
//              category (5), avatar (20 per category = 100), and an
//              animation (12, index.css's avatar-* keyframes, off by
//              default and skipped entirely under prefers-reduced-
//              motion). Opens via AvatarPickerModal.jsx from either the
//              header avatar or a new "Change Avatar" link on Settings'
//              profile card - saves straight to db.users (no schema
//              bump - same pattern as other optional per-record fields
//              like purity/moistureContent), so it's live everywhere at
//              once, on every device via Dexie Cloud sync.
//            - AppHeader now shows that avatar beside the page title on
//              every page/role (avatar left, title beside it, no
//              subtext except Home's existing "Welcome back" greeting,
//              unchanged). The four right-side controls (sync/KG-MT/
//              theme/logout) now sit inside one shared pill instead of
//              four individually bordered circles - same tap-target
//              sizing as before, just visually grouped. The pill never
//              wraps or shrinks; a long page title wraps onto its own
//              second line instead, so the pill stays pinned to the
//              same top-right spot at the same size on every page.
//            - Settings: Classifier's separate Delete button removed -
//              Edit already shows an editable, clearable input, so
//              Delete was a second control for what's really one
//              action. Auto Age Monitoring gets a small clock icon.
//              The plain-user/Visitor "Sync Status" card is gone,
//              folded into a small pill on the profile card instead
//              (Admin's own diagnostic panel is untouched).
//            - Still to come: the Create/Edit Pile modal and Beginning
//              Balances redesign agreed in the same round of demos -
//              a larger, higher-risk change (it touches live stock
//              data entry) getting its own separate, focused pass
//              rather than being rushed in alongside this one.
//   1.9-141 - Avatar picker refinements, all from real usage of 1.9-140:
//            - Header avatar 32px -> 44px (matches the pill's own
//              height); Settings profile avatar 44px -> 64px, with the
//              redundant "Change Avatar" text link removed (tapping the
//              avatar itself was always the real entry point).
//            - Auto Age Monitoring's description line dropped - the
//              icon + label + toggle state already say what it is.
//            - Avatar picker rebuilt as 3 top-level tabs (Background /
//              Avatar / Animation) instead of one long scroll, with the
//              live preview pinned above the tabs so it's visible on
//              every tab at every scroll position.
//            - Background: 10 named palettes (Red/Orange/Amber/Yellow/
//              Green/Teal/Blue/Indigo/Purple/Pink) x 10 shades each,
//              plus a Neutral row with true black and white - 100 solid
//              swatches total, replacing the old single hue-stepped
//              wall that made every color look like a slightly
//              different version of the same thing. Gradient mode
//              reuses the identical 100-swatch set for a genuinely
//              custom 2-color combo (own Color 1 / Color 2 sub-tabs),
//              not a fixed preset list.
//            - Avatar: 50 faces per category (was 20) x 5 categories =
//              250 total, shown bigger (4 per row instead of 6-7) so
//              they're actually recognizable, with the plain-initials
//              option moved to be the FIRST tile in every category
//              instead of the last.
//            - Animation: rebuilt on distinct motion axes (Bob/Float/
//              Pulse/Spin/Wiggle/Shake/Wave/Bounce/Flip/Zoom/Sparkle/
//              None - see avatarOptions.js/index.css) so each one reads
//              as genuinely different instead of "everything just
//              jiggles the same way" - and the tab itself now shows
//              every option as its own live, currently-playing preview
//              tile instead of a plain text chip, so you can see the
//              motion before picking it.
//   1.9-142 - Create/Edit Pile modal + Beginning Balances rework - the
//            larger, higher-risk piece deliberately deferred from
//            1.9-140/141 since it touches live stock data entry:
//            - Settings' old always-open "Create Pile" tab is gone -
//              replaced by a "+ Create Pile" button (CreateEditPileModal.jsx)
//              that opens a modal with the same fields, grouped into
//              Identity / Quantity / Quality & Dates sections under a
//              hero header that live-previews the pile's own name and
//              a variety pill tinted to its cereal type (same
//              convention as the Pile List's accent bars). Tapping an
//              existing pile in the list below opens the identical
//              modal pre-filled to edit its metadata.
//            - Editing a pile still only ever touches metadata (name/
//              category/variety/purity/dates/condition) - bags/kilos/
//              age stay exclusively owned by Beginning Balances, same
//              as before. Rather than leaving that split implicit,
//              Edit Pile now shows live current stock as a read-only
//              summary with an "Edit balance ->" link that closes the
//              modal and jumps straight into Beginning Balances,
//              already scrolled to and editing that same pile.
//            - Beginning Balances' pile editor gets the same tinted
//              hero header (replacing the old amber alert-style
//              banner - nothing was actually wrong, an alert box
//              shouldn't have implied it was), a red "Remove" on each
//              line that now asks for confirmation before it actually
//              deletes anything, and Sack Condition now grows in
//              beside Sack Weight/MTS in the same row (instead of
//              sitting always-visible-but-disabled) only once a real
//              sack weight is actually picked.
//   1.9-143 - Real bug fixes reported after using 1.9-142 for real:
//            - Preferences' Auto Age Monitoring icon was visibly
//              misaligned with its label (a leftover top-offset tuned
//              for when the row still had a description line under
//              the label, which was already dropped last version) -
//              row now centers properly.
//            - Settings had TWO separate pile lists - PileListSection
//              (metadata edit) and Beginning Balances' own full Piles
//              tab/list (bags/kg edit), both showing the same piles
//              with their own edit affordance. Beginning Balances'
//              Piles tab is no longer shown on Settings at all - it
//              stays exactly as it was for AdminDashboard's own
//              standalone Beginning Balances page (which has no other
//              pile list to duplicate), but Settings now has exactly
//              ONE pile list and reaches balance editing through two
//              modals in sequence: CreateEditPileModal's own "Edit
//              balance ->" closes it and opens the new
//              EditBeginningBalanceModal.jsx for that same pile. Pile-
//              lifecycle actions that only ever lived in the now-gone
//              list (Export BIN Card, Close/Re-open, Delete) moved into
//              a kebab menu on CreateEditPileModal's own header.
//            - Classifier: the pencil now shows a red clear (X) button
//              inside the input once there's text, for faster
//              retyping; switching between the read-only row and the
//              edit row now fades in (animate-fade-in) instead of
//              snapping; and tapping Update/Save morphs the button into
//              a checkmark (the same spring-overshoot pop used
//              elsewhere) for a beat before the row settles back to
//              read-only, instead of vanishing instantly.
//   1.9-144 - More real fixes/requests after using 1.9-143:
//            - Settings restores a Stocks/Sacks tab pair (Create Pile
//              lives only under Stocks) instead of both sections
//              stacked on one page - PileListSection under Stocks now
//              also shows each pile's live Bags/Net Kg as its own pair
//              of stacked tiles (that info used to only exist in the
//              now-removed duplicate list).
//            - CreateEditPileModal/EditBeginningBalanceModal/
//              AvatarPickerModal: header icon row now actually aligns
//              (the kebab menu's wrapper div wasn't a flex/items-center
//              container like its sibling X button), every Close (X)
//              icon is red per house convention (delete already was),
//              the backdrop is darker (bg-black/60 -> /80) and the hero
//              header got an explicit opaque base so page content
//              behind the modal reads much less through it, and the
//              bottom action button now adds the device's own safe-
//              area inset so it doesn't sit flush against a phone's
//              home-indicator zone.
//            - Sacks: Save/Cancel row gets the same shrink-beside-grow
//              animation used elsewhere (Save shrinks via flex-1 as
//              Cancel grows in from zero width) instead of Cancel just
//              appearing/disappearing, and the sack entries list text
//              sizes up (text-sm/text-xs -> text-base/text-sm).
//            - AppHeader: fixed a real mobile bug - the header pill's
//              44px icons left so little room next to the avatar that
//              a single long title word ("Dashboard", "Monitoring")
//              had no space to break at, so it split mid-word
//              ("Dashboa"/"rd"). Pill icons sized to 40px (avatar
//              matches), KG/MT padding tightened, title dropped to
//              text-base - comfortably fits on one line on a real
//              phone now instead of breaking apart.
//   1.9-145 - Another real round of fixes/requests:
//            - Settings: real missing gap between Classifier and the
//              Stocks/Sacks tab pill below it, fixed. Pile List rows
//              drop the redundant "Net Kgs" suffix on the value (the
//              tile's own "NET KG" label already says it), and variety
//              now shares the pile name's row as a colored pill (same
//              cereal-type convention as HomePiles.jsx) instead of a
//              separate plain-text line.
//            - CreateEditPileModal's "Current Stock (live)" restyled to
//              match the same stacked Bags/Net Kg tile card, with
//              "Edit balance ->" as its own full-width button below
//              instead of squeezed inline beside the figures.
//            - AppHeader's KG/MT toggle: the highlight now slides
//              between the two halves (same technique as the app's
//              other tab pairs) instead of each label just snapping
//              its own background on/off in place.
//            - Monitoring and Piles page titles drop their subtitle -
//              title only, per explicit request.
//            - Real bug: tapping Edit on a sack beginning-balance entry
//              scrolled toward the form but landed it partly under the
//              sticky header (missing scrollMarginTop, same class of
//              bug already fixed elsewhere) and never focused a field,
//              so it wasn't obvious anything had happened - both fixed,
//              same treatment applied to the pile balance form too.
//            - AuthorityMonitor (Home's own Activity tab) is no longer
//              collapsible - always shown, per explicit request.
//   1.9-146 - More real fixes after using 1.9-145:
//            - Pile tile values drop the trailing "kg" unit word too
//              (the label already says NET KG) - both PileListSection
//              and CreateEditPileModal's Current Stock tiles. "Edit
//              balance" button loses its trailing arrow.
//            - Real bug: ConfirmDialog used z-[60], LOWER than several
//              modals that open it (AvatarPickerModal z-[70],
//              EditBeginningBalanceModal z-[68], etc.) - since all of
//              these portal to document.body as siblings, the confirm
//              dialog rendered BEHIND whichever modal summoned it,
//              genuinely invisible, not just low-contrast. Raised to
//              z-[105] - now always the topmost layer regardless of
//              what opened it (except CalendarDatePicker's own
//              z-[110], since a date field can live inside a
//              confirmation's own body).
//            - Real bug: EditBeginningBalanceModal's outer wrapper had
//              no background color of its own, letting the backdrop
//              read through at its rounded corners - now has an
//              explicit bg-neutral-900.
//            - CreateEditPileModal and EditBeginningBalanceModal now
//              animate in/out (fade backdrop + pop card, same
//              technique EditPileAgeDialog already used) instead of
//              just appearing/disappearing instantly.
//            - Classifier gets a real Cancel button next to Update
//              (was missing entirely - editing had no way back to the
//              read-only view without saving), reverting to the last
//              saved name.
//   1.9-147 - More real requests after using 1.9-146:
//            - Update-available toast: dropped the "Restarting/Trouble
//              updating? Force refresh" secondary line entirely, per
//              explicit request - "Update now" (or "close and reopen")
//              is the only thing shown now.
//            - CreateEditPileModal/EditBeginningBalanceModal now slide
//              up on entrance and slide down on exit (the app's own
//              existing animate-sheet-slide-up/down, already used for
//              other bottom sheets) instead of the fade+scale pop used
//              last round.
//            - Classifier's edit transition is a real choreographed
//              sequence now, not just a fade: tapping the pencil grows
//              the input in first, then the Update/Cancel row grows in
//              beneath it a beat later (staggered, via a delayed grid-
//              rows transition). Tapping Update shrinks Cancel away
//              while Update grows to fill the row and morphs into a
//              checkmark, holds for a beat, then the whole block
//              collapses back down before the read-only label+pencil
//              row reappears - matching the reverse of the entrance
//              instead of just disappearing.
//   1.9-148 - More real fixes/requests after using 1.9-147:
//            - Home > Piles: tapping a pile's name/variety no longer
//              opens a floating popover (PileActionSheet.jsx, now
//              deleted) - the card itself shrinks right instead, with
//              WSR/WSI/WTS buttons (same colors as before) growing in
//              from the left edge, per explicit request. Tapping the
//              name/variety again, or tapping anywhere else on the
//              page, closes it back down.
//            - HomeStocks' "Total (Palay)"/"Total (Rice)" row drops the
//              cereal type from its own label - the section's own
//              PALAY/RICE header above it (same color) already says
//              it, and repeating it there ate space the row's own
//              figures needed on a narrow phone.
//            - Classifier's entrance/exit animation is rebuilt on the
//              app's own proven animate-flow-down/animate-flow-up-exit
//              pair (already used successfully elsewhere) instead of a
//              hand-rolled grid-template-rows transition that, per
//              direct report, wasn't actually animating at all - just
//              snapping between states.
//   1.9-149 - App-wide "Total" label sweep, per explicit request:
//            every standalone "Total" row/summary label (Home Stocks,
//            Admin Home Stocks, Piles.jsx's pile-layout box popup,
//            RicemillRecoveryDetail, the Pile Layout PDF export's
//            "TOTAL Bags"/"TOTAL Net Kg" fields) now reads "TOTAL" -
//            left alone where "Total" is part of an actual field name
//            rather than a summary label (e.g. RicemillAllocationsPanel's
//            "Total Net Kgs Authorized" input).
//            HomeStocks' own per-cereal Total row (Rice/Palay/By
//            Products) gets a real responsive fix too, not just the
//            label: on a narrow phone its own (larger, summed) Bags/
//            Net Kg figures were genuinely cramped in the same fixed-
//            width columns the smaller per-variety rows above it fit
//            fine in - below the sm breakpoint it now stacks into a
//            label + a pair of tiles instead, matching the same Bags/
//            Net Kg tile convention already used on Pile List/Settings.
//   1.9-150 - Missed spot from the redundant-unit-word fix: Home >
//            Piles' own Net Kg tile still showed a trailing "kg" under
//            its own "NET KG" label (the same fix had already landed
//            on Settings' pile tiles, just not this page's).
//   1.9-151 - Home Stocks' own per-variety rows (PDm/PDs etc, inside
//            each cereal's card) now get the same responsive card
//            treatment as their TOTAL row below - name on its own
//            line, Bags/Net Kg as a tile pair, below the sm
//            breakpoint - per explicit request ("looks better and more
//            readable at a glance"). sm+ keeps the original shared
//            grid (still aligned with the age-bucket/unwithdrawn rows
//            below it, which stay grid-based at every width - they're
//            secondary, on-demand detail behind the expand arrow).
//   1.9-152 - Home Stocks' per-variety age-group breakdown now resets
//            (collapses) the moment its tab stops being the visible
//            one - it stays mounted (not unmounted) when switching to
//            the Activity page-tab or the Sacks inventory tab, per the
//            app's own established stay-mounted-avoid-flash pattern,
//            so an expanded breakdown was silently still expanded on
//            return. Navigating to a different PAGE already resets it
//            for free (App.jsx remounts the whole route on pathname
//            change), so this only needed handling for same-page tab
//            switches.
//   1.9-153 - Settings' Beginning Balances section: sack entries now
//            use the same card style as PileListSection's own pile
//            rows (name/actions up top, a Pieces tile below) instead
//            of a single plain text line, per explicit request. Also
//            added a "Beginning Balances" heading above the Stocks/
//            Sacks tab pill, which previously had no label of its own
//            identifying the section.
//   1.9-154 - Real gap found: Settings' pile cards (Stocks tab) had no
//            Delete at all - it only lived one tap deeper, inside
//            CreateEditPileModal's own kebab menu. Added a Delete icon
//            directly on each card (next to Edit), always gated behind
//            a real confirmation first (same "does it have real
//            transactions beyond its beginning balance" check and
//            ConfirmDialog already used everywhere else a pile can be
//            deleted from) - never a one-tap delete.
//   1.9-155 - Font sizes bumped throughout the Beginning Balances area,
//            per explicit request: both Stocks/Sacks tab pill labels,
//            Settings' pile cards (Stocks tab), SacksBeginningBalances'
//            list, and the shared PileBalanceForm (Age/Date/Bags/Net
//            Kilos/Condition/Sack Weight-Condition/Purity/MC fields,
//            used by both EditBeginningBalanceModal and AdminDashboard's
//            own standalone Beginning Balances page) - plus
//            CreateEditPileModal's own Identity/Quantity/Quality & Dates
//            fields and Current Stock tiles. A local, larger label/input
//            class is used in these specific spots rather than bumping
//            the shared labelClass/inputClass constants app-wide, so
//            unrelated admin panels (Warehouses, Users, etc.) keep their
//            existing sizing.
//   1.9-156 - Real bug found: v1.9-155's Edit Balance modal input bump
//            used `text-base`, but inputClass sets no font-size of its
//            own - inputs already rendered at that same ~1rem size by
//            inheritance, so the "bump" was a no-op nobody could see.
//            Switched to `text-lg` (PileBalanceForm/CreateEditPileModal)
//            for a size that's actually bigger. Also, per explicit
//            request: every sliding-pill/underline tab group app-wide
//            (Home, Reports, Settings, Piles, AdminDashboard and its
//            sub-panels, AuthorityMonitor, MillingMonitor, Beginning
//            Balances, the Rice/Palay/By Products cereal tabs on
//            Stock forms, Avatar picker's tabs) got a larger font size
//            and the active tab now renders bold (font-bold/extrabold)
//            while the inactive one keeps its previous, lighter weight -
//            previously every tab used the same static weight regardless
//            of which was selected.
//   1.9-157 - Font sizes bumped throughout MillingMonitor.jsx, per
//            explicit request: the Milling/Test Milling pending list
//            rows (MillingOrderRow - number, ricemill name, trial
//            progress labels) and the detail modal opened by tapping an
//            MO/TMO number (header, Batch/Receiving Warehouse tiles,
//            Show more details section, Issued/Received tiles, Recovery
//            comparison, and the Stocks/Sacks transaction rows). Also
//            fixed a real redundancy: the per-transaction "Net Kgs"
//            tile's value repeated "Net Kgs" in the text itself (via
//            fmtWeight's 'Net' label param) directly under a label that
//            already says "Net Kgs" - now shows just the bare figure.
//   1.9-158 - Bottom nav (BottomNav.jsx's NavItem) now bolds whichever
//            page the user is currently on, matching the same active/
//            inactive weight distinction every other tab group in the
//            app already got - previously every label used the same
//            static weight regardless of which page was active. Its
//            label text size was also bumped a step, same as the rest.
//   1.9-159 - Redesigned the AI/SIA action menu and the View Transactions
//            ledger it opens into, per explicit request and several
//            rounds of demo review:
//            - ChoiceAuthorityModal (Add New Transaction/View
//              Transactions) now leads with a tinted hero band showing
//              the AI/SIA number prominently (blue for AI, amber for
//              SIA, same convention as CreateEditPileModal's own
//              category tint) instead of a small centered line, and
//              every button/label got a larger font.
//            - AuthorityReconciliationPanel (View Transactions) carries
//              the same hero band, adds a Net Kg/Net Bags toggle for AI
//              (kilos/50, same conversion MillingMonitor.jsx already
//              uses), switched every row to the established card style
//              (stacked Bags/Net-figure tiles), stopped truncating the
//              customer name, added the transaction's warehouse name
//              (previously missing entirely), sorts newest-first by
//              date (was ascending by serial number), and turned the
//              total into its own neon-bordered card instead of a bare
//              footer bar, with its own bottom padding respecting the
//              device's safe-area inset.
//            - AppHeader's title/subtitle now animate on every page
//              change instead of swapping instantly, sliding in the
//              direction the new page actually sits relative to the old
//              one (same left-to-right order as the bottom nav's own
//              REGULAR_NAV_COLUMN) - title and subtitle move as one
//              block, so a subtitle appearing/disappearing (e.g. Home's
//              "Welcome back" vs a page with none) is part of that same
//              motion rather than a separate effect.
//   1.9-160 - AuthorityReconciliationPanel's Total card renamed to
//            Issued and made tappable, per explicit request: tapping it
//            grows the card to reveal a Remaining figure below (the
//            authority's own authorized allocation minus what this
//            ledger shows as issued - AI reads its flat allocation
//            fields, SIA sums whichever sackLines actually carry one,
//            same "hasAllocation" check AuthorityMonitor's own
//            handleOpen already uses; shows "—" when no allocation is
//            on file at all rather than a misleading zero). Tapping the
//            card again, tapping elsewhere in the ledger, or closing the
//            whole panel collapses/discards it. Same proven
//            animate-flow-down/flow-up-exit + useDelayedUnmount pairing
//            used throughout the app for this kind of grow/shrink.
//   1.9-161 - Real bugs found in v1.9-160's Issued/Remaining expand:
//            (1) the animation wasn't smooth - the mount/unmount +
//            animate-flow-down/up-exit pairing only animates the
//            CONTENT's opacity/translate, not the card's own height, so
//            the surrounding box snapped to its new size instantly
//            while the text faded inside it. Switched to a permanently-
//            mounted block with maxHeight+opacity both animated via
//            inline style (same technique as Classifier's Cancel button
//            and the Sack Condition column), so the card genuinely
//            grows/shrinks smoothly. (2) tapping away didn't collapse
//            it, only closing/reopening the whole panel did - the
//            scoped absolutely-positioned overlay only covered the
//            ledger list, not the hero header or the card itself.
//            Replaced with a real click-outside listener (same pattern
//            already used by Settings.jsx's ClassifierSection), which
//            correctly collapses on a tap anywhere outside the card.
//   1.9-162 - Real bug found: the reconciliation ledger's bottom Issued
//            card + its own padding/gaps had grown heavy enough
//            (reported directly - "so much space at the bottom, not
//            enough viewing area for the list") to noticeably eat into
//            the scrollable list's on-screen room. Tightened the
//            card's own padding/gaps (p-3->p-2.5, py-2->py-1.5,
//            mt-2->mt-1.5) and its outer wrapper's top/bottom padding,
//            plus reduced the ledger's own trailing pb-8 to pb-3
//            (dead space at the end of a short list) - same figures
//            shown, just a smaller footprint.
//   1.9-163 - Real root cause found for v1.9-162's still-reported "huge
//            dead space at the bottom": the Issued/Remaining card was a
//            flex-col CHILD of the panel's own "fixed inset-0 flex
//            flex-col" container - on at least one real device/browser
//            that container rendered shorter than the true viewport
//            (a known class of mobile quirk), leaving a large gap
//            between the footer and the actual screen edge with the
//            page behind (same dark background) showing through it.
//            Restructured to match TransactionFormBase.jsx's own
//            proven pattern for exactly this situation: the card is now
//            an INDEPENDENTLY fixed-to-viewport sibling
//            (`fixed inset-x-0 bottom-0`), not a flex-col child, with
//            the scrollable ledger given generous bottom padding
//            (pb-40) so its last row doesn't render hidden underneath.
//   1.9-164 - Actual root cause found (v1.9-163's restructure alone
//            didn't fix it - confirmed the bug was mobile-only, desktop
//            fine, and other full-screen forms' own Save bars were
//            unaffected): AuthorityReconciliationPanel was the one
//            full-screen modal in the app missing the body-scroll lock
//            every other one already has (UnwithdrawnDetailModal.jsx's
//            identical effect, App.jsx's own for transaction forms,
//            etc.) - the page behind it stayed technically scrollable
//            even though visually covered. On mobile specifically, a
//            still-scrollable body behind a `fixed` overlay is what
//            desyncs the browser's own address-bar/toolbar show-hide
//            viewport recalculation from the overlay's fixed elements -
//            exactly the reported "dead space below the Issued card,
//            only on phones, not PC". Added the same lock, and
//            proactively added it to CompletedAuthorityModal.jsx and
//            CompletedMillingModal.jsx too, which share the identical
//            full-screen structure and were missing it for the same
//            reason.
//   1.9-165 - Real root cause found (reported directly - on PC the
//            Issued card grew upward/shrank downward as expected, but
//            on mobile it grew DOWNWARD (past the true screen bottom)
//            and shrank upward, which is exactly what left dead space
//            below it): animating a `position:fixed` element's height
//            via a nested maxHeight transition is a known class of
//            mobile-browser quirk - the fixed box isn't reliably
//            recomputed every frame the way it is on desktop, so it
//            can visibly anchor from the wrong edge. Replaced `fixed
//            inset-x-0 bottom-0` with `sticky bottom-0` inside the
//            ledger's own scrollable container - a sticky element is
//            normal in-flow (just pinned to its scroll container's
//            edge once it would scroll out of view), so its height
//            animates exactly like any other element always would, with
//            no viewport-relative math involved at all.
//   1.9-166 - v1.9-165's sticky-positioning fix still showed the same
//            symptom (reported directly, same wording as before): grows
//            downward on mobile, upward on PC. Since sticky positioning
//            itself is identical across browsers, the real mechanism is
//            almost certainly Chrome's scroll-anchoring feature, applied
//            more aggressively on mobile - it silently adjusts the
//            scroll offset to keep the view visually stable whenever
//            content resizes, which would compensate for the card's
//            real upward growth by scrolling the list down the same
//            amount, cancelling it out and making it read as downward
//            growth instead. Added `overflow-anchor: none` to the
//            ledger's scroll container and the sticky card itself to
//            disable that silent compensation.
//   1.9-167 - A screen recording finally pinned down the actual bug
//            (thank you): the Issued card's FINAL resting state was
//            fine, but the animation itself briefly overflowed past the
//            screen edge mid-transition on mobile - animating a
//            position:sticky element's own box height via a nested
//            maxHeight transition doesn't reliably recompute the
//            sticky offset every frame on some mobile browsers, so it
//            can briefly overshoot before settling. Root fix: the
//            sticky Issued wrapper's own height no longer changes AT
//            ALL. Remaining is now a separate, absolutely-positioned
//            overlay (bottom-full, positioned against the sticky
//            wrapper itself, which sticky already qualifies as a
//            containing block for) that slides up from behind the
//            Issued button via transform/opacity only - nothing here
//            can ever trigger that height-driven mobile recalculation
//            bug again, since no box's height is ever animated.
//            Also fixed, reported directly: tapping the header's Net
//            Kg/Net Bags toggle was being treated as an outside click
//            and immediately collapsing Remaining - excluded that
//            toggle's own container from the click-outside check.
//   1.9-168 - Removed the chevron icon from the Issued card, per
//            explicit request - the card's own tap-to-expand affordance
//            speaks for itself without it.
//   1.9-169 - Real performance bugs found and fixed, per reported
//            slowness looking up serial numbers and a freeze after
//            saving/updating/deleting a transaction:
//            - `isSerialTaken`, `getMatchingTransaction`,
//              `findTransactionBySerial`, and `recalculateSerialCounter`
//              (src/utils/serialNumber.js) all scanned every transaction
//              of that TYPE across EVERY warehouse in plain JS instead
//              of using the existing `[type+warehouseId+serialNo]`
//              compound index - suggestNextSerial was already fixed
//              this way earlier; these four weren't. checkAndLoadSerial
//              (which runs on every keystroke AND right after every
//              save, to advance to the next serial) calls
//              findTransactionBySerial up to 3 times, which is exactly
//              what made typing a serial feel slow and what kept the
//              UI locked for "a while" after the success toast already
//              showed - the toast fires before this chain, which was
//              running an unindexed app-wide scan underneath it.
//            - StockFormBase.jsx/SackFormBase.jsx's MO/TMO pickers
//              (used when starting a new transaction, e.g. entering a
//              By Products receipt for a completed milling run) were
//              filtering out any order where `o.fulfilled` was true -
//              an auto-computed "looks done" kg/piece/trial-count
//              signal meant only as an admin double-check hint on
//              MillingMonitor.jsx's own list (see that file's own
//              needsConfirmation comment), never a real completion
//              signal. This silently hid a TMO from the picker the
//              moment all 3 trials had a receipt, even though nobody
//              had manually marked it complete - reported directly.
//              Switched all four picker filters (MO/TMO in both forms)
//              to gate on manuallyCompleted/sheetStatus only, per
//              explicit request: "the user should just mark complete
//              the MO/TMO for it to be excluded in the selection."
//   1.9-170 - Rebuilt the Save/Update/Delete button animations in
//            AnimatedButtonBits.jsx (shared by StockFormBase, SackFormBase,
//            WTSForm), per several rounds of demo review:
//            - Save now owns its full `<button>` (new SaveButton
//              component, not just inner content) - outline when
//              disabled, solid filled when enabled (matching Update's
//              look), with a one-shot neon pulse-ring the moment it
//              BECOMES enabled (save-enable-pulse, index.css). Tapping
//              it shrinks the whole button to a small circle with a
//              genuinely centered spinner inside (real bug fixed: the
//              old checkmark was `absolute` with no centering offsets,
//              so it sat off to one side, not the middle), then a
//              centered check, then expands back.
//            - Delete keeps its existing tap flourish (shake + dust,
//              before the confirm dialog opens) but its post-confirm
//              completion signal is now spinner -> a two-part animated
//              bin icon (lid flips open, body gives a small drop
//              bounce as it shuts - delete-bin-lid/delete-bin-drop in
//              index.css) - never a checkmark, per explicit request.
//              The button itself never shrinks or disappears through
//              any of this.
//            - Real timing bug fixed: handleDeleteConfirmed (all three
//              forms) called resetToBlankEntry/resetForm immediately
//              after a successful delete, which clears loadedTransaction
//              and instantly swaps the whole Update/Delete row for the
//              plain Save button - unmounting DeleteButtonLabel before
//              its own completion animation ever got a frame. Now
//              isSaving flips false right away (so the animation
//              starts) but the actual view switch is deferred by
//              DELETE_ANIM_MS (1000ms, matching the bin animation's own
//              hold time) via a new `deleteCompleting` flag that also
//              keeps both buttons disabled through that window, so a
//              second tap can't re-trigger against an already-deleted
//              record.
//   1.9-171 - Several real bugs found and fixed, plus a PC-only entry-form
//            redesign, per direct field report:
//            1. Save's required-fields gate used OR instead of AND for
//               Bags/Gross Kilos - clearing Gross Kilos back out after
//               Bags was already filled left Save wrongly still enabled.
//               Fixed to require both, matching WTSForm's own check.
//            2. The Customer Name field's auto-detect-exact-match path
//               only back-filled the side fields (Address/RSBSA/Gender)
//               via onMatch, never called onChange - so typing a known
//               ALIAS directly (no dropdown click) saved the alias text
//               itself to the transaction and Sheet backup instead of
//               the real customer name. The dropdown-click path already
//               did both calls correctly; the typed-alias path now
//               matches it.
//            3. Changing a transaction's Pile unconditionally cleared
//               MTS (sack weight/condition) even between two piles of
//               the SAME variety - now only clears it when the pile
//               change actually implies a different variety.
//            4. Forward serial navigation ("<" / ">") now turns into a
//               "+" button when the immediate next serial is a genuine
//               gap (free, with real data further ahead) - jumps
//               straight into that gap instead of walking past it to
//               the next real document. Also, right after a Save, if
//               the auto-suggested next serial collides with a REAL
//               document, the form now skips forward to the actual next
//               genuinely free serial instead of silently loading a
//               stranger's record for editing. Applied to StockFormBase
//               (WSR/WSI), SackFormBase (ESR/ESI), and WTSForm alike.
//            5. Notifications (toasts) are now wider with larger text on
//               PC only - unchanged on mobile.
//            6. Login's PIN can now be typed with a physical keyboard on
//               PC (digits, Backspace, Escape) - additive to the
//               existing on-screen keypad, which still works everywhere.
//            7. New PC-only entry-form layout, per several rounds of
//               demo review - mobile is completely unchanged. Fields
//               flow into two columns (CSS multi-column, auto-balancing
//               the form's existing deeply-conditional field order
//               rather than hand-splitting it) with a subtle alternating
//               background tint grouping each field block, no header/
//               title text anywhere - the look picked after comparing
//               several titled and untitled variants. On StockFormBase
//               (WSR/WSI/ESR/ESI) only, a live "Pile now" sidebar grows
//               in from the side once a pile is selected, showing that
//               pile's current Bags/Net Kg while the field columns
//               narrow to make room - the header (Warehouse/cereal tabs/
//               Close) and the Save bar both stay completely fixed
//               throughout. SackFormBase and WTSForm get the same
//               tint/column treatment without the sidebar (SackFormBase
//               has no Pile ID field at all; WTSForm has two pile
//               sections, issued and received, which the sidebar
//               concept doesn't map onto and hasn't been designed for).
//   1.9-172 - Follow-up fixes from live use of 1.9-171, per direct report:
//            1. A sync push that failed once (dropped connection, cold
//               Apps Script start) but succeeded on the NEXT automatic
//               retry still showed a "failed to sync" toast, even though
//               the record was already correctly on the Sheet by the
//               time it was checked - needlessly alarming. Every push
//               (and the queued-deletion replay) now gets one immediate
//               inline retry before it's ever counted as failed or
//               toasted, so only a genuinely persistent failure surfaces.
//            2. Real bug in the post-save auto-advance (all three forms):
//               it jumped straight to suggestNextSerial's "recency-best"
//               guess instead of trying the very next serial first -
//               reported with a concrete example (saving #11760188 with
//               #11760189 still open should land there, not on some
//               unrelated "latest" number). Now always tries the plain
//               immediate next serial first; only falls back to the
//               date-aware "latest series" guess when that immediate
//               next serial turns out to already have real data (e.g.
//               saving #11760190 right before #11760191, which is taken -
//               never shown as if it were blank).
//            3. The PC two-column field-group layout from 1.9-171 was
//               genuinely broken on real data, confirmed via screenshots:
//               CSS multi-column balances by total HEIGHT, not by row,
//               so unrelated groups ended up scattered next to each
//               other with nothing aligned. Replaced with a real CSS
//               Grid using grid-auto-flow: column (an explicit row count
//               measured live from the rendered DOM, since this deeply-
//               conditional field list has no JS array to take a .length
//               from) - groups now fill straight down the left column
//               first, then the right one (reading/tab order 1,3,2,4 for
//               4 groups, per explicit follow-up), each row genuinely
//               row-aligned, and no group can ever be split across the
//               column break. Added a subtle vertical rule down the
//               center, per explicit request.
//            4. Keyboard accessibility, per explicit request: every
//               input/select across the entry forms now shows a real
//               glow ring on focus (not just a border-color change), Tab
//               moving focus anywhere in the form now smooth-scrolls
//               that field to the vertical center of the screen, and
//               tapping Save/Update while something required is missing
//               now focuses (and centers) the actual first offending
//               field instead of only showing a toast - reusing the
//               `!border-brand-amber` class every required field already
//               gets when empty/invalid, rather than threading a ref
//               through nearly every field in three very large forms.
//   1.9-173 - Rebuilt the PC field-group layout again, after live
//            screenshots showed 1.9-172's version was still wrong: a
//            tint per already-existing single/paired-field div (Date
//            alone, MC+MTS alone, etc.) looked scattered rather than
//            grouped, even once row-aligned - "very ugly, very wrong
//            grouping" per direct feedback. Redesigned into four real
//            semantic groups instead - Document, Customer, Stock
//            Details, Quantity (WSR/WSI/ESR/ESI - grouped by relevance,
//            matching an earlier approved reference mockup; WTSForm
//            uses a smaller Document/Details split alongside its two
//            already color-coded Issued/Received cards, which don't
//            need a generic tint layered on top of their own accent
//            borders) - each one flat tinted box, same tint on every
//            box, no title text. Every field stayed in its exact
//            original DOM position - only wrapper <div>s were added
//            around each existing contiguous run, nothing was cut or
//            reordered, to avoid touching this file's extensive
//            conditional business logic. Two more follow-ups from the
//            same round of feedback: (1) the notification redesign
//            settled on "C + glow" - the whole toast card tinted its
//            own type color (not just a thin left border) with a soft
//            glow-ring shadow around it, title text in that same color.
//            (2) The live "Pile now" sidebar (StockFormBase only) now
//            shows a card per pile on a multi-pile WSI (the primary
//            pile plus every "Issue from another pile" addition that
//            has a pile selected yet), each with its own accent color
//            so they read as genuinely separate piles - no combined
//            total card, per explicit request.
//   1.9-174 - Fixed a real, reported bug on Login: typing a PIN with a
//            physical keyboard on PC entered every digit TWICE (one "0"
//            press showed two dots filled). Root cause: 1.9's PIN-
//            keyboard feature added a separate document-level keydown
//            listener that called its own appendDigit - on top of the
//            hidden type="number" input this page already had, wired to
//            the exact same PIN state, and normally focused. Every
//            physical keypress fired both paths at once. There was
//            never a missing feature to add - the hidden input already
//            handled physical-keyboard entry; the real gap (the one the
//            original report was actually about) was that clicking an
//            on-screen keypad button steals focus away from that hidden
//            input, so typing stopped working until clicking back in
//            manually. Removed the duplicate listener entirely and
//            fixed the actual gap instead: the hidden input now
//            refocuses itself (PC only) whenever it loses focus, so
//            physical typing keeps routing through the one real handler
//            no matter what was just clicked.
//   1.9-175 - Two more layout fixes from the same round of live feedback,
//            reported directly with real screenshots:
//            1. The four-group layout (1.9-173) still looked wrong: a
//               shared CSS Grid row (grid-auto-flow: column) forced two
//               groups in the same row to match height - Document (two
//               single fields) sat far shorter than its row partner
//               Stock Details (several paired fields), leaving a dead
//               empty gap below it before the next row started.
//               Rebuilt as two INDEPENDENT flex columns instead of a
//               shared-row grid - each column just stacks its own two
//               groups tightly with its own natural height, no gaps.
//               The four groups (WSR/WSI/ESR/ESI) or two groups (WTS)
//               are now built once as local consts and composed in
//               whichever visual order each screen width calls for,
//               instead of relying on a measured DOM row count.
//            2. The two-column layout was gated on isTouchDevicePointer
//               (pointer: coarse) - a mouse-driven PC with a genuinely
//               narrow/resized window still got the cramped two-column
//               layout meant for a wide screen, and the reverse for a
//               touch device at a wide width. Per explicit correction
//               ("it should adjust the layout by screen size, not by
//               actual device"), replaced with a live screen-width
//               match (useIsWideLayout, shared.js) that updates as the
//               window actually resizes - applies to the field-group
//               layout and the live "Pile now" sidebar on all three
//               entry forms.
//   1.9-176 - Three more follow-up fixes from the same round of live
//            feedback:
//            1. Removed the "Locked to this pile's variety..." subtext
//               under Variety Type - reported as adding to the
//               misaligned feel between the Pile ID/Variety row and the
//               row below it, since it made that box taller than its
//               row-mates for no functional reason.
//            2. The live "Pile now" sidebar's per-pile cards were
//               shrunk down to small side-by-side stat rows during the
//               multi-pile-accent rework - reported as "looks very
//               small." Restored the original large, centered, stacked
//               Bags/Net Kg tiles per pile, just with each pile's own
//               accent border and name label layered on top.
//            3. Real bug found in the notification "C + glow" redesign:
//               the card's tint was a low-alpha color with nothing
//               opaque behind it, so the actual page showed straight
//               through - reported directly ("why is it transparent").
//               Fixed with a two-layer background (an opaque dark base
//               UNDER a ~75% accent wash, per explicit request) so the
//               card can never show the page through it again, while
//               still reading as strongly tinted. Text/icon switched to
//               white for contrast against the now much more saturated
//               background.
//   1.9-177 - Follow-up correction to 1.9-176's notification fix,
//            reported directly: the opaque-base fix went too far the
//            other way - the card was now "too opaque" and the glow
//            shadow no longer read as visible against it. Rebuilt as a
//            genuine frosted-glass card: backdropFilter blurs whatever
//            is actually behind the toast (so it can never look like a
//            sharp see-through window onto the page again) while the
//            card's own fill is a real translucent tint (not opaque),
//            and the glow shadow is stronger/wider so it stays clearly
//            visible against that lighter fill.
//   1.9-178 - Compacted the Quantity group on WSR/WSI/ESR/ESI, per
//            explicit request, on both mobile and PC: Auto-compute Net
//            Kilos and Net Kilos now sit side by side in one row
//            (the toggle switched to the same label-above treatment
//            every other field here uses, instead of its old label-
//            left/switch-right bar, so it reads consistently next to
//            Net Kilos); Age, Unit, and Condition now sit in one row
//            too (Condition's 5 flag buttons narrowed to fit). The rare
//            Months + Days age mode still gets its own short row above
//            for the extra Months/Days fields, since that mode needs
//            two number inputs instead of one. Cancelled was already
//            rendered outside every group box (it sits after Farmers
//            Organization, right before the Save bar) - confirmed
//            unchanged, no group tint or border wraps it.
//   1.9-179 - Follow-up correction to 1.9-178's compacting, reported
//            directly as "ugly": Auto-compute Net Kilos, Net Kilos,
//            Age, and Unit are now together on ONE shared row (4
//            columns) instead of two separate two-column rows.
//            Condition moved back to its own full-width row below,
//            with its 5 flag buttons restored to their original
//            comfortable size (no longer squeezed to fit alongside Age/
//            Unit). Months + Days mode still gets its own short row
//            above for the extra Months/Days fields, and the shared row
//            drops to 3 columns in that case (Age's slot isn't needed).
//   1.9-180 - More compacting, per explicit follow-up request:
//            1. StockFormBase (WSR/WSI/ESR/ESI): the Auto-compute Net
//               Kilos toggle's own label text was removed (the switch
//               alone is self-explanatory next to the field it
//               controls) - an invisible same-height placeholder keeps
//               its cell's toggle still lined up with its label-having
//               neighbors. Its column is now sized narrower than Net
//               Kilos's (1:2 ratio via an explicit column-width grid
//               instead of an even split), so Net Kilos genuinely reads
//               as the bigger, more important field. "MTS — Sack Code &
//               Condition" shortened to just "MTS" everywhere it
//               appears. The "Additional pile" (Issue from another
//               pile) card gets the same treatment: MC%/MTS now sit
//               side by side (used to be stacked only because the old,
//               longer MTS label wrapped to two lines and broke
//               alignment there - moot now that it's just "MTS"), and
//               its own Auto-compute/Net Kilos pair compacted the same
//               1:2 way.
//            2. SackFormBase (ESR/ESI): reduced from four groups to
//               three. The old separate Stock Details group (MO/TMO
//               fields) was usually completely empty - only Milling/
//               Test Milling transaction types populate it - and
//               rendered as a big blank box; folded into Customer
//               instead, since there's nothing else it belongs with.
//               Document (Date + linked doc) now renders as its own
//               full-width row above the other two groups, on both
//               mobile and PC, instead of sharing a column with either.
//   1.9-181 - More follow-up fixes on StockFormBase (WSR/WSI/ESR/ESI),
//            per direct feedback:
//            1. The Auto-compute Net Kilos toggle no longer sits inside
//               its own bordered/filled box - it's a bare switch now,
//               per explicit request ("remove the background of the
//               toggle, let it just be a toggle").
//            2. The Toggle+Net Kilos row now shares the exact same
//               column width as Number of Bags above it, and Age+Unit
//               share Gross Kilos's column width - the row below now
//               genuinely lines up with the row above instead of using
//               a different split. Applied to both the primary pile
//               section and the "Issue from another pile" card.
//            3. The "Issue from another pile" card now has its own
//               distinct amber tint/border (upgrading to neon once a
//               pile is actually picked), so it visually stands apart
//               from the plain tint every other group box uses, per
//               explicit request.
//   1.9-182 - Dashboard/overview fixes, per direct feedback with real
//            screenshots:
//            1. Real bug fixed: the Warehouse Inventory stock overview's
//               TOTAL row (HomeStocks.jsx) renders its bags/net-kg
//               figures a size step bigger than a normal row - a real
//               total like "1,420,438.540" didn't fit the old fixed
//               116px column at that larger size and visibly overflowed
//               into the bags column next to it, reading as one
//               concatenated number ("24,1931,420,438.540"). Widened
//               the shared grid's two number columns - this grid only
//               ever applies from the `sm:` breakpoint up, so this
//               never affects a phone.
//            2. Real bug fixed: two admin warehouse-card lists
//               (AdminHomeSacks.jsx, AdminHomeStocks.jsx) render as a
//               flat, muddy gray box in light mode instead of the same
//               soft light-gray tone every other card gets - both use
//               Tailwind's opacity-suffixed bg-neutral-950/50, which
//               compiles to its own distinct CSS class that the light-
//               mode override system never covered (only the plain,
//               opacity-free class name was mapped). Added the missing
//               override.
//            3. Sack Pieces (AdminHomeSacks.jsx), large screens only:
//               provinces now sit side by side instead of one long
//               vertical list, same for per-province warehouse cards on
//               the Warehouse tab; each card's own sack types now flow
//               into a small grid instead of a single stacked column;
//               warehouse names are now accent-colored for at-a-glance
//               scanning. Mobile is completely unaffected (all gated on
//               the `lg:` breakpoint).
//            4. Age Grouping table (AdminHomeStocks.jsx), large screens
//               only: per-warehouse row figures bumped up a size step to
//               visually match the TOTAL row below them - both actually
//               shared the same size before (only font-weight differed),
//               reported as the rows reading noticeably smaller.
//   1.9-183 - Follow-up fixes from the same round, reported directly
//            with more screenshots:
//            1. Real bug fixed: two new responsive/opacity Tailwind
//               classes introduced in 1.9-182 (lg:bg-neutral-950,
//               bg-neutral-950/60) had no light-mode override - this
//               theming system only maps plain, non-variant class
//               names, so anything with a breakpoint prefix or opacity
//               suffix silently falls through as a near-black box in
//               light mode. Added the missing bg-neutral-950/60
//               mapping; the lg: variant is moot now (see #2).
//            2. Real bug fixed: the per-warehouse Sack Pieces card
//               (Warehouse tab) is already narrower than the Province
//               card, since several sit side by side - cramming its
//               sack types into 2 columns wrapped labels/values onto
//               multiple lines. Reverted to single column there; the
//               2-column treatment stays on the wider Province card.
//            3. Real bug fixed: confining each province to its own
//               2-column sub-grid on the Warehouse tab wasted a lot of
//               space whenever one province had far fewer warehouses
//               than another. Per explicit follow-up ("don't group them
//               by province, just make sure the 2 provinces are
//               divided but not like this"), every warehouse card now
//               shares one wide auto-filling grid - a province heading
//               is still its own full-width row marking where that
//               province's cards start, dividing them without boxing
//               them into a separate, narrower grid.
//            4. Auto-compute Net Kilos toggle moved to the RIGHT of Net
//               Kilos (was left) and now sits in a fixed-height wrapper
//               matching the input's own height, so it's genuinely
//               centered against the input - not just bottom-aligned
//               against the whole label+input column. Applied to both
//               the primary pile section and the "Issue from another
//               pile" card.
//   1.9-184 - More follow-up fixes, reported directly with screenshots:
//            1. StockFormBase: the toggle-centering fix from 1.9-183
//               (matching a guessed pixel height) still wasn't reliably
//               centered. Fixed properly this time - the toggle now
//               sits INSIDE the same flex row as the Net Kilos input
//               itself (items-center directly against it), guaranteed
//               centered regardless of the input's real rendered
//               height. Also dropped the redundant "kg" unit suffix
//               from the Net Kilos value (the field is already
//               labeled "Net Kilos"). Both the primary pile section and
//               the "Issue from another pile" card.
//            2. StockFormBase: removing an "Issue from another pile"
//               line now asks for confirmation first - it used to
//               delete instantly on tap, an easy way to accidentally
//               lose a partly-filled line.
//            3. AdminHomeSacks.jsx: real bug fixed (found twice) - the
//               Province tab's sack-type tiles only applied their
//               background/border classes at the `lg:` breakpoint
//               (lg:bg-neutral-950 etc), and this app's light-mode
//               override system only ever maps the PLAIN class name,
//               never a breakpoint-prefixed variant - so those tiles
//               stayed hard-coded near-black in light mode regardless
//               of breakpoint. Every sack-type tile is now always a
//               plain bordered/tinted tile (already-covered classes) at
//               every screen size; only the column count changes at
//               `lg:`. Sack type codes also bumped to a bigger, accent-
//               colored treatment - they were a dim gray label, easy to
//               miss.
//            4. AdminHomeSacks.jsx: the Warehouse tab's shared grid
//               (from 1.9-183) still didn't look "balanced" - CSS Grid
//               auto-fill packs strictly row by row, so an uneven count
//               left a sparse, lonely last row. Switched to real CSS
//               multi-column instead, which balances every column to a
//               similar total height regardless of how many warehouses
//               or provinces exist at any given screen size.
//            5. RicemillRecoveryDetail.jsx (NFA tab's expanded
//               authority Issuance/Receipt list): now uses the same
//               card-style list at every screen size instead of a
//               separate dense desktop table, per explicit request.
//   1.9-185 - Three more follow-up fixes, reported directly:
//            1. HomeStocks.jsx: real bug fixed - on a wide screen the
//               shared grid's name column stretches to fill the extra
//               width, and the per-variety expand chevron was centered
//               across the FULL row width, leaving it floating alone in
//               that dead space, disconnected from both the pile name
//               and the figures. Now aligned under the number columns
//               (sm:justify-end) instead, reading as attached to the
//               row's own data. Mobile is unaffected.
//            2. AdminHomeSacks.jsx (Sack Pieces, Warehouse tab): capped
//               at 3 columns (was 4 at xl:) - with only a handful of
//               warehouses total, the 4th column often left one column
//               holding a single short card and a large dead gap below
//               it, since CSS multi-column's balance algorithm can't
//               always split unevenly-sized content evenly across more
//               columns than there's real content for.
//            3. RicemillRecoveryDetail.jsx (NFA expanded authority
//               list): the "card type" from 1.9-184 was still one
//               continuous divide-y list, not genuinely separate cards
//               - per direct follow-up, each entry (and the TOTAL row)
//               is now its own bordered/tinted tile with real gaps
//               between them, matching the same tile treatment used
//               elsewhere (e.g. Sack Pieces).
//   1.9-186 - Three more follow-up fixes, reported directly with
//            screenshots:
//            1. Real bug fixed: "Net Bags by Province & Category"'s
//               TOTAL row was a completely separate flex strip below
//               the real <table>, not an actual part of its column
//               grid - so its two figures could visibly drift out of
//               alignment with the real Rice/Palay columns above them.
//               Moved into a real <tfoot> row using the same Th/Td
//               cells as every other row - guaranteed pixel-aligned.
//            2. Real bug fixed, reported across two rounds: the Sacks
//               Warehouse tab's shared multi-column flow never actually
//               worked for grouping by province - a province heading
//               only appears once wherever CSS multi-column happens to
//               place it in ITS column, so a card from the same
//               province landing in a DIFFERENT column had no heading
//               above it and started at a different height, and a
//               small province (Catanduanes) became visually
//               indistinguishable from its neighbor once their cards
//               interleaved into the same flow. Each province is now
//               its own clearly-bordered section with its own
//               independent auto-filling grid - no cross-province
//               alignment problem, no confusion about which province a
//               card belongs to, and no wasted space (each section's
//               own column count adapts to how many warehouses IT has).
//            3. NFA expanded authority list (RicemillRecoveryDetail.jsx):
//               now also auto-balances into up to 3 columns on large
//               screens instead of staying single-column and leaving a
//               lot of width unused, per explicit request. TOTAL stays
//               outside the columned flow as its own full-width tile,
//               since multi-column can't reliably keep one item pinned
//               last and full-width the way a plain block below it can.
//   1.9-187 - Direct correction to 1.9-186's Sacks Warehouse tab redesign,
//            reported immediately after seeing it live: "i told you not to
//            divide this part by province, the first 3 columns looks
//            better, just make the province more noticeable, and don't
//            make the sack type be the same color of the warehouse name,
//            just white with a larger text than the values."
//            1. Reverted the per-province bordered-box grid back to the
//               shared columns-1/sm:2/lg:3 CSS multi-column flow the
//               previous version replaced - the bordered-box version
//               traded one problem for a worse one: every card in the
//               same grid ROW is forced to match the tallest card's
//               height, so a province with one bigger card left every
//               shorter neighbor sitting on dead space underneath it.
//               Real CSS multi-column doesn't have that problem since
//               each column flows independently by actual content
//               height. The earlier "hard to tell provinces apart"
//               complaint is addressed differently this time: the
//               province heading itself is now bigger, bolder and
//               brighter (text-app-text instead of text-neutral-500,
//               bumped to text-base) so it stays noticeable even though
//               it can still only physically appear once, wherever its
//               own card lands in the flow.
//            2. Sack type code label (both the Province tab's
//               SackTypeCard and the Warehouse tab's WarehouseSackCard)
//               was styled text-brand-neon - the same accent green as
//               the warehouse name highlight - and was the same size as
//               (or smaller than) the condition values below it. Changed
//               to plain white (text-app-text) and bumped to text-lg, so
//               it's no longer confusable with the warehouse-name accent
//               color and reads as clearly larger than the figures it
//               labels.
//   1.9-188 - Sacks Warehouse tab: per direct request ("put each sack
//            type in their own box, so it much better UX"), a warehouse
//            card holding more than one sack type (e.g. PPMG50 and
//            PPRE50 in the same warehouse) no longer stacks them as one
//            continuous divide-y block - each sack type is now its own
//            bordered/tinted tile inside the card, matching the tile
//            treatment the Province tab's SackTypeCard already uses.
//   1.9-189 - Removed the date-fns dependency - a performance/dependency
//            audit found zero imports of it anywhere in the app (src/,
//            docs/, api/ all confirmed clean); it was never actually
//            shipping in the built bundle since nothing referenced it,
//            so this is pure dependency-hygiene cleanup with no runtime
//            behavior change.
//   1.10-0 - New SDO (Disbursing Officer) feature, built from the plan/
//           demo cycle: a new 'SDO' role with its own Home (Buying
//           Price, live-computed Cash on Hand, a For Payment/Completed
//           WSR list with search+sort), a Purchase Receipt reference
//           screen that auto-fills from a WSR and computes its own ENW
//           factor + Basic Cost (Equivalent Net Weight truncated to 4
//           decimals, every peso amount truncated - never rounded - to
//           2, exactly as specified) - it is a reference only, not an
//           exported document, since the real PR stays hand-written.
//           Purity/D&D for the ENW lookup come from the Palay variety
//           itself (extended in the Varieties admin panel), not a
//           per-transaction field. Cash on Hand is never stored - it's
//           always Replenishments minus Liquidations minus this SDO's
//           own Active Purchase Receipts, so cancelling a PR reverts
//           its cash automatically and never touches the underlying
//           WSR (only Warehouse staff can cancel that). Pricer is a
//           per-SDO incentive Admin turns on individually (off by
//           default for everyone), not a branch-wide switch. New Admin
//           → Disbursement group: ENW Factor Table, Purity display
//           format (range vs. letter), Pricer eligibility per SDO, and
//           Abstract signatories. New Abstract of Cereal Purchases PDF
//           export (its own isolated generator, landscape, paginated)
//           matching the real report's exact columns (RSBSA No.,
//           Gross/Sack/Net, Rate/Amount only when Pricer applies).
//           Entirely additive - a new Dexie schema version, new files,
//           and small isolated edits to Varieties/AdminDashboard/App/
//           BottomNav - no existing table, page, or role's behavior
//           changed.
//   1.10-1 - URGENT fix: v1.10-0 broke Dexie Cloud sync for EVERYONE, on
//           every device, not just SDO users - reported directly (a
//           Settings > Sync Identity diagnostic panel stuck on
//           "unauthorized"/"disconnected"), confirmed via the app's own
//           [DEXIE-CLOUD-DIAGNOSTIC] console logs. Root cause: cashLedger
//           (new in v1.10-0) was the only table in this entire schema
//           given Dexie's native auto-incrementing key ('id++') - every
//           other table (30+) uses an app-assigned UUID string instead.
//           Dexie Cloud doesn't support auto-incrementing keys on a
//           synced table - two different devices working offline can
//           independently create the exact same numeric id (both save
//           their first row as id 1), which breaks the global identity
//           sync depends on. Fixed at the source: cashLedger's primary
//           key redefined to a plain UUID (schema v34 - safe, the table
//           had zero real rows anywhere since the feature had only just
//           shipped), CashActionModal.jsx now assigns that id itself via
//           crypto.randomUUID() same as every other table already does.
//           All 6 new SDO tables sync normally - none of them are
//           excluded, since syncing across devices is the entire point
//           (an SDO's Purchase Receipts, cash ledger, and Buying Price
//           must be visible to Admin/other devices, not stuck local-only).
//   1.10-2 - CRITICAL fix: v1.10-1's own fix for the sync outage was
//           itself broken and caused a WORSE one - "The app's local
//           database couldn't open" for every device, reported directly
//           within minutes, with a real console error: UpgradeError
//           "Not yet support for changing primary key". Root cause:
//           v1.10-1 tried to redefine cashLedger's primary key in place
//           (same table name, new key shape) - IndexedDB does not
//           support changing an existing object store's keyPath at all,
//           ever, so that upgrade transaction threw and the database
//           failed to open completely for anyone reaching it. The only
//           safe way to change a primary key is a NEW table: renamed to
//           cashLedgerV2 (correct UUID key), old cashLedger left
//           declared exactly as it always was (v33's original id++
//           definition, completely untouched) so opening the database
//           never attempts an invalid in-place key change again, and
//           added to unsyncedTables since it's now dead/unused. Every
//           file that wrote to cashLedger now uses cashLedgerV2 instead.
//           No data was ever at risk - this table had zero real rows
//           anywhere at any point, the whole feature was minutes old.
//   1.10-3 - Wired the existing forceRefresh() escape hatch (already
//           built in appUpdate.js, never actually used anywhere) into
//           DbOpenErrorScreen as a "Get Latest Version" button - a
//           device stuck on a broken cached bundle whose local
//           database also fails to open was in a genuine dead end
//           before this: <App/> (and UpdateChecker.jsx inside it, the
//           only thing that normally drives updating to a fixed build)
//           never gets to mount when the database itself fails to
//           open, so a plain Reload kept re-serving the exact same
//           broken service-worker-cached bundle forever, no matter how
//           many times a fixed version had already shipped to the
//           server. This button unregisters the service worker and
//           clears the cache directly, bypassing that entire stuck
//           update flow, so this specific trap can't strand anyone
//           again.
//   1.10-4 - SDO Home/Settings usability fixes, reported directly after
//           first real use:
//           1. No more warehouse selector on SDO Home - every warehouse
//              the SDO is assigned to is now aggregated into one list,
//              same as Admin's own dashboards never needing a selector.
//              Each WSR card now shows which warehouse it's from since
//              multiple can appear together. Each warehouse's own
//              reportingCutoffDate (combined with the global Data Start
//              Date override) is applied per row - the same rule
//              Reports.jsx already uses everywhere else, now respected
//              here too.
//           2. Settings for an SDO was showing the full warehouse-
//              operations screen (Active Warehouse, Auto Age
//              Monitoring, Classifier, Beginning Balances) - none of
//              that applies to this role. Now just the profile card,
//              same as every role gets.
//           3. Cash on Hand had no way to seed a starting balance -
//              Replenish now has an "opening balance" option that
//              skips requiring a real check number, since Cash on Hand
//              is always derived (never a stored starting number) and
//              Replenish already is how any cash enters the sum.
//           4. KG/MT toggle removed from the header for SDO - nothing
//              in this role's own screens uses a stock weight unit.
//           5. Buying Price cards are now tap-anywhere to edit, not a
//              small pencil icon.
//           6. Removed the "· N" counts beside For Payment/Completed.
//           7. Every sdo/* modal now gets the same fade+scale entrance
//              transition already used elsewhere in the app (e.g.
//              ConfirmDialog) - they were rendering instantly before,
//              which read as out of place next to how smooth everything
//              else in the app is.
//   1.10-5 - Four more SDO fixes, reported directly:
//           1. Abstract "Prepared By" is now always the SDO who
//              actually generated the export, filled in dynamically
//              from their own account - never an admin-configured
//              fixed name. Removed from Admin's Abstract Signatories
//              panel entirely (Verified By/Noted By stay, those genuinely
//              are fixed branch roles regardless of which SDO exports).
//           2. ENW Factor Table gets a "Load Reference Table" button -
//              seeds all 68 rows (17 MC brackets x Purity A/B x D&D
//              0-3%/3.1-7%) from the reference sheet already provided
//              for this feature, instead of Admin retyping every value
//              by hand. One value corrected against the sheet's own
//              decreasing trend (a 10x outlier next to its neighbors,
//              flagged in the confirmation dialog for a manual check).
//           3. SDO Home's For Payment/Completed switched to the same
//              sliding-pill tab style used everywhere else in the app
//              (e.g. the Province/Warehouse toggle), not two plain
//              buttons - and now that all assigned warehouses show
//              together at once, added a warehouse filter dropdown
//              next to the existing search/sort.
//   1.10-6 - Two more fixes, reported directly with screenshots:
//           1. SDO Home's warehouse filter was showing the bare numeric
//              code (e.g. "050522") instead of the warehouse name, and
//              apparent duplicates - fixed to show "code — name" (same
//              convention already used in Settings/Users) and deduped
//              defensively by warehouseId. The list itself was already
//              scoped to only this SDO's own assignedWarehouses (same
//              shared source every other warehouse picker in the app
//              uses) - if a warehouse that shouldn't be there still
//              shows, the fix is that user's Assigned Warehouses in
//              Admin > Structure > Users, not this dropdown.
//           2. ENW Factor Table rebuilt as a real grid - D&D/Purity
//              rows down the side, MC brackets across the top, factor
//              editable directly in each cell - matching the reference
//              sheet's own layout and how this was shown during
//              planning, instead of 68 separate list rows with a
//              one-row-at-a-time add form.
//   1.10-7 - Real bug fixed: every SDO modal (Purchase Receipt,
//           Replenish/Liquidate, Denomination Count, Abstract export)
//           rendered small and off-center instead of a proper full-
//           width centered overlay - root cause was the same one
//           ConfirmDialog.jsx already documented and fixed for itself:
//           a plain `fixed` element inside App.jsx's page wrapper (which
//           applies a CSS transform for the page-slide animation) gets
//           constrained to that ancestor's own box instead of the real
//           viewport. All four now portal straight to document.body,
//           same as ConfirmDialog already does.
//           Two more real fixes: (1) the ENW factor lookup used strict
//           === for D&D bracket/purity-letter matching, which could
//           silently fail on a type/whitespace mismatch even when the
//           same values were visibly correct in both the variety and
//           the ENW grid - now compares numerically with tolerance,
//           case/whitespace-insensitive for the letter. (2) Buying
//           Price resolution required a price row dated on/before the
//           WSR's own date, so a price set today for the first time
//           found nothing for an already-encoded older WSR ("no price
//           set" despite one existing) - now falls back to the earliest
//           price on record instead of reporting none.
//           Also: Admin Dashboard's group tab bar (Structure/Inventory/
//           Operations/Disbursement/System) was built assuming exactly
//           4 equal-width groups and broke on narrow screens now that
//           Disbursement made it 5 - converted to the same scrollable-
//           pill style the sub-tab row below it already uses. SDO
//           Home's warehouse filter now drops to its own row below
//           search+sort on small screens instead of competing for the
//           same cramped row. Stock entry forms (WSR/WSI/ESR/ESI) now
//           stack Net Kilos+toggle and Age+Unit as two full rows on
//           small screens instead of squeezing both into one row's
//           worth of space (PC keeps them side by side).
//   1.10-8 - Correction + a full pass on the SDO modals, reported directly:
//           1. Peso-amount rounding rule corrected: "the amount was
//              rounded up to 2 decimals, the 3rd decimal is not
//              dropped" - every peso amount (Basic Cost, Pricer Amount,
//              Total Amount, Cash on Hand) now standard-rounds to 2
//              decimals instead of truncating. Equivalent Net Weight's
//              own truncate-to-4-decimals rule is unchanged - only the
//              peso side was wrong.
//           2. Modals switched from bottom-sheet-on-mobile to always
//              centered (matching ConfirmDialog's own established
//              pattern), with real internal scroll regions and safe-
//              area-aware bottom padding so tall content can't get cut
//              off by a phone's home-indicator/gesture bar.
//           3. SDO Home's search+sort cluster now actually grows to
//              fill the row on wide screens - it was missing flex-1 at
//              the outer wrapper level, so the whole search/filter/sort
//              row sat stranded on the left with empty space filling
//              the rest of a wide display.
//           4. Header/bottom nav now hide (and page scroll locks) while
//              any sdo/* modal is open, same chromeHidden switch
//              App.jsx already uses for transaction forms - previously
//              they stayed visible above the modal and produced two
//              visible scrollbars at once.
//           5. Purchase Receipt reference screen: WSR chip enlarged and
//              the word "From" dropped, every numeric value (bags,
//              gross, net, equivalent net weight, pricer amount) now
//              comma-formatted, and text sizes bumped throughout.
//           6. New "Position / Role" field in the SDO's own Settings -
//              printed as the Abstract export's "Prepared By" position
//              instead of a hardcoded "Disbursing Officer" label, read
//              live so an edit shows up on the very next export.
//   1.10-9 - Correction: Equivalent Net Weight truncates to 3 decimals,
//           not 4 - fixed at the source (computeEquivalentNetWeight)
//           and in both display spots that formatted it to 4 (the
//           Purchase Receipt reference screen, the Abstract export's
//           per-row and TOTAL columns). The ENW *factor* itself (the
//           table lookup value, e.g. 0.6824) is unrelated and still
//           shown at its own 4 decimals - only the weight quantity it's
//           multiplied against was ever 3.
//   1.10-10 - Denomination Count now tracks bundles separately from
//            loose pieces, per your reference sheet's own "7 Bundle
//            1000" style entries - a bundle is a fixed 100 pieces, so
//            a ₱1,000-bill bundle is worth ₱100,000, not one more
//            piece counted at face value. Each denomination row now has
//            its own Bundles and Pcs inputs; a saved count from before
//            this existed still loads correctly (read as loose pieces,
//            0 bundles).
//   1.10-11 - Every native date input in the SDO feature (Replenish/
//            Liquidate, Abstract export's From/To) replaced with the
//            app's own CalendarDatePicker, matching every other date
//            field in the app. Added a new "Date Paid" picker to the
//            Purchase Receipt reference screen, defaulting to today -
//            previously the PR silently used the WSR's own (often
//            earlier, backlogged) encoding date with no way to say
//            "I'm actually paying this today." The Buying Price lookup
//            now uses this date too, which is the genuinely correct
//            fix for the earlier "no price set" issue - resolving by
//            the real payment date instead of the fallback-to-earliest
//            workaround from before.
//   1.10-12 - Real bug fixed in the Abstract of Cereal Purchases export:
//            the reconciliation box's position was computed from a
//            hardcoded signature-column width that assumed A4's
//            297mm - on the actual page it ran 18mm PAST the right
//            edge of the sheet, which is what "it does not fit" was
//            actually describing. Fixed at the source: paper size
//            changed to the real one this is printed on (8.5 x 13 in,
//            not A4), and every footer width (signature columns, the
//            reconciliation box) is now derived from the real page
//            width instead of a hardcoded value, so it can't run off
//            the edge on any paper size again. Table/footer font sizes
//            bumped up for readability on the larger sheet.
//            Purchase Receipt screen: removed the subtitle under the
//            title, relabeled "Date Paid" to just "Date", and moved it
//            above the PR No. field on small screens (still side by
//            side once there's room).
//   1.10-13 - Abstract export's Variety column now shows only the base
//            classifier (PD1, PD2, PW1, PW2) - the full variety name
//            (e.g. "PD1m-A") carries a moisture-state modifier letter
//            and a Purity-grade suffix that matter for the ENW lookup
//            but shouldn't print on the export itself.
//   1.10-14 - Abstract export polish pass, reported directly against a
//            real export:
//            1. Period line now reads "September 15, 2026", not raw
//               ISO ("2026-09-15").
//            2. Table headers centered.
//            3. DATE column's year moved into the header (second line,
//               only when every row shares one year - same convention
//               the existing NFA stock report already uses), rows show
//               just "Sep 15" instead of repeating the year on every
//               line.
//            4. The BN/SH mark is no longer a table column - drawn as
//               small, light gray text just past the table's right
//               edge instead, not part of the bordered grid.
//            5. Added the rule between the org header block and the
//               report title, matching the reference layout - it was
//               missing entirely before.
//            SDO Home: WSR/PR numbers on the transaction list are now
//            larger and more prominent, general list font sizes bumped.
//   1.10-15 - Real, serious performance bug fixed: marking an AI/SIA
//            authority (or a milling order) complete/pending triggered
//            a severe frame drop. Root cause: the row's exit animation
//            (row-complete-out/row-revert-out, shared by
//            AuthorityMonitor, MillingMonitor, AdminMonitoring, and
//            both Completed*Modal panels) animated max-height/margin/
//            padding together with transform, to make the rows below
//            slide up smoothly as the space reclaimed itself. Those are
//            layout properties, not compositor ones - animating them
//            forces a full reflow of the surrounding list on every
//            single frame for the whole 0.7s (~42 forced layouts, not
//            one), far worse on the lower-end phones this app targets.
//            Now only opacity, background-color, and transform animate
//            - compositor/paint-only, no per-frame reflow. Trade-off:
//            rows below no longer slide up smoothly during the glow,
//            they snap into place in one (effectively instant) reflow
//            once the row actually leaves the list - a fair trade for
//            eliminating a genuinely serious, widely-shared jank bug.
//   1.10-16 - Reverted v1.10-15's animation fix - confirmed on video
//            it traded the frame drop for a worse-looking bug: the
//            row's reserved space just sat there frozen for the whole
//            0.7s (no smooth shrink), then the list jumped/snapped the
//            instant it was removed, reading as broken rather than
//            smooth. Restored the original max-height/margin collapse
//            animation. Fixed the actual reflow cost the right way
//            instead: added `contain: layout` to every list that uses
//            this animation (AuthorityMonitor, MillingMonitor x2,
//            AdminMonitoring, CompletedAuthorityModal,
//            CompletedMillingModal) - this scopes the browser's reflow
//            work to just that list's own box, so animating a row's
//            height no longer also forces a reflow of everything
//            OUTSIDE the list (the rest of the page), which is the
//            more likely real source of a "very serious" drop than one
//            small list reflowing itself.
//   1.10-17 - Four more SDO fixes, reported directly:
//            1. Equivalent Net Weight's decimal rule now depends on the
//               ENW factor itself, confirmed directly: 3 decimals when
//               the factor is exactly 1 (1.0000), 4 decimals for any
//               other factor. Applied at the source (sdoCalculations.
//               computeEquivalentNetWeight) and in both display spots
//               (PR reference screen, Abstract export's per-row and
//               TOTAL columns).
//            2. ENW Factor now shown as its own field on the Purchase
//               Receipt reference screen - it was only ever implied by
//               the classification badge before, never displayed
//               directly.
//            3. Abstract export: Basic Cost is only shown as its own
//               column when Pricer is enabled - "the basic cost is
//               part of the pricers" - with Pricer off it's identical
//               to Total Amount, so showing both was a redundant
//               column rather than useful information.
//            4. Abstract export's Cash Reconciliation box was missing
//               every running TOTAL row entirely (COH+ADD, and after
//               each LESS deduction) - confirmed against a real sample
//               of the document. Added, with a light gray fill to set
//               each TOTAL apart from the plain rows above it.
//   1.10-18 - Live comma-separator formatting added to the SDO cash
//            inputs (Replenish/Liquidate's Amount, Denomination
//            Count's Bundles/Pcs) - these were still plain `type=
//            "number"` inputs, which can't ever show commas as the
//            user types, unlike every other numeric field in the app
//            (Number of Bags, Net Kilos, etc). Switched to the same
//            text + liveFormatNumber/parseFormattedNumber pattern
//            those already use. Denomination counts are still saved as
//            plain numbers, not the comma-formatted display strings -
//            only how they're edited on screen changed.
//   1.10-19 - Abstract export's Whse column was showing the opaque
//            numeric warehouse code ("050501") instead of the
//            warehouse's own name - fixed to show the short name
//            (province-code prefix stripped, e.g. "ALB-BSI B" ->
//            "BSI B"), matching how every other warehouse label in the
//            app already displays.
//   1.10-20 - Buying Price editing moved from an inline expanding panel
//            under the price cards into its own centered modal (new
//            BuyingPriceModal.jsx), with larger font sizes, matching
//            the established sdo/* modal pattern (portaled, entrance
//            animation, safe-area bottom padding).
//   1.10-21 - SDO feature audit fixes, following a full review of the
//            whole feature:
//            1. Duplicate-PR protection: issuing now re-checks for an
//               existing Active PR inside one atomic Dexie transaction
//               right before writing (closes a same-device double-tap/
//               race), plus a synchronous ref guard against a fast
//               double-submit. If two PRs still land on the same WSR
//               (two offline devices syncing later - can't be closed
//               client-side), SdoHome now detects it and shows a
//               banner, and the PR screen lists every duplicate with
//               its own Cancel button to resolve it.
//            2. ENW Factor Table's "Reload/Load Reference Table" is now
//               idempotent - updates a cell that differs, leaves one
//               that matches, and collapses any stray duplicates from
//               before - instead of blindly appending a second row
//               every time it's tapped (its own confirm dialog used to
//               have to warn "adds duplicates, so use it once").  Also
//               added overlap validation on the "+ New bracket" form,
//               since lookupEnwFactor's first-match lookup depends on
//               MC brackets never overlapping.
//            3. Pricer Rate/Amount/Basic Cost now reflect each PR's OWN
//               stored pricerAmount, not the SDO's CURRENT Pricer
//               eligibility toggle - both on the PR reference screen
//               (a re-opened PR) and the Abstract export (every PR in
//               the period). Before this, toggling Pricer off after a
//               PR was issued made that PR's own pricer breakdown
//               silently vanish, even though Total Amount still
//               included it.
//            4. New Cash History view (View cash history, next to the
//               denomination link) - Replenish/Liquidate entries had no
//               way to be reviewed or corrected before. A mistaken
//               entry can now be Voided (with a required reason); a
//               voided entry stays on record but no longer counts
//               toward Cash on Hand.
//            5. Buying Price's "current price" resolution had two
//               separate implementations (Home's own inline sort vs.
//               resolveBuyingPrice) that could disagree on a same-day
//               correction; unified onto resolveBuyingPrice, which now
//               also breaks same-day ties on save time (createdAt)
//               instead of incidental array order.
//            6. Smaller fixes: Pricer Rate input now uses the same
//               live comma-formatting every other money field in this
//               app uses; a non-blocking warning appears when issuing a
//               PR or liquidating cash would exceed current Cash on
//               Hand; the Abstract's Cash Reconciliation box overflow
//               check is now sized to its actual row count instead of
//               a flat 40mm guess; the "Completed" list now loads in
//               pages of 50 with a Load More button instead of
//               rendering every paid WSR at once.
//   1.10-22 - Denomination Count and Cash History moved from SDO Home
//            into Settings (new "Cash Balance" section, with icon
//            buttons), leaving Home focused on today's actions
//            (Replenish/Liquidate). Cash History now also has:
//            1. An Edit action per Replenish/Liquidate entry (amount,
//               ref no., date), alongside the existing Void - there was
//               previously no way to correct an entry directly, only
//               void it and add a new one.
//            2. A year selector, offering only years that actually
//               have at least one entry (defaults to the current
//               year), with the existing 50-per-page Load More applying
//               within whichever year is selected.
//   1.10-23 - Real fix for MO/TMO auto-completion (reported again after
//            a previous partial fix): StockFormBase.jsx and
//            SackFormBase.jsx were still auto-writing DONE straight to
//            the MO/TMO Sheet the instant recovery math looked complete
//            (all 3 Test Milling trials recovered, or an MO's recovery %
//            met) - a real case, reported directly: all 3 rice recovery
//            trials were encoded, the TMO auto-completed, and the still-
//            pending by-products receipt for that same TMO had nowhere
//            left to pick it from, since the entry-form picker already
//            (correctly) hides anything with sheetStatus 'DONE'. The
//            earlier fix only stopped the LOCAL "fulfilled" flag from
//            hiding orders; it never removed this actual auto-write side
//            effect, which produced the identical symptom once synced
//            back. Both auto-write blocks are removed - completion is
//            now exclusively the Milling Operations monitor's manual
//            checkbox, as intended.
//            Also fixed: the Completed list's "uncheck" control only
//            ever appeared for orders completed via that manual
//            checkbox (manuallyCompleted) - an order that ended up DONE
//            any other way (the auto-write above, or someone editing
//            the Sheet directly) had no revert button anywhere in the
//            app. Now offered for sheetStatus 'DONE' too, so an admin
//            can un-stick an already-affected MO/TMO from here.
//   1.10-24 - Fixed the revert-to-pending fix itself: unchecking a
//            completed MO/TMO cleared manuallyCompleted but left the
//            LOCAL cached sheetStatus still reading 'DONE' - only the
//            next full background sync would have refreshed it, so the
//            order stayed stuck in Completed even after the Sheet
//            itself was confirmed no longer DONE. Now clears sheetStatus
//            locally in the same update, so reverting moves an order
//            back to Pending immediately.
//   1.10-25 - Fixed physical keyboard PIN entry breaking after a wrong
//            PIN on the login page. The error handler called the hidden
//            PIN input's focus() while it was still `disabled` in the
//            actual DOM (the setIsSubmitting(false) that re-enables it
//            hadn't been rendered yet at that point in the handler), so
//            the browser silently refused the focus - leaving nothing
//            focused, and no later blur event to trigger the existing
//            refocus-on-blur logic either, since focus never actually
//            landed. Deferred the focus() with setTimeout(0), same
//            pattern already used elsewhere on this page, so it runs
//            after the input is actually re-enabled.
//   1.10-26 - Six more fixes, reported directly:
//            1. Home Stocks: By Products rows with any unwithdrawn AI
//               stock used to always show their Unwithdrawn/Potential
//               block, with no way to collapse it - now behind the same
//               on-demand expand arrow Rice/Palay already uses. Also
//               bumped variety/figure text one size up at the lg
//               breakpoint (within the same column widths already sized
//               for that size on the TOTAL row, so nothing overflows).
//            2. Pile List: a multi-variety By Products pile used to skip
//               the primary Bags/Net Kg tile pair every other pile card
//               shows and dump straight into a wall of per-variety text
//               - now shows that same tile pair (the pile's real total)
//               up front, with the per-variety breakdown as an optional
//               expandable extra below it, matching Rice/Palay's own
//               multi-sack-weight breakdown convention exactly.
//            3. The entry form's live "Pile now" sidebar showed a By
//               Products pile's flat total only, never broken out by
//               variety - now reads the same per-variety breakdown
//               HomeStocks.jsx/HomePiles.jsx already use, one row per
//               variety with real stock.
//            4. Fixed a focus-shift jitter/shake on the entry form: the
//               "keep the focused field visible" logic used to
//               re-center EVERY focused field unconditionally, even one
//               already comfortably on screen - tabbing through several
//               fields kept re-triggering competing smooth-scrolls.
//               Only actually scrolls now when the field isn't already
//               reasonably visible.
//            5. Test Milling's Trial selector gained an "All Trials"
//               option for one combined receipt covering all 3 trials
//               at once (stored as a real sentinel value, expanded back
//               out to trials 1/2/3 wherever recovery/fulfillment math
//               reads it, so it still correctly completes an order).
//            6. Every place that displays a saved trial number now
//               shows "Trials 1, 2 and 3" for that All-Trials case, not
//               the raw dropdown option text "All Trials".
//   1.10-27 - Three more fixes, reported directly:
//            1. Fixed a real regression from 1.10-26's own focus-jitter
//               fix: the "skip the scroll if the field looks visible"
//               check used window.innerHeight for the bottom bound,
//               which most mobile browsers do NOT shrink when the
//               on-screen keyboard opens (only the visual viewport
//               does) - so a tapped field near the bottom half of the
//               screen was judged "comfortably visible" against the
//               full, keyboard-ignoring height and never got scrolled
//               above the keyboard, reading as "no more auto-focus."
//               Now uses window.visualViewport's real height when
//               available, falling back to innerHeight elsewhere.
//            2. New AI/SIA authorities (and any other Sheet edit) were
//               reported as taking too long to reach the app - the
//               periodic pull was every 5 minutes. Both
//               syncAuthoritiesFromSheets and syncMillingOrdersFromSheets
//               are already cheap, full-table re-fetches designed to run
//               forever on a fixed cadence, so there was no real reason
//               to hold this that far back - dropped to 1 minute,
//               matching the app's other periodic pulls far more
//               closely.
//            3. The background "N record(s) failed to sync" toast is
//               gone - reported directly as alarming/concerning to see
//               on a device someone's just using day to day, for
//               something the app already retries automatically every
//               30s until it lands (most "failures" are a transient
//               blip already fixed by the time anyone reads the toast).
//               A genuinely persistent failure is now logged to the
//               admin-only Error Log instead (which record, which
//               device), and gets a "Resolved — synced successfully"
//               note added to that same entry the moment a later retry
//               actually lands, instead of just vanishing silently or
//               leaving a permanently alarming-looking entry behind.
//   1.10-28 - New login entrance animation, picked after several rounds
//            of demos: "Magnetic Snap" for the logo/title/subtitle/PIN
//            dots (each pulls in fast from a different direction with a
//            real elastic overshoot) + "Scan Reveal" for the keypad (a
//            bright line sweeps down each button, revealing it
//            progressively behind it, like a document coming off a
//            scanner). Implemented as real CSS @keyframes (index.css),
//            replacing the old transition-based "reverse of the exit"
//            approach - deliberately with no forwards/both fill-mode on
//            any of them, so the unchanged fly-out exit animation (on a
//            successful login) can still freely apply its own inline-
//            style transform afterward without a held animation frame
//            silently overriding it.
//   1.10-29 - Fixed a real, reported bug: the Admin Dashboard's Home
//            (province/warehouse stock totals) showed a flat zero every
//            single time on an installed iOS PWA, even with local data
//            confirmed present and Dexie Cloud confirmed connected
//            (checked directly via Settings' own Sync Identity
//            diagnostic panel). Root cause: AdminHomeStocks.jsx's
//            warehouseCategoryStock computation fired every warehouse's
//            own (already-substantial, several-queries-per-pile) work
//            all at once via a single Promise.all - for a branch with
//            several warehouses, that's dozens of concurrent IndexedDB
//            transactions at once. WKWebView (what an installed/
//            standalone iOS PWA runs IndexedDB through, not the same
//            engine as a plain Safari tab) is documented to silently
//            drop or hang transactions once too many fire simultaneously
//            - the computation was resolving to empty data on that
//            device specifically, not a sync or data problem at all.
//            Fixed by processing warehouses in small batches (3 at a
//            time) instead of all at once - still purely local reads, so
//            no meaningful slowdown. Also gave "still computing" its own
//            loading state (AdminHomeShared.jsx's new LoadingRows),
//            separate from the existing "genuinely nothing to show"
//            Empty state - the two looked identical before, which is
//            exactly what made this bug so hard to distinguish from a
//            real data-sync issue while investigating it.
//   1.10-30 - TEMPORARY diagnostic build: added direct console logging
//            inside AdminHomeStocks.jsx's warehouseCategoryStock
//            computation (1.10-29's fix), to investigate a still-open
//            reported case where Admin Home continues to show a flat
//            zero on a specific device even though the underlying data
//            and this exact computation were both independently
//            confirmed correct (checked directly against that device's
//            own local database via the console). Logs each warehouse's
//            own computed result and surfaces any thrown error instead
//            of letting it fail silently. Remove once root-caused.
//   1.10-31 - Root-caused via 1.10-30's diagnostic logs: warehouseCategoryStock
//            WAS computing correctly the whole time (confirmed real,
//            non-zero totals in the logs) - the actual problem was that
//            it lived inside a useLiveQuery, which makes Dexie auto-track
//            every table the computation touches (db.transactions, read
//            for every pile across all warehouses). On a device actively
//            receiving Dexie Cloud sync traffic, EVERY incoming
//            transaction record retriggered a full re-computation across
//            every warehouse - the logs showed dozens of back-to-back
//            recomputes in quick succession. Since useLiveQuery keeps
//            showing its previous result while a new one computes, the
//            "still computing" loading state only ever appeared once (the
//            very first computation) and never came back for any of the
//            silent recomputes after it, so a page that was legitimately
//            still settling looked frozen with no loading indicator at
//            all - eventually correct, but only after a long, invisible
//            wait. Fixed by decoupling the heavy computation from Dexie's
//            automatic per-write reactivity: a cheap transaction/pile
//            row-count liveQuery now acts as the change signal, debounced
//            700ms so a burst of incoming sync writes collapses into one
//            recompute after things go quiet, and the actual computation
//            runs in a plain effect that explicitly resets to "loading"
//            every time it starts - not just the first time. Removed the
//            temporary diagnostic logging from 1.10-30.
//   1.10-32 - Fixed a real regression 1.10-31 introduced: on a device with
//            genuinely continuous Dexie Cloud sync traffic (confirmed via
//            console - pushing/pulling cycling back-to-back with no real
//            gap), a plain "wait 700ms for quiet" debounce never actually
//            got its quiet window, and the heavy computation effect's own
//            dependency array (the live warehouses/varieties/sackTypes
//            arrays, whose identity changes on every table write) kept
//            cancelling and restarting it before a single pass could ever
//            finish - Admin Home's stock totals showed nothing but a
//            spinner for 15+ minutes on both an iPhone and an Android
//            device. Fixed by making the computation effect depend ONLY
//            on the debounced trigger number (reading warehouses/
//            varieties/sackTypes from refs kept fresh every render,
//            instead of as effect dependencies), so unstable array
//            identity can no longer restart it mid-flight; also added a
//            hard 5s maxWait alongside the quiet-period debounce, so a
//            recompute is guaranteed on a bounded schedule even if sync
//            traffic never truly goes quiet, plus a try/catch around the
//            computation so a real failure surfaces in the console and
//            settles the page instead of leaving the spinner stuck
//            forever with no explanation.
//   1.10-33 - Fixed two separate, real bugs surfaced alongside the Admin
//            Home investigation above, both console-visible on the same
//            device: (1) the automatic GitHub backup was failing every
//            single day with HTTP 413 (Content Too Large) - the daily
//            full-database dump had grown past Vercel Serverless
//            Functions' hard, non-configurable 4.5MB request body
//            limit as real transaction volume increased. Fixed by
//            gzip-compressing the dump client-side (browser-native
//            CompressionStream, no new dependency) before it's sent,
//            with the endpoint decompressing server-side - repetitive
//            JSON like this typically shrinks 80-90%, comfortably
//            clearing the limit again. (2) fetchTransactionsBulk and
//            markRowsSeen (the Sheets preload's own bulk multi-
//            warehouse fetch and batch "mark as seen" write) were using
//            the same tight 8s fetch timeout built for a single quick
//            lookup during navigation, aborting mid-flight under real
//            login-sync load - these two now get a separate, longer
//            45s budget appropriate for genuinely larger bulk requests,
//            while every small lookup keeps the original 8s ceiling.
//   1.10-34 - Fixed a real regression the previous fix's own 5s maxWait
//            introduced: reported as the app "freezing"/slow to respond
//            on taps, specifically on Admin Home and Admin Monitor, and
//            specifically for admin users (whose pages compute across
//            every warehouse, unlike a regular user's own
//            warehouse-scoped Home). Root cause: this device's sync
//            traffic essentially never goes fully quiet, so the 5s
//            maxWait meant AdminHomeStocks.jsx's full 16-warehouse
//            ledger replay was firing on an effectively permanent
//            5-second loop the entire time an admin stayed on that
//            page - not merely slow to first load, but continuously
//            busy recomputing in the background, competing for the
//            same main thread and IndexedDB connection every tap needs.
//            Also found the exact same bug, not yet fixed, in
//            MillingMonitor.jsx (used by Admin Monitor):
//            computeMillingOrderStatuses reads db.transactions/
//            db.millingOrders/db.authorities across every warehouse's
//            own MO/TMO orders, called directly inside a useLiveQuery -
//            same retrigger-on-every-sync-write shape. Extracted the
//            now-twice-needed fix into a shared
//            src/utils/useDebouncedLiveCompute.js hook (documented as
//            the standing pattern in docs/technical-design-document.md
//            §2.12) and applied it to both pages, with maxWaitMs bumped
//            from 5s to a much more generous 30s - a stock total or an
//            order-fulfillment list doesn't need to refresh more than
//            once every 30s even under continuous sync churn, and the
//            debounced quiet-window wait still fires promptly the
//            moment things actually settle.
//   1.10-35 - Fixed a real, video-confirmed regression the previous fix
//            didn't cover: dropped frames/stutter specifically while
//            marking an authority complete on Admin Monitoring's AI/SIA
//            tab. Root cause, found by tracing what else mounts on that
//            page: MillingMonitor.jsx and NfaMillingMonitor.jsx both
//            stay mounted in the background the whole time any
//            Monitoring tab is open (by design, to preserve their own
//            state across tab switches), and NfaMillingMonitor's own
//            recoverySummaryByNumber computation reads db.authorities
//            across every ricemill - the SAME table a "mark authority
//            complete" write touches. That background computation was
//            retriggering on the main thread at the exact moment the
//            mark-complete row's glow+collapse animation was trying to
//            play smoothly on the AI/SIA tab the user was actually
//            looking at. Converted NfaMillingMonitor.jsx's
//            recoverySummaryByNumber to the same shared
//            useDebouncedLiveCompute fix (a third confirmed instance of
//            the TDD §2.12 pattern), and - the more direct fix for this
//            specific symptom - both MillingMonitor.jsx and
//            NfaMillingMonitor.jsx now freeze their own recompute
//            trigger entirely while their `active` prop is false, so
//            neither one does ANY background work while a different
//            Monitoring tab is the one actually being interacted with;
//            each simply keeps showing its last-known data and picks
//            back up the moment its own tab is looked at again.
//   1.10-36 - Fixed a real regression 1.10-35 didn't cover: frame drops on
//            Admin Monitoring, confirmed still happening AND confirmed
//            admin-only (the user-side AuthorityMonitor.jsx stays smooth).
//            A fifth confirmed instance of the TDD §2.12 shape, but not the
//            same failure mode as the first four: AdminMonitoring.jsx's own
//            AI/SIA data is a plain, unscoped useLiveQuery(() => db
//            .authorities.toArray()) - every authority in the whole system,
//            re-fetched synchronously on every single write to that table
//            (this page's own completion toggle, CompletedAuthorityModal's
//            un-complete, every WSI/ESI issuance anywhere, every incoming
//            Dexie Cloud sync write). AuthorityMonitor.jsx never hits this
//            because its own query is scoped to just the logged-in user's
//            accessible warehouse(s), a tiny slice of the nationwide table -
//            this page has no such scope, since an admin genuinely needs
//            every warehouse's data. useDebouncedLiveCompute (the fix for
//            the first four instances) isn't the right tool here: its
//            change-detection signal is a row COUNT, which only changes on
//            insert/delete, but almost every meaningful update to this
//            table is a field mutation on an existing row - a count-based
//            signal would silently go stale on exactly the actions this
//            page most needs to reflect immediately. Fixed instead with
//            useDeferredValue: the data stays fully, immediately
//            consistent (no staleness trade-off), but React now schedules
//            the resulting heavy filter/dedupe/sort re-render at lower
//            priority, so it no longer blocks the same frame as the
//            completingId-driven row animation.
//   1.10-37 - Fixed a real gap the 1.10-33 bulk-fetch-timeout fix missed:
//            fetchMillingOrderRows (MO/TMO sheet sync, behind
//            syncMillingOrdersFromSheets) and fetchAuthorityRows (AI/SIA
//            sheet sync) both fetch an entire sheet's worth of rows -
//            the same bulk shape as fetchTransactionsBulk and
//            markRowsSeen, which 1.10-33 already moved to the 45s
//            BULK_FETCH_TIMEOUT_MS budget - but were left on the 8s
//            single-row FETCH_TIMEOUT_MS, aborting under real load with
//            the exact same "AbortError: signal is aborted without
//            reason" symptom 1.10-33 fixed for the other two. Reported
//            directly: syncMillingOrdersFromSheets failing in the
//            console alongside a still-erroring fetchTransactionsBulk
//            call - the latter's fix was already shipped in 1.10-33, so
//            if it persists after updating to this build, the device is
//            most likely still running a stale cached PWA bundle rather
//            than a new gap.
//   1.10-38 - Fixed a real reported bug: the Completed AI/SIA list wasn't
//            actually sorted by "latest series first" - it was sorting by
//            each record's completedDate (its last matching WSI/ESI
//            transaction's date), not by the AI/SIA number itself. Two
//            authorities completed the same week can have very different
//            numbers, so this read as effectively unsorted against the
//            actual expectation. Sorted by reference number instead,
//            descending, matching the same numeric-aware convention
//            (`numeric: true`) CompletedMillingModal already uses for
//            MO/TMO number. Shared by both AdminMonitoring.jsx and
//            AuthorityMonitor.jsx (user side), which both render the same
//            CompletedAuthorityModal.jsx, so one fix covers both.
//   1.10-39 - Fixed a real reported bug: no date was ever showing on AI/SIA
//            authorities anywhere (pending list or Completed list), despite
//            the UI already having code to display it when present. Root
//            cause: the AI sheet's date column header has the CURRENT year
//            baked directly into it ("DATE (2026)"), the same header-drift
//            shape already found twice before for regionalAuthorityNumber
//            and ageGroup - and since each Sheet Source is explicitly a
//            fresh copy started every year (TDD §2.8), a literal year
//            string goes stale on a fixed yearly schedule, not just once.
//            Fixed by matching any header starting with "date"
//            (case-insensitive) instead of one specific literal, so a
//            year-suffixed rename in any future year keeps working with no
//            code change required. Also applied to SIA, which had no
//            year-suffix fallback at all before this fix.
//   1.10-40 - TEMPORARY diagnostic build: 1.10-39's findDateValue fix
//            (matching any "date"-prefixed header) was reported as NOT
//            fixing the missing-date symptom - screenshot confirmed, real
//            authorities, still no date line anywhere. Rather than guess
//            at a third literal header string, added a one-time-per-sync
//            console.log of the AI/SIA sheet's actual raw row keys and a
//            full sample row, so the real header text (or the real
//            absence of any date value for these specific rows) is
//            confirmed directly from the live data instead of guessed at
//            again.
//   1.10-41 - Found and fixed the REAL cause of the recurring
//            fetchTransactionsBulk 404s (previously blamed, incorrectly,
//            on a stale build and then on a redeploy that never
//            happened). Confirmed via the Apps Script Executions log:
//            every doGet was completing successfully server-side, so the
//            script itself was never broken - only the response-delivery
//            layer. Root cause: once a sheet's real transaction history
//            grows large enough, Apps Script Web Apps automatically
//            switch to serving the response through a
//            script.googleusercontent.com/macros/echo?... redirect
//            instead of returning it directly, and that mechanism is
//            unreliable for a plain fetch() client - it started 404ing
//            on every call once this app's real production data crossed
//            that size threshold, with zero code or deployment change on
//            anyone's part. Fixed by paginating fetchTransactionsBulk
//            (both the Apps Script action - see
//            docs/apps-script-full-replacement.js, must be redeployed to
//            the live Web App - and the client, which now requests pages
//            of BULK_FETCH_PAGE_SIZE=500 rows and concatenates them)
//            instead of requesting a sheet's entire filtered history in
//            one response, so a page never gets large enough to trip
//            that mechanism at all.
//   1.10-42 - Corrected 1.10-41's root-cause theory after real evidence
//            disproved it: pagination did NOT actually fix the
//            fetchTransactionsBulk 404s. A direct Network-tab inspection
//            showed the true mechanism - Apps Script Web Apps route
//            EVERY GET response through a 302 redirect to a
//            script.googleusercontent.com/macros/echo?... content-
//            hosting URL when fetched via a plain fetch() client,
//            regardless of payload size (confirmed directly: a tiny,
//            0.1kB paginated response still went through the exact same
//            redirect, and 404'd on some attempts while succeeding on
//            others with no code or data change in between). This is a
//            transient-failure class of bug, not a size problem - the
//            same shape already fixed once before for POST requests via
//            postToSheetsWithRetry. Added a GET-flavored equivalent
//            (fetchWithRetry, 3 attempts with a short increasing delay)
//            and applied it to fetchTransactionsBulk, fetchAuthorityRows,
//            and fetchMillingOrderRows - all three go through the same
//            echo-redirect layer and are equally exposed to this
//            flakiness. Pagination (1.10-41) is kept regardless, since
//            smaller responses are still good practice even though they
//            weren't the actual fix here.
//   1.10-43 - Retry alone (1.10-42) didn't eliminate the Sheets sync
//            404s - some sheets (WSI/ESR/ESI especially) still exhausted
//            all three attempts often enough to matter. Built the real
//            structural fix: a new Vercel serverless function,
//            api/sheets-proxy.js, that makes every GET (read-only) call
//            to the Apps Script Web App server-to-server instead of the
//            browser calling it directly. A direct top-level browser
//            navigation to the exact same Apps Script URL never showed
//            the echo-redirect 404 at all, pointing squarely at
//            something specific to a browser-issued fetch() - a
//            server-to-server request from Vercel's Node runtime should
//            not exhibit that same behavior. Every GET call in
//            googleSheetsBridge.js (fetchTransactionsBulk,
//            fetchAuthorityRows, fetchMillingOrderRows,
//            fetchTransactionBySerial, fetchSerialFloorFromSheet) now
//            routes through this proxy via the new viaProxy() helper.
//            The doPost write actions are unaffected - no reported
//            symptom there, left calling Apps Script directly.
//   1.10-44 - Fixed the real cause of 1.10-43's new proxy consistently
//            502ing: Vercel's own function logs showed the actual error
//            was a plain AbortError from api/sheets-proxy.js's OWN
//            internal timeout (25s) firing - not Google rejecting or
//            rate-limiting the server-to-server request, which was the
//            worse possibility this looked like at first. That 25s
//            figure was a defensive guess (assuming a 10s Hobby-plan
//            function limit); the actual confirmed budget for this
//            project is 5 minutes, and the client itself was already
//            willing to wait 45s (BULK_FETCH_TIMEOUT_MS) - so the proxy
//            was aborting and returning 502 before the client's own,
//            more generous timeout ever got a chance to matter. Raised
//            the proxy's internal timeout to 60s and the client's bulk
//            timeout to 55s, keeping the proxy's budget safely above
//            the client's so the proxy is never the tighter constraint,
//            with headroom for the extra hop's own latency now that
//            every bulk GET routes through it.
//   1.10-45 - Confirmed the whole Sheets-sync saga (1.10-37 through
//            1.10-44) actually resolved: real-device log showed zero
//            404s/502s/AbortErrors across a full sync cycle. But the AI
//            tab still showed no date, confirmed by screenshot on real
//            authorities. Root cause: not a remaining sync bug at all -
//            every AI/SIA authority already synced onto a device before
//            1.10-39's findDateValue fix has a permanently-null `date`
//            field cached locally, and a normal delta (modifiedSince)
//            sync will never revisit an unchanged row to backfill it,
//            since nothing on the sheet itself actually changed - only
//            how the existing value gets READ changed. Added a Dexie
//            schema migration (v35, dexie.js) that clears every
//            sheetSource's lastSyncedAt once, the same shape already
//            used once before (v17) for an identical class of problem -
//            forces the very next sync on every device to pull every
//            row fresh, letting the upsert merge logic finally backfill
//            `date` onto every existing record, not just newly-synced
//            ones. Also removed 1.10-40's TEMPORARY [AUTHORITY-SYNC-DIAG]
//            logging now that it's served its purpose.
//   1.10-46 - Investigated the "continuous sync churn" open item flagged
//            and deferred twice earlier this session, prompted by
//            real-device evidence (Vercel logs) showing 10+ Apps Script
//            requests landing in the same ~30-second window, some
//            failing even through the new retry+proxy path. Found a
//            real, structural cause: AUTHORITY_SYNC_INTERVAL_MS (60s) is
//            an exact 2x multiple of TRANSACTION_SYNC_INTERVAL_MS (30s),
//            and both workers fire their first run immediately on login,
//            in the same tick - a plain setInterval never drifts, so
//            every OTHER transaction cycle permanently coincided with an
//            authority cycle for the rest of the session, a deterministic
//            burst of every periodic sync request this device makes
//            landing on Apps Script simultaneously, forever - not random
//            flakiness, a self-inflicted thundering-herd pattern, worse
//            across however many staff devices are open in the field at
//            once. Fixed with scheduleJittered (syncWorker.js) - a
//            self-rescheduling timer with ±20% randomized jitter each
//            cycle, replacing the fixed setInterval on both workers - and
//            staggered the authority worker's very first run 5-10s behind
//            the transaction worker's, so the two drift apart instead of
//            staying phase-locked.
//   1.10-47 - Reverted 1.10-43's Vercel proxy. It didn't fully eliminate
//            the original echo-redirect flakiness and introduced a
//            separate, new failure mode of its own: Vercel's own routing
//            to a newly-added serverless function intermittently 404ing
//            under this device's request volume, confirmed directly in
//            Vercel's own request logs (a mix of 200s and 404s for the
//            identical route within the same few minutes - not a missing
//            or failed deployment). Simplified back to calling Apps
//            Script directly from the browser for every GET action,
//            relying on fetchWithRetry (1.10-42) plus the jitter fix
//            (1.10-46, reduces how often multiple requests burst at
//            once) instead of adding another layer on top of a layer.
//            api/sheets-proxy.js is left in the repo, unused.
//   1.10-48 - Fixed the AI date for real, from ground truth instead of
//            another guess: user confirmed directly against the live
//            sheet that the date is Column A. Header-name matching was
//            never going to work reliably for it regardless of pattern
//            (confirmed literal "DATE (2026)", then a broader "any
//            date-prefixed header" match, neither actually fixed it).
//            Switched to the SAME raw-column-position technique this
//            sheet's own Regional Authority Number/Source Warehouse
//            fields already use, for the same reason. Server
//            (docs/apps-script-full-replacement.js, needs redeploying
//            to API.gs) now adds row['Date Column A'] directly; the
//            client reads that instead of guessing at header text. SIA
//            is untouched - its real header is confirmed, actually and
//            reliably named "DATE" (column B, not A - different sheet
//            layout), and was already displaying correctly.
//   1.10-49 - Found the true root cause, from the user directly: the AI
//            sheet's date column header cell had been deleted - no
//            header text existed at all, so no pattern-matching attempt
//            could ever have found it, explaining both prior failed
//            fixes at once. Header restored ("DATE"). Restored header-
//            name matching (findDateValue) as the primary read, per
//            explicit request ("better that we are looking for a header
//            name, just in case anything happens") - self-documenting
//            and survives a future year-suffix rename the way a fixed
//            column index wouldn't - but tried FIRST against
//            `Date Column A` (1.10-48's raw-position fallback, which the
//            server already adds unconditionally), so a header getting
//            blanked out again in the future degrades gracefully instead
//            of silently breaking the same way twice. SIA untouched -
//            already correct.
//   1.10-50 - Fixed why the date still didn't show even after the header
//            was fixed: v35's forced full pull (1.10-45) ran BEFORE the
//            header existed, so it correctly found nothing and saved
//            date: null - then stamped the sync as done. Editing only
//            the header cell afterward didn't help on its own, since the
//            sheet's onEdit trigger explicitly skips row 1, so no data
//            row's Last Modified changed and a normal delta sync had
//            nothing telling it to revisit anything. Added a v36 schema
//            migration (dexie.js), the exact same lastSyncedAt-clearing
//            shape as v17/v35, forcing one more full pull now that the
//            header is genuinely readable.
//   1.10-51 - Restored real visibility into the authorities sync path,
//            which had NONE at all - unlike syncMillingOrdersFromSheets'
//            own success log, a failed syncAuthoritiesFromSheets pass was
//            completely silent in the console, indistinguishable from
//            "hasn't run yet." Five minutes of real-device testing after
//            1.10-50 still showed no date, with no way to tell from the
//            console whether the sync was still failing outright or
//            succeeding while resolving the date wrong. Added TEMPORARY
//            diagnostic logging: a success/failure log for the whole
//            sync pass, and a one-time-per-pass log of exactly what the
//            first real AI row's date resolves to and from which source
//            (header match vs Column A fallback) - answers definitively
//            instead of guessing a sixth time.
//   1.10-52 - 1.10-51's logging showed real progress: the authority sync
//            is succeeding now (no more errors), but importing 0 AI and
//            0 SIA rows. Likely explanation, not yet confirmed: when
//            date-parsing was broken, it always resolved to null, which
//            silently BYPASSED the Date From cutoff filter (`if (aiDate
//            && aiDate < source.dateFrom) continue` never fires on a
//            null aiDate) - every row always got processed regardless of
//            its real date. Now that the date resolves correctly, real
//            dates earlier than the configured Date From (currently Aug
//            1, 2026) would - correctly, by that filter's own design -
//            get excluded for the first time, which could explain zero
//            rows importing if the sheet's real current data predates
//            that cutoff. Added one more TEMPORARY diagnostic: the raw
//            row count BEFORE filtering, and the first raw AI row
//            unfiltered, so this is confirmed directly instead of
//            guessed.
//   1.10-53 - Found it: aiRows.length was 0 at the SERVER response level
//            (before any client-side date/dateFrom filtering), while
//            siaRows.length was 467 - the same class of staleness bug
//            already hit twice this session (v17/v35/v36's fix), a third
//            time: once ANY sync pass succeeds (even with 0 AI rows, for
//            any transient reason), lastSyncedAt gets stamped, and since
//            a header-only edit never re-stamps any data row's own Last
//            Modified (the sheet's onEdit trigger skips row 1), every
//            later pass keeps asking "what changed since then" and
//            getting nothing back, permanently. Removed modifiedSince
//            entirely for the authorities fetch - always does a full
//            pull now, trading a small amount of bandwidth (SIA already
//            pulls several hundred rows with no apparent cost) for
//            eliminating this whole recurring bug class. lastSyncedAt is
//            still written for display (SheetSourcesPanel.jsx) and its
//            existing "Force Resync" button - just no longer read as a
//            filter.
//   1.10-54 - Two consecutive manual "Force Resync" failures confirmed
//            via the restored diagnostic log: sync FAILED: Sheet request
//            failed (404), the same echo-redirect flakiness, losing all
//            3 of fetchWithRetry's default attempts twice in a row on
//            fetchAuthorityRows specifically. Raised its own retry
//            budget to 6 attempts - six idempotent read requests cost
//            nothing in correctness and only add a few seconds in the
//            worst case, and give real additional headroom against a
//            run of bad luck on this one action.
//   1.10-55 - Sync itself was finally confirmed working (1.10-54's retry
//            budget did the trick: aiCount 207, siaCount 127, no 404s),
//            and the diagnostic log proved date extraction is correct
//            (aiDate: 2026-08-04, straight from row['DATE']) - but the
//            AI Completed list still showed specific old authorities
//            with no date. Root cause: the Date From cutoff filter (`if
//            (aiDate && aiDate < source.dateFrom) continue`, added back
//            in 1.10-48/1.10-49 to "ignore old experiments in the
//            sheet") ran unconditionally, before upsertAuthority was
//            ever called - so an authority that already existed locally
//            with date: null (synced back when the header was blank)
//            got permanently skipped by every later sync the moment its
//            real date turned out to predate the cutoff, and could never
//            backfill. Fixed by only applying the cutoff to genuinely
//            NEW records (`!aiCache.has(aiNum)` / `!siaCache.has(siaNum)`,
//            both already pre-built this sync run) - an already-known
//            authority now always goes through and gets its date (and
//            every other field) refreshed, regardless of age.
//   1.10-56 - 1.10-55 fixed the date bug (confirmed on a real device:
//            AI's Completed list now shows dates), but immediately
//            surfaced a second, more serious problem via the Admin
//            Dashboard's own Sync Identity diagnostic panel: SYNC
//            STATUS error/error, "HTTP 400: Too many changes in a
//            single sync request (maximum 1000 allowed)" - a
//            device-wide Dexie Cloud sync stall, not limited to
//            authorities. Root cause: upsertAuthority/upsertSiaAuthority
//            called db.authorities.update() unconditionally on every
//            matching row every sync pass, regardless of whether any
//            field actually differed from what was already stored.
//            Combined with 1.10-53's full-pull-always fetch and 1.10-55
//            letting old records back into the write path, this meant
//            literally every authority (1269 AI + 229 SIA, confirmed on
//            the diagnostic panel) got rewritten to Dexie on every
//            single pass - comfortably over Dexie Cloud's 1000-change-
//            per-push cap. Added a real "did anything change" check
//            (patchFieldsChanged / sackLinesEqual) before either upsert
//            calls db.authorities.update() - a write now only happens
//            when a field genuinely differs, so a steady-state sync
//            (the common case) costs close to zero Dexie Cloud changes
//            instead of ~1500 every time.
//   1.10-57 - 1.10-56 shipped but the Sync Identity diagnostic still
//            showed error/error on the SAME device, now with a
//            different symptom: HTTP 413 "request entity too large"
//            instead of the earlier HTTP 400. Investigated
//            dexie-cloud-addon's own source directly rather than
//            guessing again: it has NO built-in chunking for a sync
//            push - every attempt always bundles 100% of the local
//            unsynced backlog into one request (confirmed via
//            listClientChanges()'s call site in the addon bundle, no
//            limit passed). This device's local backlog - the
//            legitimate ~1000-record date backfill from 1.10-55, queued
//            before the write-skip fix landed - is a fixed, already-
//            recorded set of mutations that will keep retrying as the
//            same oversized request forever; it cannot self-heal by
//            waiting or reconnecting, and there is no documented
//            dexie-cloud-addon option to cap push size from our side.
//            Two real, in-our-control improvements landed instead of
//            another guess at a full fix: (1) upsertAuthority/
//            upsertSiaAuthority now send only the field(s) that
//            genuinely changed (`diffPatch`) instead of the whole
//            ~15-field record on every write, so any FUTURE bulk
//            correction stays small instead of recreating this same
//            failure mode at a smaller scale; (2) the Admin Dashboard's
//            existing Sync Identity diagnostic panel now shows a
//            read-only count of this device's actual pending unsynced
//            authority writes (`$authorities_mutations` table, read via
//            db.table().count()) so the backlog size is visible
//            directly instead of inferred from an HTTP status code.
//            Unsticking this specific device's existing backlog likely
//            needs either Dexie Cloud raising this database's per-
//            request size limit or a support conversation with them -
//            not something fixable from the app's own code alone.
//   1.10-58 - User's own correction to the whole approach since 1.10-53:
//            "we don't need to get every authority, just what changed,
//            and it must also respect the override date, so there is
//            not so much to fetch." Restored `modifiedSince` on the
//            client for fetchAuthorityRows - the Apps Script server side
//            never lost its support for it, only the client stopped
//            sending it, so no redeploy was needed. This directly
//            targets the real root cause behind the 22,470-mutation
//            backlog: a full pull-and-diff of ~1500 authorities every 5
//            minutes, for as long as this bug was being chased, none of
//            which ever successfully pushed. The staleness trap that
//            got modifiedSince removed in the first place (a header-only
//            edit never re-stamps a data row's Last Modified, so once
//            one pass succeeds the delta filter legitimately - but
//            wrongly, for a code-side parsing fix - returns nothing
//            forever) is covered by the EXISTING "Force Resync" button,
//            which already clears lastSyncedAt before syncing, giving a
//            full pull on demand without waiting on the periodic
//            background pass. Combined with 1.10-56's write-skip and
//            1.10-57's minimal-patch fixes, a healthy periodic sync
//            should now fetch, process, and write close to nothing most
//            passes - not the ~1500-row full reprocessing that caused
//            this incident.
//   1.10-59 - 1.10-58 stopped the backlog from growing further, but the
//            already-stuck 22,470 entries on the affected device don't
//            self-heal - dexie-cloud-addon has no built-in way to
//            partially push or trim it. User confirmed real transactions
//            (WSI/ESI/authority completions) were entered on that same
//            device during the incident, so a blanket clear of the
//            local sync queue was ruled out - it would risk silently
//            discarding real, not-yet-synced business data alongside
//            the sync noise. Added a real, evidence-based cleanup tool
//            instead: the Admin Dashboard's Sync Identity panel can now
//            inspect every pending authority mutation and classify it
//            precisely (confirmed against dexie-cloud-addon's own
//            mutation-tracking source: a single-key `.update()` call is
//            recorded as `{type: 'update', keys, changeSpecs}`) - an
//            entry is only ever "safe to clear" if EVERY key in its
//            patch is a pure Sheet-derived field, never
//            totalIssuedBags/totalIssuedKilos/manuallyCompleted/status/
//            sackLines (which mixes issuance data). Anything of a
//            different mutation type, or that fails to parse cleanly,
//            is always treated as must-keep. Clearing only removes this
//            device's local copy of corrections the Sheet will simply
//            re-derive and re-send on its next sync pass anyway - it
//            never touches other devices or the Sheet itself.
//   1.10-60 - 1.10-59's classifier came back with 0 of 22,470 entries
//            safe to clear - suspicious, and investigated rather than
//            accepted. Root cause: it only checked whether a patch's
//            KEYS included a business field, but the pre-1.10-56 code
//            that generated this whole backlog always included
//            totalIssuedBags/totalIssuedKilos/manuallyCompleted in
//            EVERY update call, unconditionally re-echoing whatever
//            `existing` already held at that moment - so every old
//            entry LOOKED like it touched real data, even though none
//            of them ever actually changed the value. Fixed by comparing
//            each patch's business-field VALUES against the authority's
//            current local value (one batched bulkGet building an
//            authorityMap, not a lookup per mutation) - only a genuine
//            value difference from what's there now counts as a real,
//            must-keep write. SIA's sackLines gets the same per-line
//            totalIssuedBags comparison, matched by (sackTypeId,
//            condition) since array order isn't guaranteed stable.
//   1.10-61 - 1.10-60's value-comparison fix STILL reported 0/22,470
//            safe - a second suspicious result, investigated again
//            rather than accepted. Classifier now returns WHY each
//            mutation was kept, not just yes/no. Working theory: this
//            whole incident ran many sync passes, each calling
//            pickCanonicalAuthority + bulkDelete(staleDuplicateIds) -
//            so a queued mutation's authId may no longer exist in
//            db.authorities at all (deleted later as a stale
//            duplicate). The previous "row not found -> can't verify,
//            must-keep" fail-safe silently folded every one of these
//            orphaned entries into the same bucket as genuine business
//            writes, which could plausibly explain the whole 22,470.
//            Orphaned entries are now tracked and surfaced as their own
//            category (clearable, same as pure sync noise) rather than
//            assumed either way - a mutation for a row that's already
//            been deleted can never be actionable, since the dedup step
//            already decided a different record holds the real state.
//   1.10-62 - 1.10-61 reported 22,470/22,470 "unrecognized" - every
//            single entry, a third suspicious result in a row,
//            investigated instead of shipped as-is. Root cause: the
//            classifier assumed dexie-cloud-addon's PUSH-time
//            canonicalized shape (`{type: 'update', keys, changeSpecs}`)
//            for what's stored in the RAW `$authorities_mutations`
//            table - wrong table-vs-transient-shape assumption. Traced
//            into Dexie CORE's own source (not the addon) this time:
//            `Table.update(key, changes)` is implemented as
//            `.where(':id').equals(key).modify(changes)` - always a
//            criteria-based modify, recorded as `{type: 'modify', keys,
//            criteria, changeSpec}` with a SINGULAR changeSpec, not the
//            assumed array. Every upsertAuthority/upsertSiaAuthority
//            write uses exactly this `.update(authId, patch)` form, so
//            this is the shape that actually matters. classifyMutation
//            rewritten against this confirmed shape.
//   1.10-63 - Sync incident fully resolved and confirmed (in-sync/
//            connected, 0 pending) - moved on to the follow-up request:
//            the date, now finally displaying reliably, moved from a
//            buried line five rows down (only visible once you'd
//            already read past warehouse/customer/variety) to a small
//            label in the card's own upper-right corner, visible at a
//            glance for every authority - AuthorityMonitor.jsx (the
//            user-facing Monitoring page) and AdminMonitoring.jsx (its
//            admin-side mirror, built to stay visually consistent with
//            it) both updated the same way.
//   1.10-64 - Denomination Count modal (SDO Cash on Hand reconciliation)
//            redesigned per explicit request: shown three demo directions
//            first (compact+sticky, bills-first-coins-collapsed, tap-to-
//            select), picked "A". Implemented: the totals/System Cash on
//            Hand/diff banner/Save button now live in their own fixed
//            footer below the denomination list, not inside the same
//            scrolling region as the 13 rows - previously you had to
//            scroll past every denomination to even see the diff or
//            reach Save. Rows are tighter (smaller padding/columns), and
//            a denomination with a zero subtotal dims instead of looking
//            identical to one that's actually been counted.
//   1.10-65 - 1.10-64 made the Denomination Count modal worse, not
//            better: the row grid had a FIXED, too-narrow subtotal
//            column (68px) while Bundles/Pcs stayed flexible - a
//            subtotal like ₱111,000.00 doesn't fit in 68px, so the row
//            (and the whole modal) overflowed horizontally, forcing a
//            sideways scrollbar that didn't exist before. Fixed by
//            inverting it: Bundles/Pcs are now fixed-narrow (44px,
//            maxLength 3 - neither ever needs more than 3 digits in
//            practice) and Subtotal takes the remaining space via
//            minmax(0,1fr), which can shrink instead of blowing out the
//            grid. Also added tabular-nums to every input and amount
//            (bundles, pcs, subtotal, counted total, cash on hand) so
//            digits stay aligned instead of jittering column width as
//            they change.
//   1.10-66 - 1.10-65's fixed-width grid columns still overlapped/
//            overflowed: a bare <input> carries a browser-default
//            intrinsic minimum width (as if sized ~20 characters), and
//            a CSS Grid item honors that minimum UNLESS `min-width:0`
//            is set on it - so even with explicit 44px tracks, the
//            inputs were forcing the row (and the whole modal) wider
//            than intended, which is what pushed the label under the
//            Bdl input and forced a sideways scrollbar. Added `min-w-0`
//            to every grid child (label, both inputs, subtotal) so each
//            can actually shrink to its assigned column instead of
//            demanding its own default minimum - the standard fix for
//            this exact, well-known Grid behavior. Verified this time
//            before shipping: built a standalone reproduction of the
//            same markup/classes and rendered it at a real 375px mobile
//            viewport in the browser pane - confirmed no horizontal
//            overflow and no label/input overlap, instead of shipping
//            on the same untested assumption twice in a row.
//   1.10-67 - 1.10-66 was confirmed still broken on the real device
//            (user was genuinely on that version - not a cache issue).
//            Real root cause, found by actually measuring against the
//            real Inter font this time (not the system-ui fallback a
//            local test page had been using without realizing it): "₱1000"
//            renders at ~43px in Inter, not the ~40px a narrow fixed
//            column assumed, so the label was still visually overflowing
//            onto the Bundles input (a Grid track doesn't clip a child's
//            overflowing content by default - min-width:0 only stops the
//            TRACK from being forced wider, it does nothing about text
//            painting past its own cell edge). Tried true equal-4
//            columns next per explicit request, but measured that too:
//            the widest subtotal ("₱111,000.00") needs ~90px against
//            only ~80px in an equal quarter-share, so it silently
//            truncated to "₱111,00…" - hiding a real peso figure, not
//            acceptable for a cash reconciliation tool. Landed on
//            measured widths: Bdl/Pcs/label equal at 50px (covers the
//            widest label with margin), Subtotal flexible (comfortably
//            covers the widest realistic amount). Verified in the
//            browser pane with the real Inter font loaded and real
//            375px mobile viewport before shipping - zero truncation,
//            zero overlap, zero overflow, confirmed programmatically
//            (scrollWidth checks) and visually (screenshot).
//   1.10-68 - 1.10-67 was confirmed still broken on the real device
//            too - now truncating labels ("₱1…", "₱0.…") instead of
//            overlapping. Three fixed-pixel guesses in a row each
//            worked on this session's own testing but not on the real
//            device, which points at some real device/font-scaling
//            difference this session can't fully reproduce - so this
//            pass stopped guessing a fourth number and changed the
//            approach structurally instead: the label column is now
//            `auto` (browser-computed from actual rendered content),
//            making truncation mathematically impossible regardless of
//            font metrics, zoom, or OS text-scaling, on any device.
//            Required merging all 13 rows into ONE shared grid (each
//            row is now a key'd Fragment, not its own nested grid) so
//            `auto` sizes from the WIDEST label across every row and
//            columns stay aligned top to bottom - the border/dimming
//            that lived on a row wrapper now applies to each of the
//            four cells individually. Bdl/Pcs stay equal to each other
//            at 50px (fixed-size input boxes, not variable text);
//            Subtotal stays flexible. Verified in the browser pane
//            against the real Inter font AND a deliberate 125% text-
//            scaling stress test (well beyond anything measured
//            before) - zero truncation, zero overlap, zero overflow.
//   1.10-69 - 1.10-68 fixed the overlap/truncation bug (confirmed on
//            the real device - every label and subtotal showed in
//            full), but the user's explicit, reiterated ask was
//            literal equal columns, which had been avoided because the
//            widest subtotal ("₱111,000.00") measured wider than an
//            equal quarter-share. Fixed the actual cause of that width
//            instead of the symptom: added fmtRowSubtotal, which drops
//            the unnecessary ".00" on a whole-peso amount. Every bill
//            denomination (₱1000 down to ₱1) is structurally always a
//            whole-peso multiple, so this only ever shortens exactly
//            the rows that needed the most room ("₱111,000.00" ->
//            "₱111,000") - the coin rows (₱0.25 and below) are the only
//            ones that can be genuinely fractional, and they're never
//            the widest value, so real cents are never hidden. The
//            footer's Counted total/System Cash on Hand keep full
//            2-decimal precision always. With that shrink, true
//            grid-cols-4 fits cleanly - verified in the browser pane
//            with the real seeded data (up to ₱111,000) before
//            shipping: no truncation, no overlap, everything within
//            the card's bounds.
//   1.10-70 - Two SDO fixes. (1) The exported "Abstract of Cereal
//            Purchases" PDF's Cash Reconciliation box always showed
//            "Fund available" as 0.00 - AbstractExportModal.jsx had it
//            hardcoded (`addAmount: 0`, never derived from anything),
//            and "COH — Fund Balance" could ALSO show 0.00 whenever a
//            replenishment landed on or after the report's own dateFrom
//            (that opening-balance calc only looks strictly before
//            dateFrom by design) - a mid-period replenishment then fell
//            into neither line, uncounted anywhere in the report even
//            though the live on-screen Cash Balance was correct. Fixed
//            by deriving "Fund available" from the same replenish/
//            liquidate cashLedgerV2 entries computeCashOnHand already
//            uses, scoped to the report's own [dateFrom, dateTo] window
//            instead of "before it" - fundBalance + addAmount - this
//            period's disbursements now reconciles correctly. (2) Added
//            a "For Encashment/Replenishment" field to the Denomination
//            Count modal - a check the SDO is physically holding but
//            hasn't deposited yet, per explicit request: still real
//            cash on hand even though it's not a bill or coin, so it
//            now feeds into Counted total the same as every
//            denomination row, and persists on the existing
//            cashDenominationCounts record (no schema change needed -
//            only sdoUid is indexed on that table).
//   1.10-71 - 1.10-70's Abstract PDF fix was functionally correct
//            (numbers reconciled properly) but showed two lines - "COH
//            — Fund Balance" and a separate "Fund available" - where
//            the SDO's own convention is one figure. Per explicit
//            correction: the ₱200,000 replenishment belongs directly in
//            "COH — Fund Balance", not next to it as a second number.
//            Folded opening balance + this period's replenish/liquidate
//            into one fundBalance in AbstractExportModal.jsx, and made
//            sdoAbstractPdfGenerator.js's ADD row conditional on
//            addAmount being non-zero (kept, not deleted, in case a
//            genuinely separate mid-period addition needs its own line
//            some future export) - so the box now reads exactly one
//            COH — Fund Balance figure, followed by disbursements and
//            the final total.
//   1.10-72 - Reported real bug: on a By Products entry, selecting an AI
//            then selecting a pile wiped the variety back to blank, even
//            though the AI itself already determines the variety.
//            Root cause in StockFormBase.jsx's handlePileChange: a By
//            Products pile can genuinely hold a mix of varieties, so
//            clearing varietyId on pile change is correct when nothing
//            else has pinned it yet - but it ran unconditionally, even
//            when an authority was already linked (handleSelectAuthority
//            already resolves and locks the variety from the AI itself
//            in that case). Fixed by only clearing when no authority
//            (linkedDocNo) is currently linked - matches the existing,
//            already-correct rule the other direction (picking a pile
//            BEFORE the authority: handleSelectAuthority clears a
//            mismatched pile rather than the other way around).
//   1.10-73 - Two real fixes, both reported directly. (1) Serious data
//            integrity bug: two consecutive weekly Stock Report PDFs
//            (Sep 1-7 vs Sep 8-15) disagreed on the carried-forward
//            balance - period 1's own Ending Balance was under-reported
//            by exactly one Cancelled transaction's bag/kilo count,
//            while period 2's independently-computed Beginning Balance
//            (Reports.jsx, already correctly Active-only) didn't repeat
//            that error, so the two periods silently stopped agreeing.
//            Root cause in pdfGenerator.js: Cancelled transactions are
//            deliberately kept in the receipts/issues arrays so
//            Statement pages can list them (labeled "CANCELLED") for
//            audit visibility - but every SUMMING function reusing
//            those same arrays (Summary balances, Recap totals, a
//            Statement page's own bottom TOTAL row, and their sack
//            equivalents) had no status filter at all, silently
//            counting a cancelled transaction's bags/kilos/pieces as
//            real stock movement. Added one shared `isCountable` filter
//            and applied it everywhere a real total gets accumulated -
//            never in the row-by-row listing itself, which still shows
//            Cancelled rows exactly as before. (2) Deleting an already-
//            Cancelled record (e.g. un-voiding) always triggered an
//            alarming "no matching row found on the Sheet" toast - a
//            cancelled document is deliberately never written to the
//            Sheet backup by policy, so that outcome is guaranteed and
//            expected, not a real discrepancy. queueTransactionDeletion
//            now takes an `expectMissing` flag, passed as true whenever
//            the caller (StockFormBase/SackFormBase/WTSForm, both
//            Delete and Un-void) already knows the record was Cancelled.
//   1.10-74 - The Cancelled-status fix (1.10-73) was confirmed real and
//            worth keeping, but re-exporting both weekly reports showed
//            the exact same numbers - it wasn't the cause of THIS
//            specific discrepancy. User-supplied on-screen evidence
//            (Beginning Balances panel + the Receipts/Issues tabs for
//            both periods) narrowed it further: the raw pile seeds
//            (91+490+740 = 1,321 bags / 65,371.610 kg) exactly match
//            what the Sep 8-15 report shows as ITS Beginning Balance -
//            meaning that period's "prior balance" query isn't
//            reflecting the 490 bags of real, Active WSI issues dated
//            Sep 1 and Sep 3, even though both dates are unambiguously
//            before Sep 8. Rather than guess a fourth theory, added a
//            TEMPORARY diagnostic logging exactly what
//            Reports.jsx's own prior-balance query finds for a given
//            stmtFrom - every matching transaction's date/type/pileId/
//            varietyId/bags, before and after the reportingCutoffDate
//            filter, plus the live existingPileIds set - so the real
//            cause can be confirmed from console evidence next export
//            instead of theorized further.
//   1.10-75 - Root cause of the beginning/ending balance mismatch found
//            and confirmed - NOT a code bug in the date-comparison logic
//            itself, which has always correctly matched its own
//            documented design. The real cause: this warehouse's
//            "Reports Start Date" (WarehousesPanel.jsx's per-warehouse
//            cutoff) was set to a specific date, and its OLD label/help
//            text read as inclusive ("Start Date" - the first day
//            counted), but the actual, always-documented rule is
//            exclusive - data dated ON OR BEFORE that date is excluded
//            everywhere (live stock, BIN Cards, every future report's
//            beginning balance), while a plain date-range list (Reports'
//            own current-period Receipts/Issues tabs) has no cutoff
//            filter at all and shows it normally - which is exactly
//            what made this look like two reports disagreeing with each
//            other, when it was one misconfigured date plus a genuinely
//            confusing field name. Reworded both WarehousesPanel.jsx's
//            per-warehouse field (now "Ignore Data On/Before") and
//            DataStartDatePanel.jsx's global override (whose OLD wording
//            actually contradicted its own code, saying "before" when
//            the real rule is "on or before") with explicit, worked
//            examples, so this exact misconfiguration is far harder to
//            repeat. Removed the temporary diagnostic added in 1.10-74
//            now that the cause is confirmed. 1.10-73's Cancelled-
//            transaction exclusion from report totals remains - a real,
//            separate, correct fix, just not the cause of this specific
//            report.
//   1.10-76 - Reported real bug: a Cancelled transaction with no
//            resolvable cereal category (an older record voided before
//            StockFormBase.jsx's category-preservation fix existed, or
//            a multi-pile group's "extra" record) fell back to
//            'Unknown' the same as any other transaction when building
//            the exported Stock Report's list of cereal types - and
//            since nothing else ever legitimately uses 'Unknown' as a
//            real category, this spawned a whole phantom "LOCAL
//            UNKNOWN" page set (Summary with every figure dashed out,
//            plus a Statement listing just that one cancelled row) for
//            a category that never had any real stock activity at all.
//            A Cancelled row WITH a known category was never the
//            problem - it already correctly folds into that category's
//            own real statement page, unchanged. Fixed by only counting
//            Active transactions toward which cereal types get a page
//            in the first place.
//   1.10-77 - Admin Home's Stock Age Grouping tab used to always show
//            Potential (actual minus unwithdrawn AI-authorized stock)
//            with no way to see raw Actual inventory by age bucket, and
//            no visibility into WHICH AIs made up the subtraction. Per
//            explicit request: added the same Actual/Potential PillToggle
//            the top card and Breakdown tab already use (same default -
//            Actual). When Potential is selected, any warehouse row with
//            real unwithdrawn stock now shows a tappable "X unwithdrawn"
//            button that opens the existing UnwithdrawnDetailModal
//            (already used by the Breakdown tab) scoped to that
//            warehouse + cereal category - the full list of contributing
//            AIs, each with its own allocated/withdrawn/unwithdrawn
//            split and every WSI/WTS document issued against it, instead
//            of the subtraction being an opaque number with nothing
//            behind it.
//   1.10-78 - 1.10-76's phantom-"Unknown"-page fix went one step too
//            far per direct correction: excluding Cancelled records
//            from which cereal types get a page meant an orphaned one
//            (broken/missing category - a legacy record voided before
//            category preservation existed) now vanished from the
//            export entirely, instead of showing correctly folded into
//            a real category's statement the way a properly-categorized
//            Cancelled row already does. Fixed by keeping such a record
//            OUT of which categories get a page (still no phantom
//            "Unknown" page), but routing it INTO the first real cereal
//            type's own statement listing instead of dropping it - the
//            only non-arbitrary choice once its true original category
//            can no longer be recovered, and the correct one in the
//            common case of a warehouse dealing in a single cereal type.
//   1.10-79 - Same fix as 1.10-78, applied to the on-screen Reports
//            list (Reports.jsx's own groupStock), which had the
//            identical bug: an orphaned-category Cancelled record
//            appeared under its own separate "UNKNOWN" heading, plus a
//            second, near-blank entry right before it. Display-only
//            grouping into the real category with the most activity in
//            the current list (never written back to the record's own
//            stored cerealCategory - purely which on-screen group it
//            renders under), and each cancelled row now shows a red
//            border, dimmed/disabled look, and a plain "CANCELLED"
//            label instead of trying to fill in the blank fields a void
//            deliberately clears - so it's clearly part of the list,
//            never mistaken for a genuine confirmed entry.
//   1.10-80 - 1.10-78/79's "closest real category" fallback was itself
//            wrong per direct correction: a series/serial number
//            belongs permanently to ONE cereal type (Rice and Palay
//            keep entirely separate series per warehouse), so a
//            Cancelled record's own stored cerealCategory is always
//            the correct, final answer for where it belongs - it must
//            never be reassigned just because this exact export/tab
//            happens to have no OTHER Active activity of that same
//            type in the current period. Both pdfGenerator.js's
//            generateNfaReport and Reports.jsx's groupStock only ever
//            counted ACTIVE transactions toward "which categories are
//            real" here, so a Cancelled-only Rice record showed up
//            under whatever category (e.g. By Products) happened to
//            have the most/first activity instead of its own true
//            Rice series. Fixed by honoring a record's own stored
//            category directly whenever it has one (Cancelled or not)
//            - only a genuinely orphaned record (no category ever
//            recorded at all - a legacy one voided before category
//            preservation existed) still falls back to a guess, since
//            that's the only case with no recoverable true answer.
//            Also fixed: the on-screen Reports list could show one
//            Cancelled record twice (a genuine duplicate Dexie record,
//            e.g. an unhealed Sheet-import placeholder) since it never
//            had the same type+warehouseId+serialNo+cerealCategory
//            dedup guard pdfGenerator.js's addStockStatementPage
//            already applies - added the identical guard here so the
//            on-screen list and the exported PDF always agree.
//   1.10-81 - 1.10-80 was still wrong on two counts per direct
//            correction, both now fixed:
//            (1) The on-screen dedup guard keyed on cerealCategory,
//            but the two real duplicate Dexie records for 26529454 both
//            had it null - so their normalized keys matched (should
//            have deduped) yet both still rendered. Root cause: a
//            Cancelled record has nothing left to legitimately
//            distinguish it by category (buildCancelledPayload wipes
//            every content field), so requiring an exact category match
//            to dedupe two Cancelled records was too strict - Active
//            records still require it (Rice #50 and Palay #50 ARE
//            legitimately different real documents), but two Cancelled
//            records sharing type+warehouse+serial are now always
//            treated as the same real document regardless of category.
//            (2) A cancelled document's serial number belongs to one
//            specific cereal-type series just like every other document
//            (Rice and Palay never share a series) - guessing its
//            category from "whichever real category this export/period
//            happens to have the most/first activity in" was never
//            actually correct, it just coincidentally looked right in
//            the single-category case. Per explicit correction: the
//            true category is knowable from the immediately surrounding
//            serials in that same document type's own series (e.g.
//            #9453 and #9455 both Rice means #9454, cancelled with no
//            category of its own, is provably Rice too) - added
//            Reports.jsx's resolveOrphanCategories to infer it that way
//            before either the on-screen list or the PDF export ever
//            sees the record, so both agree and neither creates a
//            phantom "Unknown" summary/statement page for a record that
//            demonstrably belongs to a real series. Also fixed a related
//            bug this surfaced: pdfGenerator.js's own fallback treated
//            the literal string 'Unknown' (which Reports.jsx's
//            enrichStock uses to normalize a truly-null category before
//            handing records to the PDF) as if it were a real category,
//            silently resurrecting the phantom page even after 1.10-80.
//   1.10-82 - Reports > Stock Statement's Stocks/Sacks tab and its
//            Receipts/Issues sub-tab below it were two separate stacked
//            toggle rows for what's really one choice ("which list am I
//            looking at") - merged into a single 4-way segmented control
//            (Stock Receipts / Stock Issues / Sack Receipts / Sack
//            Issues), 2 columns on narrow screens and 4 across from the
//            sm breakpoint up, dropping the page from 3 stacked toggle
//            rows to 2 before any data shows. Also: the exported PDF's
//            Stock Summary page ("SUMMARY OF WEEKLY STOCK RECEIPTS,
//            ISSUES AND BALANCES") only bolded the word "TOTAL" itself
//            on its totals row, leaving the actual beginning/receipts/
//            issues/ending figures next to it in plain weight - the
//            numbers are the point of a totals row, so the whole row is
//            now bold for visibility, matching every other report
//            page's totals row (which were already fully bold).
//   1.10-83 - Home's Activity panel stacked Milling Operations
//            (collapsible) directly above Authority Monitor (always
//            shown) on the same screen. Per explicit request, split
//            them into their own mutually-exclusive sub-tabs
//            (Authority | Milling/NFA Ricemill), matching the same
//            sliding-pill pattern as the Overview/Activity and
//            Stocks/Sacks tabs elsewhere on this page - only one
//            section is ever visible at a time now, defaulting to
//            Authority since it applies to every warehouse (the
//            sub-tab bar itself only appears for a warehouse that
//            actually has milling activity to switch to). Removed the
//            now-unused collapse/expand state and animation that used
//            to belong to the old Milling accordion button.
//   1.10-84 - Reports' date fields and its month-nav/preset picker
//            stacked as two separate rows even on wide screens, per
//            direct correction - now sit side by side from the lg
//            breakpoint up (dates fixed-width, preset picker filling
//            the rest), still stacked below it where there isn't room
//            for both. Applied to both the Summary and Statement tabs'
//            period controls, matching the merged segment row's own
//            same-shape responsiveness. Also: Reports' Export PDF
//            button and the Summary card's Save as image button were
//            both subtle outlined ghost buttons easy to miss - both
//            now solid, filled brand-neon buttons with real visual
//            weight, matching each other.
//   1.10-85 - 1.10-84's row-merge was corrected per direct feedback: the
//            Period From/To date fields stay their own row as before -
//            it's the Export PDF/Save as image button that now shares
//            that row (right-aligned), and separately the month-nav
//            (‹ Month ›) and preset pills (1-7/8-15/etc) merge into one
//            row together (PeriodPresetPicker.jsx itself, from the lg
//            breakpoint up - still stacked below it on narrow screens).
//            Save as image's export logic/canvas ref, previously
//            self-contained inside DailySummaryCard with its own button,
//            is now triggered imperatively (forwardRef +
//            useImperativeHandle) from a button Reports.jsx renders in
//            its own header row, matching Export PDF's position exactly.
//
//            Also added Procurement Monitoring: a 5th admin Monitoring
//            tab (AI/SIA/MILLING/NFA/PROCUREMENT) showing every
//            Procurement-type WSR (palay bought directly from farmers)
//            across every warehouse at once, one card per warehouse,
//            each row showing date, variety, the real counted bags and
//            net kilos (both prominent), with the derived net-bags
//            figure (kilos / 50) shown subtly alongside them - new
//            src/components/common/ProcurementMonitor.jsx.
//   1.10-86 - Per direct feedback, corrected 1.10-85's "divide by 2"
//            layout to a true 50/50 two-column grid (was an asymmetric
//            shrink-to-fit flex split) on both Reports.jsx's date+export
//            row and PeriodPresetPicker.jsx's month-nav+preset-pills
//            row, still stacked on narrow screens.
//
//            Rebuilt ProcurementMonitor.jsx's row layout (was too
//            crowded): bags now sits below the variety on the left;
//            net kilos (larger) and the derived net-bags figure
//            (smaller, subtle) sit on the right. Added a per-warehouse
//            TOTAL row, a search box (warehouse/variety), a variety
//            filter, a sort order (date/bags, asc/desc), and an
//            optional Period From/To range (blank = every Procurement
//            transaction ever recorded) using the same true 50/50 split.
//
//            Also: StockFormBase.jsx's Procurement-only RSBSA/Gender row
//            was a fixed 2-column grid at every width - now stacks on
//            narrow screens and sits side by side from sm up.
//   1.10-87 - Large SDO/export batch, all per explicit request:
//            - Abstract PDF (sdoAbstractPdfGenerator.js): rows now sort
//              ascending by PR Number (AbstractExportModal.jsx, numeric-
//              aware with a string fallback); the branch header block
//              and every column header/transaction-detail cell are
//              UPPERCASE; Equivalent Net Weight always displays 4
//              decimals everywhere (PDF and PurchaseReceiptModal.jsx's
//              own preview) - the underlying truncation precision that
//              determines the stored value is unchanged, this is
//              display-only; the black "Cash Reconciliation" header bar
//              is removed, the running-balance rows print on their own;
//              Address now comes right after the farmer's name, RSBSA
//              after Address (was Name -> RSBSA -> Address); "Sack"
//              relabeled "MTS"; a blank spacer row now prints before the
//              first transaction row and again right before TOTAL.
//            - The Whse column (and AbstractExportModal.jsx's warehouse
//              label) is now built fresh from each PR's own warehouse's
//              real province.code ("ALB-BSI B") instead of stripping
//              whatever prefix happened to already be baked into
//              warehouse.name.
//            - Buying Price: the old separate Dry/Wet inputs are now one
//              "Buying Price" field (BuyingPriceModal.jsx, SdoHome.jsx's
//              two price cards merged into one) - still writes the same
//              value into both existing dryPrice/wetPrice columns, so
//              every already-issued PR's own snapshotted cost is
//              unaffected and no schema change was needed. Also added a
//              real Effective From date picker (was silently always
//              "today"), so a price change can be backdated or scheduled.
//            - SdoHome.jsx's Unpaid WSR list could briefly show a
//              genuine duplicate Dexie record (e.g. a sync-race Sheet-
//              import placeholder) as two rows for the same WSR before a
//              background self-heal quietly caught up - added the same
//              display-level dedup guard Reports.jsx already uses, so
//              the SDO never sees a duplicate here at all.
//   1.10-88 - Per direct feedback: Reports.jsx's Save as image/Export
//            PDF buttons and PeriodPresetPicker.jsx's month-nav cluster
//            now actually fill their whole half of the 50/50 split (was
//            a narrow element anchored to one side, leaving empty space
//            beside it). Fixed the Abstract PDF's spacer rows (added
//            1.10-87) losing their border entirely instead of reading as
//            a clean empty row. A check-numbered period replenishment
//            (CashActionModal.jsx's refNo field) now prints as its own
//            line item in the Cash Reconciliation section instead of
//            being silently folded into one COH — Fund Balance figure -
//            the one-time "Opening balance" seed entry (no real check)
//            still folds in as before, since it has nothing to itemize.
//   1.10-89 - CRITICAL FIX: 1.10-83 removed the `useRef` import from
//            Home.jsx (thought unused after removing the old Milling
//            accordion's collapse state) but `warehouseSectionRef`
//            still used it - broke the entire Home page for every
//            regular user (ReferenceError: useRef is not defined) from
//            1.10-83 onward. Restored the import.
//
//            Also, per explicit correction, rebuilt ProcurementMonitor:
//            the variety filter is now a warehouse filter (cards are
//            already grouped by warehouse, so this jumps straight to
//            one); each warehouse's rows now group by variety with
//            their own subtotal; bags and net bags both display much
//            larger/more readable than the previous pass (net bags
//            especially had been left too small/subtle to read).
//   1.10-90 - Per direct feedback, ProcurementMonitor's Subtotal only
//            renders when a warehouse has 2+ varieties (a single-variety
//            card's subtotal just repeated its own TOTAL below it,
//            pointlessly); the variety heading is bigger/brighter; both
//            Subtotal and TOTAL are now bigger text, in the same shape
//            as each individual row - label with bags below it on the
//            left, net kilos with net bags stacked below it on the
//            right (was one condensed line each).
//   1.10-91 - AdminMonitoring.jsx's 5-tab bar (AI/SIA/MILLING/NFA/
//            PROCUREMENT) clipped "PROCUREMENT" on narrow screens - now
//            shrinks font size and abbreviates to "PROC" below the sm
//            breakpoint, full label/size from sm up.
//
//            Built the SDO Cancel/Delete PR feature, all per explicit
//            request:
//            - Cancel is now reachable by typing a PR number alone
//              (CancelPrModal.jsx, "Cancel PR" button on SdoHome.jsx),
//              no reason required - an already-issued PR is cancelled in
//              place, a number never issued is reserved straight at
//              status: 'Cancelled' with no real data behind it. Either
//              way it prints on the Abstract PDF as a CANCELLED row
//              (sdoAbstractPdfGenerator.js/AbstractExportModal.jsx now
//              include Cancelled PRs in the export, blank fields except
//              date/PR No., excluded from every total) so a gap in the
//              PR Number sequence is always explained.
//            - Delete is a separate, genuinely permanent action -
//              PurchaseReceiptModal.jsx's header now has both a Cancel
//              (amber, soft) and Delete (red, `.delete()`) button for an
//              issued PR; SdoHome.jsx's Completed tab gained its own
//              "Cancelled PRs" section (Cancelled PRs have no WSR to
//              attach to) with a Delete button per entry, since a
//              cancelled PR needs somewhere to be purged from entirely.
//   1.10-92 - Per direct feedback: removed CancelPrModal.jsx's
//            explanatory paragraph, and moved its trigger from
//            SdoHome.jsx to Settings.jsx's Cash Balance section (next to
//            Denomination Count/Cash History) - the "Cancelled PRs" list
//            + Delete on SdoHome.jsx's Completed tab is unaffected.
//   1.10-93 - ProcurementMonitor.jsx now tags each row Paid (green) or
//            Unpaid (amber) - Paid means an Active Purchase Receipt
//            exists for that WSR on the SDO side
//            (purchaseReceipts.wsrTransactionId), nothing derived from
//            the transaction itself. Added an All/Paid/Unpaid toggle
//            alongside the existing warehouse/sort/period filters.
//   1.10-94 - Per direct feedback, ProcurementMonitor's Paid/Unpaid tags
//            are bigger (text-xs, more padding - was text-[10px]).
//   1.10-95 - New feature: SDO Purchase Receipt backup to a Google Sheet
//            "SUMMARY" tab, admin-configured (SheetSourcesPanel.jsx
//            gains a "SUMMARY (Purchase Receipts)" sheet-name field,
//            same db.sheetSources record every other backup sheet
//            already uses). Fires automatically on issue/cancel/delete,
//            same isSynced/hasBeenBackedUp/pendingPrSheetDeletions-queue
//            pattern already proven for WSR/WSI/ESR/ESI backups
//            (syncWorker.js), extended in parallel rather than reusing
//            their type-dispatch tables (a Purchase Receipt is a
//            structurally different record). A Cancel updates the row
//            in place (blanks the figures, NAME becomes CANCELLED) so a
//            gap in the PR Number sequence is always explained; only a
//            genuine Delete removes the row entirely.
//
//            Per explicit correction: which of the admin's monthly
//            spreadsheets a row belongs to - and its own DATE column -
//            is resolved from the underlying WSR's own date (the real
//            delivery date), never the PR's own date (when the SDO
//            happened to record the payment) or today's date. A
//            pre-registered "never issued" cancelled PR (no real WSR)
//            falls back to its own date, having nothing else to go by.
//
//            Column headers match the real SUMMARY sheet's own header
//            row exactly, including its two blank spacer columns and
//            its two differently-punctuated RSBSA columns. REMARKS
//            (its own =IF(K2="GID 2","CTD","ALB") formula) is
//            deliberately never written to - that column belongs to the
//            sheet, per explicit decision. I/FA and GENDER are pulled
//            from the underlying WSR's own farmerCoops/farmerGender
//            fields, not stored redundantly on the PR record.
//
//            docs/apps-script-full-replacement.js (the template pasted
//            into each new monthly deployment) gained 'SUMMARY' in its
//            own WRITE_ALLOWLIST - no other server-side change needed,
//            since its generic appendTransaction/updateTransaction
//            actions already map by header name for any sheet.
//   1.10-96 - Fixed a real architectural mistake in 1.10-95: the SUMMARY
//            backup was sharing db.sheetSources with the WSR/WSI/ESR/ESI
//            backups, which all point at the "CONTROL NUMBER"
//            spreadsheet. Confirmed by the user: SUMMARY actually
//            belongs in the separate "PALAY DELIVERIES" spreadsheets -
//            different files, different URLs, one per month rather than
//            per year. Reusing db.sheetSources would have written PR
//            data into the CONTROL NUMBER file, never reaching PALAY
//            DELIVERIES at all. Gave the SUMMARY backup its own table
//            (db.prSheetSources, v38) and its own admin panel ("PR Sheet
//            Sources") - completely decoupled from Sheet Sources, so
//            configuring one can never redirect the other. The panel
//            groups its entries by year for easier scanning as more
//            months get added over time.
//   1.10-97 - Added a "Sync Now" button to PR Sheet Sources, for pushing
//            any Purchase Receipt not yet backed up to a Sheet
//            immediately (most useful right after adding a new month's
//            source, when there's already a real local backlog dated
//            into it). Also fixed a real bug found in the process: the
//            background sync's own PR-pending query used
//            `pr.isSynced === false`, which never matches `undefined` -
//            every Purchase Receipt issued before this backup feature
//            shipped has no isSynced field at all, so none of them were
//            ever being picked up automatically. Changed to
//            `pr.isSynced !== true`, which correctly treats "never set"
//            the same as "not yet synced".
//   1.10-98 - docs/apps-script-full-replacement.js only: replaced every
//            SpreadsheetApp.openById(SPREADSHEET_ID) (a hardcoded ID,
//            left over from the original single-spreadsheet script)
//            with SpreadsheetApp.getActiveSpreadsheet(). Per direct
//            question from the user: the deployed Web App URL a source
//            is configured with already IS what determines which
//            spreadsheet gets written to (Sheet Sources/PR Sheet
//            Sources both already say so in their own UI copy) - the
//            hardcoded ID contradicted that and would have silently
//            made a PALAY DELIVERIES deployment keep writing into the
//            CONTROL NUMBER file if this exact file were ever pasted in
//            unmodified, exactly as the file's own header comment
//            already claimed it could be. No app-side code changed -
//            this is a redeploy-only fix for whoever pastes the script
//            into a spreadsheet's Apps Script project next.
//   1.10-99 - Per explicit correction: a Cancelled Purchase Receipt must
//            never appear on the SUMMARY Sheet at all - the original
//            version of this feature was writing it as a blanked
//            "CANCELLED" placeholder row (matching the Abstract PDF's
//            own convention), but the user confirmed the Sheet itself
//            should follow the SAME convention already used for every
//            other cancelled document's backup: removed outright, never
//            shown. syncWorker.js's PR-sync loop now deletes (not
//            updates) a Cancelled PR's row - only if it was actually
//            backed up while Active; a placeholder PR that was
//            cancelled from the moment it was created (never issued)
//            has nothing to remove. A gap in the PR Number sequence is
//            still explained on the Abstract PDF, same as always - only
//            the Sheet backup's behavior changed. A v39 Dexie migration
//            resets isSynced on any already-cancelled-and-backed-up PR,
//            so existing "CANCELLED" rows already sitting on real
//            Sheets get cleaned up by the very next sync automatically.
//   1.10-100 - Per direct feedback from a real SUMMARY sheet: FARMER
//            MEMBER was showing "Name (RSBSA, Gender)" crammed into one
//            cell for a Farmers Association PR, duplicating what the
//            RSBSA NO./GENDER columns already exist for. FARMER MEMBER
//            now holds just the name(s); for a single-member FA, that
//            member's own RSBSA and gender fill the RSBSA NO./GENDER
//            columns directly (was pr.rsbsa/the WSR-level farmerGender
//            field, which are really the Individual farmer's own info
//            and don't represent an FA transaction). A v40 Dexie
//            migration resets sync state on already-backed-up FA PRs so
//            existing rows on real Sheets self-correct on the next sync.
//   1.10-101 - docs/apps-script-full-replacement.js only: fixed a real
//            reported bug - the SUMMARY sheet's hand-maintained REMARKS
//            formula (=IF(K2="GID 2","CTD","ALB")) kept getting silently
//            wiped on every sync. Root cause: appendTransaction/
//            updateTransaction built a full-width row array (blank
//            string for any header not sent, including REMARKS, which
//            the app deliberately never sends) and wrote the WHOLE row
//            in one setValues() call - "not sent" became "write blank"
//            for the entire row, clobbering REMARKS even though the app
//            never touched it directly. New writeRowCells() helper
//            writes only the specific cells the caller actually
//            provided, leaving every other column (REMARKS or anything
//            else hand-maintained) completely alone, on every sheet
//            this same code backs up (WSR/WSI/ESR/ESI/SUMMARY/MO/TMO).
//            No app-side code changed - redeploy-only fix.
//   1.10-102 - Fixed a real reported bug in the exported Stock Statement
//            PDF (pdfGenerator.js): the signatory block (Certified
//            Correct/Verified Correct/Audited By/Noted By) was drawn at
//            whatever Y a preceding table happened to end at, with no
//            check that it actually fit on the page - a long Statement
//            of Weekly Issues table pushed "Noted By" past the physical
//            page height, where jsPDF silently draws off-canvas, so it
//            never appeared at all - confirmed against a real export
//            where the exact same block rendered fine on the very next
//            (shorter) Recapitulation page. addSignatories now computes
//            its own required height up front and forces a page break
//            before drawing anything if it wouldn't fit, so signatories
//            are always present - extending onto a fresh page when
//            needed, never silently clipped. Applies to every page type
//            that calls addSignatories (stock summary/statement/recap,
//            sack summary/statement/recap).
//   1.10-103 - Per explicit request, the PR SUMMARY sheet's DATE column
//            now reads "9/21/2026" (M/D/YYYY, no leading zeros) instead
//            of this app's internal 'YYYY-MM-DD' format - new
//            toSheetDateFormat() helper in googleSheetsBridge.js. A v41
//            Dexie migration resets sync state on already-backed-up
//            Active PRs so existing Sheet rows self-correct on the next
//            sync, same cleanup pattern as v39/v40.
//   1.10-104 - Fixed the customer name autocomplete dropdown (and an
//            identical copy in Settings.jsx's classifier name field)
//            being unscrollable and cut off when a search (e.g. typing
//            "WS") matched many results - the <ul> had overflow-hidden
//            with no max-height, which clips extra rows entirely rather
//            than letting them scroll. Changed to max-h-72
//            overflow-y-auto (the pattern already used correctly
//            elsewhere in this app, e.g. UsersPanel.jsx), so a long
//            match list is now fully reachable by scrolling.
//   1.10-105 - Fixed the customer autocomplete dropdown still being cut
//            off after 1.10-104's fix: the previous fix made the list
//            itself scrollable, but it was still `position: absolute`
//            inside the WSR/WSI form modal's own scrollable body
//            (overflow-y-auto) - an absolutely-positioned element can
//            never render past its nearest scrolling ancestor's clipped
//            viewport, so the bottom of a long list stayed cut off
//            regardless of its own internal scroll. Now portals
//            straight to document.body and positions itself with
//            `fixed` + the input's live getBoundingClientRect(),
//            removing it from that ancestor entirely - repositions on
//            scroll/resize so it still tracks the input, and its own
//            max-height now adapts to whatever room is actually left
//            below the input on screen. Click-outside-to-close updated
//            to also recognize clicks inside the now-portaled dropdown
//            (previously would have closed it before a selection's own
//            click could register).
//   1.10-106 - New feature: WSR "Receive to another pile," the receipt-
//            side equivalent of WSI's existing "Issue from another
//            pile" - per explicit request, since a single WSR can
//            arrive with more stock than one pile alone should hold
//            (e.g. that pile is already near full). Reuses the exact
//            same mechanism WSI's version already proved out this
//            session (StockFormBase.jsx): each extra pile allocation
//            becomes its own separate transaction record sharing the
//            primary's groupSerialNo, letter-suffixed serial, and full
//            atomic save/update/delete/void handling - Reports.jsx's
//            on-screen grouping, pdfGenerator.js's PDF grouping, and
//            serialRename.js's group-aware renaming all already
//            operate on `transactions` generically (never gated to
//            WSI specifically), so they combine a multi-pile WSR for
//            free with no changes needed there.
//
//            Two real differences from WSI's version, both fixed:
//            (1) a WSI line draws its OWN pile's current stock down
//            and is capped by it - a WSR line only ADDS, so that
//            same-shaped ceiling check (extraAllocInfos' overKilos/
//            overBags) is now gated behind the same `isIssuance` check
//            the primary pile's own fields already used, so a receipt
//            is never wrongly blocked by "not enough already in that
//            pile." (2) reverseGroupEffect and two spots inside
//            handleUpdate hardcoded `type: 'WSI'` when reversing an
//            extra allocation's pile effect on delete/edit - correct
//            only because this whole feature never existed for any
//            other type before now. Fixed to use the record's own real
//            type (primary.type / extraUpdated.type / updated.type)
//            instead, so reversing a WSR line correctly subtracts back
//            out rather than incorrectly adding, which the literal
//            'WSI' would have silently done.
//   1.10-107 - Fixed the "Additional pile" selector (WSI "issue from
//            another pile" / WSR "receive to another pile") showing
//            only the bare pile name, unlike the primary pile selector
//            just above it, which shows "PILE NAME (VARIETY)" - per
//            direct feedback, made hard to tell apart piles sharing a
//            similar name. Now uses the exact same label format as the
//            primary selector.
//   1.10-108 - Per explicit request, simplified the "MC % (Moisture
//            Content)" field label to just "MC %" on every entry form
//            (StockFormBase.jsx's primary pile fields and its
//            Additional pile allocation rows, WTSForm.jsx).
//   1.10-109 - Shortened the authority (AI/SIA) background sync interval
//            from 60s to 20s, per explicit request after discussing the
//            tradeoffs (still a poll, not true push - no cost increase
//            on the Apps Script side, a modest increase in requests
//            through Vercel's sheets-proxy function, no logic changed).
//            Cuts worst-case latency for a Sheet edit reaching the app
//            from ~60s to ~20s.
//   1.10-110 - Large batch of direct feedback fixes:
//            - MillingMonitor.jsx: AI/SIA number now shown in-line with
//              the MO/TMO number itself (list card + detail sheet), for
//              every role - was only ever in the admin-only AI/SIA tab.
//            - StockFormBase.jsx (Procurement): the "FA" (Farmers
//              Organization) toggle moved to sit in-line with the
//              Customer Name label itself (was its own separate section
//              far down the form). The top-level RSBSA/Gender fields
//              now hide entirely whenever FA is on - per explicit
//              request, a whole association can't be represented by one
//              person's RSBSA/Gender; that data only ever lives per-
//              member in the Members list now. Every save path (add,
//              PurchaseReceiptModal's rememberCustomer calls, edit)
//              guards farmerRsbsa/farmerGender behind !farmerOrgEnabled
//              too, not just the UI, so a stale value typed before
//              toggling FA on can never sneak into a save.
//            - PurchaseReceiptModal.jsx: RSBSA display/save now joins
//              every FA member's own RSBSA into one string
//              (resolvedRsbsa) instead of reading the now-always-null
//              top-level wsr.farmerRsbsa: the Payee block shows each
//              member's name/RSBSA/Gender individually for FA, or the
//              single RSBSA/Gender for an Individual, same as before.
//            - PurchaseReceiptModal.jsx: the Buying Price lookup now
//              resolves against the WSR's own date, not whenever the
//              SDO pays (datePaid/existingPr.date) - per explicit
//              correction, a WSR delivered before a price change must
//              still use the OLD price even if paid after the change.
//            - AbstractExportModal.jsx: falls back to computing the
//              same joined multi-RSBSA string from a WSR's farmerCoops
//              for an older PR issued before resolvedRsbsa existed, so
//              its Abstract row isn't left blank.
//            - sdoAbstractPdfGenerator.js: NET column header renamed to
//              NET WT; MC column now shows one decimal (14 -> "14.0");
//              signatory NAMES print in full caps, Role/Position stays
//              exactly as entered (Title Case).
//            - New shared fmtMc() helper (calculations.js), applied
//              everywhere MC displays - Piles.jsx's pile detail popups
//              and pileLayoutPdfGenerator.js's exported Pile Layout PDF
//              boxes - for the same one-decimal formatting, not just
//              the Abstract.
//   1.10-111 - Follow-up fixes from direct feedback on the previous
//            batch:
//            - MillingMonitor.jsx: every MO/TMO genuinely carries BOTH
//              its own AI and SIA (confirmed against the real Sheet) -
//              now shows both in-line with the number, not just
//              whichever one happened to be checked first.
//            - FARMER MEMBER/RSBSA NO./GENDER (PR SUMMARY sheet AND the
//              main WSR/WSI CONTROL NUMBER backup) were only ever
//              populated for an FA transaction with EXACTLY one member -
//              a real reported bug, confirmed against a live sheet
//              showing blank RSBSA/GENDER for a 2-member FA row. Now
//              joins every member's own name/RSBSA/gender with "/",
//              for any number of members.
//            - AbstractExportModal.jsx: the Abstract PDF's RSBSA column
//              could show a stale/WRONG value left over from before
//              resolvedRsbsa existed (a non-empty pr.rsbsa always won,
//              even when it didn't match any real member) - now always
//              recomputes fresh from the WSR's own farmerCoops whenever
//              one exists, overriding whatever pr.rsbsa holds.
//            - PurchaseReceiptModal.jsx's own resolvedRsbsa switched
//              from ", " to "/" to match the same separator convention
//              used everywhere else this session.
//            - v42 Dexie migration re-queues already-backed-up FA PRs
//              for resync again, so existing Sheet rows pick up this
//              fix too, not just newly-issued PRs.
//   1.10-112 - Direct feedback round:
//            - The "/" separator joining multiple FA members now has a
//              space on each side ("A / B") everywhere it's used - the
//              SUMMARY sheet, the main WSR/WSI backup, the Abstract PDF,
//              and PurchaseReceiptModal.jsx's own display - so a report
//              or spreadsheet column naturally overflows/wraps between
//              entries instead of running them together. v43 migration
//              re-queues already-backed-up FA PRs once more.
//            - MillingMonitor.jsx: AI/SIA moved off the MO/TMO number's
//              own line to a bordered column on the right side of the
//              card (list row and detail sheet), for clearer visual
//              separation from the rest of the card.
//            - pdfGenerator.js's addSignatories page-fit check (added
//              1.10-102) was more conservative than it needed to be -
//              recomputed the required-height estimate to match exactly
//              what gets drawn (was padded ~8mm over the real need) and
//              reduced the footer safety margin from 12mm to 8mm, so a
//              table with genuinely enough room below it (confirmed
//              against a real export wasting most of a page) no longer
//              gets pushed to a wasted extra page unnecessarily.
//            - SdoHome.jsx: the Abstract Export button was too easy to
//              miss (small, same muted treatment as a secondary button) -
//              now a real accent-colored action with an icon. Stacks
//              onto its own full-width row below the For Payment/
//              Completed tabs on narrow screens instead of competing
//              for space in the same row, rejoining it at sm+.
//   1.10-113 - Direct feedback round:
//            - MillingMonitor.jsx: AI/SIA moved to the actual top-right
//              CORNER of the card (absolutely positioned, no longer
//              vertically centered with the whole card), shown side by
//              side as two distinct pills instead of stacked, so they
//              read as clearly separate values. Same treatment in the
//              detail sheet's header.
//            - sdoAbstractPdfGenerator.js: RSBSA NO. column given a
//              fixed, modest width (was auto-sizing to fit a now-
//              multi-value RSBSA, squeezing every other column) - wraps
//              a multi-value RSBSA onto a second line instead.
//            - New feature: Milling Overview panel (built from the "G1"
//              demo), sitting above the MO/TMO list - one automatically
//              per tab (Milling/Test Milling), since it's built from
//              whichever tab's own pending list is already showing. A
//              donut (On Hand / Partial / Ready to Complete, using the
//              same "fulfilled" signal the pending list's own
//              needsConfirmation cue already relies on) plus a capped,
//              priority-sorted per-order status list where an overdue
//              On Hand order (nothing received back for 7+ days) gets
//              its own flagged treatment in place.
//   1.10-114 - Direct feedback round:
//            - MillingMonitor.jsx's new Overview panel now scales up on
//              wider screens instead of staying exactly mobile-sized -
//              bigger donut, larger legend text, and the Per-Order
//              Status list flows into a 2-column (sm) / 3-column (lg)
//              grid once there's genuinely room, instead of one narrow
//              column with empty space beside it. Row cap raised from 5
//              to 6, which divides evenly into both grid widths.
//            - sdoAbstractPdfGenerator.js's page margin reduced from
//              12mm (~0.47in) to 0.3in, per explicit request, freeing up
//              more width for the actual report content.
//   1.10-115 - MillingMonitor.jsx's Overview panel: per-order sub-line
//            now shows the actual warehouse the stock moved through,
//            not the MO/TMO number (already this whole panel's own
//            context). Confirmed: "On Hand" means a warehouse has
//            issued stock TO the ricemill, nothing back yet - that row
//            shows the ISSUING warehouse (from the order's own issue
//            transactions). Partial/Ready to Complete shows the
//            RECEIVING warehouse instead (order.receivingWarehouse,
//            falling back to a receipt transaction's own warehouse).
//   1.10-116 - MillingMonitor.jsx: AI/SIA badges moved back in-line with
//            the MO/TMO number (same row, right edge), per explicit
//            feedback that the corner-badge version (1.10-113) was too
//            small to read and added extra height to every card. Now
//            larger (text-xs, more padding) and sits on the number's own
//            row, adding no extra vertical space. Same treatment in the
//            detail sheet header.
export const APP_VERSION = '1.10-116'
