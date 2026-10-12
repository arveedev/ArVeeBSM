// Disbursement Voucher (DV) and Budget Utilization Request and Status (BUR) for the SDO's CPF replenishment.
//
// Page 1 is the DV on a full A4. Page 2 is an A4 holding TWO identical BURs, one above the other, so cutting the
// sheet along the dashed line gives two copies. Both forms are drawn from the same data the Abstract export has:
// the payee is the SDO, the amount is the replenishment (the total of the paid PRs), and the signatories are the
// Abstract's (Verified By certifies, Noted By approves).

import jsPDF from 'jspdf'

const MONTHS = ['JAN.', 'FEB.', 'MAR.', 'APR.', 'MAY', 'JUNE', 'JULY', 'AUG.', 'SEPT.', 'OCT.', 'NOV.', 'DEC.']

const parts = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return { y, m, d } }

/** "OCT. 9-10, 2026", "OCT. 9, 2026", "SEPT. 30 - OCT. 2, 2026" or across years in full. */
export const fmtDatedRange = (fromIso, toIso) => {
  if (!fromIso || !toIso) return ''
  const a = parts(fromIso), b = parts(toIso)
  if (a.y === b.y && a.m === b.m) return a.d === b.d ? `${MONTHS[a.m - 1]} ${a.d}, ${a.y}` : `${MONTHS[a.m - 1]} ${a.d}-${b.d}, ${a.y}`
  if (a.y === b.y) return `${MONTHS[a.m - 1]} ${a.d} - ${MONTHS[b.m - 1]} ${b.d}, ${a.y}`
  return `${MONTHS[a.m - 1]} ${a.d}, ${a.y} - ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`
}

/** "TO: REPLENISHMENT OF CPF FOR THE PAID PR #first TO last" plus " DATED ..." only when the setting is on. */
export const replenishmentParticulars = ({ firstPrNo, lastPrNo, dateFrom, dateTo, showDated }) => {
  const range = firstPrNo && lastPrNo && firstPrNo !== lastPrNo ? `#${firstPrNo} TO ${lastPrNo}` : `#${firstPrNo ?? ''}`
  const dated = showDated && dateFrom && dateTo ? ` DATED ${fmtDatedRange(dateFrom, dateTo)}` : ''
  return `TO: REPLENISHMENT OF CPF FOR THE PAID PR ${range}${dated}`
}

const fmtAmount = (n) => Number(n ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const officeName = (branchName) => `${String(branchName ?? '').replace(/\s*branch(\s*office)?\s*$/i, '').trim()} Branch Office`.trim()

export const generateDvBur = ({
  branchName, provinceName, payeeName, payeeAddress = 'LEGAZPI CITY', amount, particulars, certified, approved,
}) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const L = 10, W = 190, R = L + W
  const BLACK = [0, 0, 0]
  const line = (w = 0.25) => { doc.setLineWidth(w); doc.setDrawColor(...BLACK) }
  const box = (x, y, w, h, lw = 0.3) => { line(lw); doc.rect(x, y, w, h) }
  const vline = (x, y1, y2, lw = 0.3) => { line(lw); doc.line(x, y1, x, y2) }
  const hline = (y, x1, x2, lw = 0.3) => { line(lw); doc.line(x1, y, x2, y) }
  const text = (t, x, y, o = {}) => {
    doc.setFont('helvetica', o.bold ? 'bold' : o.italic ? 'italic' : 'normal')
    doc.setFontSize(o.size ?? 8)
    doc.setTextColor(...(o.color ?? BLACK))
    doc.text(String(t ?? ''), x, y, { align: o.align ?? 'left', ...(o.maxWidth ? { maxWidth: o.maxWidth } : {}) })
  }
  const wrapped = (t, x, y, w, o = {}) => {
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal')
    doc.setFontSize(o.size ?? 8)
    const lines = doc.splitTextToSize(String(t ?? ''), w)
    const lh = (o.size ?? 8) * 0.4
    lines.forEach((l, i) => { doc.setTextColor(...BLACK); doc.text(l, x, y + i * lh, { align: o.align ?? 'left' }) })
    return lines.length * lh
  }
  const check = (x, y) => { line(0.25); doc.rect(x, y, 3.2, 3.2) }
  const office = officeName(branchName)
  const name = (certified?.name ?? '').toUpperCase()
  const appr = (approved?.name ?? '').toUpperCase()
  const payee = (payeeName ?? '').toUpperCase()
  const amt = fmtAmount(amount)

  // ===================== DISBURSEMENT VOUCHER (page 1) =====================
  let y = 10
  box(L, y, W, 30)
  vline(L + 140, y, y + 30)
  hline(y + 13, L + 140, R)
  text('Republic of the Philippines', L + 70, y + 5.5, { align: 'center', size: 8 })
  text('NATIONAL FOOD AUTHORITY', L + 70, y + 10, { align: 'center', size: 9, bold: true })
  text(office, L + 70, y + 14.5, { align: 'center', size: 9, bold: true })
  text('DISBURSEMENT  VOUCHER', L + 70, y + 26, { size: 15, bold: true, align: 'center' })
  text('Fund Cluster :', L + 142, y + 5.5, { size: 7.5 })
  text('DV No. :', L + 142, y + 20, { size: 7.5 })

  y += 30                                              // Mode of Payment
  box(L, y, W, 8)
  vline(L + 28, y, y + 8)
  text('Mode of', L + 2, y + 3.4, { size: 7.5, bold: true })
  text('Payment', L + 2, y + 6.6, { size: 7.5, bold: true })
  ;[[L + 36, 'MDS Check'], [L + 66, 'Commercial Check'], [L + 118, 'ADA'], [L + 140, 'Others (Please specify)']].forEach(([x, t]) => {
    check(x, y + 2.4); text(t, x + 4.6, y + 5.2, { size: 7.5 })
  })
  hline(y + 7, L + 141, R - 2, 0.2)

  y += 8                                               // Payee
  box(L, y, W, 10)
  vline(L + 28, y, y + 10); vline(L + 128, y, y + 10); vline(L + 160, y, y + 10)
  text('Payee', L + 2, y + 6, { size: 8, bold: true })
  text(payee, L + 31, y + 6, { size: 8, bold: true })
  text('TIN/Employee No.:', L + 129.5, y + 4, { size: 7 })
  text('BURS No.:', L + 161.5, y + 4, { size: 7 })

  y += 10                                              // Address
  box(L, y, W, 7)
  vline(L + 28, y, y + 7)
  text('Address', L + 2, y + 5, { size: 8, bold: true })
  text(payeeAddress, L + 31, y + 4.2, { size: 8 })

  y += 7                                               // Particulars table
  const cw = [90, 34, 27, 39]
  const cx = [L, L + 90, L + 124, L + 151]
  box(L, y, W, 9)
  cx.slice(1).forEach((x) => vline(x, y, y + 9))
  ;['Particulars', 'Responsibility Center', 'MFO/PAP', 'Amount'].forEach((t, i) => text(t, cx[i] + cw[i] / 2, y + 5.4, { align: 'center', size: 7.5 }))
  y += 9
  const bodyH = 48
  box(L, y, W, bodyH)
  cx.slice(1).forEach((x) => vline(x, y, y + bodyH))
  wrapped(particulars, L + 3, y + 24, 84, { size: 8 })
  text(amt, R - 3, y + 24, { align: 'right', size: 8 })
  y += bodyH
  box(L, y, W, 6.5)
  vline(L + 151, y, y + 6.5)
  text('Amount Due', L + 100, y + 4.6, { size: 8, bold: true, align: 'right' })
  text(amt, R - 3, y + 4.6, { size: 8, bold: true, align: 'right' })

  y += 6.5                                             // A. Certified
  box(L, y, W, 27)
  text('A.', L + 1.5, y + 4.4, { size: 8, bold: true })
  text('Certified:', L + 7, y + 4.4, { size: 7.5, bold: true })
  text('Expenses/Cash Advance necessary, lawful and incurred under my direct supervision.', L + 22, y + 4.4, { size: 7.5 })
  text(name, L + 95, y + 17, { align: 'center', size: 8, bold: true })
  text(certified?.position ?? '', L + 95, y + 21.4, { align: 'center', size: 7.5 })

  y += 27                                              // B. Accounting Entry
  box(L, y, W, 5.5)
  text('B.', L + 1.5, y + 4, { size: 8, bold: true })
  text('Accounting Entry:', L + 7, y + 4, { size: 7.5 })
  y += 5.5
  const ac = [76, 53, 27, 34]
  const ax = [L, L + 76, L + 129, L + 156]
  box(L, y, W, 6.5)
  ax.slice(1).forEach((x) => vline(x, y, y + 6.5))
  ;['Account Title', 'UACS Code', 'Debit', 'Credit'].forEach((t, i) => text(t, ax[i] + ac[i] / 2, y + 4.4, { align: 'center', size: 7.5 }))
  y += 6.5
  for (let i = 0; i < 9; i++) {
    box(L, y, W, 5.2, 0.2)
    ax.slice(1).forEach((x) => vline(x, y, y + 5.2, 0.2))
    y += 5.2
  }

  const topCD = y                                      // C. Certified | D. Approved for Payment
  box(L, y, W / 2, 22); box(L + W / 2, y, W / 2, 22)
  text('C.', L + 1.5, y + 4.4, { size: 8, bold: true })
  text('Certified:', L + 7, y + 4.4, { size: 7.5, bold: true })
  ;['Cash available', 'Subject to Authority to Debit Account (when applicable)', 'Supporting documents complete and amount claimed proper'].forEach((t, i) => {
    check(L + 2, y + 6.4 + i * 4.8)
    if (i === 2) wrapped(t, L + 7, y + 9 + i * 4.8, 85, { size: 7 })
    else text(t, L + 7, y + 9 + i * 4.8, { size: 7 })
  })
  text('D.', L + W / 2 + 1.5, y + 4.4, { size: 8, bold: true })
  text('Approved for Payment', L + W / 2 + 7, y + 4.4, { size: 7.5, bold: true })
  y += 22
  const sigBlock = (x, who) => {
    const lw = 20
    let yy = y
    ;[['Signature', 8], ['Printed Name', 6.2], ['Position', 6.2], ['Date', 5]].forEach(([label, h]) => {
      box(x, yy, W / 2, h); vline(x + lw, yy, yy + h)
      text(label, x + 1.5, yy + h - 1.8, { size: 7 })
      if (label === 'Printed Name') text((who.name ?? '').toUpperCase(), x + lw + (W / 2 - lw) / 2, yy + h - 1.8, { align: 'center', size: 7.5, bold: true })
      if (label === 'Position') text(who.position ?? '', x + lw + (W / 2 - lw) / 2, yy + h - 1.8, { align: 'center', size: 7.5 })
      yy += h
    })
    return yy
  }
  sigBlock(L, certified ?? {})
  y = sigBlock(L + W / 2, approved ?? {}) - 0
  void topCD

  // E. Receipt of Payment - a narrow right-hand column holds "JEV No." (beside the header and the Check/ADA row)
  // and "Date :" (beside the signature and Official Receipt rows)
  const RW = 38, MW = W - RW
  box(L, y, MW, 5.2)
  text('E.', L + 1.5, y + 3.9, { size: 8, bold: true })
  text('Receipt of Payment', L + 7, y + 3.9, { size: 7.5, bold: true })
  box(R - RW, y, RW, 5.2 + 9)
  text('JEV No.', R - RW + 2, y + 3.9, { size: 7 })
  y += 5.2
  box(L, y, MW, 9)
  vline(L + 28, y, y + 9); vline(L + 80, y, y + 9); vline(L + 88, y, y + 9)
  text('Check/ADA No. :', L + 1.5, y + 4, { size: 7 })
  text('Date :', L + 81, y + 4, { size: 7 })
  text('Bank Name & Account Number:', L + 90, y + 4, { size: 7 })
  y += 9
  box(L, y, MW, 9)
  vline(L + 28, y, y + 9); vline(L + 80, y, y + 9); vline(L + 88, y, y + 9)
  text('Signature :', L + 1.5, y + 6, { size: 7 })
  text('Date :', L + 81, y + 4, { size: 7 })
  text('Printed Name:', L + 90, y + 4, { size: 7 })
  text(payee, L + 90 + (MW - 90) / 2, y + 7.6, { size: 7.5, bold: true, align: 'center' })
  box(R - RW, y, RW, 9 + 5.5)
  text('Date:', R - RW + 2, y + 4, { size: 7 })
  y += 9
  box(L, y, MW, 5.5)
  text('Official Receipt No. & Date/Other Documents', L + 1.5, y + 3.9, { size: 7 })

  // ===================== BUR x 2 on one A4 (page 2) =====================
  doc.addPage()
  const bur = (oy) => {
    let by = oy + 6
    box(L, by, W, 23)
    vline(L + 130, by, by + 23)
    text('BUDGET UTILIZATION REQUEST AND STATUS', L + 65, by + 7, { size: 11.5, bold: true, align: 'center' })
    text('Republic of the Philippines', L + 68, by + 12.5, { align: 'center', size: 7.5 })
    text('NATIONAL FOOD AUTHORITY', L + 68, by + 16.5, { align: 'center', size: 8.5, bold: true })
    text(office, L + 68, by + 20.5, { align: 'center', size: 8.5, bold: true })
    ;[['Serial No.:', 0], ['Date :', 1], ['Fund Cluster:', 2]].forEach(([t, i]) => {
      text(t, L + 132, by + 5 + i * 7.6, { size: 7 })
      if (i < 2) hline(by + 7.6 * (i + 1), L + 130, R)
    })
    by += 23
    ;[['Payee', payee, true], ['Office', `NFA - ${String(provinceName ?? '').toUpperCase()}`, true], ['Address', '', false]].forEach(([label, val, bold]) => {
      box(L, by, W, 6)
      vline(L + 28, by, by + 6)
      text(label, L + 14, by + 4.2, { size: 7.5, align: 'center' })
      text(val, L + 30, by + 4.2, { size: 7.5, bold })
      by += 6
    })
    const bw = [28, 78, 22, 28, 34]
    const bx = [L, L + 28, L + 106, L + 128, L + 156]
    box(L, by, W, 10)
    bx.slice(1).forEach((x) => vline(x, by, by + 10))
    ;['Responsibility Center', 'Particulars', 'MFO/ PAP', 'UACS Object\nCode/\nExpenditures', 'Amount'].forEach((t, i) => {
      const ls = t.split('\n')
      ls.forEach((l, k) => text(l, bx[i] + bw[i] / 2, by + (ls.length === 1 ? 5.8 : 3.2 + k * 2.8), { align: 'center', size: ls.length === 1 ? 7 : 6 }))
    })
    by += 10
    box(L, by, W, 20)
    bx.slice(1).forEach((x) => vline(x, by, by + 20))
    wrapped(particulars, L + 30, by + 11, 74, { size: 7.5 })
    text(amt, R - 2, by + 11, { size: 7.5, bold: true, align: 'right' })
    by += 20
    box(L, by, W, 5.5)
    vline(L + 156, by, by + 5.5)
    text('Total', L + 154, by + 4, { size: 7.5, bold: true, align: 'right' })
    text(amt, R - 2, by + 4, { size: 7.5, bold: true, align: 'right' })
    by += 5.5
    const half = (x, letter, statement, who) => {
      box(x, by, W / 2, 30)
      text(letter, x + 3, by + 5.5, { size: 10, bold: true })
      text('Certified:', x + 11, by + 5.5, { size: 7.5, bold: true })
      wrapped(statement, x + 28, by + 5.5, 64, { size: 6.5 })
      ;[['Signature', 17.5], ['Printed Name', 21.8], ['Position', 25.8], ['Date', 29.6]].forEach(([l, off]) => {
        text(l, x + 2, by + off - 1, { size: 6.5 }); text(':', x + 19, by + off - 1, { size: 6.5 })
        if (l === 'Signature') hline(by + off - 0.6, x + 22, x + W / 2 - 4, 0.2)
        if (l === 'Printed Name') text((who?.name ?? '').toUpperCase(), x + 22 + (W / 2 - 26) / 2, by + off - 1, { size: 7.5, bold: true, align: 'center' })
        if (l === 'Position') text(who?.position ?? '', x + 22 + (W / 2 - 26) / 2, by + off - 1, { size: 7, align: 'center' })
      })
    }
    half(L, 'A.', 'Charges to appropriation/budget necessary, lawful and under my direct supervision; and supporting documents valid, proper and legal', approved)
    half(L + W / 2, 'B.', 'Budget available and utilized for the purpose/adjustment necessary as indicated above', certified)
    by += 30
    box(L, by, W, 5.5)
    text('C.', L + 3, by + 4, { size: 8, bold: true })
    text('STATUS OF UTILIZATION', L + W / 2, by + 4, { size: 7.5, bold: true, align: 'center' })
    by += 5.5
    const sw = [18, 52, 24, 24, 24, 24, 12, 12]
    const sx = sw.reduce((a, w, i) => (a.push((a[i] ?? L) + (i ? sw[i - 1] : 0)), a), []).slice(0, 8)
    const xs = [L]; sw.forEach((w) => xs.push(xs[xs.length - 1] + w))
    void sx
    box(L, by, W, 5)
    vline(xs[3], by, by + 5)
    text('Reference', (xs[0] + xs[3]) / 2, by + 3.6, { size: 7, bold: true, align: 'center' })
    text('Amount', (xs[3] + xs[8]) / 2, by + 3.6, { size: 7, bold: true, align: 'center' })
    hline(by + 5, xs[3], xs[8], 0.2)
    by += 5
    box(L, by, W, 7)
    xs.slice(1, 8).forEach((x, i) => { if (i !== 5) vline(x, by, by + 7, i < 2 ? 0.3 : 0.2) })
    ;[['Date', 0], ['Particulars', 1], ['BURS/JEV\nNo.', 2], ['Utilization\n(a)', 3], ['Payable\n(b)', 4], ['Payment\n(c)', 5]].forEach(([t, i]) => {
      const ls = t.split('\n')
      ls.forEach((l, k) => text(l, (xs[i] + xs[i + 1]) / 2, by + (ls.length === 1 ? 4.4 : 3 + k * 3), { size: 6.5, align: 'center' }))
    })
    text('Balance', (xs[6] + xs[8]) / 2, by + 2.6, { size: 6.5, align: 'center' })
    text('(a-b)', (xs[6] + xs[7]) / 2, by + 5.8, { size: 6, align: 'center' })
    text('(b-c)', (xs[7] + xs[8]) / 2, by + 5.8, { size: 6, align: 'center' })
    hline(by + 3.2, xs[6], xs[8], 0.2)
    vline(xs[7], by + 3.2, by + 7, 0.2)
    by += 7
    box(L, by, W, 10)
    xs.slice(1, 8).forEach((x) => vline(x, by, by + 10, 0.2))
  }
  bur(0)
  bur(148.5)
  doc.setLineDashPattern([2, 1.5], 0)
  doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.2)
  doc.line(4, 148.5, 206, 148.5)
  doc.setLineDashPattern([], 0)
  return doc
}
