import { useEffect, useMemo, useRef, useState } from 'react'
import { inr, round2 } from '../lib/money'
import { buildIndex, searchGroups, sizeRank } from '../lib/posSearch'
import { createStyle } from '../db/catalog'
import { Field } from './ui'
import { TagInput, parseTags } from './TagInput'
import { useApp } from '../state'
import type { VariantView } from '../db/ops'
import type { Category, Product } from '../db/types'

export interface ReceiveLine { variant: VariantView; qty: number; cost: number }

/**
 * Enter a whole delivery of one style in seconds: pick the style, then type how many of each
 * size and colour arrived into a grid — instead of scanning or searching piece by piece.
 */
export function SizeGrid({ variants, focusProductId, onAdd }: {
  variants: VariantView[]
  /** Open straight on this style (e.g. one just created). */
  focusProductId?: string | null
  onAdd: (lines: ReceiveLine[], styleName: string) => void
}) {
  const index = useMemo(() => buildIndex(variants), [variants])
  const [productId, setProductId] = useState<string | null>(focusProductId ?? null)
  const [q, setQ] = useState('')
  const [qty, setQty] = useState<Record<string, string>>({})
  const [cost, setCost] = useState('')
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (focusProductId) setProductId(focusProductId) }, [focusProductId])
  const group = index.find((g) => g.id === productId) ?? null
  useEffect(() => {
    setQty({})
    setCost(group?.variants[0] ? String(group.variants[0].cost || '') : '')
  }, [group?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const results = useMemo(() => {
    const t = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return t.length ? searchGroups(index, t, 6) : index.slice().sort((a, b) => a.name.localeCompare(b.name)).slice(0, 6).map((g) => ({ group: g }))
  }, [q, index])

  if (!group) {
    return (
      <div>
        <input className="input input-lg" autoFocus placeholder="Which style arrived? Type its name or style code" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="grid grid-2" style={{ marginTop: 10 }}>
          {results.length === 0 && <div className="small muted">No style matches. Use “New item” to create it.</div>}
          {results.map(({ group: g }) => (
            <button key={g.id} type="button" className="grid-pick" onClick={() => setProductId(g.id)}>
              <span className="bold">{g.name}</span>
              <span className="small muted">{g.styleCode}{g.brand ? ` · ${g.brand}` : ''} · {g.variants.length} variants</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  const sizes = [...new Set(group.variants.map((v) => v.size))].sort((a, b) => sizeRank(a) - sizeRank(b))
  const colors = [...new Set(group.variants.map((v) => v.color))]
  const cell = new Map(group.variants.map((v) => [`${v.size}|${v.color}`, v]))
  const lines: ReceiveLine[] = group.variants
    .map((v) => ({ variant: v, qty: Number(qty[v.id]) || 0, cost: Number(cost) || v.cost }))
    .filter((l) => l.qty > 0)
  const pieces = lines.reduce((s, l) => s + l.qty, 0)
  const value = round2(lines.reduce((s, l) => s + l.qty * l.cost, 0))

  function nextCell(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const inputs = [...(gridRef.current?.querySelectorAll<HTMLInputElement>('.matrix input') ?? [])]
    inputs[inputs.indexOf(e.currentTarget) + 1]?.focus()
  }

  function submit() {
    if (!lines.length) return
    onAdd(lines, group!.name)
    setQty({})
  }

  return (
    <div>
      <div className="row between" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <div>
          <span className="bold" style={{ fontSize: 15 }}>{group.name}</span>
          <span className="small muted"> · {group.styleCode}</span>
          <button className="link-btn" style={{ marginLeft: 12 }} onClick={() => { setProductId(null); setQ('') }}>Change style</button>
        </div>
        <div className="row gap-6">
          <span className="small muted">Cost each (₹)</span>
          <input className="input num" style={{ width: 100 }} inputMode="decimal" value={cost} placeholder="0"
            onChange={(e) => setCost(e.target.value.replace(/[^\d.]/g, ''))} />
        </div>
      </div>

      <div className="table-wrap" ref={gridRef}>
        <table className="matrix">
          <thead><tr><th className="corner">Colour \ Size</th>{sizes.map((s) => <th key={s}>{s}</th>)}</tr></thead>
          <tbody>
            {colors.map((c) => (
              <tr key={c}>
                <th className="corner">{c}</th>
                {sizes.map((s) => {
                  const v = cell.get(`${s}|${c}`)
                  if (!v) return <td key={s} className="cell-zero">—</td>
                  return (
                    <td key={s}>
                      <input className="num" inputMode="numeric" placeholder="0" value={qty[v.id] ?? ''} aria-label={`${c} ${s} quantity received`}
                        onFocus={(e) => e.currentTarget.select()}
                        onKeyDown={nextCell}
                        onChange={(e) => setQty({ ...qty, [v.id]: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
                      <div className="small muted" style={{ marginTop: 2 }}>have {v.stock}</div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row between" style={{ marginTop: 12 }}>
        <span className="small muted">Type the pieces received in each box. Press Enter to jump to the next one.</span>
        <button className="btn btn-primary btn-lg" disabled={!lines.length} onClick={submit}>
          Add {pieces} piece{pieces === 1 ? '' : 's'}{value > 0 ? ` · ${inr(value)}` : ''} to receipt
        </button>
      </div>
    </div>
  )
}

const SIZE_PRESETS: Record<string, string> = {
  'Apparel (S–XXL)': 'S, M, L, XL, XXL',
  'Waist (28–40)': '28, 30, 32, 34, 36, 38, 40',
  'Kids (2–10Y)': '2-3Y, 4-5Y, 6-7Y, 8-9Y, 10-11Y',
  'Free size': 'Free',
}

/** Create a brand-new style without leaving the receipt: it gets its own barcoded variants at 0 stock. */
export function NewItemPanel({ categories, products, onCreated }: {
  categories: Category[]
  products: Product[]
  onCreated: (product: Product, variants: number) => void
}) {
  const { toast } = useApp()
  const [d, setD] = useState({ name: '', styleCode: '', categoryId: '', brand: '', sizes: 'S, M, L, XL, XXL', colors: '', cost: '', mrp: '', price: '', plain: false })
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)

  const sizes = parseTags(d.sizes)
  const colors = parseTags(d.colors)
  const price = Number(d.price) || Number(d.mrp) || 0
  const styleCode = d.styleCode.trim().toUpperCase()
  const taken = !!styleCode && products.some((p) => p.styleCode === styleCode)
  const bad = { name: tried && !d.name.trim(), style: (tried && !styleCode) || taken, price: tried && price <= 0, sizes: tried && !d.plain && !sizes.length, colors: tried && !d.plain && !colors.length }
  // A plain item (saree) is one variant per type name, or a single one, and has no colour.
  const makeSizes = d.plain ? (sizes.length ? sizes : ['']) : sizes
  const makeColors = d.plain ? [''] : colors

  async function create() {
    setTried(true)
    if (!d.name.trim() || !styleCode || taken || !makeSizes.length || !makeColors.length || price <= 0) { toast('Fill the highlighted fields to continue', 'err'); return }
    setBusy(true)
    try {
      const { product, variants } = await createStyle({
        name: d.name, styleCode, categoryId: d.categoryId || categories[0]?.id || '', brand: d.brand, fabric: '', season: 'All Season', hsn: '6205',
        sizes: makeSizes, colors: makeColors, cost: Number(d.cost) || 0, mrp: Number(d.mrp) || price, price,
      })
      toast(`${product.name} created — ${variants} variants with barcodes`, 'ok')
      onCreated(product, variants)
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="grid grid-3">
        <Field label="Item name *"><input className={`input ${bad.name ? 'invalid' : ''}`} autoFocus value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Oxford Casual Shirt" /></Field>
        <Field label="Style code *" hint={taken ? undefined : 'Becomes the SKU prefix'}>
          <input className={`input ${bad.style ? 'invalid' : ''}`} value={d.styleCode} onChange={(e) => setD({ ...d, styleCode: e.target.value.toUpperCase() })} placeholder="MS-103" />
          {taken && <span className="small" style={{ color: 'var(--danger)', fontWeight: 650 }}>{styleCode} already exists</span>}
        </Field>
        <Field label="Category">
          <select className="select" value={d.categoryId} onChange={(e) => setD({ ...d, categoryId: e.target.value })}>
            <option value="">Select…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.group} — {c.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid grid-4" style={{ marginTop: 12 }}>
        <Field label="Brand"><input className="input" value={d.brand} onChange={(e) => setD({ ...d, brand: e.target.value })} /></Field>
        <Field label="Cost (₹)"><input className="input num" inputMode="decimal" value={d.cost} onChange={(e) => setD({ ...d, cost: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <Field label="MRP (₹)"><input className="input num" inputMode="decimal" value={d.mrp} onChange={(e) => setD({ ...d, mrp: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
        <Field label="Selling price (₹) *"><input className={`input num ${bad.price ? 'invalid' : ''}`} inputMode="decimal" value={d.price} onChange={(e) => setD({ ...d, price: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
      </div>
      <div className="row gap-6 wrap" style={{ margin: '14px 0 8px' }}>
        <button type="button" className={`chip ${!d.plain ? 'on' : ''}`} onClick={() => setD({ ...d, plain: false, sizes: 'S, M, L, XL, XXL', colors: '' })}>Has sizes &amp; colours</button>
        <button type="button" className={`chip ${d.plain ? 'on' : ''}`} onClick={() => setD({ ...d, plain: true, sizes: '', colors: '' })}>No sizes or colours (sarees, etc.)</button>
      </div>
      {d.plain ? (
        <Field label="Types / varieties (optional)" hint="e.g. Kanjivaram, Banarasi — each becomes its own barcoded item. Leave empty for a single item.">
          <TagInput value={d.sizes} onChange={(v) => setD({ ...d, sizes: v })} placeholder="Kanjivaram, Banarasi…" />
        </Field>
      ) : (<>
      <div className="row gap-6 wrap" style={{ margin: '0 0 8px' }}>
        <span className="small muted">Size preset</span>
        {Object.entries(SIZE_PRESETS).map(([label, val]) => (
          <button key={label} type="button" className={`chip ${d.sizes === val ? 'on' : ''}`} onClick={() => setD({ ...d, sizes: val })}>{label}</button>
        ))}
      </div>
      <div className="grid grid-2">
        <Field label="Sizes *"><TagInput value={d.sizes} invalid={bad.sizes} onChange={(v) => setD({ ...d, sizes: v })} placeholder="S, M, L…" /></Field>
        <Field label="Colours *"><TagInput value={d.colors} invalid={bad.colors} onChange={(v) => setD({ ...d, colors: v })} placeholder="White, Navy…" /></Field>
      </div>
      </>)}
      <div className="row between" style={{ marginTop: 14 }}>
        <span className="small muted">
          {makeSizes.length && makeColors.length ? <><b>{makeSizes.length * makeColors.length === 1 ? '1 item' : `${makeSizes.length * makeColors.length} variants`}</b> will be created with their own barcodes, at 0 stock.</> : 'Add at least one size and one colour.'}
        </span>
        <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => void create()}>Create item &amp; enter quantities</button>
      </div>
    </div>
  )
}
