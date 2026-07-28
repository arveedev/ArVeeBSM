// Shared styling constants for the Admin Dashboard config panels.

export const inputClass =
  'mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-app-text outline-none transition-colors focus:border-brand-neon'

export const labelClass = 'text-xs text-neutral-400'

export const primaryButtonClass =
  'rounded-xl bg-brand-neon px-3 py-2 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 hover:shadow-[0_0_16px_rgba(0,255,163,0.45)] active:scale-95'

export const secondaryButtonClass =
  'rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm font-medium text-neutral-300 transition-all hover:border-neutral-600 hover:text-app-text active:scale-95'

export const dangerButtonClass =
  'rounded-xl border border-brand-crimson/40 bg-neutral-900 px-3 py-2 text-sm font-medium text-brand-crimson transition-all hover:bg-brand-crimson/10 hover:shadow-[0_0_16px_rgba(239,68,68,0.35)] active:scale-95'

export const listItemClass =
  'flex items-center justify-between rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm transition-colors hover:border-neutral-700'

// Icon-only action buttons (edit/delete) in list rows.
export const iconButtonClass =
  'rounded-lg p-2 transition-all hover:scale-110 active:scale-95'

export const editIconClass = `${iconButtonClass} text-neutral-400 hover:text-app-text hover:drop-shadow-[0_0_6px_rgba(255,255,255,0.5)]`

export const deleteIconClass = `${iconButtonClass} text-brand-crimson hover:drop-shadow-[0_0_6px_rgba(239,68,68,0.7)]`

// Title Case role labels — also used directly as the stored `role` value.
export const ROLES = ['Admin', 'Warehouse Supervisor', 'Warehouse Assistant']

// Every sack type has exactly these three conditions. Fixed, not
// admin-configurable as a list — only the per-sack weight values are.
export const SACK_CONDITIONS = [
  { code: 'BN', label: 'Brand New' },
  { code: 'SH', label: 'Second Hand' },
  { code: 'US', label: 'Unserviceable' },
]

/** Locale-aware alphabetical sort comparator for strings. */
export const byAlpha = (a, b) => (a ?? '').localeCompare(b ?? '', undefined, { sensitivity: 'base' })
