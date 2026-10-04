// Admin-only: changes an already-saved transaction's serial number in
// place, keeping every other field untouched. This is different from
// retyping the Serial No. field during normal entry, which always
// means "find or start a different document" and resets the whole
// form (see StockFormBase.jsx's handleSerialChange/resetToBlankEntry) -
// this is a genuine rename of the SAME record, same id.
//
// Built for the one real case that needs it: two different offline
// devices independently used the same serial number for two different
// real transactions - a genuine collision, not a duplicate. The
// self-healing duplicate-cleanup sweep (transactionPreload.js) detects
// exactly this and deliberately leaves both records untouched (never
// deletes/merges a real collision), flagging it in the Error Log
// instead so an admin can resolve it by renumbering one side - this is
// that renumbering action.
//
// A multi-pile WSI issuance (or WSR receipt - same feature, same
// mechanism, either direction) is actually several linked records
// sharing one groupSerialNo (the primary's own serialNo, plus one
// "<serial>-A"/"-B"/... record per extra pile - see StockFormBase.jsx's
// performSave). Renaming the primary renames the whole group together,
// so no sibling record is left pointing at a groupSerialNo that no
// longer matches anything (which would silently break their Reports/
// PDF grouping).
//
// Does not call the Google Sheets backup directly. Marking the record
// unsynced (isSynced: false) lets the existing background push create a
// row for the NEW serial on the next sync, the same path any other edit
// already goes through. The OLD serial is remembered on the record
// (staleSheetSerials) and syncWorker.js removes that old Sheet row once
// the new one is confirmed, retrying until it succeeds. (Before this, the
// old row was left behind as a "manual step" and the Sheet-import preload
// later re-created it as an empty ghost record.)

import { db } from '../db/dexie.js'
import { isSerialTaken } from './serialNumber.js'

export const renameTransactionSerial = async (transaction, newSerialRaw, { type, warehouseId, cerealCategory = null } = {}) => {
  const newSerial = newSerialRaw.trim()
  if (!newSerial) throw new Error('New serial number is required')
  if (newSerial === transaction.serialNo) throw new Error("That's already this record's serial number")

  const taken = await isSerialTaken(type, warehouseId, newSerial, transaction.id, cerealCategory)
  if (taken) throw new Error(`Serial ${newSerial} is already used for a ${type} document at this warehouse`)

  const oldSerial = transaction.serialNo
  const isGroupPrimary = Boolean(transaction.groupSerialNo) && transaction.groupSerialNo === oldSerial

  await db.transaction('rw', db.transactions, async () => {
    if (isGroupPrimary) {
      const siblings = await db.transactions
        .where('type').equals(type)
        .and((t) => t.groupSerialNo === oldSerial && t.id !== transaction.id)
        .toArray()
      for (const sibling of siblings) {
        const suffix = sibling.serialNo.startsWith(`${oldSerial}-`) ? sibling.serialNo.slice(oldSerial.length) : null
        await db.transactions.update(sibling.id, {
          serialNo: suffix ? `${newSerial}${suffix}` : sibling.serialNo,
          groupSerialNo: newSerial,
          isSynced: false,
          // The Sheet still has a row under the sibling's OLD serial - see
          // staleSheetSerials below.
          staleSheetSerials: [...(sibling.staleSheetSerials ?? []), sibling.serialNo],
        })
      }
    }
    // Confirmed, reported real bug: this used to leave the Sheet row under
    // the OLD serial behind forever (the header comment above even called
    // it "a separate manual step"). The Sheet-import preload later found
    // that orphan row and re-created it in the app as an empty placeholder
    // - a ghost that double-counted the receipt in procurement and the
    // authority's issued total. The old serial is now remembered on the
    // record (an array, so a second rename before the first cleanup ran
    // can't lose the first orphan) and syncWorker removes that Sheet row
    // - but only AFTER the new-serial row is confirmed on the Sheet, so
    // the Sheet never loses its only copy - retrying until it succeeds.
    await db.transactions.update(transaction.id, {
      serialNo: newSerial,
      ...(transaction.groupSerialNo ? { groupSerialNo: isGroupPrimary ? newSerial : transaction.groupSerialNo } : {}),
      isSynced: false,
      staleSheetSerials: [...(transaction.staleSheetSerials ?? []), oldSerial],
    })
  })

  return newSerial
}
