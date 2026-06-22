// WSI — Warehouse Stock Issuance. Uses StockFormBase (Phase 5 rewrite).
// The AI No. field on StockFormBase links to db.authorities and deducts
// from its balance on save. `prefill` lets the AI/SIA monitoring panel
// deep-link here with name/variety/bags/kilos already filled in.

import StockFormBase from './StockFormBase.jsx'

function WSIForm({ onClose, prefill }) {
  return <StockFormBase type="WSI" title="WSI" onClose={onClose} prefill={prefill} />
}

export default WSIForm
