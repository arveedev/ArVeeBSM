// Report Builder: sort a source's many fields into a few plain groups so the list is easy to read (pure).
// "Main fields" are the ones people use every day (chosen per source); the rest are grouped by what they are.
// "Technical details" are bookkeeping the app keeps for itself (for example when a user last confirmed a document after its authority
// changed); they stay available but folded away.

export const CATEGORIES = [
  { id: 'calc', label: 'Calculated fields', open: true },
  { id: 'main', label: 'Main fields', open: true },
  { id: 'numbers', label: 'Quantities', open: false },
  { id: 'money', label: 'Money', open: false },
  { id: 'dates', label: 'Dates and times', open: false },
  { id: 'places', label: 'Warehouse, pile and place', open: false },
  { id: 'people', label: 'People and names', open: false },
  { id: 'authority', label: 'Authority and milling', open: false },
  { id: 'status', label: 'Status, notes and condition', open: false },
  { id: 'other', label: 'Other details', open: false },
]

const TECH = /^(authorityAck|autoComputeNet|syncFailureLogged|needsCompletion|fromSheetImport|varietyNameRaw|totalPiecesRaw|cerealCategory|staleSheetSerials|netWeightDecimals|sackLinesCount|farmerMembers|hasBeenBackedUp|orderId|sheetStatusRaw|firstSeenAt|changes$|initialAgeValue|mtsCondition|isAccountabilityPile)/i
const MONEY = /amount|cost|price|pesos|php|balance|check|basic|pricer/i
const AUTH = /authority|\bai\b|\bsia\b|\bmo\b|\btmo\b|batch|trial|regional|milling|ricemill|\blot\b|gmr|receiving|age group|serial|\bpr no|\bwsr no/i
const PLACE = /warehouse|province|pile|facility|address|branch|region|code|barangay/i
const PEOPLE = /\bby\b|name|customer|farmer|payee|disbursing|officer|\buser\b|nickname|role|position|owner|classifier|signator|gender|sdo/i
const STATUS = /status|state|cancel|complete|void|closed|approx|remark|note|condition|initial balance|closing|purity|moisture/i

/** The group id of one field. `mainIds` = the source's main fields. */
export function categoryOf(f, mainIds = []) {
  if (f.calc) return 'calc'
  if (mainIds.includes(f.id)) return 'main'
  if (TECH.test(f.id)) return 'tech'
  const label = String(f.label ?? '')
  if (f.kind === 'date' || f.d) return 'dates'
  if (f.kind === 'num') return MONEY.test(label) || MONEY.test(f.id) ? 'money' : 'numbers'
  if (AUTH.test(label)) return 'authority'
  if (PLACE.test(label)) return 'places'
  if (PEOPLE.test(label)) return 'people'
  if (STATUS.test(label) || STATUS.test(f.id)) return 'status'
  return 'other'
}

/** [{ id, label, open, fields }] for the groups that have fields, in the order above; `fields` keep the source's own order. */
export function groupFields(fields, mainIds = []) {
  const by = new Map(CATEGORIES.map((c) => [c.id, []]))
  for (const f of fields) { const c = categoryOf(f, mainIds); if (c !== 'tech') by.get(c).push(f) } // bookkeeping fields are left out of the picker
  const main = mainIds.length ? by.get('main') : []
  if (mainIds.length) main.sort((a, b) => mainIds.indexOf(a.id) - mainIds.indexOf(b.id))
  return CATEGORIES.filter((c) => by.get(c.id).length).map((c) => ({ ...c, fields: by.get(c.id) }))
}

// Fields nobody needs in a report: the app's own bookkeeping and near-duplicates of other fields. Matched by label or by field id,
// ignoring case and punctuation. Every date also has a "(week)" version, which is left out (the month version stays).
const HIDE = new Set(['enteredby', 'recordedby', 'recordedbyname', 'createdbyname', 'residuepileto', 'residuepilefrom', 'warehousecode', 'warehouseshort',
  'groupserialno', 'groupserial', 'isclosingresidue', 'isinitialbalance', 'issuedcondition', 'issuedstockcondition', 'receivedcondition', 'receivedstockcondition',
  'ageunit', 'agevalue', 'createdat', 'dateprocured', 'issuedvariety', 'receivedvariety', 'linkeddocno', 'linkeddocserial', 'linkeddocserialno'])
const norm = (x) => String(x ?? '').toLowerCase().replace(/[^a-z]/g, '')
export function isHiddenField(f) {
  if (f.calc) return false
  if (f.d && /_wk$/.test(f.id)) return true
  const a = norm(f.label)
  const b = norm(f.id)
  return HIDE.has(a) || HIDE.has(b) || a.startsWith('linkeddoc') || b.startsWith('linkeddoc') || a.startsWith('groupserial') || b.startsWith('groupserial')
}
