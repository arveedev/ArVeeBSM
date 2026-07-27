// Serial Number field — first input on every transaction form (Phase 5).
// Free-text, but pre-filled with a system-suggested starting value (one
// higher than the highest existing serial of this document type). The -/+
// stepper lets the user navigate a pad of pre-numbered paper forms by 1
// without retyping the whole number; it preserves any letter prefix
// (e.g. "B11766626" -> "B11766627").

import { stepSerial } from '../../utils/serialNumber.js'

const inputClass =
  'mt-1 w-full rounded-xl border border-neutral-800 bg-neutral-950 px-3 py-2 text-center font-mono text-app-text outline-none transition-colors focus:border-brand-neon'

const stepperButtonClass =
  'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-neutral-800 bg-neutral-900 text-lg font-semibold text-neutral-300 transition-all hover:border-neutral-600 hover:text-app-text active:scale-90'

function SerialNumberField({ value, onChange, label = 'Serial No.' }) {
  return (
    <div>
      <label className="text-xs text-neutral-400">{label}</label>
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(stepSerial(value, -1))}
          aria-label="Decrease serial by 1"
          className={stepperButtonClass}
        >
          −
        </button>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
          placeholder="0000000"
        />
        <button
          type="button"
          onClick={() => onChange(stepSerial(value, 1))}
          aria-label="Increase serial by 1"
          className={stepperButtonClass}
        >
          +
        </button>
      </div>
    </div>
  )
}

export default SerialNumberField
