// Lets a report generator hand its content to the Excel exporter as well as the PDF.
//
// A generator that is given a `capture` array records, next to every thing it prints,
// the same content as plain data (title lines, headings, tables, signatories). The Excel
// exporter (reportExcel.js) turns that record into a workbook, so the Excel file always
// holds exactly what the PDF holds - same rows, same totals - without a second set of
// calculations that could drift apart from the first.
//
// Nothing here changes how a PDF is drawn. Without a capture array every call is a no-op.

import autoTableBase from 'jspdf-autotable'

/** Same as autoTable(doc, options), and records the table (head, body, foot) when capturing. */
export const autoTable = (doc, opts) => {
  const rec = doc.__cap ? { kind: 'table', head: opts.head, body: opts.body, foot: opts.foot, showFoot: opts.showFoot } : null
  if (rec) doc.__cap.push(rec)
  const out = autoTableBase(doc, opts)
  if (rec) {
    // The printed geometry, so the Excel sheet can use the same column proportions and indent.
    const m = opts.margin
    rec.startX = typeof m === 'number' ? m : (m && m.left) ?? 14
    rec.colWidths = (doc.lastAutoTable?.columns ?? []).map((c) => c.width)
    rec.colHalign = Object.fromEntries(Object.entries(opts.columnStyles ?? {}).filter(([, v]) => v && v.halign).map(([k, v]) => [k, v.halign]))
    rec.headStyle = opts.headStyles
    rec.pageW = doc.internal.pageSize.getWidth()
    rec.pageH = doc.internal.pageSize.getHeight()
  }
  return out
}

/** Records one piece of content on the capture array attached to `doc` (if any). */
export const cap = (doc, record) => { if (doc.__cap) doc.__cap.push(record) }

/** Attaches the capture array to a freshly created document. */
export const attachCapture = (doc, capture) => { if (capture) doc.__cap = capture; return doc }
