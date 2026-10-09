// A WTS issued from several piles of one warehouse into ONE receiving pile.
//
// The first pile stays the document's own record. Every extra issuing pile is saved as its own
// ordinary WTS record (serial "<serial>-A", "-B", ..., same groupSerialNo, its own issued side and its
// own received side into the same receiving pile) - the same way a WSI issued from several piles is
// saved (see StockFormBase.jsx). Because each record is an ordinary WTS, pile balances, bin cards,
// the pile ledger, Sheet sync and the Stock Desk read it exactly as before.
//
// This file holds the group logic apart from the form so it can be tested on its own. The pile-balance
// functions stay in WTSForm.jsx and are passed in, so nothing about how a single WTS moves a pile changes.

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** The first unused letter suffix ('A', 'B', ...). `used` is a Set of letters already taken. */
export const nextLetter = (used) => {
  for (const c of LETTERS) if (!used.has(c)) return c
  throw new Error('A WTS can have at most 26 extra piles')
}

/** The letter part of a sibling's serial ("12345-B" with base "12345" -> "B"). */
export const letterOf = (serialNo, baseSerial) => (serialNo.startsWith(`${baseSerial}-`) ? serialNo.slice(baseSerial.length + 1) : null)

// issued* / received* fields of one side, as stored on a WTS record.
export const sideFields = (prefix, side, netKilos) => ({
  [`${prefix}PileId`]: side.pileId || null,
  [`${prefix}VarietyId`]: side.varietyId || null,
  [`${prefix}SackTypeId`]: side.sackTypeId || null,
  [`${prefix}Condition`]: side.condition || null,
  [`${prefix}Bags`]: side.bags === '' ? null : Number(String(side.bags).replace(/,/g, '')),
  [`${prefix}GrossKilos`]: side.grossKilos === '' ? null : Number(String(side.grossKilos).replace(/,/g, '')),
  [`${prefix}NetKilos`]: side.grossKilos === '' ? null : netKilos,
  [`${prefix}StockCondition`]: side.stockCondition,
})

export const sideIsComplete = (side) =>
  Boolean(side.pileId && side.varietyId && side.sackTypeId && side.condition && side.bags !== '' && side.grossKilos !== '')

/** A line the user added but never filled in is ignored. */
export const lineIsEmpty = (line) => !line.issued.pileId && line.issued.bags === '' && line.issued.grossKilos === ''

/** The received side of a line: its own numbers, but always into the document's one receiving pile. */
export const receivedOfLine = (line, receivingSide) => ({ ...line.received, pileId: receivingSide.pileId, varietyId: receivingSide.varietyId })

/** Received numbers follow the issued ones until the user changes them (a rebagging has different numbers). */
export const mirrorToReceived = (issued, received) => ({
  ...received,
  sackTypeId: issued.sackTypeId, condition: issued.condition, bags: issued.bags, grossKilos: issued.grossKilos, stockCondition: issued.stockCondition,
})

/**
 * First problem with the extra lines, or null. A line must be complete on both sides, and no pile
 * may be used twice as an issuing pile of the same document.
 */
export const firstLineProblem = ({ lines, receivingSide, primaryIssuedPileId }) => {
  const used = new Set(primaryIssuedPileId ? [primaryIssuedPileId] : [])
  let n = 0
  for (const line of lines) {
    if (lineIsEmpty(line)) continue
    n += 1
    if (!sideIsComplete(line.issued)) return `Extra pile ${n}: the issued side needs the pile, variety, sack type, condition, bags and gross kilos`
    if (!sideIsComplete(receivedOfLine(line, receivingSide))) return `Extra pile ${n}: the received side needs the sack type, condition, bags and gross kilos (and the receiving pile above)`
    if (used.has(line.issued.pileId)) return `Extra pile ${n}: this pile is already issued from in this document`
    used.add(line.issued.pileId)
  }
  return null
}

/** One extra record: the document's common fields, this line's own issued and received sides, its serial. */
export const buildLineRecord = ({ base, line, receivingSide, issuedNet, receivedNet, serialNo, groupSerialNo, id }) => ({
  ...base,
  id,
  serialNo,
  groupSerialNo,
  ...sideFields('issued', line.issued, issuedNet),
  ...sideFields('received', receivedOfLine(line, receivingSide), receivedNet),
})

// ── database operations (each is one atomic transaction) ───────────────────────────────

/** Save a new document: the primary and every extra record, each applied to the piles. */
export const saveGroup = async ({ db, primary, extras, applyToPiles, inTransaction }) => {
  await db.transaction('rw', db.tables, async () => {
    await db.transactions.add(primary)
    for (const r of extras) await db.transactions.add(r)
    if (inTransaction) await inTransaction()
    await applyToPiles(primary)
    for (const r of extras) await applyToPiles(r)
  })
}

/**
 * Update a document. `lines` are the extra records after the edit ({ txId, record }; txId null for a new
 * line), `originals` the extra records as they were loaded. A kept line keeps its own serial; a new line
 * gets the next unused letter (already placed in `record.serialNo` by the caller); a removed line is
 * deleted and its pile effect reversed.
 */
export const updateGroup = async ({ db, loaded, updated, lines, originals, applyToPiles, reapplyToPiles, reverseFromPiles, queueDeletion }) => {
  await db.transaction('rw', db.tables, async () => {
    // new values are written first, then the piles are reconciled (same ordering rule as a single WTS)
    await db.transactions.update(loaded.id, updated)
    await reapplyToPiles(loaded, updated)
    const kept = new Set()
    for (const { txId, record } of lines) {
      if (txId) {
        kept.add(txId)
        const orig = originals.find((o) => o.id === txId)
        await db.transactions.update(txId, record)
        await reapplyToPiles(orig, record)
      } else {
        await db.transactions.add(record)
        await applyToPiles(record)
      }
    }
    for (const orig of originals) {
      if (kept.has(orig.id)) continue
      await db.transactions.delete(orig.id)
      await reverseFromPiles(orig)
      queueDeletion(orig.serialNo)
    }
  })
}

/** Delete the whole document. Records that were already cancelled have no pile effect left to reverse. */
export const deleteGroup = async ({ db, loaded, originals, reverseFromPiles, queueDeletion, inTransaction }) => {
  await db.transaction('rw', db.tables, async () => {
    await db.transactions.delete(loaded.id)
    if (inTransaction) await inTransaction()
    for (const orig of originals) {
      await db.transactions.delete(orig.id)
      queueDeletion(orig.serialNo)
    }
    if (loaded.status !== 'Cancelled') {
      await reverseFromPiles(loaded)
      for (const orig of originals) await reverseFromPiles(orig)
    }
  })
}

/** Void the whole document: every record becomes Cancelled (keeping its serial) and its pile effect is reversed. */
export const voidGroup = async ({ db, loaded, cancelledPrimary, cancelledOf, originals, reverseFromPiles }) => {
  const wasActive = loaded.status !== 'Cancelled'
  await db.transaction('rw', db.tables, async () => {
    await db.transactions.update(loaded.id, cancelledPrimary)
    for (const orig of originals) await db.transactions.update(orig.id, cancelledOf(orig))
    if (wasActive) {
      await reverseFromPiles(loaded)
      for (const orig of originals) await reverseFromPiles(orig)
    }
  })
}

/** Un-void: the Cancelled records of the group are deleted, so the serial is free again. */
export const unvoidGroup = async ({ db, loaded, originals, queueDeletion, inTransaction }) => {
  await db.transaction('rw', db.tables, async () => {
    await db.transactions.delete(loaded.id)
    for (const orig of originals) {
      await db.transactions.delete(orig.id)
      queueDeletion(orig.serialNo)
    }
    if (inTransaction) await inTransaction()
  })
}
