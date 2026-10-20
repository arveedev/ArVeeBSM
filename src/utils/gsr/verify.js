// Read-back verification (pure): compares what the app computed with what Google Sheets holds after writing.
// Every number and every label the app wrote is checked; a blank cell counts as 0 where a number was expected
// (a total that adds up to 0 prints blank by design).

const TOL = 0.005

/**
 * @param builders  SheetBuilder[] that were written
 * @param read      [{ name, values: [[...]] }] as the receiver read them back
 * @returns { checked, bad: [{ sheet, ref, expected, got }] }
 */
export const verifyReadback = (builders, read) => {
  const byName = new Map((read ?? []).map((s) => [s.name, s.values]))
  let checked = 0
  const bad = []
  for (const sheet of builders) {
    const values = byName.get(sheet.name)
    if (!values) { bad.push({ sheet: sheet.name, ref: '(sheet)', expected: 'present', got: 'missing' }); continue }
    for (const [ref, expected] of sheet.expected()) {
      const m = /^([A-Z]+)(\d+)$/.exec(ref)
      let c = 0
      for (const ch of m[1]) c = c * 26 + (ch.charCodeAt(0) - 64)
      c -= 1
      const r = Number(m[2]) - 1
      const got = values[r]?.[c]
      checked += 1
      if (typeof expected === 'number') {
        const n = got === '' || got === undefined || got === null ? 0 : Number(got)
        if (!Number.isFinite(n) || Math.abs(n - expected) > TOL) bad.push({ sheet: sheet.name, ref, expected, got })
      } else if (String(got ?? '').trim() !== String(expected).trim()) {
        bad.push({ sheet: sheet.name, ref, expected, got })
      }
    }
  }
  return { checked, bad }
}
