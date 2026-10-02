// Sub-kind of a cashLedger row, chosen by a toggle in the Replenish /
// Liquidate modals. Cash on Hand math only ever looks at `type`
// ('replenish' | 'liquidate'); the kind below is purely labelling.
//   replenish  -> 'replenishment' (default) | 'cashAdvance' | 'additionalCashAdvance'
//   liquidate  -> 'partial' (default) | 'full'
// Older rows carry only the boolean isCashAdvance (v1.10-261), mapped here.

export const REPLENISH_KINDS = [
  { value: 'replenishment', label: 'Replenishment' },
  { value: 'cashAdvance', label: 'Cash Advance' },
  { value: 'additionalCashAdvance', label: 'Additional Cash Advance' },
]
export const LIQUIDATE_KINDS = [
  { value: 'partial', label: 'Partial' },
  { value: 'full', label: 'Full' },
]

export const entryKindOf = (e) => {
  if (e.type === 'liquidate') return e.entryKind === 'full' ? 'full' : 'partial'
  if (e.entryKind) return e.entryKind
  return e.isCashAdvance ? 'cashAdvance' : 'replenishment'
}

// Short label for lists / the Abstract.
export const entryKindLabel = (e) => ({
  replenishment: 'Replenish',
  cashAdvance: 'Cash Advance',
  additionalCashAdvance: 'Additional Cash Advance',
  partial: 'Partial Liquidation',
  full: 'Full Liquidation',
}[entryKindOf(e)])

// Upper-case heading used in the CPF Logbook.
export const entryKindCpfLabel = (e) => ({
  replenishment: 'REPLENISHMENT OF CPF',
  cashAdvance: 'CASH ADVANCE',
  additionalCashAdvance: 'ADDITIONAL CASH ADVANCE',
  partial: 'PARTIAL LIQUIDATION',
  full: 'FULL LIQUIDATION',
}[entryKindOf(e)])
