// Dev-only console helpers for the Phase 2 verification gate:
// "Populate a test mock record... toggle offline... verify data persists
// locally... reactivate connectivity... check Firestore receives the update."
//
// Exposes `db`, `processSyncQueue`, and `seedMockTransaction` on `window`
// in dev builds so this can be driven entirely from the browser console.

import { db } from '../db/dexie.js'
import { processSyncQueue } from '../services/syncWorker.js'

export const mockTransaction = (overrides = {}) => ({
  id: crypto.randomUUID(),
  type: 'WSR',
  serialNo: String(Math.floor(11760000 + Math.random() * 9000)),
  status: 'Active',
  date: new Date().toISOString().slice(0, 10),
  customerName: 'Sample Ricemill',
  transactionTypeId: null,
  linkedDocNo: null,
  pileId: 'pile-test-001',
  varietyId: null,
  mtsSackTypeId: null,
  mtsCondition: null,
  numberOfBags: 100,
  grossKilos: 5050,
  mts: 50,
  autoComputeNet: true,
  netKilos: 5000,
  ageValue: 0,
  ageUnit: 'Days',
  initialAgeValue: 0,
  condition: 'GQ',
  farmerRsbsa: null,
  farmerGender: null,
  aiNumber: null,
  farmerCoops: null,
  isSynced: false,
  ...overrides,
})

export const mockUser = (overrides = {}) => ({
  uid: crypto.randomUUID(),
  accessCode: '123456',
  role: 'Admin',
  name: 'Juan Santos',
  nickname: 'Juan',
  assignedWarehouses: [],
  ...overrides,
})

export const mockPile = (overrides = {}) => ({
  pileId: crypto.randomUUID(),
  warehouseId: '',
  pileName: 'Pile A-1',
  cerealType: 'Palay',
  varietyId: null,
  currentBags: 100,
  currentKilos: 5000,
  initialAgeValue: 0,
  dateOfReceipt: new Date().toISOString().slice(0, 10),
  ...overrides,
})

export const enableDevTools = () => {
  if (!import.meta.env.DEV) return

  window.db = db
  window.processSyncQueue = processSyncQueue

  window.seedMockTransaction = async (overrides) => {
    const tx = mockTransaction(overrides)
    await db.transactions.add(tx)
    console.log('Seeded mock transaction:', tx)
    return tx
  }

  // Bootstraps the very first login — without this there's no `users`
  // record to authenticate against on a fresh database. Also seeds a
  // sample province + warehouse so the other admin panels (Users,
  // Signatories) have something to reference. The admin itself doesn't
  // need a warehouse assignment — Admins have access to all warehouses.
  window.seedAdminUser = async (overrides) => {
    const existing = await db.users.where('accessCode').equals('123456').first()
    if (existing && !overrides) {
      console.log('Admin user with PIN 123456 already exists:', existing)
      return existing
    }

    let province = await db.provinces.where('code').equals('ALB').first()
    if (!province) {
      province = { provinceId: crypto.randomUUID(), code: 'ALB', name: 'Albay' }
      await db.provinces.add(province)
    }

    let warehouse = await db.warehouses.where('code').equals('050501').first()
    if (!warehouse) {
      warehouse = {
        warehouseId: crypto.randomUUID(),
        code: '050501',
        name: 'ALB-TABACO GID',
        provinceId: province.provinceId,
      }
      await db.warehouses.add(warehouse)
    }

    const user = mockUser(overrides)
    await db.users.add(user)
    console.log('Seeded admin user:', user)
    return user
  }

  // Seeds a few sample piles into the "050501" warehouse so the Home
  // dashboard has data to summarize. Safe to re-run — clears existing
  // piles for that warehouse first. Self-sufficient: if WD1/PD variety
  // records don't exist yet (i.e. seedFormConfig() wasn't run first), it
  // creates minimal versions of them itself rather than silently seeding
  // piles with a blank varietyId.
  window.seedMockPiles = async () => {
    const warehouse = await db.warehouses.where('code').equals('050501').first()
    if (!warehouse) {
      console.log('Run seedAdminUser() first — warehouse 050501 not found.')
      return []
    }

    await db.piles.where('warehouseId').equals(warehouse.warehouseId).delete()

    const ensureVariety = async (category, name) => {
      const existing = await db.varietyTypes.where('name').equals(name).first()
      if (existing) return existing
      const created = { varietyId: crypto.randomUUID(), category, name }
      await db.varietyTypes.add(created)
      console.log(`(seedMockPiles) auto-created missing variety: ${name} (${category})`)
      return created
    }

    const riceVariety = await ensureVariety('Rice', 'WD1')
    const palayVariety = await ensureVariety('Palay', 'PD')

    const today = new Date()
    const daysAgo = (n) => {
      const d = new Date(today)
      d.setDate(d.getDate() - n)
      return d.toISOString().slice(0, 10)
    }

    const piles = [
      mockPile({
        warehouseId: warehouse.warehouseId,
        pileName: 'Pile A-1',
        cerealType: 'Palay',
        varietyId: palayVariety.varietyId,
        currentBags: 29,
        currentKilos: 1509.24,
        initialAgeValue: 1,
        dateOfReceipt: daysAgo(1),
      }),
      mockPile({
        warehouseId: warehouse.warehouseId,
        pileName: 'Pile A-2',
        cerealType: 'Palay',
        varietyId: palayVariety.varietyId,
        currentBags: 150,
        currentKilos: 7500,
        initialAgeValue: 2,
        dateOfReceipt: daysAgo(12),
      }),
      mockPile({
        warehouseId: warehouse.warehouseId,
        pileName: 'Pile B-1',
        cerealType: 'Rice',
        varietyId: riceVariety.varietyId,
        currentBags: 480,
        currentKilos: 24000,
        initialAgeValue: 0,
        dateOfReceipt: daysAgo(20),
      }),
    ]

    await db.piles.bulkAdd(piles)
    console.log(`Seeded ${piles.length} piles into ${warehouse.code}:`, piles)
    return piles
  }

  // Seeds the admin-configurable lookups that the Phase 5 transaction forms
  // depend on: Transaction Types, Variety Types, and Sack Types (with
  // weights). Safe to re-run — skips anything that already exists by name.
  window.seedFormConfig = async () => {
    const txTypeNames = ['Milling', 'Procurement', 'Transfer', 'Sales']
    for (const name of txTypeNames) {
      const existing = await db.transactionTypes.where('name').equals(name).first()
      if (!existing) {
        await db.transactionTypes.add({ transactionTypeId: crypto.randomUUID(), name })
      }
    }

    const varieties = [
      { category: 'Rice', name: 'WD1' },
      { category: 'Palay', name: 'PD' },
    ]
    const varietyIds = {}
    for (const v of varieties) {
      let existing = await db.varietyTypes.where('name').equals(v.name).first()
      if (!existing) {
        existing = { varietyId: crypto.randomUUID(), ...v }
        await db.varietyTypes.add(existing)
      }
      varietyIds[v.name] = existing.varietyId
    }

    const sackTypes = [
      { category: 'Rice', code: 'PPMG50', weights: { BN: 0.1, SH: 0.095, US: null } },
      { category: 'Palay', code: 'PPRE50', weights: { BN: 0.095, SH: 0.102, US: 0.11 } },
    ]
    const sackTypeIds = {}
    for (const s of sackTypes) {
      let existing = await db.sackTypes.where('code').equals(s.code).first()
      if (!existing) {
        existing = { sackTypeId: crypto.randomUUID(), ...s }
        await db.sackTypes.add(existing)
      }
      sackTypeIds[s.code] = existing.sackTypeId
    }

    console.log('Seeded transaction types, varieties, and sack types.')
    return { varietyIds, sackTypeIds }
  }

  // Seeds one sample AI (stock authority) and one sample SIA (sack
  // authority) so the AI/SIA monitoring panel and the WSI/ESI deep-link
  // flow have something to tap on. Requires seedAdminUser() (for the
  // warehouse) and seedFormConfig() (for variety/sack ids) to have run
  // first.
  window.seedMockAuthority = async () => {
    const warehouse = await db.warehouses.where('code').equals('050501').first()
    if (!warehouse) {
      console.log('Run seedAdminUser() first — warehouse 050501 not found.')
      return null
    }

    const variety = await db.varietyTypes.where('name').equals('PD').first()
    const transactionType = await db.transactionTypes.where('name').equals('Milling').first()

    const ai = {
      authId: crypto.randomUUID(),
      type: 'AI',
      aiNumber: '26219637',
      siaNumber: null,
      assignedWarehouse: warehouse.warehouseId,
      customerName: 'KIPSHOVEN R/M',
      varietyId: variety?.varietyId ?? null,
      transactionTypeName: transactionType?.name ?? 'Milling',
      totalAllocationBags: 250,
      totalAllocationKilos: 12978,
      totalIssuedBags: 0,
      totalIssuedKilos: 0,
      manuallyCompleted: false,
      remarks: null,
      note1: null,
      note2: null,
      note3: null,
      status: 'Pending',
    }

    const sia = {
      authId: crypto.randomUUID(),
      type: 'SIA',
      aiNumber: null,
      siaNumber: '0111965',
      assignedWarehouse: warehouse.warehouseId,
      customerName: 'KIPSHOVEN R/M',
      sackTypeRaw: 'PPRE50',
      transactionTypeName: transactionType?.name ?? 'Milling',
      totalAllocationBags: 487,
      rawSiaAllocation: null,
      totalAllocationKilos: null,
      totalIssuedBags: 0,
      totalIssuedKilos: null,
      manuallyCompleted: false,
      remarks: null,
      status: 'Pending',
    }

    await db.authorities.bulkAdd([ai, sia])
    console.log('Seeded sample AI and SIA authorities:', { ai, sia })
    return { ai, sia }
  }

  // Saves a placeholder Google Sheets config so the "Sync Now" / refresh
  // buttons have a URL to call (Phase 6). Replace the URL with a real
  // deployed Apps Script Web App URL to actually pull data — this helper
  // only seeds the config fields, it does not stand up a working backend.
  window.seedSheetsConfig = async (webAppUrl = 'https://script.google.com/macros/s/REPLACE_ME/exec') => {
    await db.googleSheetsConfig.put({
      id: 'global',
      webAppUrl,
      aiSheetName: 'AI',
      siaSheetName: 'SIA',
      receiptsSheetName: 'DATA_ENTRY',
      issuesSheetName: 'Issues Backup',
      sacksReceiptsSheetName: 'Sacks Receipts Backup',
      sacksIssuesSheetName: 'Sacks Issues Backup',
      lastSyncedAt: null,
    })
    console.log('Seeded Google Sheets config (placeholder URL):', webAppUrl)
  }

  console.log(
    '[devTools] Phase 2/3/4/5/6 helpers ready — try:\n' +
      '  await seedAdminUser()           // PIN 123456, role: Admin (access to all warehouses)\n' +
      '  await seedFormConfig()          // transaction types, varieties, sack types\n' +
      '  await seedMockAuthority()       // sample AI + SIA records\n' +
      '  await seedMockPiles()           // sample piles for the Home dashboard\n' +
      '  await seedMockTransaction()\n' +
      '  await seedSheetsConfig()        // placeholder Google Sheets bridge config\n' +
      '  await db.transactions.toArray()\n' +
      '  await processSyncQueue()'
  )
}
