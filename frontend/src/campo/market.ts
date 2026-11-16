import type { DistrictRotation, WaterRegime } from '../lib/district.ts'

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
