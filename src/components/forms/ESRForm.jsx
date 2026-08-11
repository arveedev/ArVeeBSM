// ESR — Empty Sack Receipt. Uses SackFormBase (Phase 5 rewrite, per the
// "Empty Sack Receipt" sample document). Needs an ESI No. reference (the
// Empty Sacks Issue document this receipt corresponds to).

import SackFormBase from './SackFormBase.jsx'

function ESRForm({ onClose, prefill }) {
  return (
    <SackFormBase
      type="ESR"
      title="ESR"
      linkedDocLabel="ESI / AI"
      onClose={onClose}
      prefill={prefill}
    />
  )
}

export default ESRForm
