// WSR — Warehouse Stock Receipt. Uses StockFormBase (Phase 5 rewrite).

import StockFormBase from './StockFormBase.jsx'

function WSRForm({ onClose, prefill }) {
  return <StockFormBase type="WSR" title="WSR" onClose={onClose} prefill={prefill} />
}

export default WSRForm
