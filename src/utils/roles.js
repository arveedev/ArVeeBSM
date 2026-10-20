// Who is who. One place for the role rules that more than one screen needs, so they cannot drift apart.
//
//  Admin    - everything.
//  Analyst  - reads like a Visitor (same read-only screens, no entry forms) but is a real person with their own PIN, so it can also use the
//             Tools (the Report Builder) and keep saved layouts.
//  Visitor  - signs in with a shared access code; read-only; never gets the Tools.
//  SDO      - disbursing officer; not part of the Tools.
//  Staff    - warehouse supervisors / assistants / MPO III (and the acting ones): their own warehouses only.

export const STAFF_ROLES = ['Warehouse Supervisor', 'Acting Warehouse Supervisor', 'Warehouse Assistant', 'Acting Warehouse Assistant', 'MPO III', 'Acting MPO III']

/** Read-only viewers: they see the Admin's Home and screens but cannot enter or change anything. */
export const isViewerRole = (role) => role === 'Visitor' || role === 'Analyst'
/** Roles that see every warehouse. */
export const isWideRole = (role) => role === 'Admin' || role === 'Analyst'
export const isStaffRole = (role) => STAFF_ROLES.includes(role)

/** Tools access, kept on reportConfig.toolsAccess = { reportBuilder: { analyst: true, staff: true } } (absent = on). The Visitor and the SDO never get it. */
export const canUseReportBuilder = (user, toolsAccess) => {
  const role = user?.role
  if (role === 'Admin') return true
  const t = toolsAccess?.reportBuilder ?? {}
  if (role === 'Analyst') return t.analyst !== false
  if (isStaffRole(role)) return t.staff !== false
  return false
}
