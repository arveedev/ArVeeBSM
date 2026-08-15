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
