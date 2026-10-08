process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456'
process.env.DATABASE_URL ??= 'postgresql://postgres@localhost:5433/rr_test'

import { readdirSync, readFileSync } from 'fs'
import { gunzipSync, gzipSync } from 'zlib'
import { join } from 'path'
import { Test } from '@nestjs/testing'
import type { NestExpressApplication } from '@nestjs/platform-express'
import request from 'supertest'
import { AppModule } from '../src/app.module'
import { configureApp } from '../src/setup'
import { DbService } from '../src/db/db.service'
import { provisionStore } from '../src/provision'

describe('Krishna Collection API', () => {
  let app: NestExpressApplication
  let db: DbService
  let http: () => ReturnType<typeof request>
  let owner = '', cashier = '', storeId = '', otherOwner = ''

  const auth = (t: string) => ({ Authorization: `Bearer ${t}` })
  const api = (path: string) => `/api${path}`

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile()
    app = mod.createNestApplication<NestExpressApplication>()
    configureApp(app)
    await app.init()
    db = app.get(DbService)
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    const dir = join(__dirname, '../migrations')
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) await db.pool.query(readFileSync(join(dir, f), 'utf8'))
    http = () => request(app.getHttpServer())

    const a = await provisionStore(db, { storeName: 'Store A', ownerName: 'Asha', ownerEmail: 'asha@a.in', password: 'password-a-1', pin: '1111', storeId: 'store_a' })
    await provisionStore(db, { storeName: 'Store B', ownerName: 'Bala', ownerEmail: 'bala@b.in', password: 'password-b-1', pin: '2222', storeId: 'store_b' })
    storeId = a.storeId
  })
  afterAll(async () => { await app.close() })

  it('health is public and checks the database', async () => {
    const r = await http().get(api('/health')).expect(200)
    expect(r.body.ok).toBe(true)
  })

  it('rejects unauthenticated calls and bad tokens', async () => {
    await http().get(api('/products')).expect(401)
    await http().get(api('/products')).set(auth('nope')).expect(401)
  })

  it('web login (email + password) and counter login (PIN)', async () => {
    const w = await http().post(api('/auth/web-login')).send({ email: 'ASHA@a.in', password: 'password-a-1' }).expect(201)
    expect(w.body.user.role).toBe('owner')
    expect(w.body.store).toEqual({ id: 'store_a', name: 'Store A' })
    owner = w.body.token

    const p = await http().post(api('/auth/login')).send({ storeId, userId: w.body.user.id, pin: '1111' }).expect(201)
    expect(p.body.token).toBeTruthy()

    await http().post(api('/auth/web-login')).send({ email: 'asha@a.in', password: 'wrong' }).expect(401)
    await http().post(api('/auth/login')).send({ storeId: 'store_b', userId: w.body.user.id, pin: '1111' }).expect(401)

    const b = await http().post(api('/auth/web-login')).send({ email: 'bala@b.in', password: 'password-b-1' }).expect(201)
    otherOwner = b.body.token
  })

  it('locks a user out after 5 wrong PINs', async () => {
    const w = await http().post(api('/auth/web-login')).send({ email: 'bala@b.in', password: 'password-b-1' })
    for (let i = 0; i < 5; i++) await http().post(api('/auth/login')).send({ storeId: 'store_b', userId: w.body.user.id, pin: '0000' }).expect(401)
    const r = await http().post(api('/auth/login')).send({ storeId: 'store_b', userId: w.body.user.id, pin: '2222' }).expect(429)
    expect(r.body.error).toMatch(/Too many failed attempts/)
    await db.query("UPDATE users SET locked_until = NULL WHERE store_id = 'store_b'")
  })

  it('owner creates a cashier; cashier has restricted permissions', async () => {
    await http().post(api('/users')).set(auth(owner)).send({ id: 'usr_c1', name: 'Kavita', role: 'cashier', pin: '3333' }).expect(201)
    const l = await http().post(api('/auth/login')).send({ storeId, userId: 'usr_c1', pin: '3333' }).expect(201)
    cashier = l.body.token
    await http().post(api('/products')).set(auth(cashier)).send({ id: 'x', styleCode: 'X', name: 'X' }).expect(403)
    await http().put(api('/store')).set(auth(cashier)).send({ name: 'Hacked' }).expect(403)
    await http().get(api('/expenses')).set(auth(cashier)).expect(403)
    const users = await http().get(api('/users?storeId=store_a')).expect(200)
    expect(users.body.map((u: { name: string }) => u.name).sort()).toEqual(['Asha', 'Kavita'])
    expect(JSON.stringify(users.body)).not.toMatch(/hash/)
  })

  const product = {
    id: 'prd_1', styleCode: 'MS-101', name: 'Oxford Shirt', categoryId: 'cat_mshirt', brand: 'Urban', fabric: 'Cotton', season: 'All', hsn: '6205', createdAt: 1,
    variants: [{ id: 'var_1', productId: 'prd_1', sku: 'MS-101-NAV-L', barcode: '2100000000019', size: 'L', color: 'Navy', cost: 480, mrp: 1299, price: 1099, stock: 10, reorderLevel: 3 }],
  }
  const item = (qty: number) => ({
    variantId: 'var_1', sku: 'MS-101-NAV-L', barcode: '2100000000019', name: 'Oxford Shirt', size: 'L', color: 'Navy', hsn: '6205', qty,
    mrp: 1299, price: 1099, discountType: 'amt', discountValue: 0, discountAmount: 0, net: 1099 * qty, taxable: 1046.67 * qty,
    taxRate: 5, cgst: 26.17 * qty, sgst: 26.17 * qty, lineTotal: 1099 * qty, returnedQty: 0,
  })
  const bill = (qty: number) => ({
    id: 'bill_1', no: 'INV-1', date: 1000, customerId: 'cus_1', items: [item(qty)], payments: [{ mode: 'cash', amount: 1099 * qty }],
    grossMrp: 1299 * qty, subtotal: 1099 * qty, taxableTotal: 1046.67 * qty, taxTotal: 52.33 * qty, total: 1099 * qty, paid: 1099 * qty,
    loyaltyEarned: 10, loyaltyRedeemed: 0, creditUsed: 0, status: 'paid', cashierId: 'usr_c1',
  })

  it('syncs products, is idempotent (409) and keeps tenants apart', async () => {
    await http().post(api('/categories')).set(auth(owner)).send({ id: 'cat_mshirt', name: 'Shirts', group: 'Men' }).expect(201)
    await http().post(api('/categories')).set(auth(owner)).send({ id: 'cat_mshirt', name: 'Shirts', group: 'Men' }).expect(201) // upsert
    await http().post(api('/products')).set(auth(owner)).send(product).expect(201)
    await http().post(api('/products')).set(auth(owner)).send(product).expect(409)
    // Store B can reuse the same style code / barcode — uniqueness is per store.
    await http().post(api('/products')).set(auth(otherOwner)).send({ ...product, id: 'prd_b1', variants: [{ ...product.variants[0], id: 'var_b1', productId: 'prd_b1' }] }).expect(201)
    const list = await http().get(api('/products')).set(auth(owner)).expect(200)
    expect(list.body).toHaveLength(1)
    expect(list.body[0].variants[0]).toMatchObject({ sku: 'MS-101-NAV-L', price: 1099, stock: 10 })
    const scan = await http().get(api('/variants/barcode/2100000000019')).set(auth(cashier)).expect(200)
    expect(scan.body).toMatchObject({ id: 'var_1', productName: 'Oxford Shirt' })
    await http().get(api('/variants/barcode/nope')).set(auth(owner)).expect(404)
  })

  it('posts a bill: stock, ledger and loyalty move; a retry is a 409, not a double sale', async () => {
    await http().post(api('/customers')).set(auth(cashier)).send({ id: 'cus_1', name: 'Priya', phone: '9999900000', createdAt: 5 }).expect(201)
    await http().post(api('/customers')).set(auth(cashier)).send({ id: 'cus_2', name: 'Dup', phone: '9999900000' }).expect(409)
    await http().post(api('/bills')).set(auth(cashier)).send(bill(3)).expect(201)
    await http().post(api('/bills')).set(auth(cashier)).send(bill(3)).expect(409)

    const prod = await http().get(api('/products')).set(auth(owner))
    expect(prod.body[0].variants[0].stock).toBe(7)
    const cust = (await http().get(api('/customers')).set(auth(owner))).body[0]
    expect(cust.loyaltyPoints).toBe(10)
    const moves = await http().get(api('/stock/moves?variantId=var_1')).set(auth(owner)).expect(200)
    expect(moves.body).toEqual([expect.objectContaining({ type: 'sale', qty: -3, ref: 'INV-1' })])

    const got = await http().get(api('/bills/bill_1')).set(auth(owner)).expect(200)
    expect(got.body.items[0]).toMatchObject({ qty: 3, lineTotal: 3297, priceOverridden: false })
    expect(got.body.payments).toEqual([{ mode: 'cash', amount: 3297 }])
    await http().get(api('/bills/bill_1')).set(auth(otherOwner)).expect(404) // other tenant
  })

  it('returns: partial then full, refuses over-return, credit note is idempotent', async () => {
    const note = (id: string, qty: number) => ({
      id, no: `CN-${id}`, date: 2000, items: [item(qty)], payments: [{ mode: 'credit', amount: 1099 * qty }],
      total: -1099 * qty, status: 'returned', cashierId: 'usr_c1',
    })
    await http().post(api('/bills/bill_1/return')).set(auth(cashier)).send(note('cn_1', 1)).expect(201)
    await http().post(api('/bills/bill_1/return')).set(auth(cashier)).send(note('cn_1', 1)).expect(409)
    expect((await http().get(api('/bills/bill_1')).set(auth(owner))).body).toMatchObject({ status: 'partial-return' })

    const over = await http().post(api('/bills/bill_1/return')).set(auth(cashier)).send(note('cn_2', 5)).expect(422)
    expect(over.body.error).toMatch(/Only 2 of MS-101-NAV-L left/)
    await http().post(api('/bills/bill_1/return')).set(auth(cashier)).send(note('cn_3', 2)).expect(201)

    expect((await http().get(api('/bills/bill_1')).set(auth(owner))).body).toMatchObject({ status: 'returned' })
    expect((await http().get(api('/products')).set(auth(owner))).body[0].variants[0].stock).toBe(10)
    const cust = (await http().get(api('/customers')).set(auth(owner))).body[0]
    expect(cust.storeCredit).toBe(3297) // 3 pieces refunded as store credit
  })

  it('purchases add stock and update cost; adjustments hit the ledger', async () => {
    await http().post(api('/suppliers')).set(auth(owner)).send({ id: 'sup_1', name: 'Fabric Co' }).expect(201)
    await http().post(api('/purchases')).set(auth(owner)).send({
      id: 'pur_1', no: 'GRN-1', supplierId: 'sup_1', date: 3000, userId: '', total: 5000, paid: 0, items: [{ variantId: 'var_1', qty: 5, cost: 500 }],
    }).expect(201)
    await http().post(api('/purchases')).set(auth(owner)).send({ id: 'pur_1', no: 'GRN-1', supplierId: 'sup_1', date: 3000, items: [] }).expect(409)
    await http().post(api('/stock/adjust')).set(auth(owner)).send({ id: 'mv_1', variantId: 'var_1', qty: -2, type: 'adjust', reason: 'Damaged', at: 4000 }).expect(201)
    const v = (await http().get(api('/products')).set(auth(owner))).body[0].variants[0]
    expect(v).toMatchObject({ stock: 13, cost: 500 })
    const purchases = (await http().get(api('/purchases')).set(auth(owner))).body
    expect(purchases[0].items).toEqual([{ variantId: 'var_1', qty: 5, cost: 500 }])
  })

  it('expenses, day sessions and store settings', async () => {
    await http().post(api('/expenses')).set(auth(owner)).send({ id: 'exp_1', date: 5000, category: 'Rent', amount: 15000, mode: 'bank', recurring: true }).expect(201)
    await http().post(api('/sessions')).set(auth(owner)).send({ id: 'ses_1', openedAt: 6000, openedBy: 'usr_x', openingCash: 1000 }).expect(201)
    await http().put(api('/sessions/ses_1')).set(auth(owner)).send({ closedAt: 7000, countedCash: 4000, expectedCash: 4100, variance: -100 }).expect(200)
    const s = (await http().get(api('/sessions')).set(auth(owner))).body[0]
    expect(s).toMatchObject({ openingCash: 1000, closedAt: 7000, variance: -100 })

    const st = await http().put(api('/store')).set(auth(owner)).send({ name: 'Store A Renamed', nextInvoiceNo: 42, slabs: [{ upto: 500, rate: 5 }], priceIncludesTax: false }).expect(200)
    expect(st.body).toMatchObject({ name: 'Store A Renamed', nextInvoiceNo: 42, priceIncludesTax: false, slabs: [{ upto: 500, rate: 5 }] })
    expect((await http().get(api('/store')).set(auth(otherOwner))).body.name).toBe('Store B')
  })

  it('snapshot returns the whole store, role-filtered, and nothing from other tenants', async () => {
    const full = (await http().get(api('/sync/snapshot')).set(auth(owner)).expect(200)).body
    expect(full.store.name).toBe('Store A Renamed')
    expect(full.products).toHaveLength(1)
    expect(full.variants).toHaveLength(1)
    expect(full.bills.map((b: { id: string }) => b.id).sort()).toEqual(['bill_1', 'cn_1', 'cn_3'])
    expect(full.purchases).toHaveLength(1)
    expect(full.expenses).toHaveLength(1)
    expect(full.categories).toHaveLength(10)

    const lim = (await http().get(api('/sync/snapshot')).set(auth(cashier)).expect(200)).body
    expect(lim.expenses).toEqual([])
    expect(lim.purchases).toEqual([])
    expect(lim.bills.length).toBeGreaterThan(0)

    const b = (await http().get(api('/sync/snapshot')).set(auth(otherOwner)).expect(200)).body
    expect(b.bills).toEqual([])
    expect(b.products.map((p: { id: string }) => p.id)).toEqual(['prd_b1'])
  })

  describe('whole-store backups', () => {
    const original = JSON.stringify({ data: { bills: [1, 2, 3], audit: ['a'] } })
    const gz = gzipSync(Buffer.from(original))
    const sum = 'a'.repeat(64)
    const upload = (token: string, body: Buffer | string = gz, checksum = sum, kind = 'auto') =>
      http().post(api('/backups')).set(auth(token)).set('Content-Type', 'application/octet-stream')
        .set('X-Checksum', checksum).set('X-Device', 'Counter 1').set('X-Kind', kind).set('X-Counts', JSON.stringify({ bills: 3 })).send(body as Buffer)
    let id = 0

    it('stores a gzip backup and does not store an identical automatic upload twice', async () => {
      const first = await upload(owner).expect(201)
      expect(first.body.deduped).toBe(false)
      id = first.body.id
      const again = await upload(owner).expect(201)
      expect(again.body).toMatchObject({ deduped: true, id })
      // a hand-made backup is always kept, even when the data is unchanged
      expect((await upload(owner, gz, sum, 'manual').expect(201)).body.deduped).toBe(false)
    })

    it('lists backups newest first and returns the exact bytes on download (owner only)', async () => {
      const list = (await http().get(api('/backups')).set(auth(owner)).expect(200)).body
      expect(list).toHaveLength(2)
      expect(list[0]).toMatchObject({ kind: 'manual' })
      expect(list[1]).toMatchObject({ device: 'Counter 1', kind: 'auto', counts: { bills: 3 }, checksum: sum })
      const dl = await http().get(api('/backups/' + id)).set(auth(owner)).buffer(true)
        .parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))) })
        .expect(200)
      expect(gunzipSync(dl.body as Buffer).toString()).toBe(original)
    })

    it('rejects data that is not a gzip backup or has no valid checksum', async () => {
      await upload(owner, Buffer.from('{"not":"gzip"}')).expect(400)
      await upload(owner, gz, 'not-a-checksum').expect(400)
    })

    it('keeps stores apart and keeps cashiers out', async () => {
      expect((await http().get(api('/backups')).set(auth(otherOwner)).expect(200)).body).toEqual([])
      await http().get(api('/backups/' + id)).set(auth(otherOwner)).expect(404)
      await http().post(api('/backups')).set(auth(cashier)).set('Content-Type', 'application/octet-stream').set('X-Checksum', 'b'.repeat(64)).send(gz).expect(403)
      await http().get(api('/backups')).set(auth(cashier)).expect(403)
      await http().get(api('/backups/' + id)).set(auth(cashier)).expect(403)
      await http().get(api('/backups')).expect(401)
    })
  })

  it('refreshes a still-valid token so a long-open counter stays connected', async () => {
    const r = await http().post(api('/auth/refresh')).set(auth(owner)).expect(201)
    expect(r.body.token).toBeTruthy()
    const me = await http().get(api('/auth/me')).set(auth(r.body.token)).expect(200)
    expect(me.body).toMatchObject({ storeId: 'store_a', role: 'owner' })
    await http().post(api('/auth/refresh')).expect(401)
  })
})
