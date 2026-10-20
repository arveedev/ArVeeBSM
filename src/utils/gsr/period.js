// GSR report date versus period reported (pure, no database).
// The memo date is the day the GSR is made; the period reported is the previous working day:
// a Monday memo reports Friday to Sunday, any other day reports yesterday. The Admin can change both dates.

const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']

export const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const weekday = (iso) => new Date(Date.parse(`${iso}T00:00:00Z`)).getUTCDay() // 0 = Sunday, 1 = Monday
const parts = (iso) => { const [y, m, d] = iso.split('-').map(Number); return { y, m, d } }

/** { from, to } the period a memo made on `memoISO` reports. */
export const defaultPeriod = (memoISO) => (weekday(memoISO) === 1
  ? { from: addDays(memoISO, -3), to: addDays(memoISO, -1) }
  : { from: addDays(memoISO, -1), to: addDays(memoISO, -1) })

/** "OCTOBER 16-18, 2026", "OCTOBER 15, 2026", "SEPTEMBER 30 - OCTOBER 2, 2026". */
export const periodTitle = (from, to) => {
  const a = parts(from)
  const b = parts(to)
  if (from === to) return `${MONTHS[a.m - 1]} ${a.d}, ${a.y}`
  if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m - 1]} ${a.d}-${b.d}, ${a.y}`
  if (a.y === b.y) return `${MONTHS[a.m - 1]} ${a.d} - ${MONTHS[b.m - 1]} ${b.d}, ${a.y}`
  return `${MONTHS[a.m - 1]} ${a.d}, ${a.y} - ${MONTHS[b.m - 1]} ${b.d}, ${b.y}`
}

/** "GSR OCTOBER 16-18" (the title without the year). */
export const gsrFileName = (from, to) => `GSR ${periodTitle(from, to).replace(/,\s*\d{4}$/, '')}`

/** The Drive folder path: NEWGSR / year / "10 OCTOBER" (by the memo date). */
export const folderPath = (memoISO) => {
  const { y, m } = parts(memoISO)
  return ['NEWGSR', String(y), `${String(m).padStart(2, '0')} ${MONTHS[m - 1]}`]
}

/** "19 October 2026" for the memo header. */
export const memoDateText = (memoISO) => {
  const { y, m, d } = parts(memoISO)
  const name = MONTHS[m - 1]
  return `${d} ${name[0]}${name.slice(1).toLowerCase()} ${y}`
}

/** First day of the period's month and of the reporting year (the data start). */
export const monthStart = (iso) => `${iso.slice(0, 7)}-01`
