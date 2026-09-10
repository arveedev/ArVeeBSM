// Shown the instant the page loads, before db.open() even starts -
// replaces what used to be a blank flash while the database opens
// (normally near-instant, but not guaranteed, especially the first
// time a device runs a new schema migration). Rendered synchronously
// in main.jsx, swapped out for the real app (or DbOpenErrorScreen) the
// moment db.open() settles either way.
const BootScreen = () => (
  <div className="flex min-h-screen flex-col items-center justify-center bg-neutral-950">
    <img
      src="/logo.svg"
      alt="BSM App logo"
      className="h-16 w-16 rounded-2xl animate-boot-logo-pulse"
    />
  </div>
)

export default BootScreen
