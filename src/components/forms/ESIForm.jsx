// ESI — Empty Sacks Issue. Uses SackFormBase (Phase 5 rewrite, per the
// "Empty Sacks Issue" sample document). The SIA No. field links to
// db.authorities and deducts pieces from its balance on save. `prefill`
// lets the SIA monitoring panel deep-link here pre-filled.

import SackFormBase from './SackFormBase.jsx'

function ESIForm({ onClose, prefill }) {
  return (
    <SackFormBase
      type="ESI"
      title="ESI"
      linkedDocLabel="SIA No."
      onClose={onClose}
      prefill={prefill}
    />
  )
}

export default ESIForm
