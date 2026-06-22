// WTS — Warehouse Transfer Stock. Uses StockFormBase (Phase 5 rewrite).

import StockFormBase from './StockFormBase.jsx'

function WTSForm({ onClose, prefill }) {
  return <StockFormBase type="WTS" title="WTS" onClose={onClose} prefill={prefill} />
}

export default WTSForm
