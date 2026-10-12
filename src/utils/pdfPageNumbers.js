// Stamps "Page X of Y" in the lower right corner of every page of a finished jsPDF
// document. Called once, after the last page exists, so Y is the real page count.
export function addPageNumbers(doc, { right, bottom }) {
  const total = doc.getNumberOfPages()
  const w = doc.internal.pageSize.getWidth()
  const h = doc.internal.pageSize.getHeight()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(90, 90, 90)
    doc.text(`Page ${p} of ${total}`, w - right, h - bottom, { align: 'right' })
  }
  doc.setTextColor(0, 0, 0)
}
