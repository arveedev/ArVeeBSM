// Shared table helpers for AdminHomeStocks.jsx and AdminHomeSacks.jsx.

export function Section({ title, headerRight, children }) {
  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-neutral-300">{title}</h2>
        {headerRight}
      </div>
      <div className="overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        {children}
      </div>
    </div>
  )
}

// Small pill toggle switch, shared by the Actual/Potential inventory
// toggles - two labeled segments with a sliding highlight, same visual
// language as the tab switchers elsewhere on this page.
export function PillToggle({ options, value, onChange }) {
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

export function Th({ children, right }) {
  return (
    <th className={`whitespace-nowrap px-2 pb-2 text-xs font-semibold uppercase text-neutral-500 first:pl-0 last:pr-0 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

export function Td({ children, right }) {
  return (
    <td className={`whitespace-nowrap px-2 py-1.5 text-xs text-neutral-300 first:pl-0 last:pr-0 ${right ? 'text-right' : ''}`}>
      {children}
    </td>
  )
}

export function Empty() {
  return <p className="text-xs text-neutral-500">No data available yet.</p>
}
