import type { CSSProperties } from 'react'
import { getBarcodeMarkup } from '../lib/barcode'
import { inr } from '../lib/money'

/** The physical page width a printer needs for one row of labels — shared
 *  by every call site so the @page size passed to PrintProvider always
 *  matches what LabelSheet itself lays out. */
export function labelRowWidthMm(widthMm: number, across: number, gapMm: number): number {
  return across * widthMm + (across - 1) * gapMm
}

export interface LabelSpec {
  barcode: string
  name: string
  size: string
  color: string
  sku: string
  mrp: number
  copies: number
}

/**
 * Every font size, the barcode's height and the cell padding were tuned by
 * eye against a 38mm-tall label — this baseline lets them scale down (or up)
 * proportionally for whatever height Settings actually has, instead of
 * overflowing a shorter label or wasting space on a taller one. Clamped so a
 * pathologically short or tall setting can't shrink text to unreadable.
 */
const BASELINE_HEIGHT_MM = 38
function fitScale(heightMm: number): number {
  return Math.min(1.25, Math.max(0.45, heightMm / BASELINE_HEIGHT_MM))
}

/** Size/gap/padding as CSS custom properties — shared by the printed sheet and the on-screen preview. */
export function labelVars(widthMm: number, heightMm: number, gapMm = 0): CSSProperties {
  const padMm = Math.max(0.8, Math.min(2, 2 * fitScale(heightMm)))
  return {
    '--label-w': `${widthMm}mm`, '--label-h': `${heightMm}mm`, '--label-gap': `${gapMm}mm`, '--label-pad': `${padMm}mm`,
  } as CSSProperties
}

/** "₹1,699" for whole rupees (cleaner on a tag), "₹1,699.50" otherwise. */
const price = (n: number) => (Number.isInteger(n) ? '₹' + n.toLocaleString('en-IN') : inr(n))

/**
 * The inside of one garment label. The barcode is the only thing meant to stand out: everything else is
 * plain, normal-weight black text so it is easy to read without competing with the bars. Pure black on white
 * because thermal printers have no grey. Used by the printed sheet and the preview, so what you see is what prints.
 */
export function LabelFace({ l, storeName, showMrp = true, heightMm }: {
  l: Omit<LabelSpec, 'copies'> & { copies?: number }
  storeName: string
  showMrp?: boolean
  /** Kept for callers; the face scales from the label height alone. */
  widthMm?: number
  heightMm: number
}) {
  const scale = fitScale(heightMm)
  // Barcode size is deliberately the original one (36px tall, 1.25px modules, 10px digits, scaled with the
  // label height): large enough to scan reliably, so the rest of the label is fitted around it.
  const bars = getBarcodeMarkup(l.barcode, { height: 36 * scale, width: 1.25, fontSize: 10 * scale })
  const variant = [l.size, l.color].filter(Boolean).join(' / ')
  return (
    <>
      <div className="lbl-store" style={{ fontSize: 8 * scale }}>{storeName}</div>
      <div className="lbl-line" style={{ fontSize: 10.5 * scale }}>
        <span className="lbl-name">{l.name}</span>
        {variant && <span className="lbl-variant"> · {variant}</span>}
      </div>
      <span className="lbl-bar" dangerouslySetInnerHTML={{ __html: bars }} />
      <div className="lbl-foot" style={{ fontSize: 10.5 * scale }}>
        {showMrp ? <span className="lbl-mrp">MRP {price(l.mrp)}</span> : <span />}
        <span className="lbl-sku">{l.sku}</span>
      </div>
    </>
  )
}

/**
 * Barcode label sheet — one physical *row* per printed page, sized in mm to
 * exactly match the sticker stock loaded in the printer (a label-roll or
 * die-cut printer feeds by page size, so a mismatch prints across labels or
 * leaves a gap). Most rolls are a single lane (across=1, one label = one
 * row = one page); some carry two or more labels side by side, in which
 * case a page is `across` labels wide plus `across - 1` gaps of `gapMm`,
 * and the trailing row is padded with empty slots so it still lays out
 * `across`-wide. widthMm/heightMm/across/gapMm come from Settings → Label
 * printing and drive both the page size itself (PrintProvider's dynamic
 * @page rule) and each cell's on-paper dimensions via CSS custom
 * properties. A run can carry hundreds of *copies* of the same handful of
 * SKUs, so each cell embeds pre-rendered barcode markup (getBarcodeMarkup
 * caches by value) instead of mounting a live JsBarcode-backed component
 * per copy — regenerating identical barcodes is what froze the page on a
 * large print run.
 */
export function LabelSheet({ labels, storeName, showMrp = true, widthMm, heightMm, across = 1, gapMm = 0 }: {
  labels: LabelSpec[]; storeName: string; showMrp?: boolean
  widthMm: number; heightMm: number; across?: number; gapMm?: number
}) {
  const flat = labels.flatMap((l) => Array.from({ length: Math.max(1, l.copies) }, () => l))
  const rows: (LabelSpec | null)[][] = []
  for (let i = 0; i < flat.length; i += across) {
    const row: (LabelSpec | null)[] = flat.slice(i, i + across)
    while (row.length < across) row.push(null)
    rows.push(row)
  }
  return (
    <div className="label-sheet" style={labelVars(widthMm, heightMm, gapMm)}>
      {rows.map((row, r) => (
        <div className="label-row" key={r}>
          {row.map((l, i) => l ? (
            <div className="label-cell" key={i}>
              <LabelFace l={l} storeName={storeName} showMrp={showMrp} widthMm={widthMm} heightMm={heightMm} />
            </div>
          ) : <div className="label-cell label-cell-empty" key={i} />)}
        </div>
      ))}
    </div>
  )
}
