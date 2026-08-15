// Small two-option pill switch with a sliding highlight - shared by
// every Actual/Potential, Bags/Net Bags, etc. toggle in the app, so
// they all look and animate identically instead of each screen growing
// its own slightly-different switch control.

function PillToggle({ options, value, onChange }) {
  const activeIndex = options.findIndex((o) => o.value === value)
  return (
    <div className="relative flex w-36 gap-0.5 rounded-full border border-neutral-800 bg-neutral-950 p-0.5 text-[11px]">
      <div
        className="absolute inset-y-0.5 w-[calc(50%-0.0625rem)] rounded-full bg-brand-neon transition-transform duration-300 ease-out"
        style={{ transform: activeIndex === 0 ? 'translateX(0%)' : 'translateX(calc(100% + 0.125rem))' }}
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`relative z-10 flex-1 rounded-full px-2 py-1 text-center font-semibold transition-colors ${value === o.value ? 'text-brand-contrast' : 'text-neutral-500'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default PillToggle
