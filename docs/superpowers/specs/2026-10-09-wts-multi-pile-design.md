# WTS issued from several piles — design

Status: approved in chat on 2026-10-09 (approach A). Short spec; no separate plan document.

## Goal
One WTS document can take stock out of more than one pile **of the same warehouse** and put it into
**one receiving pile**. Pile balances, bin cards, pile ledger, Reports, Sheet sync and the Stock Desk
keep reading ordinary WTS records, so none of them changes.

## Decision
Copy the way a WSI is issued from several piles. The first pile stays the document's own record. Each
extra issuing pile is saved as its **own ordinary WTS record**:

- serial `<serial>-A`, `-B`, … (next unused letter), `groupSerialNo` = the primary's serial on every record of the group;
- same date, AI No., nature of transaction, MC %, warehouse, `createdByName`;
- its own issued side (pile, variety, sack type, condition, bags, gross, net, stock condition) **and its own received side**
  into the **same receiving pile** (bags, gross, net, sack type, condition, stock condition entered per line).
- no schema change, no migration (`groupSerialNo` is not indexed).

Rejected: issued-only sibling records with one received total (one-sided records, the Stock Desk would have to
group them to keep lot ages right); one record holding a list of issuing piles (changes the shape every screen reads).

## Form (WTSForm)
- Below the Issued / Received panels: **Add another issuing pile**. Each extra line shows an issued panel (pile from the same
  warehouse, not already used in this document) and a received panel whose pile is fixed to the receiving pile chosen above.
- Received numbers of a line follow the issued numbers until the user edits them (rebagging).
- A total row shows issued and received bags and net kilos for the whole document.
- A completely empty line is ignored; a half-filled line blocks Save with a message naming it.
- Opening `<serial>-A` (typed or from Reports) opens the primary. Next / Previous skip the `-A` records.

## Save / edit / void / delete (all in one Dexie transaction, same ordering rules as today)
- Save: add the primary and every extra record, apply each to the piles.
- Update: write the primary, then each existing extra (kept serial) with a net pile delta, add new lines (next letter),
  delete removed lines and reverse their pile effect.
- Delete: delete the whole group, reverse every record that was not already cancelled.
- Void: every record of the group becomes Cancelled (keeping its serial), pile effects reversed; Unvoid deletes the group.
- Rename serial: the existing rename already renames a group together; the form reloads afterwards.

## Reports and Stock Desk
- Reports and the PDF already combine records sharing a `groupSerialNo` (issued side and received side separately), so a
  multi-pile WTS shows as one row with the summed bags and kilos.
- The Stock Desk reads each record as a normal WTS, so each issuing pile's stock reaches the receiving pile with its own
  receipt dates.

## Testing
Node tests on the group logic with an in-memory database (save, update with add / change / remove of a line, void, unvoid,
delete, pile balances, letters, validation), a check of the Stock Desk result for a multi-pile transfer on the backup copy,
and a browser pass of the form.
