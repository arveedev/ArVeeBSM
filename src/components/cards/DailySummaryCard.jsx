// Summary Card — at-a-glance summary grouped by cereal type → transaction
// type → variety. Uses the shared date range from the Reports page (the
// page itself owns the "Summary" heading and date pickers — this card
// only shows the period inline in its own header).
//
// For Procurement transactions, shows the count of individual farmers vs
// farmer associations (and their member counts) directly below the
// variety row, since procurement reporting cares about how many distinct
// suppliers were involved, not just the volume moved.
//
// "Save as image" exports the card as a JPEG via html2canvas for sharing.
// The trigger button itself is NOT rendered here - per explicit request
// it sits in Reports.jsx's own header row alongside the period date
// fields, for the same row layout as the Statement tab's Export PDF
// button. This component exposes an imperative `exportImage()` (via
// forwardRef) for that button to call, and reports its own busy state
// up through `onExportingChange` so Reports.jsx's button can show the
// same spinner/label states without duplicating the export logic here.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import html2canvas from 'html2canvas'
import toast from 'react-hot-toast'
import { useWarehouse } from '../../context/WarehouseContext.jsx'
import { useSettings } from '../../context/SettingsContext.jsx'
import { db } from '../../db/dexie.js'
import { fmtBags, fmtKilos, todayLocalISO } from '../../utils/calculations.js'
import { splitStockTransactions } from '../../utils/wtsAdapter.js'

const STOCK_TYPES = ['WSR', 'WSI', 'WTS']
const PROCUREMENT_TYPE_NAME = 'Procurement'

const DailySummaryCard = forwardRef(function DailySummaryCard({ dateFrom, dateTo, onExportingChange }, ref) {
  const { currentWarehouse } = useWarehouse() ?? {}
  const { weightUnit } = useSettings() ?? {}
  const cardRef = useRef(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    onExportingChange?.(exporting)
  }, [exporting, onExportingChange])

  const today = todayLocalISO()
  const effectiveFrom = dateFrom || today
  const effectiveTo = dateTo || today

  const rawTx = useLiveQuery(async () => {
    if (!currentWarehouse) return []
    return db.transactions
      .where('warehouseId').equals(currentWarehouse.warehouseId)
      .and((t) =>
        STOCK_TYPES.includes(t.type) &&
        t.status === 'Active' &&
        !t.isInitialBalance &&
        t.date >= effectiveFrom &&
        t.date <= effectiveTo
      )
      .toArray()
  }, [currentWarehouse?.warehouseId, effectiveFrom, effectiveTo])

  const varieties = useLiveQuery(() => db.varietyTypes.toArray(), []) ?? []
  const txTypes = useLiveQuery(() => db.transactionTypes.toArray(), []) ?? []

  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const txTypeMap = new Map(txTypes.map((t) => [t.transactionTypeId, t]))

  const { receipts: rawReceipts, issues: rawIssues } = splitStockTransactions(rawTx ?? [])

  const enrich = (t) => ({
    ...t,
    varietyName: varietyMap.get(t.varietyId)?.name ?? '—',
    cerealCategory: varietyMap.get(t.varietyId)?.category ?? 'Unknown',
    transactionTypeName: txTypeMap.get(t.transactionTypeId)?.name ?? t.type,
  })

  const txList = [...rawReceipts.map(enrich), ...rawIssues.map(enrich)]

  // Group by: cereal type → transaction type → variety → { bags, kilos,
  // individualFarmers (Set of names), coopCount, coopMemberCount }
  const groups = {}
  for (const t of txList) {
    if (!groups[t.cerealCategory]) groups[t.cerealCategory] = {}
    const txTypeName = t.transactionTypeName
    if (!groups[t.cerealCategory][txTypeName]) groups[t.cerealCategory][txTypeName] = {}
    if (!groups[t.cerealCategory][txTypeName][t.varietyName]) {
      groups[t.cerealCategory][txTypeName][t.varietyName] = {
        bags: 0, kilos: 0,
        individualFarmers: new Set(),
        coopCount: 0,
        coopMemberCount: 0,
      }
    }
    const entry = groups[t.cerealCategory][txTypeName][t.varietyName]
    entry.bags += t.numberOfBags ?? 0
    entry.kilos += t.netKilos ?? 0

    if (txTypeName === PROCUREMENT_TYPE_NAME) {
      if (t.farmerCoops?.length) {
        entry.coopCount += 1
        entry.coopMemberCount += t.farmerCoops.length
      } else if (t.customerName) {
        entry.individualFarmers.add(t.customerName)
      }
    }
  }

  const totalTx = txList.length
  const hasData = totalTx > 0

  const periodLabel = effectiveFrom === effectiveTo
    ? new Date(effectiveFrom + 'T00:00:00').toLocaleDateString('en-PH', { day: 'numeric', month: 'long', year: 'numeric' })
    : `${new Date(effectiveFrom + 'T00:00:00').toLocaleDateString('en-PH', { day: 'numeric', month: 'short' })} – ${new Date(effectiveTo + 'T00:00:00').toLocaleDateString('en-PH', { day: 'numeric', month: 'short', year: 'numeric' })}`

  const handleExport = async () => {
    if (!cardRef.current) return
    setExporting(true)
    try {
      // Reported real bug, three earlier attempts (document.fonts.ready,
      // removing `truncate`'s ellipsis, normal-nums overriding tabular-
      // nums) all shipped with no effect - variety names like "PD1m-A"
      // kept rendering as garbled/illegible glyphs in the exported image,
      // always correct on-screen. Every user report was from an iPhone;
      // reproducing this same export in a desktop Chromium browser
      // (against the app's real, built CSS and fonts) never showed the
      // severe corruption at all - only a harmless minor spacing quirk.
      // That points squarely at a Safari/WebKit-specific html2canvas bug,
      // a well-documented category of issue around CUSTOM webfont
      // handling (this app's Inter font ships as 35 separate @font-face
      // entries, subsetted by unicode-range, per weight) - not something
      // reproducible or verifiable from a desktop testing environment.
      //
      // Rather than continue guessing at which exact CSS property
      // triggers it, this sidesteps the entire bug category: the
      // captured card temporarily switches to a plain system font stack
      // (already installed on the device, never subsetted, never
      // downloaded, nothing for html2canvas/WebKit to mishandle) for the
      // duration of the html2canvas capture only, then restores Inter
      // immediately after - the live on-screen card is completely
      // unaffected, only the exported image's font differs.
      const originalFontFamily = cardRef.current.style.fontFamily
      cardRef.current.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      await document.fonts?.ready
      let canvas
      try {
        canvas = await html2canvas(cardRef.current, {
          backgroundColor: '#0A0A0A',
          scale: 2,
          useCORS: true,
        })
      } finally {
        cardRef.current.style.fontFamily = originalFontFamily
      }
      const filename = `BSM-Summary-${currentWarehouse?.code ?? 'WH'}-${effectiveFrom}.jpg`

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      const file = new File([blob], filename, { type: 'image/jpeg' })

      // Mobile browsers often don't actually save a programmatic download
      // link to the photo gallery - the file just lands somewhere in
      // internal storage, invisible to the user. The Web Share API's
      // native share sheet includes a "Save Image"/"Save to Photos"
      // option that reliably does reach the gallery, so it's preferred
      // whenever the browser supports sharing files.
      if (navigator.canShare?.({ files: [file] })) {
        toast.success('Choose "Save Image" to add it to your photo gallery')
        await navigator.share({ files: [file], title: filename })
      } else {
        const link = document.createElement('a')
        link.download = filename
        link.href = URL.createObjectURL(blob)
        link.click()
        URL.revokeObjectURL(link.href)
        toast.success('Summary image saved - check your Downloads folder or gallery')
      }
    } catch (err) {
      // AbortError fires when the user simply closes the share sheet
      // without picking anything - not a real failure, don't show an
      // error toast for it.
      if (err?.name === 'AbortError') return
      console.error('Summary image export error:', err)
      toast.error('Export failed — try again')
    } finally {
      setExporting(false)
    }
  }

  useImperativeHandle(ref, () => ({ exportImage: handleExport }))

  return (
    <div className="mt-2">
      <div ref={cardRef} className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-neon">
            NFA — BSM Summary
          </p>
          <p className="mt-0.5 text-lg font-bold text-app-text">
            {currentWarehouse?.code ?? '—'} · {currentWarehouse?.name ?? '—'}
          </p>
          <p className="text-xs text-neutral-500">{periodLabel}</p>
        </div>

        <div className="mt-4 border-t border-neutral-800 pt-4 space-y-4">
          {!hasData && (
            <p className="text-center text-xs text-neutral-600">
              No transactions in this period.
            </p>
          )}

          {Object.entries(groups).sort().map(([cerealType, byTxType]) => (
            <div key={cerealType}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-neutral-500">
                {cerealType}
              </p>

              {Object.entries(byTxType).sort().map(([txTypeName, byVariety]) => (
                <div key={txTypeName} className="mb-3">
                  <p className="mb-1.5 text-xs font-medium text-neutral-400">{txTypeName}</p>
                  <div className="space-y-1">
                    {Object.entries(byVariety).sort().map(([varietyName, totals]) => {
                      const isProcurement = txTypeName === PROCUREMENT_TYPE_NAME
                      const individualCount = totals.individualFarmers?.size ?? 0
                      return (
                        // Reported bug, four earlier wrong fixes
                        // (document.fonts.ready, removing `truncate`'s
                        // ellipsis, normal-nums overriding tabular-nums,
                        // a system-font swap during capture) all shipped
                        // with no effect: variety names exported cut off
                        // mid-word (e.g. "PD1m-A" and "PD1m-B" both
                        // showing as just "PD1m" + a stray mark), always
                        // correct on-screen. Finally root-caused by
                        // building an actual reproduction of the real
                        // export (this app's real code, real login, real
                        // seeded data) and inspecting the real output
                        // JPEG directly, instead of guessing from a
                        // description: html2canvas was measuring this
                        // row's CSS Grid `1fr` track (grid-cols-[1fr_
                        // 4rem_7rem], the previous layout here) far
                        // narrower than the live DOM does - a well-known
                        // html2canvas weak spot with CSS Grid's `fr`
                        // unit - and the name span's overflow-hidden
                        // then clipped whatever didn't fit inside that
                        // wrongly-narrow measured width. Rebuilt as
                        // plain Flexbox with explicit pixel widths on
                        // the two numeric columns (matching the old
                        // 4rem/7rem exactly - w-16/w-28) instead of a
                        // `1fr` track - flexbox with fixed widths is
                        // historically far more reliably measured by
                        // html2canvas than CSS Grid ratio units.
                        // Verified against this exact fix, in an
                        // isolated reproduction, before shipping.
                        <div key={varietyName} className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="min-w-0 flex-1 break-words text-xs text-app-text">{varietyName}</span>
                            <div className="w-16 shrink-0 text-right">
                              <p className="text-xs text-neutral-500">Bags</p>
                              <p className="whitespace-nowrap font-mono text-sm font-semibold tabular-nums text-app-text">{fmtBags(totals.bags)}</p>
                            </div>
                            <div className="w-28 shrink-0 text-right">
                              {/* Unit is already this card's own weightUnit
                                  setting - no per-value "kg"/"MT" suffix
                                  needed (that used to be wide enough to
                                  push "kg" onto its own line), just a
                                  unit-aware label instead. */}
                              <p className="text-xs text-neutral-500">Net {weightUnit === 'mt' ? 'MT' : 'Kilos'}</p>
                              <p className="whitespace-nowrap font-mono text-sm font-semibold tabular-nums text-brand-neon">
                                {weightUnit === 'mt'
                                  ? Number(totals.kilos / 1000).toLocaleString('en-PH', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
                                  : fmtKilos(totals.kilos)}
                              </p>
                            </div>
                          </div>
                          {isProcurement && (individualCount > 0 || totals.coopCount > 0) && (
                            <p className="mt-1 text-[11px] text-neutral-500">
                              {individualCount > 0 && `${individualCount} individual farmer${individualCount !== 1 ? 's' : ''}`}
                              {individualCount > 0 && totals.coopCount > 0 && ' · '}
                              {totals.coopCount > 0 && (
                                `${totals.coopCount} farmer association${totals.coopCount !== 1 ? 's' : ''} (${totals.coopMemberCount} member${totals.coopMemberCount !== 1 ? 's' : ''})`
                              )}
                            </p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        <p className="mt-4 border-t border-neutral-800 pt-2 text-right text-[10px] text-neutral-700">
          BSM by ArVee · {effectiveFrom}
        </p>
      </div>
    </div>
  )
})

export default DailySummaryCard
