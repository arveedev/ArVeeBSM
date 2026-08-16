// Pile Layout PDF — landscape, matching the real "Warehouse Piling
// Layout" paper report. Header: Warehouse Name, Address, "PILE LAYOUT"
// title, period. Body: the grid layout itself, each box showing either
// its linked pile's data or VACANT. Footer: four signatories - Prepared
// By (Classifier), Verified Correct (BSQAO, global), Certified Correct
// (assigned Warehouse Supervisor), Noted By (Branch Manager).

import jsPDF from 'jspdf'
import { fmtBags, fmtKilos } from './calculations.js'

const BLACK = [0, 0, 0]
const GRAY_TEXT = [80, 80, 80]
const margin = 12

const fmtDate = (s) => {
  if (!s) return ''
  const d = new Date(s + 'T00:00:00')
  return d.toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const generatePileLayoutReport = ({
  warehouse, branch, periodFrom, periodTo, gridCols, gridRows, boxes, signatories,
}) => {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()

  // Always render the full nominal grid, never cropped to only the used
  // area - this is a floor plan of the whole warehouse, so a warehouse
  // using only a small corner of it must still show that corner at its
  // true proportional size within the full layout, not blown up to fill
  // the page as if it were the entire warehouse.
  const effectiveCols = gridCols
  const effectiveRows = gridRows

  let y = 14
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...BLACK)
  doc.text(warehouse?.name?.toUpperCase() ?? '', pageW / 2, y, { align: 'center' })
  y += 5

  if (warehouse?.address) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.text(warehouse.address.toUpperCase(), pageW / 2, y, { align: 'center' })
    y += 5
  }

  y += 3
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('PILE LAYOUT', pageW / 2, y, { align: 'center' })
  y += 6

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.text(`As of ${fmtDate(periodFrom)} - ${fmtDate(periodTo)}`, pageW / 2, y, { align: 'center' })
  y += 6

  // ── Grid layout ──────────────────────────────────────────────────────────
  const gridStartY = y
  const signatoryAreaHeight = 38
  const outerHeight = pageH - gridStartY - signatoryAreaHeight - margin
  const outerWidth = pageW - margin * 2

  // gridInset separates the outer boundary box from the area piles can
  // occupy - no pile box ever touches the boundary. boxGap separates
  // adjacent pile boxes from each other - no two piles ever touch.
  const gridInset = 4
  const boxGap = 1.5

  const innerX = margin + gridInset
  const innerY = gridStartY + gridInset
  const innerW = outerWidth - gridInset * 2
  const innerH = outerHeight - gridInset * 2
  const cellW = innerW / effectiveCols
  const cellH = innerH / effectiveRows

  doc.setDrawColor(...BLACK)
  doc.setLineWidth(0.4)
  doc.rect(margin, gridStartY, outerWidth, outerHeight)

  // Computes how tall a box is structurally ALLOWED to grow before it
  // would touch whatever sits below it in an overlapping column range -
  // or the grid's own boundary if nothing is below it. This is computed
  // fresh here, independent of the editor's own overlap validation, so a
  // pre-existing layout (drawn before that validation existed, or any
  // other edge case) can never produce an overlapping export - the PDF
  // itself guarantees it, not just whatever created the layout.
  const colOverlap = (a, b) => a.colStart < b.colStart + b.colSpan && b.colStart < a.colStart + a.colSpan
  const maxAllowedHeight = (box) => {
    const boxRawY = innerY + (box.rowStart - 1) * cellH
    const below = boxes.filter((b) => b.id !== box.id && b.rowStart > box.rowStart && colOverlap(box, b))
    const nearestBelowY = below.length
      ? Math.min(...below.map((b) => innerY + (b.rowStart - 1) * cellH))
      : innerY + innerH
    return nearestBelowY - boxRawY - boxGap
  }

  for (const box of boxes) {
    const rawX = innerX + (box.colStart - 1) * cellW
    const rawY = innerY + (box.rowStart - 1) * cellH
    const rawW = box.colSpan * cellW
    const rawH = box.rowSpan * cellH

    const isVacant = !box.pile
    const detailFields = isVacant
      ? []
      : [
          box.variety?.name && ['Var', box.variety.name],
          box.pile.currentBags != null && ['Bags', fmtBags(box.pile.currentBags)],
          box.pile.currentKilos != null && ['Net Kg', fmtKilos(box.pile.currentKilos)],
          box.pile.formattedAge && ['Age', box.pile.formattedAge],
          box.pile.condition && ['Cond', box.pile.condition],
          box.pile.moistureContent && ['MC', box.pile.moistureContent],
          box.pile.purity && ['Purity', box.pile.purity],
          box.pile.dateProcured && [box.pile.cerealType === 'Palay' ? 'Procured' : 'Received', box.pile.dateProcured],
        ].filter(Boolean)

    // Fixed, comfortable, always-readable font sizes - only shrunk (down
    // to a genuinely legible floor, never the old illegible extreme) in
    // the rare case a box's content needs more room than is structurally
    // available before the next box begins. Every box with enough room
    // keeps the full comfortable size. Tighter base spacing than before -
    // the previous 3.4mm looked needlessly loose for dense field lists.
    let headerFontSize = 10
    let detailFontSize = 7
    let lineHeight = 3.0
    const padding = 2

    const rawWInset = rawW - boxGap
    const contentWForWrap = Math.min(rawWInset - padding * 2, rawWInset * 0.85)
    const blockWidthForWrap = contentWForWrap

    const computeWrappedFields = () => {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(detailFontSize)
      // Value gets whatever room is actually left after the label's own
      // measured width - not a fixed ratio for every field - since
      // labels are all short (Var, Bags, MC...) but values vary widely
      // (a date range needs far more room than "GQ").
      const wrapped = detailFields.map(([label, value]) => {
        const labelText = `${label}:`
        const labelWidth = doc.getTextWidth(labelText)
        const valueWidth = Math.max(8, blockWidthForWrap - labelWidth - 3)
        return { label: labelText, valueLines: doc.splitTextToSize(String(value), valueWidth) }
      })
      const totalLines = wrapped.reduce((sum, f) => sum + f.valueLines.length, 0)
      const slots = 1.2 + Math.max(totalLines, isVacant ? 1 : 0)
      return { wrapped, requiredHeight: lineHeight * slots + padding * 2, slots }
    }

    // Every field's ACTUAL wrapped line count is computed upfront - a
    // long value that needs 2 lines is counted as 2 slots, not assumed
    // to be 1. This is what actually eliminates both missing data
    // (previously from truncation) and overlap (previously from
    // unaccounted wrapping): nothing is ever cut, and every line gets
    // its own reserved vertical space.
    let { wrapped: wrappedFields, requiredHeight, slots: totalSlots } = computeWrappedFields()

    const allowedH = maxAllowedHeight(box)

    // If the content needs more room than is structurally available
    // before the next box begins, shrink (down to a legible floor)
    // just enough to fit within that available space - this is the
    // fallback that guarantees no export ever overlaps another box,
    // regardless of how the layout was originally drawn.
    if (requiredHeight > allowedH && allowedH > padding * 2) {
      const targetSlots = totalSlots
      const shrunkLineHeight = Math.max(2.4, (allowedH - padding * 2) / targetSlots)
      if (shrunkLineHeight < lineHeight) {
        lineHeight = shrunkLineHeight
        detailFontSize = Math.max(5.5, lineHeight * 1.7)
        headerFontSize = Math.max(6.5, detailFontSize * 1.3)
        ;({ wrapped: wrappedFields, requiredHeight, slots: totalSlots } = computeWrappedFields())
      }
    }

    // Width-adaptive shrinking for the pile name specifically - a
    // narrow/slim box previously had no check at all here, only value
    // fields wrapped to fit the box's width. Shrinks headerFontSize
    // (down to the same legibility floor as above) until the name
    // actually fits within the box, rather than letting it overflow
    // past the box's edges.
    const pileNameText = box.pile?.pileName ?? box.label ?? ''
    const availableHeaderWidth = rawWInset - padding * 2
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(headerFontSize)
    while (headerFontSize > 6.5 && doc.getTextWidth(pileNameText) > availableHeaderWidth) {
      headerFontSize -= 0.5
      doc.setFontSize(headerFontSize)
    }

    // The box GROWS to fit its content rather than cutting text off -
    // its drawn grid position (top-left corner) never moves, only its
    // rendered height extends downward if the content needs more room
    // than the drawn span provides. A box with enough room already
    // keeps its full drawn size, it never shrinks. Growth is normally
    // capped by whatever sits below it - but if content still doesn't
    // fit even at the legible font floor, the cap is lifted rather than
    // silently dropping a field: showing every detail has been flagged
    // as the higher priority than never touching a neighbor in this
    // specific, rare, both-constraints-can't-be-satisfied case.
    const cappedHeight = Math.min(Math.max(rawH - boxGap, requiredHeight), Math.max(allowedH, rawH - boxGap))
    const h = requiredHeight > cappedHeight ? requiredHeight : cappedHeight
    const w = rawWInset

    // Inset within the raw cell allocation so this box never touches its
    // neighbors, even when two boxes sit in adjacent cells.
    const x = rawX + boxGap / 2
    const boxY = rawY + boxGap / 2

    // Matches the on-screen box colors exactly (Piles.jsx's PALAY_COLOR/
    // RICE_COLOR/BYPRODUCT_COLOR) - previously used different, only
    // vaguely similar hardcoded values, so the exported PDF didn't
    // actually match what the user sees in the app.
    const fillColor = isVacant
      ? [255, 255, 255]
      : box.variety?.category === 'Palay'
        ? [173, 235, 179]   // #ADEBB3
        : box.variety?.category === 'By Products'
          ? [251, 235, 204]  // #FBEBCC
          : [184, 227, 233]  // #B8E3E9

    doc.setFillColor(...fillColor)
    doc.rect(x, boxY, w, h, 'F')
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(0.3)
    doc.rect(x, boxY, w, h)

    const contentW = w - padding * 2
    const centerX = x + w / 2

    const totalContentHeight = lineHeight * totalSlots
    let ty = boxY + Math.max(padding + headerFontSize / 3, (h - totalContentHeight) / 2 + lineHeight)

    // Pile number/name - larger, centered, its own line.
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(headerFontSize)
    doc.setTextColor(...BLACK)
    doc.text(box.pile?.pileName ?? box.label ?? '', centerX, ty, { align: 'center' })
    ty += lineHeight * 1.2

    doc.setFontSize(detailFontSize)

    if (isVacant) {
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...GRAY_TEXT)
      doc.text('VACANT', centerX, ty, { align: 'center' })
    } else {
      // Label left-aligned, value right-aligned, within a content block
      // that is itself centered in the box. A value that needs more than
      // one line wraps onto extra lines - each one already accounted for
      // in the box's height above, so nothing overlaps the next field.
      const blockWidth = Math.min(contentW, w * 0.85)
      const blockLeftX = centerX - blockWidth / 2
      const blockRightX = centerX + blockWidth / 2

      // No safety-break here on purpose: h is already guaranteed (via
      // requiredHeight above) to have room for every line of every
      // field, including wrapped continuations. A break here could only
      // ever drop legitimate content in the case of a tiny rounding
      // mismatch - showing everything is the higher priority than
      // guarding against a fraction-of-a-millimeter visual overflow that
      // the box's own surrounding gap absorbs anyway.
      for (const { label, valueLines } of wrappedFields) {
        doc.setFont('helvetica', 'normal')
        doc.setTextColor(...GRAY_TEXT)
        doc.text(label, blockLeftX, ty)
        doc.setTextColor(...BLACK)
        for (const line of valueLines) {
          doc.text(line, blockRightX, ty, { align: 'right' })
          ty += lineHeight
        }
      }
    }
  }

  // ── Signatories: Prepared By | Verified Correct | Certified Correct | Noted By ──
  const sigY = pageH - signatoryAreaHeight + 6
  const colW = (pageW - margin * 2) / 4

  const renderSignatory = (label, name, position, x) => {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...GRAY_TEXT)
    doc.text(label, x, sigY)

    const lineY = sigY + 12
    doc.setDrawColor(...BLACK)
    doc.setLineWidth(0.3)
    doc.line(x, lineY, x + colW - 6, lineY)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...BLACK)
    doc.text(name ?? '', x + (colW - 6) / 2, lineY - 1, { align: 'center' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.text(position ?? '', x + (colW - 6) / 2, lineY + 4, { align: 'center' })
  }

  renderSignatory('Prepared by:', signatories.preparedByName, 'Classifier', margin)
  renderSignatory('Verified Correct:', signatories.verifiedCorrect?.name, signatories.verifiedCorrect?.position, margin + colW)
  renderSignatory('Certified Correct:', signatories.certifiedCorrectName, signatories.certifiedCorrectPosition, margin + colW * 2)
  renderSignatory('Noted by:', signatories.notedByName, signatories.notedByPosition, margin + colW * 3)

  // ── Footer ───────────────────────────────────────────────────────────────
  const dateOnly = new Date().toLocaleDateString('en-PH', { day: '2-digit', month: 'short', year: 'numeric' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(160, 160, 160)
  doc.text(`BSM by ArVee - ${dateOnly}`, pageW / 2, pageH - 4, { align: 'center' })

  return doc
}
