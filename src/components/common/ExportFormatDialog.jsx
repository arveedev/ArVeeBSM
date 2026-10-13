// Asks which file to make when the single "Export" button is tapped: the printable PDF or an
// editable Excel workbook. One button per report, one choice here - so every report offers the
// same two formats the same way.

import { createPortal } from 'react-dom'
import { FileText, FileSpreadsheet } from 'lucide-react'
import { useEscapeClose } from '../../utils/useEscapeClose.js'

function ExportFormatDialog({ open, title = 'Export as', onPick, onClose }) {
  useEscapeClose(() => onClose?.(), open)

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4" onClick={onClose} data-suppress-form-shortcuts>
      <div className="w-full max-w-xs rounded-2xl border border-neutral-800 bg-neutral-900 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-base font-bold text-app-text">{title}</h3>
        <div className="flex flex-col gap-2">
          <button type="button" autoFocus onClick={() => onPick('pdf')}
            className="flex items-center gap-3 rounded-xl bg-brand-neon px-4 py-3 text-left text-sm font-bold text-brand-contrast transition-all hover:brightness-110 active:scale-95">
            <FileText size={18} />
            <span>PDF<span className="block text-xs font-medium opacity-80">Ready to print or send</span></span>
          </button>
          <button type="button" onClick={() => onPick('excel')}
            className="flex items-center gap-3 rounded-xl border border-brand-neon/40 px-4 py-3 text-left text-sm font-bold text-brand-neon transition-all hover:bg-brand-neon/10 active:scale-95">
            <FileSpreadsheet size={18} />
            <span>Excel<span className="block text-xs font-medium opacity-80">Editable, totals are formulas</span></span>
          </button>
        </div>
        <button type="button" onClick={onClose} className="mt-3 w-full rounded-xl py-2 text-sm font-medium text-neutral-400 hover:text-app-text">Cancel</button>
      </div>
    </div>,
    document.body,
  )
}

export default ExportFormatDialog
