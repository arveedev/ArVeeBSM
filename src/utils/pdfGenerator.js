// PDF report generation for NFA warehouse stock statements.
// Uses jsPDF + jspdf-autotable to produce a properly formatted document
// matching the NFA's existing paper forms as closely as possible.
//
// Signatory lines (from db.signatories + db.reportConfig):
//   Prepared By       — the logged-in Warehouse Supervisor (their name
//                       and configured certifiedCorrectPosition)
//   Certified Correct — same Warehouse Supervisor block (NFA convention)
//   Verified Correct  — from reportConfig.verifiedCorrect (1 or more)
//   Audited By        — from reportConfig.auditedBy
//   Noted By          — from reportConfig.notedBy

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { db } from '../db/dexie.js'

const DARK = [10, 10, 10]        // #0A0A0A
const LIGHT = [250, 250, 250]     // near-white for alternating rows
const MID = [230, 230, 230]       // light gray for header bg
const BLACK = [0, 0, 0]

const TYPE_LABELS = {
  WSR: 'Warehouse Stock Receipt',
  WSI: 'Warehouse Stock Issuance',
  WTS: 'Warehouse Transfer Stock',
  ESR: 'Emptied Sack Receipt',
  ESI: 'Emptied Sack Issuance',
}

/**
 * Formats a date string (ISO) to "DD MMM YYYY" for the report.
 */
const fmtDate = (dateStr) => {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * Generates a stock statement PDF for the given warehouse, filtered to
 * the provided transaction rows, and opens it in a new browser tab (or
 * triggers download on mobile). Returns the jsPDF instance so callers
 * can do further processing if needed.
 */
export const generateStockStatementPdf = async ({
  warehouse,
  province,
  transactions,
  dateFrom,
  dateTo,
  currentUser,
}) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const margin = 14

  // ── Header ──────────────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...BLACK)
  doc.text('NATIONAL FOOD AUTHORITY', pageW / 2, 16, { align: 'center' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(
    `${province?.name ?? ''} — ${warehouse?.name ?? ''} (${warehouse?.code ?? ''})`,
    pageW / 2,
    21,
    { align: 'center' }
  )

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('WAREHOUSE STOCK STATEMENT', pageW / 2, 27, { align: 'center' })

  const dateRange =
    dateFrom || dateTo
      ? `${dateFrom ? fmtDate(dateFrom) : 'Start'} – ${dateTo ? fmtDate(dateTo) : 'Present'}`
      : 'All Dates'
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(dateRange, pageW / 2, 32, { align: 'center' })

  // ── Transaction table ────────────────────────────────────────────────────
  const varieties = await db.varietyTypes.toArray()
  const varietyMap = new Map(varieties.map((v) => [v.varietyId, v]))
  const piles = await db.piles.toArray()
  const pileMap = new Map(piles.map((p) => [p.pileId, p]))
  const txTypes = await db.transactionTypes.toArray()
  const txTypeMap = new Map(txTypes.map((t) => [t.transactionTypeId, t]))

  const stockTx = transactions.filter((t) => ['WSR', 'WSI', 'WTS'].includes(t.type))
  const sackTx = transactions.filter((t) => ['ESR', 'ESI'].includes(t.type))

  if (stockTx.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('STOCK TRANSACTIONS (WSR / WSI / WTS)', margin, 38)

    autoTable(doc, {
      startY: 40,
      margin: { left: margin, right: margin },
      headStyles: { fillColor: MID, textColor: BLACK, fontSize: 7, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7, textColor: BLACK },
      alternateRowStyles: { fillColor: LIGHT },
      head: [[
        'Date',
        'Type',
        'Serial No.',
        'Transaction',
        'Customer',
        'Pile',
        'Variety',
        'Bags',
        'Gross Kg',
        'Net Kg',
        'Condition',
      ]],
      body: stockTx.map((t) => {
        const pile = pileMap.get(t.pileId)
        const variety = varietyMap.get(t.varietyId)
        const txType = txTypeMap.get(t.transactionTypeId)
        return [
          fmtDate(t.date),
          t.type,
          t.serialNo ?? '—',
          txType?.name ?? '—',
          t.customerName ?? '—',
          pile?.pileName ?? '—',
          variety?.name ?? '—',
          t.numberOfBags?.toLocaleString() ?? '—',
          t.grossKilos?.toFixed(2) ?? '—',
          t.netKilos?.toFixed(2) ?? '—',
          t.condition ?? '—',
        ]
      }),
    })
  }

  if (sackTx.length > 0) {
    const afterStockY = doc.lastAutoTable?.finalY ?? 40
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('SACK TRANSACTIONS (ESR / ESI)', margin, afterStockY + 8)

    autoTable(doc, {
      startY: afterStockY + 10,
      margin: { left: margin, right: margin },
      headStyles: { fillColor: MID, textColor: BLACK, fontSize: 7, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7, textColor: BLACK },
      alternateRowStyles: { fillColor: LIGHT },
      head: [['Date', 'Type', 'Serial No.', 'Transaction', 'Customer', 'Lines (Code / Cond / Pcs)']],
      body: sackTx.map((t) => {
        const txType = txTypeMap.get(t.transactionTypeId)
        const linesSummary = (t.sackLines ?? [])
          .map((l) => {
            const sackType = db.sackTypes ? null : null // resolved at render time below
            return `${l.pieces} (${l.condition})`
          })
          .join(', ')
        return [
          fmtDate(t.date),
          t.type,
          t.serialNo ?? '—',
          txType?.name ?? '—',
          t.customerName ?? '—',
          linesSummary || '—',
        ]
      }),
    })
  }

  // ── Summary totals ───────────────────────────────────────────────────────
  const totalNetKilos = stockTx.reduce((s, t) => {
    const sign = t.type === 'WSI' ? -1 : 1
    return s + (t.netKilos ?? 0) * sign
  }, 0)
  const totalBags = stockTx.reduce((s, t) => {
    const sign = t.type === 'WSI' ? -1 : 1
    return s + (t.numberOfBags ?? 0) * sign
  }, 0)

  const summaryY = (doc.lastAutoTable?.finalY ?? 40) + 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(
    `Net movement: ${totalBags.toLocaleString()} bags · ${totalNetKilos.toFixed(2)} kg net`,
    margin,
    summaryY
  )

  // ── Signatory blocks ─────────────────────────────────────────────────────
  const reportConfig = await db.reportConfig.get('global')
  const supervisorSignatory = currentUser
    ? await db.signatories.get(currentUser.uid)
    : null

  const sigY = summaryY + 14
  const colW = (pageW - margin * 2) / 3
  const lineGap = 5

  const renderSignatoryBlock = (label, name, position, x, y) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.text(label.toUpperCase(), x, y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    const nameLine = y + lineGap * 2.5
    doc.line(x, nameLine - 1, x + colW - 4, nameLine - 1)
    doc.text(name ?? '________________________', x, nameLine)
    doc.setFontSize(7)
    doc.text(position ?? '', x, nameLine + 4)
  }

  // Row 1: Prepared By | Certified Correct | Verified Correct (first one)
  renderSignatoryBlock(
    'Prepared By',
    currentUser?.name,
    supervisorSignatory?.certifiedCorrectPosition,
    margin,
    sigY
  )
  renderSignatoryBlock(
    'Certified Correct',
    currentUser?.name,
    supervisorSignatory?.certifiedCorrectPosition,
    margin + colW,
    sigY
  )

  const firstVerified = reportConfig?.verifiedCorrect?.[0]
  renderSignatoryBlock(
    'Verified Correct',
    firstVerified?.name,
    firstVerified?.position,
    margin + colW * 2,
    sigY
  )

  // Additional Verified Correct rows if configured
  const extraVerified = (reportConfig?.verifiedCorrect ?? []).slice(1)
  let extraY = sigY + lineGap * 4.5
  for (const sig of extraVerified) {
    renderSignatoryBlock('Verified Correct (cont.)', sig.name, sig.position, margin + colW * 2, extraY)
    extraY += lineGap * 4.5
  }

  // Row 2: Audited By | Noted By
  const row2Y = Math.max(sigY + lineGap * 5, extraY + 4)
  renderSignatoryBlock(
    'Audited By',
    reportConfig?.auditedByName,
    reportConfig?.auditedByPosition,
    margin,
    row2Y
  )
  renderSignatoryBlock(
    'Noted By',
    reportConfig?.notedByName,
    reportConfig?.notedByPosition,
    margin + colW,
    row2Y
  )

  // ── Footer ───────────────────────────────────────────────────────────────
  const pageCount = doc.internal.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(150)
    doc.text(
      `Generated ${new Date().toLocaleString('en-PH')} · Page ${i} of ${pageCount}`,
      pageW / 2,
      doc.internal.pageSize.getHeight() - 8,
      { align: 'center' }
    )
  }

  return doc
}

/**
 * Resolves sack type codes for sack transaction lines, for use in the
 * sack transactions table. Called separately because db.sackTypes can't
 * be accessed synchronously inside the pdf builder.
 */
export const enrichSackLines = async (transactions) => {
  const sackTypes = await db.sackTypes.toArray()
  const sackTypeMap = new Map(sackTypes.map((s) => [s.sackTypeId, s]))

  return transactions.map((t) => ({
    ...t,
    sackLines: (t.sackLines ?? []).map((l) => ({
      ...l,
      code: sackTypeMap.get(l.sackTypeId)?.code ?? '?',
    })),
  }))
}
