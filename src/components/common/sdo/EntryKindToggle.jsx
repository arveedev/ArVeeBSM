// Segmented toggle for a cash ledger entry's kind (see utils/cashEntryKind.js).
function EntryKindToggle({ options, value, onChange }) {
  return (
    <div className="flex gap-1 rounded-xl border border-neutral-800 bg-neutral-900 p-1" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg px-1.5 py-1.5 text-[11px] leading-tight transition-all active:scale-95 ${
            value === o.value ? 'bg-brand-neon font-bold text-brand-contrast' : 'font-medium text-neutral-400 hover:text-app-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default EntryKindToggle
