// Shared styling constants for transaction forms (WSR/WSI/WTS/ESR/ESI).

export const inputClass =
  'mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-app-text outline-none transition-colors focus:border-brand-neon'

export const labelClass = 'text-sm font-medium text-neutral-300'

export const readOnlyClass =
  'mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-app-text'

export const primaryButtonClass =
  'flex-1 rounded-xl bg-brand-neon px-3 py-3 text-sm font-semibold text-brand-contrast transition-all hover:brightness-110 hover:shadow-[0_0_16px_rgba(0,255,163,0.45)] active:scale-95 disabled:opacity-50 disabled:pointer-events-none'

export const secondaryButtonClass =
  'flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-3 text-sm font-medium text-neutral-300 transition-all hover:border-neutral-600 hover:text-app-text active:scale-95 disabled:opacity-50 disabled:pointer-events-none'

export const smallButtonClass =
  'rounded-lg border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs font-medium text-neutral-300 transition-all hover:border-neutral-600 hover:text-app-text active:scale-95'

export const removeButtonClass =
  'rounded-lg border border-neutral-800 px-2 py-1 text-neutral-400 transition-all hover:border-brand-crimson/50 hover:text-brand-crimson active:scale-90'

// Stock condition flags — GQ (Good Quality), TRD (Trace Damage), INF
// (Infested), PD (Part Damaged), TD (Totally Damaged).
export const CONDITION_FLAGS = ['GQ', 'TRD', 'INF', 'PD', 'TD']
