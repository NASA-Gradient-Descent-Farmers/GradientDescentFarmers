import type { NearCentre } from './acopio.ts'
import type { DistrictRotation, WaterRegime } from './district.ts'

// "Where to sell": for each crop in a rotation, the official buyer and price when there is one, else where wholesale
// prices are published. Maíz and frijol from small producers have a federal guarantee price (Acopio para el Bienestar,
// Reglas de Operación 2026, DOF); other crops have no public buyer list, so the line points to SNIIM's wholesale prices
// and says plainly that the farm-gate price is usually lower. Nothing here is a promise that a buyer exists nearby.

/** Reglas de Operación del Programa de Acopio para el Bienestar 2026 (DOF), Art. 3, 6 and 11 (maxTHa: the yield cap it buys,
 * tonnes per hectare). Update every year. */
export const GUARANTEE = {
  year: 2026,
  maiz: { price: 7000, maxT: 35, maxHa: { temporal: 5, riego: 5 }, maxTHa: { temporal: 7, riego: 7 } },
  /** Native or pigmented maíz: a pilot only in these states (Art. 4-5). */
  maizPigmentado: { price: 8000, maxT: 15, states: ['México', 'Estado de México', 'Puebla', 'Tlaxcala'] },
  frijol: { price: 27000, maxT: 15, maxHa: { temporal: 30, riego: 5 }, maxTHa: { temporal: 0.5, riego: 3 } },
} as const

export const SELL_LINKS = {
  /** The official list of collection centres, with location and opening dates (Art. 22). */
  acopio: 'https://www.gob.mx/alimentacionparaelbienestar',
  rules: 'https://sidof.segob.gob.mx/notas/docFuente/5777721',
  /** Secretaría de Economía: daily wholesale prices at the centrales de abasto. */
  sniim: 'http://www.economia-sniim.gob.mx/',
}

export type FarmSize = 'hasta5' | 'hasta30' | 'mas30'
const SIZE_HA: Record<FarmSize, number> = { hasta5: 5, hasta30: 30, mas30: Infinity }

export interface CropPrice {
  /** As the engine names it, e.g. "Maíz", "Calabaza (semilla)". */
  crop: string
  /** District (or state/national) median rural price, MXN per tonne, last 5 years (SIAP); null when not stated. */
  price: number | null
}

export interface GuaranteeLine {
  kind: 'guarantee'
  program: 'maiz' | 'frijol'
  crop: string
  price: number
  maxT: number
  maxHa: number
  /** The most it buys per hectare (yield cap), tonnes. */
  maxTHa: number
  /** true/false once the farm size is known; null when it was not asked. */
  eligible: boolean | null
  districtPrice: number | null
  /** The pigmented-maíz price, only where that pilot runs. */
  pigmented: number | null
}

export interface MarketLine {
  kind: 'market'
  crops: CropPrice[]
}

export type SellLine = GuaranteeLine | MarketLine

const SEASON = /^(.*?) \((?:primavera|otoño|perenne|spring|autumn|fall|perennial)/i
const PRICE = /\$([\d,]+)\s*\/\s*t\b/

/** The crops of a rotation and their SIAP prices, read from its evidence lines (one per crop and season). */
export function cropPrices(rotation: DistrictRotation): CropPrice[] {
  const out = new Map<string, CropPrice>()
  for (const e of rotation.tarjeta.evidencia) {
    const crop = SEASON.exec(e.texto)?.[1]?.trim()
    if (!crop) continue
    const m = PRICE.exec(e.texto)
    const price = m ? Number(m[1]!.replace(/,/g, '')) : null
    const key = crop.toLowerCase()
    const seen = out.get(key)
    if (!seen) out.set(key, { crop, price })
    else if (seen.price == null && price != null) seen.price = price
  }
  return [...out.values()]
}

export function programOf(crop: string): 'maiz' | 'frijol' | null {
  const c = crop.toLowerCase()
  if (/forraj|fodder|silage|elote|palomero|popcorn/.test(c)) return null
  if (/^(ma[ií]z|maize|corn)\b/.test(c)) return 'maiz'
  if (/^(frijol|beans?)\b/.test(c)) return 'frijol'
  return null
}

/** One line per guarantee crop, then one line for every other crop of the rotation. */
export function sellLines(rotation: DistrictRotation, agua: WaterRegime, state: string, size: FarmSize | null): SellLine[] {
  const lines: SellLine[] = []
  const market: CropPrice[] = []
  for (const cp of cropPrices(rotation)) {
    const program = programOf(cp.crop)
    if (!program) {
      market.push(cp)
      continue
    }
    if (lines.some((l) => l.kind === 'guarantee' && l.program === program)) continue
    const rule = GUARANTEE[program]
    const maxHa = rule.maxHa[agua]
    lines.push({
      kind: 'guarantee',
      program,
      crop: cp.crop,
      price: rule.price,
      maxT: rule.maxT,
      maxHa,
      maxTHa: rule.maxTHa[agua],
      eligible: size ? SIZE_HA[size] <= maxHa : null,
      districtPrice: cp.price,
      pigmented: program === 'maiz' && (GUARANTEE.maizPigmentado.states as readonly string[]).includes(state) ? GUARANTEE.maizPigmentado.price : null,
    })
  }
  if (market.length) lines.push({ kind: 'market', crops: market })
  return lines
}

/** Whether asking the farm size changes anything for these rotations. */
export const needsSize = (rotations: DistrictRotation[], agua: WaterRegime, state: string) =>
  rotations.some((r) => sellLines(r, agua, state, null).some((l) => l.kind === 'guarantee'))

/** The size bucket of a farm given in hectares. */
export const sizeOf = (hectares: number | null | undefined): FarmSize | null =>
  hectares == null || !Number.isFinite(hectares) || hectares <= 0 ? null : hectares <= 5 ? 'hasta5' : hectares <= 30 ? 'hasta30' : 'mas30'

/** The sell lines for several rotations at once (each crop once): what a chat says about the current and suggested crops. */
export function sellLinesFor(rotations: DistrictRotation[], agua: WaterRegime, state: string, size: FarmSize | null): SellLine[] {
  const merged = { tarjeta: { evidencia: rotations.flatMap((r) => r.tarjeta.evidencia) } } as unknown as DistrictRotation
  return sellLines(merged, agua, state, size)
}

type T = (path: string, vars?: Record<string, string | number>) => string
interface Fmt {
  number: (value: number, digits?: number) => string
}

/** The sell lines as plain sentences (chat bubbles), in the farmer view's words. */
export function sellSentences(lines: SellLine[], t: T, fmt: Fmt): string[] {
  const money = (n: number) => fmt.number(Math.round(n))
  return lines.map((l) => {
    if (l.kind === 'market') {
      const priced = l.crops.filter((c) => c.price != null)
      return [
        t('campo.answer.sell.market', { crops: l.crops.map((c) => c.crop.toLowerCase()).join(', ').replace(/^./, (c) => c.toUpperCase()) }),
        priced.length ? t('campo.answer.sell.marketPrices', { list: priced.map((c) => `${c.crop.toLowerCase()} $${money(c.price!)}/t`).join(', ') }) : '',
      ]
        .filter(Boolean)
        .join(' ')
    }
    const crop = t(`campo.answer.sell.crop.${l.program}`)
    const parts = [
      `*${crop.charAt(0).toUpperCase() + crop.slice(1)}:* ${t('campo.answer.sell.guarantee', { crop, price: money(l.price), maxT: l.maxT, maxTHa: fmt.number(l.maxTHa, l.maxTHa % 1 ? 1 : 0) })}`,
      l.eligible === null ? t('campo.answer.sell.ifSize', { ha: l.maxHa }) : l.eligible ? t('campo.answer.sell.eligible') : t('campo.answer.sell.notEligible', { ha: l.maxHa }),
    ]
    if (l.districtPrice != null)
      parts.push(
        l.eligible === false
          ? t('campo.answer.sell.districtOnly', { price: money(l.districtPrice) })
          : t('campo.answer.sell.district', { price: money(l.districtPrice), diff: t(l.price >= l.districtPrice ? 'campo.answer.sell.above' : 'campo.answer.sell.below', { n: money(Math.abs(l.price - l.districtPrice)) }) }),
      )
    if (l.pigmented != null) parts.push(t('campo.answer.sell.pigmented', { price: money(l.pigmented) }))
    return parts.join(' ')
  })
}

/** The nearest collection centres as sentences: only when a guarantee price is in play and the directory is loaded. */
export function nearestSentences(near: NearCentre[], downloaded: string | null, t: T, fmt: Fmt): string[] {
  // the directory is loaded but has no centre in the farmer's state (Sinaloa and Sonora, for one)
  if (!near.length) return downloaded ? [t('campo.answer.sell.nearestNone', { date: downloaded })] : []
  const place = (c: NearCentre) => [c.locality, c.municipality].filter((x, i, all) => x && all.indexOf(x) === i).join(', ')
  const title = (x: string) => (x === x.toUpperCase() ? x.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sp: string, ch: string) => sp + ch.toUpperCase()) : x)
  const name = (c: NearCentre) => title(c.name.replace(/^\d+\s+/, '')).replace(/^Ca\s+/, 'Centro de acopio ')
  const lines = near.slice(0, 1).map((c) =>
    c.sameMunicipality
      ? t('campo.answer.sell.nearestSame', { name: name(c), place: place(c), address: c.address })
      : t('campo.answer.sell.nearest', { name: name(c), place: place(c), km: fmt.number(Math.max(5, Math.round(c.km / 5) * 5)), address: c.address }),
  )
  if (downloaded) lines.push(t('campo.answer.sell.nearestNote', { date: downloaded }))
  return lines
}

/** The sell lines as facts for the language model (Spanish, the engines' figures only). */
export function sellFacts(lines: SellLine[], fmt: Fmt): string[] {
  const money = (n: number) => fmt.number(Math.round(n))
  const out = lines.map((l) =>
    l.kind === 'guarantee'
      ? `Dónde vender ${l.program === 'maiz' ? 'maíz' : 'frijol'}: Alimentación para el Bienestar (Acopio para el Bienestar, reglas ${GUARANTEE.year}) compra a $${money(l.price)}/t a productores de hasta ${l.maxHa} ha con este régimen de agua, hasta ${fmt.number(l.maxTHa, l.maxTHa % 1 ? 1 : 0)} t por ha y ${l.maxT} t por ciclo` +
        (l.eligible === null ? ' (no sabemos cuántas hectáreas siembra)' : l.eligible ? ' (con su superficie califica)' : ' (con su superficie no califica)') +
        (l.districtPrice != null ? `; en su distrito el precio medio rural fue $${money(l.districtPrice)}/t.` : '.') +
        (l.pigmented != null ? ` Maíz nativo o criollo pigmentado: $${money(l.pigmented)}/t en este estado.` : '')
      : `Dónde vender ${l.crops.map((c) => c.crop.toLowerCase()).join(', ')}: sin precio de garantía; los precios al mayoreo de las centrales de abasto los publica el SNIIM (Secretaría de Economía); en la parcela suelen pagar menos.` +
        (l.crops.some((c) => c.price != null) ? ` Precio medio rural en su distrito: ${l.crops.filter((c) => c.price != null).map((c) => `${c.crop.toLowerCase()} $${money(c.price!)}/t`).join(', ')}.` : ''),
  )
  if (lines.some((l) => l.kind === 'guarantee'))
    out.push('Los centros de acopio y sus fechas se publican en gob.mx/alimentacionparaelbienestar; cambian cada ciclo y no todos abren: hay que confirmarlo en el CADER o DDR. No tenemos la lista de compradores privados.')
  return out
}
