import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { nextBarcode } from '../db/ops'
import { id } from '../lib/id'
import { inr, round2 } from '../lib/money'
import { toCSV, downloadFile, parseCSV } from '../lib/csv'
import { useDebounced } from '../lib/useDebounced'
import { sizeRank } from '../lib/posSearch'
import { Field, Modal, Empty, Confirm } from '../components/ui'
import { TagInput, parseTags } from '../components/TagInput'
import { skuFor } from '../lib/variantLabel'
import { nextStyleCode, sortCategories } from '../lib/styleCode'
import { moveOnEnter } from '../lib/formNav'
import { CategoryPicker } from '../components/CategoryPicker'
import { Download, InventoryIcon, PencilIcon, Plus, Search, TrashIcon, Upload } from '../components/icons'
import { useApp } from '../state'
import type { Category, Product, Variant } from '../db/types'

const SIZE_PRESETS: Record<string, string> = {
  'Apparel (S–XXL)': 'S, M, L, XL, XXL',
  'Waist (28–40)': '28, 30, 32, 34, 36, 38, 40',
  'Kids (2–10Y)': '2-3Y, 4-5Y, 6-7Y, 8-9Y, 10-11Y',
  'Free size': 'Free',
}

interface Draft {
  styleCode: string; name: string; categoryId: string; brand: string; fabric: string
  season: string; hsn: string; sizes: string; colors: string; cost: string; mrp: string; price: string
  /** No sizes or colours (sarees): `sizes` then holds optional type names, and there is no colour. */
  plain: boolean
}

const EMPTY: Draft = {
  styleCode: '', name: '', categoryId: '', brand: '', fabric: '', season: 'All Season',
  hsn: '6205', sizes: 'S, M, L, XL, XXL', colors: '', cost: '', mrp: '', price: '', plain: false,
}

type StockFilter = '' | 'low' | 'out' | 'ok'
const PAGE = 100

interface Row {
  product: Product
  variants: Variant[]
  stock: number
  value: number
  minPrice: number
  maxPrice: number
  /** Variants with some stock but at or under their reorder level. */
  low: number
  out: number
  margin: number | null
  hay: string
  catName: string
  group: string
}

const margin = (price: number, cost: number) => (price > 0 && cost > 0 ? ((price - cost) / price) * 100 : null)

export default function Inventory() {
  const { toast, user } = useApp()
  const products = useLiveQuery(() => db.products.toArray(), [], [] as Product[]) ?? []
  const variants = useLiveQuery(() => db.variants.toArray(), [], [] as Variant[]) ?? []
  const categories = useLiveQuery(() => db.categories.toArray().then(sortCategories), [], [] as Category[]) ?? []

  const [q, setQ] = useState('')
  const [stockFilter, setStockFilter] = useState<StockFilter>('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  // Once someone types their own style code, picking another category stops overwriting it.
  const [codeTouched, setCodeTouched] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const [tried, setTried] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [deleting, setDeleting] = useState<Product | null>(null)
  const [sel, setSel] = useState(0)
  const [limit, setLimit] = useState(PAGE)
  const searchRef = useRef<HTMLInputElement>(null)

  const needle = useDebounced(q.trim().toLowerCase(), 120)

  const byProduct = useMemo(() => {
    const m = new Map<string, Variant[]>()
    for (const v of variants) {
      const list = m.get(v.productId)
      if (list) list.push(v); else m.set(v.productId, [v])
    }
    return m
  }, [variants])

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  // Per-product aggregates and the search text are computed once per data change, not per keystroke.
  const all = useMemo<Row[]>(() => products.map((p) => {
    const vs = byProduct.get(p.id) ?? []
    let stock = 0, value = 0, low = 0, out = 0, costSum = 0, priceSum = 0
    let minPrice = Infinity, maxPrice = 0
    for (const v of vs) {
      stock += v.stock; value += v.stock * v.cost
      if (v.stock <= 0) out++; else if (v.stock <= v.reorderLevel) low++
      costSum += v.cost; priceSum += v.price
      if (v.price < minPrice) minPrice = v.price
      if (v.price > maxPrice) maxPrice = v.price
    }
    const cat = catMap.get(p.categoryId)
    return {
      product: p, variants: vs, stock, value: round2(value), low, out,
      minPrice: Number.isFinite(minPrice) ? minPrice : 0, maxPrice,
      margin: vs.length ? margin(priceSum / vs.length, costSum / vs.length) : null,
      catName: cat?.name ?? '—', group: cat?.group ?? '',
      hay: [p.name, p.styleCode, p.brand, p.fabric, cat?.name ?? '', ...vs.flatMap((v) => [v.sku, v.barcode, v.color])].join(' ').toLowerCase(),
    }
  }), [products, byProduct, catMap])

  const rows = useMemo(() => all
    .filter((r) => !needle || r.hay.includes(needle))
    .filter((r) => (stockFilter === 'low' ? r.low > 0 : stockFilter === 'out' ? r.out > 0 : true))
    .sort((a, b) => a.product.name.localeCompare(b.product.name)), [all, needle, stockFilter])

  useEffect(() => { setSel(0); setLimit(PAGE) }, [rows.length, needle, stockFilter])
  const visible = rows.slice(0, limit)

  const totals = useMemo(() => {
    let pieces = 0, value = 0, vcount = 0
    for (const r of all) { pieces += r.stock; value += r.value; vcount += r.variants.length }
    return { pieces, value: round2(value), vcount }
  }, [all])

  // Keyboard: ↑↓ move, Enter opens the item, / searches, N starts a new item.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (creating || editing || deleting || e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t === searchRef.current && e.key === 'ArrowDown') { e.preventDefault(); searchRef.current?.blur(); setSel(0); return }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus() }
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openNew() }
      else if (!visible.length) return
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(visible.length - 1, s + 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
      else if (e.key === 'Enter') { e.preventDefault(); setEditing(visible[sel].product) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => { document.querySelector('.inv-row.sel')?.scrollIntoView({ block: 'nearest' }) }, [sel])

  function openNew() {
    // Starts on the first category (Sarees) with its next style code ready, so a new item only needs a name and price.
    const first = categories[0]
    setCodeTouched(false)
    setDraft({ ...EMPTY, categoryId: first?.id ?? '', styleCode: first ? nextStyleCode(first, products) : '' })
    setTried(false); setCreating(true)
  }

  function pickCategory(categoryId: string) {
    const cat = categories.find((c) => c.id === categoryId)
    setDraft((d) => ({ ...d, categoryId, styleCode: codeTouched || !cat ? d.styleCode : nextStyleCode(cat, products) }))
    setTimeout(() => nameRef.current?.focus(), 0)
  }

  const sizes = parseTags(draft.sizes)
  const colors = parseTags(draft.colors)
  const draftPrice = Number(draft.price) || Number(draft.mrp) || 0
  const draftMargin = margin(draftPrice, Number(draft.cost) || 0)
  const bad = {
    name: tried && !draft.name.trim(),
    style: tried && !draft.styleCode.trim(),
    price: tried && draftPrice <= 0,
    sizes: tried && !draft.plain && !sizes.length,
    colors: tried && !draft.plain && !colors.length,
  }
  // What actually gets created: a plain item is one variant per type name (or a single one) and never has a colour.
  const makeSizes = draft.plain ? (sizes.length ? sizes : ['']) : sizes
  const makeColors = draft.plain ? [''] : colors

  async function createProduct() {
    setTried(true)
    if (!draft.name.trim() || !draft.styleCode.trim() || !makeSizes.length || !makeColors.length || draftPrice <= 0) {
      toast('Fill the highlighted fields to continue', 'err'); return
    }
    const styleCode = draft.styleCode.trim().toUpperCase()
    if (products.some((p) => p.styleCode === styleCode)) { toast(`Style code ${styleCode} is already used`, 'err'); return }

    const productId = id('prd')
    const product: Product = {
      id: productId, styleCode, name: draft.name.trim(),
      categoryId: draft.categoryId || categories[0]?.id || '',
      brand: draft.brand.trim(), fabric: draft.fabric.trim(), season: draft.season, hsn: draft.hsn.trim(),
      active: true, createdAt: Date.now(),
    }
    await db.products.add(product)

    let made = 0
    for (const color of makeColors) {
      for (const size of makeSizes) {
        await db.variants.add({
          id: id('var'), productId,
          sku: skuFor(product.styleCode, color, size),
          barcode: await nextBarcode(), size, color,
          cost: Number(draft.cost) || 0, mrp: Number(draft.mrp) || draftPrice, price: draftPrice,
          stock: 0, reorderLevel: 3,
        })
        made++
      }
    }
    toast(`${product.name} added — ${made} barcoded variants created`, 'ok')
    setCreating(false)
    setDraft(EMPTY)
    setEditing(product)
  }

  async function removeProduct(p: Product) {
    const vs = byProduct.get(p.id) ?? []
    await db.variants.bulkDelete(vs.map((v) => v.id))
    await db.products.delete(p.id)
    toast(`${p.name} removed`, 'ok')
  }

  function exportCsv() {
    const productMap = new Map(products.map((p) => [p.id, p]))
    downloadFile(`inventory-${new Date().toISOString().slice(0, 10)}.csv`, toCSV(variants.map((v) => {
      const p = productMap.get(v.productId)
      return {
        styleCode: p?.styleCode ?? '', name: p?.name ?? '', brand: p?.brand ?? '',
        category: catMap.get(p?.categoryId ?? '')?.name ?? '',
        hsn: p?.hsn ?? '', sku: v.sku, barcode: v.barcode, size: v.size, color: v.color,
        cost: v.cost, mrp: v.mrp, price: v.price, stock: v.stock, reorderLevel: v.reorderLevel,
      }
    })))
    toast('Inventory exported', 'ok')
  }

  async function importCsv(file: File) {
    const parsed = parseCSV(await file.text())
    if (!parsed.length) { toast('That file has no rows', 'err'); return }
    // Lookups by SKU / barcode / style are maps, so a big file doesn't rescan the catalogue per row.
    const bySku = new Map(variants.map((v) => [v.sku, v]))
    const byCode = new Map(variants.map((v) => [v.barcode, v]))
    const byStyle = new Map(products.map((p) => [p.styleCode, p]))
    let created = 0, updated = 0
    for (const r of parsed) {
      const existing = bySku.get(r.sku) ?? (r.barcode ? byCode.get(r.barcode) : undefined)
      if (existing) {
        await db.variants.update(existing.id, {
          cost: Number(r.cost) || existing.cost,
          mrp: Number(r.mrp) || existing.mrp,
          price: Number(r.price) || existing.price,
          stock: r.stock !== undefined && r.stock !== '' ? Number(r.stock) : existing.stock,
          reorderLevel: Number(r.reorderLevel) || existing.reorderLevel,
        })
        updated++
        continue
      }
      const style = (r.styleCode || 'IMP').toUpperCase()
      let product = byStyle.get(style)
      if (!product) {
        product = {
          id: id('prd'), styleCode: style, name: r.name || 'Imported item',
          categoryId: categories.find((c) => c.name === r.category)?.id ?? categories[0]?.id ?? '',
          brand: r.brand ?? '', fabric: r.fabric ?? '', season: r.season || 'All Season',
          hsn: r.hsn || '6205', active: true, createdAt: Date.now(),
        }
        await db.products.add(product)
        byStyle.set(style, product)
      }
      const nv: Variant = {
        id: id('var'), productId: product.id,
        sku: r.sku || skuFor(product.styleCode, r.color ?? '', r.size ?? ''),
        barcode: r.barcode || (await nextBarcode()),
        size: r.size || 'Free', color: r.color || 'Assorted',
        cost: Number(r.cost) || 0, mrp: Number(r.mrp) || 0, price: Number(r.price) || Number(r.mrp) || 0,
        stock: Number(r.stock) || 0, reorderLevel: Number(r.reorderLevel) || 3,
      }
      await db.variants.add(nv)
      bySku.set(nv.sku, nv); byCode.set(nv.barcode, nv)
      created++
    }
    toast(`Import done — ${created} new, ${updated} updated`, 'ok')
  }

  const filtered = !!(q || stockFilter)

  return (
    <div className="inv-scope">
      <header className="topbar">
        <h1>Inventory</h1>
        <div className="grow" />
        <label className="btn">
          <Upload size={15} /> Import CSV
          <input type="file" accept=".csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = '' }} />
        </label>
        <button className="btn" onClick={exportCsv} disabled={!variants.length}><Download size={15} /> Export</button>
        <button className="btn btn-primary" onClick={openNew}><Plus size={15} /> New item</button>
      </header>

      <div className="page">
        <div className="page-narrow col gap-16">
          <div className="bills-filters">
            <div className="search-wrap" style={{ flex: '1 1 300px', maxWidth: 420 }}>
              <span className="ico"><Search /></span>
              <input ref={searchRef} className="input" placeholder="Search name, style code, brand, SKU or barcode"
                value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); searchRef.current?.blur() } }} />
            </div>
            <select className="select" style={{ width: 160 }} value={stockFilter} onChange={(e) => setStockFilter(e.target.value as StockFilter)} aria-label="Show">
              <option value="">All items</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
            </select>
            <div className="grow" />
            <span className="small muted">
              <b className="num">{all.length}</b> styles · <b className="num">{totals.pieces.toLocaleString('en-IN')}</b> pieces · Stock value <b className="num">{inr(totals.value)}</b>
            </span>
          </div>

          <section className="card">
            {!rows.length ? (
              <Empty icon={<InventoryIcon size={24} />}
                title={filtered ? 'No items match' : 'No items yet'}
                hint={filtered ? 'Try a different search.' : 'Add your first style — each size and colour becomes its own barcoded SKU.'} />
            ) : (
              <div className="table-wrap">
                <table className="tbl inv-tbl">
                  <thead>
                    <tr>
                      <th>Item</th><th>Category</th><th className="num">Variants</th><th>Stock</th>
                      <th className="num">Price</th><th className="num">Stock value</th><th />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((r, i) => (
                      <tr key={r.product.id} className={`inv-row clickable ${i === sel ? 'sel' : ''}`}
                        onClick={() => { setSel(i); setEditing(r.product) }} onMouseEnter={() => setSel(i)}>
                        <td>
                          <div className="bold">{r.product.name}{!r.product.active && <span className="badge" style={{ marginLeft: 8 }}>Discontinued</span>}</div>
                          <div className="small muted"><span className="mono">{r.product.styleCode}</span>{r.product.brand && ` · ${r.product.brand}`}</div>
                        </td>
                        <td>
                          <div>{r.catName}</div>
                          <div className="small muted">{r.group}</div>
                        </td>
                        <td className="num">{r.variants.length}</td>
                        <td style={{ minWidth: 170 }}>
                          <div className="row between" style={{ gap: 8 }}>
                            <span className="num bold">{r.stock}</span>
                            <span className="row gap-4">
                              {r.out > 0 && <span className="badge badge-danger">{r.out} out</span>}
                              {r.low > 0 && <span className="badge badge-warn">{r.low} low</span>}
                            </span>
                          </div>
                          {r.variants.length ? <StockMix total={r.variants.length} low={r.low} out={r.out} /> : <div className="tiny muted" style={{ marginTop: 4 }}>No sizes added yet</div>}
                        </td>
                        <td className="num">{r.minPrice === r.maxPrice ? inr(r.maxPrice) : `${inr(r.minPrice)}–${inr(r.maxPrice)}`}</td>
                        <td className="num">{inr(r.value)}</td>
                        <td className="right nowrap">
                          <button className="btn btn-sm btn-ghost inv-act" title="Edit" aria-label={`Edit ${r.product.name}`} onClick={(e) => { e.stopPropagation(); setEditing(r.product) }}><PencilIcon size={15} /></button>
                          <button className="btn btn-sm btn-ghost inv-act" style={{ color: 'var(--danger)' }} title="Delete" aria-label={`Delete ${r.product.name}`} onClick={(e) => { e.stopPropagation(); setDeleting(r.product) }}><TrashIcon size={15} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {rows.length > limit && (
                  <div className="center" style={{ padding: 14 }}>
                    <button className="btn" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more · {rows.length - limit} not shown</button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* ---- New item ---- */}
      <Modal open={creating} title="New item" onClose={() => setCreating(false)} width="wide" footer={
        <>
          <button className="btn" onClick={() => setCreating(false)}>Cancel</button>
          <button className="btn btn-primary btn-lg" onClick={createProduct}>
            Create {makeSizes.length && makeColors.length ? (makeSizes.length * makeColors.length === 1 ? '1 item' : `${makeSizes.length * makeColors.length} variants`) : 'item'} &amp; barcodes
          </button>
        </>
      }>
        <div onKeyDown={(e) => moveOnEnter(e, () => void createProduct())}>
        <div className="form-section">
          <h3>Category</h3>
          <CategoryPicker categories={categories} value={draft.categoryId} onPick={pickCategory} />
        </div>

        <div className="form-section">
          <h3>Item</h3>
          <div className="grid grid-3">
            <Field label="Item name *"><input ref={nameRef} className={`input ${bad.name ? 'invalid' : ''}`} autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Oxford Casual Shirt" /></Field>
            <Field label="Style code *" hint={codeTouched ? 'Becomes the SKU prefix' : 'Made automatically from the category — change it if you like'}>
              <input className={`input ${bad.style ? 'invalid' : ''}`} value={draft.styleCode} onChange={(e) => { setCodeTouched(true); setDraft({ ...draft, styleCode: e.target.value.toUpperCase() }) }} placeholder="WS-101" />
            </Field>
            <Field label="Brand"><input className="input" value={draft.brand} onChange={(e) => setDraft({ ...draft, brand: e.target.value })} /></Field>
            <Field label="Fabric"><input className="input" value={draft.fabric} onChange={(e) => setDraft({ ...draft, fabric: e.target.value })} placeholder="Cotton" /></Field>
            <Field label="Season">
              <select className="select" value={draft.season} onChange={(e) => setDraft({ ...draft, season: e.target.value })}>
                {['All Season', 'Summer', 'Winter', 'Festive', 'Monsoon'].map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          </div>
        </div>

        <div className="form-section">
          <h3>Pricing</h3>
          <div className="grid grid-4">
            <Field label="Purchase cost (₹)"><input className="input num" inputMode="decimal" value={draft.cost} onChange={(e) => setDraft({ ...draft, cost: e.target.value })} /></Field>
            <Field label="MRP (₹)"><input className="input num" inputMode="decimal" value={draft.mrp} onChange={(e) => setDraft({ ...draft, mrp: e.target.value })} /></Field>
            <Field label="Selling price (₹) *" hint="Tag price, inclusive of GST"><input className={`input num ${bad.price ? 'invalid' : ''}`} inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></Field>
            <Field label="HSN code" hint="Apparel is usually 6203–6206"><input className="input" value={draft.hsn} onChange={(e) => setDraft({ ...draft, hsn: e.target.value })} /></Field>
          </div>
          {draftMargin !== null && (
            <div className="small" style={{ marginTop: 8, color: draftMargin < 15 ? 'var(--warn)' : 'var(--ok)', fontWeight: 600 }}>
              Margin {inr(draftPrice - Number(draft.cost))} per piece · {draftMargin.toFixed(0)}%{draftMargin < 15 ? ' — thin' : ''}
            </div>
          )}
        </div>

        <div className="form-section">
          <h3>Sizes &amp; colours</h3>
          <div className="row gap-6 wrap" style={{ marginBottom: 10 }}>
            <button type="button" className={`chip ${!draft.plain ? 'on' : ''}`}
              onClick={() => setDraft({ ...draft, plain: false, sizes: EMPTY.sizes, colors: '' })}>Has sizes &amp; colours</button>
            <button type="button" className={`chip ${draft.plain ? 'on' : ''}`}
              onClick={() => setDraft({ ...draft, plain: true, sizes: '', colors: '' })}>No sizes or colours (sarees, etc.)</button>
          </div>
          {draft.plain ? (
            <>
              <Field label="Types / varieties (optional)" hint="e.g. Kanjivaram, Banarasi, Cotton — each one becomes its own barcoded item. Leave empty for a single item.">
                <TagInput value={draft.sizes} onChange={(v) => setDraft({ ...draft, sizes: v })} placeholder="Kanjivaram, Banarasi…" />
              </Field>
              <div className="variant-preview">
                {sizes.length ? (
                  <>
                    <b>{sizes.length} items</b> — {draft.name.trim() || 'Item'} · {sizes.join(', ')} — each with its own SKU and EAN-13 barcode.
                    {' '}First one: <span className="mono">{skuFor(draft.styleCode || 'STYLE', '', sizes[0])}</span>
                  </>
                ) : <>One item with a single SKU and barcode: <span className="mono">{skuFor(draft.styleCode || 'STYLE', '', '')}</span></>}
              </div>
            </>
          ) : (
            <>
              <div className="row gap-6 wrap" style={{ marginBottom: 10 }}>
                <span className="small muted">Size preset</span>
                {Object.entries(SIZE_PRESETS).map(([label, val]) => (
                  <button key={label} type="button" className={`chip ${draft.sizes === val ? 'on' : ''}`} onClick={() => setDraft({ ...draft, sizes: val })}>{label}</button>
                ))}
              </div>
              <div className="grid grid-2">
                <Field label="Sizes *" hint="Type a size and press Enter"><TagInput value={draft.sizes} invalid={bad.sizes} onChange={(v) => setDraft({ ...draft, sizes: v })} placeholder="S, M, L…" /></Field>
                <Field label="Colours *" hint="Type a colour and press Enter"><TagInput value={draft.colors} invalid={bad.colors} onChange={(v) => setDraft({ ...draft, colors: v })} placeholder="White, Navy, Black…" /></Field>
              </div>
              <div className="variant-preview">
                {sizes.length && colors.length ? (
                  <>
                    <b>{sizes.length * colors.length} variants</b> ({sizes.length} sizes × {colors.length} colours), each with its own SKU and EAN-13 barcode.
                    {' '}First one: <span className="mono">{skuFor(draft.styleCode || 'STYLE', colors[0], sizes[0])}</span>
                  </>
                ) : <>Add at least one size and one colour — each combination becomes a barcoded SKU. Print labels from <b>Barcode Labels</b>.</>}
              </div>
            </>
          )}
        </div>
        </div>
      </Modal>

      {editing && <ProductEditor product={editing} variants={byProduct.get(editing.id) ?? []} categories={categories} onClose={() => setEditing(null)} userId={user?.id ?? ''} />}

      <Confirm
        open={!!deleting}
        title="Delete item?"
        danger
        confirmLabel="Delete permanently"
        message={<>This removes <strong>{deleting?.name}</strong> and all {(byProduct.get(deleting?.id ?? '') ?? []).length} of its variants. Past bills keep their record.</>}
        onConfirm={() => deleting && removeProduct(deleting)}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

/** Thin bar showing how many of a style's variants are healthy / low / sold out. */
function StockMix({ total, low, out }: { total: number; low: number; out: number }) {
  // No sizes yet: nothing to draw. (The old `empty` class here collided with the global empty-state style and became a huge pill.)
  if (!total) return null
  const pct = (n: number) => `${(n / total) * 100}%`
  return (
    <div className="stock-mix" role="img" aria-label={`${total - low - out} healthy, ${low} low, ${out} out of stock`}>
      <i style={{ width: pct(total - low - out), background: 'var(--ok)' }} />
      <i style={{ width: pct(low), background: '#f59e0b' }} />
      <i style={{ width: pct(out), background: 'var(--danger)' }} />
    </div>
  )
}

/* ---------------------------------------------------------------- */

function ProductEditor({ product, variants, categories, onClose, userId }: {
  product: Product; variants: Variant[]; categories: Category[]; onClose: () => void; userId: string
}) {
  const { toast } = useApp()
  const [form, setForm] = useState(product)
  const [saved, setSaved] = useState(product)
  const [tab, setTab] = useState<'matrix' | 'variants' | 'details'>('matrix')
  const [newSize, setNewSize] = useState('')
  const [newColor, setNewColor] = useState('')
  const [bulk, setBulk] = useState({ cost: '', mrp: '', price: '' })
  const [pendingBulk, setPendingBulk] = useState<{ field: 'price' | 'mrp' | 'cost'; value: number } | null>(null)
  const matrixRef = useRef<HTMLDivElement>(null)

  const sizes = useMemo(() => [...new Set(variants.map((v) => v.size))].sort((a, b) => sizeRank(a) - sizeRank(b)), [variants])
  const colors = useMemo(() => [...new Set(variants.map((v) => v.color))], [variants])
  const grid = useMemo(() => new Map(variants.map((v) => [`${v.size}|${v.color}`, v])), [variants])
  const cell = (size: string, color: string) => grid.get(`${size}|${color}`)

  const dirty = JSON.stringify(form) !== JSON.stringify(saved)
  const stock = variants.reduce((s, v) => s + v.stock, 0)
  const value = round2(variants.reduce((s, v) => s + v.stock * v.cost, 0))
  const low = variants.filter((v) => v.stock > 0 && v.stock <= v.reorderLevel).length
  const out = variants.filter((v) => v.stock <= 0).length
  const prices = variants.map((v) => v.price)

  async function saveDetails() {
    await db.products.update(product.id, form)
    setSaved(form)
    toast('Item updated', 'ok')
  }

  async function addVariants() {
    const addSizes = newSize ? parseTags(newSize) : sizes
    const addColors = newColor ? parseTags(newColor) : colors
    const base = variants[0]
    let made = 0
    for (const color of addColors) {
      for (const size of addSizes) {
        if (cell(size, color)) continue
        await db.variants.add({
          id: id('var'), productId: product.id,
          sku: skuFor(product.styleCode, color, size),
          barcode: await nextBarcode(), size, color,
          cost: base?.cost ?? 0, mrp: base?.mrp ?? 0, price: base?.price ?? 0,
          stock: 0, reorderLevel: base?.reorderLevel ?? 3,
        })
        made++
      }
    }
    setNewSize(''); setNewColor('')
    toast(made ? `${made} variants added` : 'Those variants already exist', made ? 'ok' : 'info')
  }

  /** Overwriting every variant is hard to undo, so it always asks first. */
  function applyBulk(field: 'price' | 'mrp' | 'cost') {
    const value = Number(bulk[field])
    if (!(value > 0)) { toast(`Enter a ${field.toUpperCase()} first`, 'err'); return }
    setPendingBulk({ field, value })
  }

  async function confirmBulk() {
    if (!pendingBulk) return
    const { field, value } = pendingBulk
    await db.variants.bulkUpdate(variants.map((v) => ({ key: v.id, changes: { [field]: value } })))
    setBulk((b) => ({ ...b, [field]: '' }))
    toast(`${field.toUpperCase()} set to ${inr(value)} on all ${variants.length} variants`, 'ok')
  }

  async function setStock(v: Variant, next: number) {
    if (next === v.stock) return
    await db.variants.update(v.id, { stock: next })
    await db.moves.add({
      id: id('mv'), variantId: v.id, qty: next - v.stock, type: 'adjust',
      ref: 'MATRIX', reason: 'Edited from size matrix', at: Date.now(), userId,
    })
  }

  /** Enter in a matrix cell saves it and moves on to the next one, like a spreadsheet. */
  function nextCell(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const inputs = [...(matrixRef.current?.querySelectorAll<HTMLInputElement>('.matrix input') ?? [])]
    inputs[inputs.indexOf(e.currentTarget) + 1]?.focus()
    if (inputs.indexOf(e.currentTarget) === inputs.length - 1) e.currentTarget.blur()
  }

  return (
    <>
    <Modal
      open
      width="xwide"
      onClose={() => (pendingBulk ? setPendingBulk(null) : onClose())}
      title={
        <div>
          <h2>{product.name}</h2>
          <div className="small muted"><span className="mono">{product.styleCode}</span> · {variants.length} variants</div>
        </div>
      }
      footer={
        <>
          <button className="btn" onClick={onClose}>Close</button>
          {tab === 'details' && (dirty
            ? <button className="btn btn-primary btn-lg" onClick={saveDetails}>Save details</button>
            : <span className="saved-note">✓ All changes saved</span>)}
        </>
      }
    >
      <div className="ed-summary">
        <div><span className="small muted">Stock</span><b className="num">{stock}</b></div>
        <div><span className="small muted">Stock value</span><b className="num">{inr(value)}</b></div>
        <div><span className="small muted">Price</span><b className="num">{prices.length ? (Math.min(...prices) === Math.max(...prices) ? inr(prices[0]) : `${inr(Math.min(...prices))}–${inr(Math.max(...prices))}`) : '—'}</b></div>
        <div className="grow" />
        {low > 0 && <span className="badge badge-warn">{low} low</span>}
        {out > 0 && <span className="badge badge-danger">{out} out of stock</span>}
        {!low && !out && variants.length > 0 && <span className="badge badge-ok">Every size stocked</span>}
      </div>

      <div className="seg" style={{ margin: '14px 0' }}>
        <button className={tab === 'matrix' ? 'on' : ''} onClick={() => setTab('matrix')}>Size × colour stock</button>
        <button className={tab === 'variants' ? 'on' : ''} onClick={() => setTab('variants')}>Prices &amp; barcodes</button>
        <button className={tab === 'details' ? 'on' : ''} onClick={() => setTab('details')}>Item details</button>
      </div>

      {tab === 'matrix' && (
        <>
          <div className="table-wrap" ref={matrixRef}>
            <table className="matrix">
              <thead>
                <tr>
                  <th className="corner">Colour \ Size</th>
                  {sizes.map((s) => <th key={s}>{s || '—'}</th>)}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {colors.map((c) => (
                  <tr key={c}>
                    <th className="corner">{c || '—'}</th>
                    {sizes.map((s) => {
                      const v = cell(s, c)
                      if (!v) return <td key={s} className="cell-zero">—</td>
                      const cls = v.stock <= 0 ? 'cell-out' : v.stock <= v.reorderLevel ? 'cell-low' : ''
                      return (
                        <td key={s} className={cls}>
                          <input className="num" key={`${v.id}:${v.stock}`} defaultValue={v.stock} inputMode="numeric"
                            title={`${v.sku} · ${v.barcode}`} aria-label={`${c} ${s} stock`}
                            onFocus={(e) => e.currentTarget.select()}
                            onKeyDown={nextCell}
                            onBlur={(e) => void setStock(v, Math.max(0, Math.round(Number(e.target.value) || 0)))} />
                        </td>
                      )
                    })}
                    <td className="bold num">{sizes.reduce((s, sz) => s + (cell(sz, c)?.stock ?? 0), 0)}</td>
                  </tr>
                ))}
                <tr>
                  <th className="corner">Total</th>
                  {sizes.map((s) => <td key={s} className="bold num">{colors.reduce((t, c) => t + (cell(s, c)?.stock ?? 0), 0)}</td>)}
                  <td className="bold num">{stock}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="row gap-16 small muted" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            <span className="legend-dot" style={{ ['--c' as string]: '#fde68a' }}>At or below reorder level</span>
            <span className="legend-dot" style={{ ['--c' as string]: '#fecaca' }}>Out of stock</span>
            <span>Type a number and press Enter — every change is written to the stock ledger.</span>
          </div>

          <div className="form-section" style={{ marginTop: 16 }}>
            <h3>Add sizes or colours</h3>
            <div className="row gap-6 wrap">
              <div style={{ flex: '1 1 220px' }}><TagInput value={newSize} onChange={setNewSize} placeholder="New sizes, e.g. 3XL" /></div>
              <div style={{ flex: '1 1 220px' }}><TagInput value={newColor} onChange={setNewColor} placeholder="New colours, e.g. Olive" /></div>
              <button className="btn btn-primary" onClick={addVariants} disabled={!newSize && !newColor}><Plus size={15} /> Add variants</button>
            </div>
            <div className="small muted" style={{ marginTop: 6 }}>New variants copy this item's price and start at 0 stock. Existing combinations are skipped.</div>
          </div>
        </>
      )}

      {tab === 'variants' && (
        <>
          <div className="form-section" style={{ marginTop: 0 }}>
            <h3>Set for every variant</h3>
            <div className="row gap-16 wrap">
              {(['cost', 'mrp', 'price'] as const).map((f) => (
                <div key={f} className="row gap-6">
                  <input className="input num" style={{ width: 110 }} inputMode="decimal" placeholder={f === 'price' ? 'Selling price' : f.toUpperCase()}
                    value={bulk[f]} onChange={(e) => setBulk({ ...bulk, [f]: e.target.value.replace(/[^\d.]/g, '') })}
                    onKeyDown={(e) => { if (e.key === 'Enter') applyBulk(f) }} />
                  <button className={`btn ${bulk[f] ? 'btn-primary' : ''}`} onClick={() => applyBulk(f)}>Apply to all</button>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table className="tbl">
                <thead>
                  <tr><th>SKU</th><th>Size</th><th>Colour</th><th>Barcode</th><th className="num">Cost</th><th className="num">MRP</th><th className="num">Price</th><th className="num">Margin</th><th className="num">Stock</th><th className="num">Reorder at</th></tr>
                </thead>
                <tbody>
                  {[...variants].sort((a, b) => a.color.localeCompare(b.color) || sizeRank(a.size) - sizeRank(b.size)).map((v) => {
                    const m = margin(v.price, v.cost)
                    return (
                      <tr key={v.id}>
                        <td className="mono small">{v.sku}</td>
                        <td>{v.size}</td>
                        <td>{v.color}</td>
                        <td className="mono small">{v.barcode}</td>
                        {(['cost', 'mrp', 'price'] as const).map((f) => (
                          <td key={f} className="num">
                            <input className="input num cell-input" key={`${v.id}:${f}:${v[f]}`} defaultValue={v[f]} inputMode="decimal" aria-label={`${v.sku} ${f}`}
                              onFocus={(e) => e.currentTarget.select()}
                              onBlur={(e) => { const n = Number(e.target.value) || 0; if (n !== v[f]) void db.variants.update(v.id, { [f]: n } as Partial<Variant>) }} />
                          </td>
                        ))}
                        <td className="num">{m === null ? <span className="muted">—</span> : <span style={{ color: m < 15 ? 'var(--warn)' : undefined }}>{m.toFixed(0)}%</span>}</td>
                        {(['stock', 'reorderLevel'] as const).map((f) => (
                          <td key={f} className="num">
                            <input className={`input num cell-input ${f === 'stock' ? (v.stock <= 0 ? 'is-out' : v.stock <= v.reorderLevel ? 'is-low' : '') : ''}`} key={`${v.id}:${f}:${v[f]}`} defaultValue={v[f]} inputMode="numeric" aria-label={`${v.sku} ${f}`}
                              onFocus={(e) => e.currentTarget.select()}
                              onBlur={(e) => {
                                const n = Math.max(0, Math.round(Number(e.target.value) || 0))
                                if (n === v[f]) return
                                if (f === 'stock') void setStock(v, n); else void db.variants.update(v.id, { reorderLevel: n })
                              }} />
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'details' && (
        <>
          <div className="form-section" style={{ marginTop: 0 }}>
            <h3>Basics</h3>
            <div className="grid grid-3">
              <Field label="Item name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Style code" hint="Existing SKUs keep their old prefix"><input className="input" value={form.styleCode} onChange={(e) => setForm({ ...form, styleCode: e.target.value.toUpperCase() })} /></Field>
              <Field label="Category">
                <select className="select" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.group} — {c.name}</option>)}
                </select>
              </Field>
            </div>
          </div>
          <div className="form-section">
            <h3>Product</h3>
            <div className="grid grid-3">
              <Field label="Brand"><input className="input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
              <Field label="Fabric"><input className="input" value={form.fabric} onChange={(e) => setForm({ ...form, fabric: e.target.value })} /></Field>
              <Field label="Season"><input className="input" value={form.season} onChange={(e) => setForm({ ...form, season: e.target.value })} /></Field>
            </div>
          </div>
          <div className="form-section">
            <h3>Tax &amp; status</h3>
            <div className="grid grid-3">
              <Field label="HSN code" hint="Apparel is usually 6203–6206"><input className="input" value={form.hsn} onChange={(e) => setForm({ ...form, hsn: e.target.value })} /></Field>
              <Field label="Status" hint="Discontinued items stay in past bills">
                <select className="select" value={form.active ? '1' : '0'} onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}>
                  <option value="1">Active</option><option value="0">Discontinued</option>
                </select>
              </Field>
            </div>
          </div>
        </>
      )}
    </Modal>

    <Confirm
      open={!!pendingBulk}
      title="Change every variant?"
      danger
      confirmLabel={pendingBulk ? `Set all to ${inr(pendingBulk.value)}` : 'Apply'}
      message={pendingBulk && (
        <>
          This sets the <strong>{pendingBulk.field === 'cost' ? 'purchase cost' : pendingBulk.field === 'mrp' ? 'MRP' : 'selling price'}</strong> of
          all <strong>{variants.length} variants</strong> of {product.name} to <strong>{inr(pendingBulk.value)}</strong>,
          replacing the current values (for example {inr(variants[0]?.[pendingBulk.field] ?? 0)} on {variants[0]?.sku}).
        </>
      )}
      onConfirm={() => void confirmBulk()}
      onClose={() => setPendingBulk(null)}
    />
    </>
  )
}
