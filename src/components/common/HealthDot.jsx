// A small coloured dot beside the Admin Dashboard card in Settings, shown only while System health has something amber or
// red. Rendered only inside the Admin-only card, so no one else ever runs the queries.
import { useSystemHealth } from '../../hooks/useSystemHealth.js'

function HealthDot() {
  const { overall } = useSystemHealth(true)
  if (overall !== 'amber' && overall !== 'red') return null
  return <span title="System health needs attention" aria-label="System health needs attention" className={`sh-pulse inline-block h-2.5 w-2.5 rounded-full ${overall === 'red' ? 'bg-red-500' : 'bg-brand-amber'}`} />
}

export default HealthDot
