import type { Category, Product } from '../db/types'

/** Two-letter prefixes in the style the shop already uses (MS-101 = men's shirt). */
const PREFIX: Record<string, string> = {
  cat_wsaree: 'WS', cat_wkurti: 'WK', cat_wtop: 'WT', cat_wjeans: 'WJ',
  cat_mshirt: 'MS', cat_mtshirt: 'MT', cat_mjeans: 'MJ', cat_mkurta: 'MK',
  cat_kids: 'KD', cat_acc: 'AC',
}

export function stylePrefix(c: Category | undefined): string {
  if (!c) return 'ST'
  return PREFIX[c.id] ?? `${(c.group[0] ?? 'X')}${(c.name[0] ?? 'X')}`.toUpperCase()
}

/** The next free style code for a category: WS-101, WS-102 … (never reuses a number already taken). */
export function nextStyleCode(c: Category | undefined, products: Array<Pick<Product, 'styleCode'>>): string {
  const prefix = stylePrefix(c)
  const used = new Set(products.map((p) => p.styleCode.toUpperCase()))
  let max = 100
  for (const code of used) {
    const m = new RegExp(`^${prefix}-(\\d+)$`).exec(code)
    if (m) max = Math.max(max, Number(m[1]))
  }
  let n = max + 1
  while (used.has(`${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}

const GROUP_ORDER = ['Women', 'Men', 'Kids', 'Accessories']

/** Sarees first, then the rest grouped Women → Men → Kids → Accessories, alphabetical inside each group. */
export function sortCategories<T extends Pick<Category, 'id' | 'name' | 'group'>>(cats: T[]): T[] {
  const rank = (c: T) => {
    if (c.id === 'cat_wsaree' || /^saree/i.test(c.name)) return -1
    const g = GROUP_ORDER.indexOf(c.group)
    return g === -1 ? GROUP_ORDER.length : g
  }
  return [...cats].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}
