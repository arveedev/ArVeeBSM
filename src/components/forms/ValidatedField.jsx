// ValidatedField — wraps a normal input with live validation feedback:
// a required field shows a light amber border by default while empty
// (a visual "this needs input" cue, the default for every field in
// every form unless explicitly marked optional), then as soon as a
// value is present it shows green + a check (valid) or red + an X
// (invalid) with red error text below explaining what's wrong.
//
// `validate(value)` returns either:
//   - null/undefined: this field has no opinion (skip the visual entirely)
//   - { valid: true }: show the green/check state
//   - { valid: false, message }: show the red/X state and the message

import { forwardRef } from 'react'
import { Check, X } from 'lucide-react'
import { inputClass } from './shared.js'

const ValidatedField = forwardRef(function ValidatedField({ value, onChange, validate, type = 'text', inputMode, placeholder, className = '', disabled, required = true }, ref) {
  const result = value !== '' ? validate?.(value) : null
  const isValid = result?.valid === true
  const isInvalid = result?.valid === false
  const isEmptyRequired = required && value === ''

  const borderClass = isValid
    ? '!border-brand-neon'
    : isInvalid
      ? '!border-brand-crimson'
      : isEmptyRequired
        ? '!border-brand-amber'
        : ''

  return (
    <div>
      <div className="relative">
        <input
          ref={ref}
          type={type}
          inputMode={inputMode}
          value={value}
          onChange={onChange}
          disabled={disabled}
          placeholder={placeholder}
          className={`${inputClass} ${borderClass} ${className} ${(isValid || isInvalid) ? 'pr-9' : ''}`}
        />
        {isValid && (
          <Check size={16} className="pointer-events-none absolute bottom-2.5 right-3 text-brand-neon" />
        )}
        {isInvalid && (
          <X size={16} className="pointer-events-none absolute bottom-2.5 right-3 text-brand-crimson" />
        )}
      </div>
      {isInvalid && result.message && (
        <p className="mt-1 text-xs text-brand-crimson">{result.message}</p>
      )}
    </div>
  )
})

export default ValidatedField
