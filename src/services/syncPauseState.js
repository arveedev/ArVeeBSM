// Shared "is background sync allowed to do heavy work right now"
// signal - split into its own module (no dependencies of its own) so
// any background worker can check it without creating an import cycle.
// syncWorker.js re-exports pauseTransactionSync/resumeTransactionSync
// from here so every existing form import (`from
// '../../services/syncWorker.js'`) keeps working unchanged; new
// consumers that only need to READ the flag (backupWorker.js,
// transactionPreload.js's pile-recalc sweep) import isTransactionSyncPaused
// directly from here instead of from syncWorker.js, since syncWorker.js
// itself imports transactionPreload.js - importing back from
// transactionPreload.js to syncWorker.js would be a real circular
// dependency.
//
// A simple counter, not a boolean - if more than one thing needs to
// pause background sync at once, they won't clobber each other's
// intent to resume.
let transactionSyncPauseCount = 0
export const pauseTransactionSync = () => { transactionSyncPauseCount++ }
export const resumeTransactionSync = () => { transactionSyncPauseCount = Math.max(0, transactionSyncPauseCount - 1) }
export const isTransactionSyncPaused = () => transactionSyncPauseCount > 0
