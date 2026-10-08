import '../env'
import 'reflect-metadata'
import { Client } from 'pg'
import { sslOption } from '../db/ssl'

/**
 * Fills an existing store with realistic demo data so dashboards, reports and
 * the POS have something to show. DEVELOPMENT ONLY — never run against a real
 * client's store: --reset wipes that store's catalogue, bills and expenses first.
 *
 *   npx ts-node src/cli/seed-demo.ts --store-id store_xxx [--days 45] [--reset]
 *
 * Deterministic (seeded PRNG), so re-running with --reset gives the same shop.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}
const flag = (n: string) => process.argv.includes(`--${n}`)

// --reset deletes a store's catalogue, bills and expenses. Refuse to touch anything but a local database unless
// the person says so explicitly, so a production DATABASE_URL in the environment can never be hit by accident.
const dbUrl = process.env.DATABASE_URL ?? ''
if (!/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(dbUrl) && !flag('allow-remote')) {
  console.error('Refusing to run: DATABASE_URL is not a local database. This script writes fake data and --reset wipes a store.')
  console.error('If you really mean it (a throwaway cloud database), add --allow-remote.')
  process.exit(1)
}

// mulberry32 — small seeded PRNG
let seed = 20261008
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length)]
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const DAY = 86400000

const CATEGORIES = [
  ['cat_mshirt', 'Shirts', 'Men'], ['cat_mtshirt', 'T-Shirts', 'Men'], ['cat_mjeans', 'Jeans', 'Men'],
  ['cat_mkurta', 'Kurta', 'Men'], ['cat_wkurti', 'Kurti', 'Women'], ['cat_wsaree', 'Sarees', 'Women'],
  ['cat_wtop', 'Tops', 'Women'], ['cat_wjeans', 'Jeans', 'Women'], ['cat_kids', 'Kids Wear', 'Kids'],
  ['cat_acc', 'Accessories', 'Accessories'],
]

const APPAREL = ['S', 'M', 'L', 'XL', 'XXL']
const WAIST = ['30', '32', '34', '36', '38']
const KIDS = ['2-3Y', '4-5Y', '6-7Y', '8-9Y']

// style, name, category, brand, fabric, season, hsn, sizes, colors, cost, mrp, price
const BLUEPRINTS: Array<[string, string, string, string, string, string, string, string[], string[], number, number, number]> = [
  ['MS-101', 'Oxford Casual Shirt', 'cat_mshirt', 'Urban Fit', 'Cotton', 'All Season', '6205', APPAREL, ['White', 'Sky Blue', 'Navy'], 480, 1299, 1099],
  ['MS-102', 'Linen Formal Shirt', 'cat_mshirt', 'Raymond', 'Linen', 'Summer', '6205', APPAREL, ['Beige', 'Grey'], 720, 1899, 1699],
  ['MT-201', 'Round Neck Tee', 'cat_mtshirt', 'Urban Fit', 'Cotton', 'Summer', '6109', APPAREL, ['Black', 'White', 'Olive', 'Maroon'], 210, 699, 599],
  ['MT-202', 'Polo Neck Tee', 'cat_mtshirt', 'Peter England', 'Pique Cotton', 'All Season', '6109', APPAREL, ['Navy', 'Grey'], 340, 999, 899],
  ['MJ-301', 'Slim Fit Denim', 'cat_mjeans', 'Denim Co', 'Denim', 'All Season', '6203', WAIST, ['Dark Blue', 'Black'], 820, 2199, 1899],
  ['MK-401', 'Cotton Kurta', 'cat_mkurta', 'Ethnic Roots', 'Cotton', 'Festive', '6205', APPAREL, ['Cream', 'Maroon'], 540, 1499, 1349],
  ['WK-501', 'Anarkali Kurti', 'cat_wkurti', 'Ethnic Roots', 'Rayon', 'Festive', '6204', APPAREL, ['Teal', 'Rust', 'Pink'], 610, 1699, 1499],
  ['WK-502', 'Straight Cotton Kurti', 'cat_wkurti', 'Aurelia', 'Cotton', 'All Season', '6204', APPAREL, ['Yellow', 'Indigo'], 380, 999, 899],
  ['WS-601', 'Banarasi Silk Saree', 'cat_wsaree', 'Kanchi Weaves', 'Silk', 'Festive', '5007', ['Free'], ['Red', 'Green', 'Royal Blue'], 2400, 5999, 5299],
  ['WS-602', 'Cotton Printed Saree', 'cat_wsaree', 'Kanchi Weaves', 'Cotton', 'Summer', '5208', ['Free'], ['Peach', 'Mint', 'Mustard'], 650, 1599, 1399],
  ['WT-701', 'Printed Top', 'cat_wtop', 'Vero Moda', 'Rayon', 'Summer', '6106', APPAREL, ['White', 'Coral'], 320, 899, 749],
  ['WJ-801', 'High Rise Skinny Jeans', 'cat_wjeans', 'Denim Co', 'Denim', 'All Season', '6204', WAIST, ['Light Blue', 'Black'], 780, 2099, 1799],
  ['KD-901', 'Kids Cotton Frock', 'cat_kids', 'Little Star', 'Cotton', 'Festive', '6104', KIDS, ['Pink', 'Yellow'], 290, 899, 749],
  ['AC-001', 'Leather Belt', 'cat_acc', 'Urban Fit', 'Leather', 'All Season', '4203', ['Free'], ['Black', 'Brown'], 180, 699, 549],
]

const FIRST = ['Aarav', 'Vihaan', 'Aditya', 'Ananya', 'Diya', 'Isha', 'Kabir', 'Meera', 'Neha', 'Priya', 'Rahul', 'Rohan', 'Sneha', 'Tanvi', 'Vikram', 'Yash', 'Pooja', 'Nikhil']
const LAST = ['Sharma', 'Patil', 'Deshmukh', 'Kulkarni', 'Joshi', 'Mehta', 'Shah', 'Verma', 'Iyer', 'Nair', 'Gupta', 'Jadhav']

const EXPENSES: Array<[string, number, number, string]> = [
  ['Rent', 38000, 38000, 'Landlord'], ['Electricity', 5200, 7800, 'MSEB'], ['Salaries', 42000, 42000, 'Staff payroll'],
  ['Packaging', 800, 2400, 'Carry bags & tags'], ['Cleaning', 600, 1200, 'Housekeeping'], ['Tea & snacks', 300, 900, 'Daily'],
  ['Repairs', 500, 3500, 'Shutter / lights'], ['Marketing', 1500, 6000, 'Instagram ads'], ['Internet', 899, 899, 'Broadband'],
]

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  const days = Number(arg('days') ?? 45)
  const client = new Client({ connectionString: url, ssl: sslOption(url) })
  await client.connect()
  const insert = async (table: string, row: Record<string, unknown>) => {
    const cols = Object.keys(row)
    await client.query(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')})`, cols.map((c) => row[c]))
  }

  try {
    const storeId = arg('store-id') ?? (await client.query('SELECT id FROM stores ORDER BY created_at LIMIT 1')).rows[0]?.id
    if (!storeId) throw new Error('No store found — run provision first')
    const owner = (await client.query(`SELECT id FROM users WHERE store_id=$1 AND role='owner' ORDER BY created_at LIMIT 1`, [storeId])).rows[0]
    if (!owner) throw new Error('Store has no owner user')
    const userId: string = owner.id

    await client.query('BEGIN')
    const existing = Number((await client.query('SELECT count(*) FROM products WHERE store_id=$1', [storeId])).rows[0].count)
    if (existing > 0 && !flag('reset')) throw new Error(`Store ${storeId} already has ${existing} products. Re-run with --reset to wipe and reseed (dev only).`)
    if (flag('reset')) {
      for (const t of ['stock_moves', 'expenses', 'day_sessions', 'audit_log']) await client.query(`DELETE FROM ${t} WHERE store_id=$1`, [storeId])
      await client.query('DELETE FROM bills WHERE store_id=$1 AND refund_of_bill_id IS NOT NULL', [storeId])
      await client.query('DELETE FROM bills WHERE store_id=$1', [storeId])
      await client.query('DELETE FROM purchases WHERE store_id=$1', [storeId])
      await client.query('DELETE FROM customers WHERE store_id=$1', [storeId])
      await client.query('DELETE FROM suppliers WHERE store_id=$1', [storeId])
      await client.query('DELETE FROM variants WHERE store_id=$1', [storeId])
      await client.query('DELETE FROM products WHERE store_id=$1', [storeId])
    }

    // Categories (upsert — provisioning may already have created them)
    for (const [id, name, group] of CATEGORIES) {
      await client.query(
        'INSERT INTO categories (id, store_id, name, category_group) VALUES ($1,$2,$3,$4) ON CONFLICT (store_id, id) DO NOTHING',
        [id, storeId, name, group])
    }

    // Catalogue ------------------------------------------------------------
    const t0 = Date.now() - (days + 5) * DAY
    interface V { id: string; productId: string; name: string; sku: string; barcode: string; size: string; color: string; hsn: string; cost: number; mrp: number; price: number; stock: number; opening: number; reorder: number }
    const variants: V[] = []
    let bc = 8901000100000
    for (const [style, name, cat, brand, fabric, season, hsn, sizes, colors, cost, mrp, price] of BLUEPRINTS) {
      const pid = `prod_${style.toLowerCase().replace('-', '')}`
      await insert('products', { id: pid, store_id: storeId, style_code: style, name, category_id: cat, brand, fabric, season, hsn, active: true, created_at: t0 })
      for (const color of colors) for (const size of sizes) {
        const opening = int(6, 28)
        const v: V = {
          id: `var_${style.toLowerCase().replace('-', '')}_${color.replace(/\W/g, '').toLowerCase()}_${size.toLowerCase()}`,
          productId: pid, name, sku: `${style}-${color.slice(0, 3).toUpperCase()}-${size}`, barcode: String(bc++),
          size, color, hsn, cost, mrp, price, stock: opening, opening, reorder: 3,
        }
        variants.push(v)
      }
    }
    // Insert variants with their opening stock now; final stock is written at the end.
    for (const v of variants) {
      await insert('variants', { id: v.id, store_id: storeId, product_id: v.productId, sku: v.sku, barcode: v.barcode, size: v.size, color: v.color, cost: v.cost, mrp: v.mrp, price: v.price, stock: v.opening, reorder_level: v.reorder })
      await insert('stock_moves', { id: `mv_open_${v.id}`, store_id: storeId, variant_id: v.id, qty: v.opening, type: 'opening', ref: 'Opening stock', reason: 'Demo data', at: t0, user_id: userId })
    }

    // Suppliers + purchases ------------------------------------------------
    const suppliers = [
      ['sup_kanchi', 'Kanchi Textiles', '9822011001', '27AAAKT1234A1Z5', 'Surat, Gujarat'],
      ['sup_urban', 'Urban Garments Pvt Ltd', '9822011002', '27AAACU5678B1Z9', 'Tiruppur, Tamil Nadu'],
      ['sup_denim', 'Denim Depot', '9822011003', '', 'Ahmedabad, Gujarat'],
    ]
    for (const [id, name, phone, gstin, address] of suppliers) {
      await insert('suppliers', { id, store_id: storeId, name, phone, gstin, address, opening_balance: 0 })
    }
    for (let p = 0; p < 3; p++) {
      const items = Array.from({ length: 6 }, () => pick(variants)).filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
      const at = Date.now() - (days - 3 - p * 10) * DAY
      const lines = items.map((v) => ({ v, qty: int(5, 15) }))
      const total = r2(lines.reduce((s, l) => s + l.qty * l.v.cost, 0))
      const pid = `pur_demo_${p + 1}`
      await insert('purchases', { id: pid, store_id: storeId, no: `GRN-${String(p + 1).padStart(4, '0')}`, supplier_id: suppliers[p][0], date: at, invoice_ref: `SI-${1000 + p}`, total, paid: p === 2 ? 0 : total, notes: 'Demo purchase', user_id: userId })
      for (const l of lines) {
        await insert('purchase_items', { purchase_id: pid, variant_id: l.v.id, qty: l.qty, cost: l.v.cost })
        l.v.stock += l.qty
        await insert('stock_moves', { id: `mv_${pid}_${l.v.id}`, store_id: storeId, variant_id: l.v.id, qty: l.qty, type: 'purchase', ref: `GRN-${String(p + 1).padStart(4, '0')}`, reason: '', at, user_id: userId })
      }
    }

    // Customers ------------------------------------------------------------
    const customers: Array<{ id: string; points: number }> = []
    for (let i = 0; i < 18; i++) {
      const id = `cus_demo_${i + 1}`
      const pts = int(0, 400)
      await insert('customers', {
        id, store_id: storeId, name: `${FIRST[i % FIRST.length]} ${pick(LAST)}`, phone: `98${String(20000000 + i * 7919).slice(0, 8)}`,
        email: '', dob: '', anniversary: '', address: pick(['Kothrud, Pune', 'Baner, Pune', 'Aundh, Pune', 'Viman Nagar, Pune', '']),
        gstin: '', loyalty_points: pts, store_credit: i % 9 === 0 ? 500 : 0, created_at: t0 + int(0, days) * DAY, notes: null,
      })
      customers.push({ id, points: pts })
    }

    // Bills ----------------------------------------------------------------
    // More footfall on weekends and in the evening; a gentle upward trend.
    let invNo = 1
    const prefix = (await client.query('SELECT invoice_prefix FROM stores WHERE id=$1', [storeId])).rows[0].invoice_prefix as string
    const modes: Array<'cash' | 'upi' | 'card'> = ['cash', 'upi', 'upi', 'card', 'cash']
    for (let d = days; d >= 0; d--) {
      const day = new Date(Date.now() - d * DAY)
      const weekend = day.getDay() === 0 || day.getDay() === 6
      const n = Math.max(2, Math.round((weekend ? 11 : 6) + (days - d) * 0.06 + (rnd() * 4 - 2)))
      for (let k = 0; k < n; k++) {
        const at = new Date(day); at.setHours(int(10, 21), int(0, 59), int(0, 59), 0)
        if (at.getTime() > Date.now()) continue
        const available = variants.filter((v) => v.stock > 0)
        const picked = Array.from({ length: int(1, 3) }, () => pick(available)).filter((v, i, a) => a.findIndex((x) => x.id === v.id) === i)
        const lines = picked.map((v) => {
          const qty = Math.min(v.stock, rnd() < 0.8 ? 1 : 2)
          const discPct = rnd() < 0.2 ? pick([5, 10]) : 0
          const gross = v.price * qty
          const disc = r2((gross * discPct) / 100)
          const net = r2(gross - disc)
          const rate = v.price <= 1000 ? 5 : 12
          const taxable = r2(net / (1 + rate / 100))
          const tax = r2(net - taxable)
          return { v, qty, discPct, disc, net, rate, taxable, cgst: r2(tax / 2), sgst: r2(tax - r2(tax / 2)) }
        }).filter((l) => l.qty > 0)
        if (!lines.length) continue
        const subtotal = r2(lines.reduce((s, l) => s + l.net, 0))
        const total = Math.round(subtotal)
        const cust = rnd() < 0.55 ? pick(customers) : null
        const mode = pick(modes)
        const splitUpi = mode === 'cash' && total > 3000 && rnd() < 0.3
        const payments = splitUpi
          ? [{ mode: 'cash', amount: Math.round(total / 2) }, { mode: 'upi', amount: total - Math.round(total / 2) }]
          : [{ mode, amount: total }]
        const id = `bill_demo_${invNo}`
        const no = `${prefix}${String(invNo).padStart(4, '0')}`
        invNo++
        await insert('bills', {
          id, store_id: storeId, no, date: at.getTime(), customer_id: cust?.id ?? null,
          gross_mrp: r2(lines.reduce((s, l) => s + l.v.mrp * l.qty, 0)),
          item_discount: r2(lines.reduce((s, l) => s + l.disc, 0)),
          bill_discount_type: 'amt', bill_discount_value: 0, bill_discount: 0, coupon: '',
          subtotal, taxable_total: r2(lines.reduce((s, l) => s + l.taxable, 0)),
          cgst_total: r2(lines.reduce((s, l) => s + l.cgst, 0)), sgst_total: r2(lines.reduce((s, l) => s + l.sgst, 0)),
          tax_total: r2(lines.reduce((s, l) => s + l.cgst + l.sgst, 0)), round_off: r2(total - subtotal), total,
          paid: total, change_due: 0, loyalty_earned: cust ? Math.floor(total / 100) : 0, loyalty_redeemed: 0, credit_used: 0,
          cashier_id: userId, status: 'paid', notes: null,
        })
        for (const l of lines) {
          await insert('bill_items', {
            bill_id: id, variant_id: l.v.id, sku: l.v.sku, barcode: l.v.barcode, name: l.v.name, size: l.v.size, color: l.v.color,
            hsn: l.v.hsn, qty: l.qty, mrp: l.v.mrp, price: l.v.price, discount_type: 'pct', discount_value: l.discPct,
            discount_amount: l.disc, net: l.net, taxable: l.taxable, tax_rate: l.rate, cgst: l.cgst, sgst: l.sgst, line_total: l.net,
          })
          l.v.stock -= l.qty
          await insert('stock_moves', { id: `mv_${id}_${l.v.id}`, store_id: storeId, variant_id: l.v.id, qty: -l.qty, type: 'sale', ref: no, reason: '', at: at.getTime(), user_id: userId })
        }
        for (const p of payments) await insert('bill_payments', { bill_id: id, mode: p.mode, amount: p.amount, ref: null })
      }
    }

    // Expenses -------------------------------------------------------------
    let ex = 0
    for (let m = 0; m * 30 <= days; m++) {
      for (const [category, lo, hi, vendor] of EXPENSES) {
        const monthly = ['Rent', 'Salaries', 'Electricity', 'Internet'].includes(category)
        const count = monthly ? 1 : int(1, 3)
        for (let c = 0; c < count; c++) {
          const at = Date.now() - (m * 30 + int(0, 28)) * DAY
          if (at < t0) continue
          await insert('expenses', {
            id: `exp_demo_${ex++}`, store_id: storeId, date: at, category, amount: r2(lo + rnd() * (hi - lo)),
            mode: pick(['cash', 'upi', 'bank']), vendor, note: '', recurring: monthly, user_id: userId,
          })
        }
      }
    }

    // Final stock + invoice counter ----------------------------------------
    for (const v of variants) await client.query('UPDATE variants SET stock=$1 WHERE id=$2', [v.stock, v.id])
    await client.query('UPDATE stores SET next_invoice_no=$1 WHERE id=$2', [invNo, storeId])
    await client.query('COMMIT')

    const low = variants.filter((v) => v.stock <= v.reorder).length
    console.log(`Seeded store ${storeId}: ${BLUEPRINTS.length} products, ${variants.length} variants (${low} at/below reorder level), `
      + `${customers.length} customers, ${invNo - 1} bills over ${days} days, ${ex} expenses, 3 purchases.`)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw e
  } finally {
    await client.end()
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1) })
