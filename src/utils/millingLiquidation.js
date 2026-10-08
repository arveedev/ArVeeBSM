// Milling and Test Milling Liquidation per ricemill - READ-ONLY, pure functions
// (no database). Groups the milling documents (WSI, ESI, WSR, ESR that carry an
// MO / TMO number and a batch / trial number) into batches, filters them by
// miller / warehouse / period / batch, and lays them out as the printed
// liquidation: issues on the left, receipts on the right, a TOTAL row, a
// SUMMARY (local rice at a price per bag, by-products at a price per kilo) and
// the signatories.
//
// The same layout feeds the screen, the Excel file and the PDF, so they agree.

const NET_BAG_KG = 50

export const SIGNATORY_FIELDS = [
  { key: 'millingSupervisor', title: 'Milling Supervisor' },
  { key: 'accountant', title: 'Accountant III' },
  { key: 'bsqao', title: 'BSQAO' },
  { key: 'engineer', title: 'Engineer III' },
  { key: 'actingAsstBranchManager', title: 'Acting Assistant Branch Manager' },
  { key: 'actingBranchManager', title: 'Acting Branch Manager' },
]

const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
const fmtInt = (n) => Math.round(n).toLocaleString('en-PH')
const fmt3 = (n) => n.toLocaleString('en-PH', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const fmt2 = (n) => n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']
const longDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1]} ${String(d).padStart(2, '0')}, ${y}` }
const shortDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}` }

/** "MO No. ALB - 2026-I-157" -> "ALB-2026-I-157" */
export const displayMoNo = (s) => String(s ?? '').replace(/^\s*T?MO\s*No\.?\s*/i, '').replace(/\s*-\s*/g, '-').trim()
// "Borromeo Ricemill", "BORROMEO RM" and "Borromeo Rice Mill" are the same miller.
/** Key under which a miller's prices are stored (no dots: Dexie Cloud reads them as paths). */
export const millerStoreKey = (key) => String(key).replace(/[.$#]/g, '_')
export const millerKey = (name) => String(name ?? '').toLowerCase().replace(/\b(rice\s*mill|ricemill|rm)\b/g, '').replace(/\s+/g, ' ').trim() || String(name ?? '').trim().toLowerCase()

/** All milling batches found in the transactions, one entry per MO/TMO + batch/trial + miller. */
export const buildMillingBatches = ({ transactions }) => {
  const map = new Map()
  for (const t of transactions) {
    if (t.status !== 'Active' || !['WSI', 'WSR', 'ESI', 'ESR'].includes(t.type)) continue
    const kind = t.moNumber ? 'MO' : t.tmoNumber ? 'TMO' : null
    if (!kind) continue
    const no = kind === 'MO' ? t.moNumber : t.tmoNumber
    const batch = (kind === 'MO' ? t.batchNumber : t.trialNumber) ?? ''
    const key = `${kind}|${no}|${batch}|${millerKey(t.customerName)}`
    let b = map.get(key)
    if (!b) {
      b = { key, kind, no, display: displayMoNo(no), batch: String(batch), millerKey: millerKey(t.customerName), miller: t.customerName ?? '', address: '', wsi: [], wsr: [], esi: [], esr: [] }
      map.set(key, b)
    }
    b[t.type.toLowerCase()].push(t)
    if (t.customerAddress && !b.address) b.address = t.customerAddress
  }
  const out = [...map.values()]
  // One display name per miller: prefer the full "... Ricemill" spelling.
  const names = new Map()
  for (const b of out) { const l = names.get(b.millerKey) ?? []; if (b.miller) l.push(b.miller); names.set(b.millerKey, l) }
  const pretty = new Map([...names].map(([k, l]) => [k, l.find((n) => /rice\s*mill/i.test(n) && n !== n.toUpperCase()) ?? l[0] ?? k]))
  for (const b of out) {
    b.miller = pretty.get(b.millerKey) ?? b.miller
    b.addressFromDocs = b.address
    for (const k of ['wsi', 'wsr', 'esi', 'esr']) b[k].sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : natural(x.serialNo, y.serialNo)))
    const base = b.wsi.length ? b.wsi : [...b.wsr, ...b.esi, ...b.esr]
    b.firstDate = base.length ? base[0].date : ''
  }
  // A TMO's empty-sack issue (ESI) is recorded for the whole TMO, not for a
  // trial. Attach it to the TMO's first trial so it prints with the trials.
  const orphans = out.filter((b) => b.kind === 'TMO' && b.batch === '' && b.wsi.length === 0 && b.wsr.length === 0)
  const dropped = new Set()
  for (const o of orphans) {
    const trials = out.filter((b) => b.kind === 'TMO' && b.no === o.no && b.millerKey === o.millerKey && b.batch !== '' && (b.wsi.length || b.wsr.length))
    if (trials.length === 0) continue
    trials.sort((a, b) => (a.firstDate < b.firstDate ? -1 : a.firstDate > b.firstDate ? 1 : natural(a.batch, b.batch)))
    trials[0].esi.push(...o.esi)
    trials[0].esr.push(...o.esr)
    dropped.add(o)
  }
  return out.filter((b) => !dropped.has(b))
}

/** Distinct millers for the filter, with the number of batches. */
export const listMillers = (batches) => {
  const m = new Map()
  for (const b of batches) { const e = m.get(b.millerKey) ?? { key: b.millerKey, name: b.miller, batches: 0 }; e.batches += 1; m.set(b.millerKey, e) }
  return [...m.values()].sort((a, b) => natural(a.name, b.name))
}

export const filterBatches = (batches, { kind, millerKey: mk = '', warehouseId = '', from, to, batch = '' }) => batches.filter((b) => {
  if (b.kind !== kind) return false
  if (mk && b.millerKey !== mk) return false
  if (from && b.firstDate < from) return false
  if (to && b.firstDate > to) return false
  if (batch && b.batch !== batch) return false
  if (warehouseId && ![...b.wsi, ...b.wsr].some((t) => t.warehouseId === warehouseId)) return false
  return true
})

const cell = (t, o = {}) => ({ t: t == null ? '' : String(t), ...o })

/**
 * Lays out one section (one miller) for the screen / Excel / PDF.
 * prices: { [product]: number } for this miller. Returns null if there are no batches.
 */
const buildSection = ({ kind, batches, whName, varietyById, sackById, prices, contractor, branch, from, to }) => {
  const isTest = kind === 'TMO'
  const productsOf = (b) => b.wsr.map((t) => ({ name: varietyById.get(t.varietyId)?.name ?? '?', category: varietyById.get(t.varietyId)?.category ?? '' }))
  const seen = new Map()
  for (const b of batches) for (const p of productsOf(b)) seen.set(p.name, p.category)
  const rice = [...seen].filter(([, c]) => c !== 'By Products').map(([n]) => n).sort(natural)
  const byp = [...seen].filter(([, c]) => c === 'By Products').map(([n]) => n).sort(natural)
  const products = [...rice, ...byp]

  const sackText = (lines) => {
    const typ = lines.map((l) => sackById.get(l.sackTypeId)?.code ?? '').filter(Boolean)
    return {
      type: [...new Set(typ)].join('\n'),
      cond: lines.map((l) => l.condition ?? '').filter(Boolean).join('\n'),
      pcs: lines.map((l) => fmtInt(l.pieces ?? 0)).join('\n'),
      total: lines.reduce((s, l) => s + (l.pieces ?? 0), 0),
    }
  }

  // ---- header
  const issueCols = isTest
    ? ['DATE', 'TMO NO.', 'TRL NO.', 'AI NO.', 'VARIETY', 'DATE WITHDRAWN', 'WSI NO.', 'NO. OF BAGS', 'NET KG.', 'ESI NO.', 'MTS TYPE', 'MTS CON.', 'NO. OF PCS.']
    : ['DATE', 'MO NO.', 'BATCH NO.', 'ISSUING WHSE', 'AI NO.', 'VARIETY', 'WSI NO.', 'BAGS', 'NET KG', 'SIA NO.', 'ESI NO.', 'TYPE/CAP', 'COND', 'NO. OF PCS']
  const recFront = isTest ? ['DATE', 'WSR NO.'] : ['DATE', 'REC WHSE', 'WSR NO.']
  const recBack = isTest ? ['ESR NO.', 'MTS TYPE', 'MTS CON.', 'NO. OF PCS.'] : ['ESR NO.', 'TYPE/CAP', 'COND', 'NO. OF PCS']
  const issueSpan = issueCols.length
  const recSpan = recFront.length + products.length * 2 + recBack.length
  const head = [
    [cell('ISSUES', { cs: issueSpan, a: 'c' }), cell('RECEIPTS', { cs: recSpan, a: 'c' })],
    [cell('PALAY', { cs: issueSpan, a: 'c' }), cell(byp.length ? 'LOCAL RICE AND BY-PRODUCTS' : 'LOCAL RICE', { cs: recSpan, a: 'c' })],
    [
      ...issueCols.map((c) => cell(c, { rs: 2, a: 'c' })),
      ...recFront.map((c) => cell(c, { rs: 2, a: 'c' })),
      ...products.map((p) => cell(p, { cs: 2, a: 'c' })),
      ...recBack.map((c) => cell(c, { rs: 2, a: 'c' })),
    ],
    products.flatMap(() => [cell('BAGS', { a: 'c' }), cell('NET KG', { a: 'c' })]),
  ]

  // ---- body
  const cards = []
  const rows = []
  const totals = { bags: 0, kilos: 0, pcsI: 0, pcsR: 0, prod: new Map(products.map((p) => [p, { bags: 0, kilos: 0 }])) }
  for (const b of batches) {
    const n = Math.max(b.wsi.length, b.wsr.length, 1)
    const esiLines = b.esi.flatMap((e) => e.sackLines ?? [])
    const esrLines = b.esr.flatMap((e) => e.sackLines ?? [])
    const esiT = sackText(esiLines)
    const esrT = sackText(esrLines)
    totals.pcsI += esiT.total
    totals.pcsR += esrT.total
    cards.push({
      date: b.firstDate ? shortDate(b.firstDate) : '', no: b.display, batch: b.batch,
      issues: b.wsi.map((w) => ({ whse: whName(w.warehouseId), ai: w.aiNumber ?? '', variety: varietyById.get(w.varietyId)?.name ?? '', serial: w.serialNo, bags: w.numberOfBags ?? 0, kilos: w.netKilos ?? 0 })),
      receipts: b.wsr.map((r) => ({ date: shortDate(r.date), whse: whName(r.warehouseId), serial: r.serialNo, product: varietyById.get(r.varietyId)?.name ?? '?', bags: r.numberOfBags ?? 0, kilos: r.netKilos ?? 0 })),
      esi: { no: b.esi.map((e) => e.serialNo).join(', '), sia: [...new Set(b.esi.map((e) => e.siaNumber).filter(Boolean))].join(', '), pcs: esiT.total },
      esr: { no: b.esr.map((e) => e.serialNo).join(', '), pcs: esrT.total },
    })
    const esiNo = b.esi.map((e) => e.serialNo).join('\n')
    const siaNo = [...new Set(b.esi.map((e) => e.siaNumber).filter(Boolean))].join('\n')
    const esrNo = b.esr.map((e) => e.serialNo).join('\n')
    for (let i = 0; i < n; i++) {
      const w = b.wsi[i]
      const r = b.wsr[i]
      const row = []
      // issues (the first three cells and the sack columns span the whole batch)
      const lead = i === 0
        ? [cell(b.firstDate ? shortDate(b.firstDate) : '', { rs: n, a: 'c' }), cell(b.display, { rs: n, a: 'c' }), cell(b.batch, { rs: n, a: 'c' })]
        : []
      const variety = w ? (varietyById.get(w.varietyId)?.name ?? '') : ''
      const wsiTail = [cell(w?.serialNo ?? '', { a: 'c' }), cell(w ? fmtInt(w.numberOfBags ?? 0) : '', { a: 'r' }), cell(w ? fmt3(w.netKilos ?? 0) : '', { a: 'r' })]
      if (!isTest) {
        row.push(...lead, cell(w ? whName(w.warehouseId) : '', { a: 'c' }), cell(w?.aiNumber ?? '', { a: 'c' }), cell(variety, { a: 'c' }), ...wsiTail)
        if (i === 0) row.push(cell(siaNo, { rs: n, a: 'c' }), cell(esiNo, { rs: n, a: 'c' }), cell(esiT.type, { rs: n, a: 'c' }), cell(esiT.cond, { rs: n, a: 'c' }), cell(esiT.pcs, { rs: n, a: 'c' }))
      } else {
        row.push(...lead, cell(w?.aiNumber ?? '', { a: 'c' }), cell(variety, { a: 'c' }), cell(w ? shortDate(w.date) : '', { a: 'c' }), ...wsiTail)
        if (i === 0) row.push(cell(esiNo, { rs: n, a: 'c' }), cell(esiT.type, { rs: n, a: 'c' }), cell(esiT.cond, { rs: n, a: 'c' }), cell(esiT.pcs, { rs: n, a: 'c' }))
      }
      if (w) { totals.bags += w.numberOfBags ?? 0; totals.kilos += w.netKilos ?? 0 }
      // receipts
      row.push(cell(r ? shortDate(r.date) : '', { a: 'c' }))
      if (!isTest) row.push(cell(r ? whName(r.warehouseId) : '', { a: 'c' }))
      row.push(cell(r?.serialNo ?? '', { a: 'c' }))
      const pname = r ? (varietyById.get(r.varietyId)?.name ?? '?') : null
      for (const p of products) {
        if (r && p === pname) {
          row.push(cell(fmtInt(r.numberOfBags ?? 0), { a: 'r' }), cell(fmt3(r.netKilos ?? 0), { a: 'r' }))
          const tp = totals.prod.get(p); tp.bags += r.numberOfBags ?? 0; tp.kilos += r.netKilos ?? 0
        } else row.push(cell(''), cell(''))
      }
      if (i === 0) row.push(cell(esrNo, { rs: n, a: 'c' }), cell(esrT.type, { rs: n, a: 'c' }), cell(esrT.cond, { rs: n, a: 'c' }), cell(esrT.pcs, { rs: n, a: 'c' }))
      rows.push({ cells: row, batchStart: i === 0 })
    }
  }

  // ---- total row
  const totalCells = isTest
    ? [cell('TOTAL', { cs: 7, a: 'c', b: true }), cell(fmtInt(totals.bags), { a: 'r', b: true }), cell(fmt3(totals.kilos), { a: 'r', b: true }), cell('', { cs: 3 }), cell(fmtInt(totals.pcsI), { a: 'r', b: true })]
    : [cell('TOTAL', { cs: 7, a: 'c', b: true }), cell(fmtInt(totals.bags), { a: 'r', b: true }), cell(fmt3(totals.kilos), { a: 'r', b: true }), cell('', { cs: 4 }), cell(fmtInt(totals.pcsI), { a: 'r', b: true })]
  const totalRecFront = recFront.length
  totalCells.push(cell('', { cs: totalRecFront }))
  for (const p of products) { const t = totals.prod.get(p); totalCells.push(cell(fmtInt(t.bags), { a: 'r', b: true }), cell(fmt3(t.kilos), { a: 'r', b: true })) }
  totalCells.push(cell('', { cs: recBack.length - 1 }), cell(fmtInt(totals.pcsR), { a: 'r', b: true }))

  // ---- summary
  const price = (p) => Number(prices?.[p] ?? 0)
  const riceLines = rice.map((p) => { const t = totals.prod.get(p); return { product: p, bags: t.bags, price: price(p), amount: t.bags * price(p) } })
  const bypLines = byp.map((p) => { const t = totals.prod.get(p); return { product: p, kilos: t.kilos, price: price(p), amount: t.kilos * price(p) } })
  const summary = {
    rice: riceLines, byProducts: bypLines,
    riceTotal: riceLines.reduce((s, l) => s + l.amount, 0), byTotal: bypLines.reduce((s, l) => s + l.amount, 0),
  }

  const miller = batches[0].miller
  const address = batches.find((b) => b.address)?.address ?? ''
  const periodText = from && to ? `${longDate(from)} TO ${longDate(to)}` : ''
  return {
    millerKey: batches[0].millerKey, miller, kind,
    heading: [
      ...(isTest ? ['Republic of the Philippines', 'NATIONAL FOOD AUTHORITY', branch?.name ? `${branch.name.split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ')} Office` : '', branch?.address ?? ''] : []),
    ].filter(Boolean),
    title: `${isTest ? 'TEST MILLING' : 'REGULAR MILLING'} LIQUIDATION OF ${miller.toUpperCase()}${isTest && address ? `, ${address}` : ''}`,
    subtitle: periodText ? `Period Covered: ${periodText}` : '',
    head, rows, cards, totals: { bags: totals.bags, kilos: totals.kilos, pcsI: totals.pcsI, pcsR: totals.pcsR, prod: Object.fromEntries(totals.prod) }, totalCells, products, contractor: contractor ?? '', summary, batchCount: batches.length,
    colCount: issueSpan + recSpan,
  }
}

/** One section per miller from the already-filtered batches. */
export const buildLiquidationSections = ({
  batches, kind, warehouses, varieties, sackTypes, config, branch, from, to,
}) => {
  const whById = new Map(warehouses.map((w) => [w.warehouseId, w]))
  const varietyById = new Map(varieties.map((v) => [v.varietyId, v]))
  const sackById = new Map(sackTypes.map((s) => [s.sackTypeId, s]))
  const whName = (id) => (whById.get(id)?.name ?? '').replace(/^[A-Z]{2,6}[\s-]+/, '')
  const mills = config?.millingMills ?? {}
  const byMiller = new Map()
  for (const b of batches) { if (!byMiller.has(b.millerKey)) byMiller.set(b.millerKey, []); byMiller.get(b.millerKey).push(b) }
  const sections = [...byMiller.entries()].map(([mk, list]) => {
    list.sort((a, b) => (a.firstDate < b.firstDate ? -1 : a.firstDate > b.firstDate ? 1 : natural(a.batch, b.batch)))
    return buildSection({
      kind, batches: list, whName, varietyById, sackById, prices: mills[millerStoreKey(mk)]?.prices, contractor: mills[millerStoreKey(mk)]?.contractor,
      branch, from, to,
    })
  })
  sections.sort((a, b) => natural(a.miller, b.miller))
  return sections
}

/** Signatory blocks in the order of the printed form. */
export const signatoryBlocks = (config, contractor) => {
  const s = config?.millingSignatories ?? {}
  const top = ['millingSupervisor', 'accountant', 'bsqao', 'engineer']
  const bottom = ['actingAsstBranchManager', 'actingBranchManager']
  const title = (k) => SIGNATORY_FIELDS.find((f) => f.key === k).title
  return {
    top: top.map((k) => ({ name: s[k] ?? '', title: title(k) })),
    bottom: [{ name: contractor ?? '', title: 'Miller Contractor' }, ...bottom.map((k) => ({ name: s[k] ?? '', title: title(k) }))],
  }
}

export const summaryLineText = { fmt2, fmt3, fmtInt }
