// The SIAP district engine ("what has worked in your district"), the second recommendation engine next to the WOFOST
// rotation runs (lib/rotations.ts). It compares the farmer's current rotation with alternatives built from what SIAP
// records for their district, with NASA climate, FAO-56 water balances and literature coefficients
// (gradientdescentfarmers/model_builder/rotations). This file only reads its answers; nothing here scores or ranks.
//
// Two ways to get an answer:
//   precomputed  public/data/district/: the engine run ahead of time over water regime x current rotation x priorities
//                (web_export.py). Always available; the other inputs keep the engine's defaults, and `notUsed` lists
//                the ones the farmer gave that this answer could not use.
//   live         the engine's small HTTP API (serve.py), when the app is built with VITE_DISTRICT_API. It takes every
//                input. If it fails, the precomputed answer is used and the reason is kept.
//
// The WOFOST part of the app is not touched: this module and its inputs are separate and stored under their own key.

import { scopedKey } from '../account/storage.ts'
import type { DemoLocationId } from './demoLocations.ts'

// ---- the engine's answer (compare.comparar_rotaciones; Spanish text, figures already formatted by the engine) ----

export type Evidence = 'alta' | 'media' | 'baja' | 'regla'

export interface Indicator {
  valor: number | null
  texto: string
  unidad: string
  puntaje: number | null
  evidencia: Evidence
  fuente: string
}

export interface DistrictCard {
  por_que: string
  evidencia: { texto: string; fuente: string; evidencia: Evidence }[]
  beneficios: string[]
  riesgos: string[]
  vacios: string[]
  revisar_con_tecnico: string[]
  meses_descubiertos?: string
  residuo?: string
}

export interface DistrictRotation {
  id: string
  nombre: string
  secuencia: string
  puntaje_prioridades: number | null
  indicadores: Record<string, Indicator>
  vs_actual_ingreso: { media: number; intervalo_90: [number, number]; años: number; clara: boolean; condicional?: boolean } | null
  tarjeta: DistrictCard
  adopcion: { condicional: boolean; cultivos_nuevos: { cultivo: string; ha: number; proporcion: number; pocas_parcelas: boolean; fuera_del_distrito: boolean }[] }
  busqueda_ampliada: boolean
  años_malos: { años: number[]; relativo: number | null; relativo_actual: number | null; años_con_dato: number } | null
  escenarios: { lluvia_pct: number[]; temp_c: number[]; unidad: string; valores: (number | null)[][] } | null
  calendario: { año: number; cultivos: { cultivo: string; ciclo: string; siembra_mes: number; cosecha_mes: number; dias: number }[]; cobertura: number[] }[]
}

export interface DistrictResult {
  lugar: { municipio: string | null; distrito: string; estado: string; agua: 'temporal' | 'riego'; notas: string[] }
  tu_lugar: string[]
  suelo: { usado: string; tipo_usado: string; lineas: string[] }
  tendencias: { lineas: string[]; tipo: string }
  agua_region: { lineas: string[]; tendencia_cm_año?: number; clara?: boolean } | null
  prioridades: string[]
  fechas_siembra: { ciclo: string; cultivo: string; mes: number; fuente: string; cosecha?: number; fuente_cosecha?: string }[]
  preguntar: { dato: string; pregunta: string; por_que: string }[]
  rotaciones: DistrictRotation[]
  nota_opciones: string | null
  costos: { nota: string; pregunta_sugerida?: string; faltantes?: string[] }
  cultivos_de_nicho: { nota: string; cultivos: string[] }
  no_evaluadas: { secuencia: string; motivo: string }[]
  como_leer: string
  vacios_generales: string[]
  aviso: string
}

// ---- the index of precomputed answers ----

export const PRIORITY_IDS = ['erosion', 'forraje', 'ingreso', 'plagas', 'riesgo', 'suelo', 'agua'] as const
export type PriorityId = (typeof PRIORITY_IDS)[number]
export type WaterRegime = 'temporal' | 'riego'

export interface CurrentRotationOption {
  id: string
  rotacion: string
  etiqueta: string
  /** The precomputed answer file; absent for options that come from the live engine (GET /district). */
  archivo?: string
  /** The rotation as the engine's structure ([{"pv": crop key}, ...]); sent instead of the text when present. */
  estructura?: Record<string, string>[]
  secuencia?: string
  distrito?: string
  alternativas?: number
}

export interface DistrictPlace {
  municipio: string
  estado: string
  regimenes: Partial<Record<WaterRegime, CurrentRotationOption[]>>
}

export interface DistrictIndex {
  version: number
  generado: string
  prioridades: { id: PriorityId; etiqueta: string }[]
  max_prioridades: number
  lugares: Partial<Record<DemoLocationId, DistrictPlace>>
}

interface Packed {
  common: Record<string, unknown>
  rotations: Record<string, Omit<DistrictRotation, 'puntaje_prioridades'>>
  variants: Record<string, Record<string, unknown> & { rotaciones: string[]; puntajes: (number | null)[] }>
}

// ---- what the farmer tells this engine (stored apart from the WOFOST answers) ----

export const SLOPES = ['plana', 'ligera', 'fuerte'] as const
export const SOILS = ['arenoso', 'franco', 'arcilloso'] as const
export const RESIDUES = ['dejar', 'pastoreo', 'sacar', 'quemar'] as const

export interface DistrictInputs {
  agua?: WaterRegime
  /** The id of a current rotation in the index (per place and water regime). */
  rotacion?: string
  /** Up to two (the index's max_prioridades). */
  prioridades?: PriorityId[]
  // Used only by the live engine; a precomputed answer lists them under notUsed.
  pendiente?: (typeof SLOPES)[number]
  suelo?: (typeof SOILS)[number]
  residuo?: (typeof RESIDUES)[number]
  animales?: boolean
  mesSiembra?: number
  mesCosecha?: number
}

/** The inputs the precomputed grid does not vary, with the engine's default for each. */
export const LIVE_ONLY: { key: keyof DistrictInputs; fallback: string | boolean | null }[] = [
  { key: 'pendiente', fallback: 'ligera' },
  { key: 'suelo', fallback: null },
  { key: 'residuo', fallback: 'dejar' },
  { key: 'animales', fallback: false },
  { key: 'mesSiembra', fallback: null },
  { key: 'mesCosecha', fallback: null },
]

const STORAGE_KEY = 'yolia-district'

const isOne = <T extends string>(list: readonly T[], value: unknown): value is T => (list as readonly unknown[]).includes(value)
const month = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12 ? value : undefined)

/** Stored text -> inputs; anything odd is dropped. */
export function parseInputs(text: string | null): DistrictInputs {
  if (!text) return {}
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    const out: DistrictInputs = {}
    if (isOne(['temporal', 'riego'] as const, raw.agua)) out.agua = raw.agua
    if (typeof raw.rotacion === 'string' && /^[a-z_]{1,40}$/.test(raw.rotacion)) out.rotacion = raw.rotacion
    if (Array.isArray(raw.prioridades)) out.prioridades = [...new Set(raw.prioridades.filter((p): p is PriorityId => isOne(PRIORITY_IDS, p)))].slice(0, 2)
    if (isOne(SLOPES, raw.pendiente)) out.pendiente = raw.pendiente
    if (isOne(SOILS, raw.suelo)) out.suelo = raw.suelo
    if (isOne(RESIDUES, raw.residuo)) out.residuo = raw.residuo
    if (typeof raw.animales === 'boolean') out.animales = raw.animales
    if (month(raw.mesSiembra)) out.mesSiembra = month(raw.mesSiembra)
    if (month(raw.mesCosecha)) out.mesCosecha = month(raw.mesCosecha)
    return out
  } catch {
    return {}
  }
}

export function loadInputs(): DistrictInputs {
  try {
    return parseInputs(localStorage.getItem(scopedKey(STORAGE_KEY)))
  } catch {
    return {}
  }
}

export function saveInputs(inputs: DistrictInputs): void {
  try {
    localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(inputs))
  } catch {
    // storage blocked: the answers last for this visit
  }
}

// ---- from the app's own answers to this engine's inputs ----

/** The few answers the app already asks (water, goal, last crop), in the WOFOST part's words. */
export interface AppAnswers {
  water?: 'rain' | 'some' | 'regular'
  goal?: 'earn' | 'water' | 'soil'
  previous?: 'maize' | 'barley' | 'fababean' | 'other' | 'none'
}

const GOAL_PRIORITY: Record<NonNullable<AppAnswers['goal']>, PriorityId> = { earn: 'ingreso', water: 'agua', soil: 'suelo' }

/**
 * The engine's inputs for a place: what the farmer told this engine, then what the app's own questions say, then the place's
 * most common rotation. Water "some" (occasional irrigation) is read as irrigated (riego) because SIAP files supplementary
 * irrigation under riego; the answer says so.
 */
export function effectiveInputs(place: DistrictPlace, own: DistrictInputs, app: AppAnswers = {}): Required<Pick<DistrictInputs, 'agua' | 'rotacion' | 'prioridades'>> & DistrictInputs {
  const available = (Object.keys(place.regimenes) as WaterRegime[]).filter((regime) => (place.regimenes[regime]?.length ?? 0) > 0)
  const fromApp: WaterRegime | undefined = app.water === 'rain' ? 'temporal' : app.water ? 'riego' : undefined
  const wanted = own.agua ?? fromApp ?? 'riego'
  const agua = available.includes(wanted) ? wanted : (available[0] ?? wanted)
  const options = place.regimenes[agua] ?? []
  const byPrevious =
    app.previous === 'maize' ? options.find((o) => o.id === 'maiz') : app.previous === 'barley' ? options.find((o) => o.id.includes('cebada')) : undefined
  const rotacion = options.find((o) => o.id === own.rotacion)?.id ?? byPrevious?.id ?? options[0]?.id ?? ''
  const prioridades = own.prioridades?.length ? own.prioridades.slice(0, 2) : app.goal ? [GOAL_PRIORITY[app.goal]] : []
  return { ...own, agua, rotacion, prioridades }
}

export const priorityKey = (priorities: readonly PriorityId[]) => [...new Set(priorities)].sort().join('+') || 'none'

// ---- loading ----

const cache = new Map<string, Promise<unknown>>()

function getJson<T>(url: string, fetcher: typeof fetch): Promise<T> {
  let hit = cache.get(url)
  if (!hit) {
    hit = fetcher(url).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status} (${url})`)
      return response.json()
    })
    hit.catch(() => cache.delete(url))
    cache.set(url, hit)
  }
  return hit as Promise<T>
}

/** The list of precomputed answers, or null when it is missing (the app then simply has no district answers). */
export async function loadDistrictIndex(base: string, fetcher: typeof fetch = fetch): Promise<DistrictIndex | null> {
  try {
    const index = await getJson<DistrictIndex>(`${base}data/district/index.json`, fetcher)
    return index && typeof index === 'object' && index.lugares ? index : null
  } catch {
    return null
  }
}

/** One answer out of a packed file (see web_export.pack). */
export function unpack(packed: Packed, key: string): DistrictResult | null {
  const variant = packed.variants?.[key]
  if (!variant) return null
  const { rotaciones, puntajes, ...rest } = variant
  return {
    ...(packed.common as object),
    ...rest,
    rotaciones: rotaciones.map((sig, i) => ({ ...packed.rotations[sig], puntaje_prioridades: puntajes[i] ?? null })),
  } as DistrictResult
}

export interface DistrictAnswer {
  result: DistrictResult
  source: 'precomputed' | 'live'
  inputs: ReturnType<typeof effectiveInputs>
  option: CurrentRotationOption
  /** Inputs the farmer gave that this answer did not use (precomputed answers only). */
  notUsed: (keyof DistrictInputs)[]
  /** Why the live engine was not used, when it was configured and failed. */
  liveError?: string
}

/** The address of the live engine, if the app was built with one. */
export const liveApi = (): string | null => {
  const url = (import.meta.env?.VITE_DISTRICT_API as string | undefined)?.trim()
  return url ? url.replace(/\/+$/, '') : null
}

const givenLiveOnly = (inputs: DistrictInputs) => LIVE_ONLY.filter(({ key }) => inputs[key] !== undefined).map(({ key }) => key)

/** The engine's answer for a place and the farmer's inputs, live when possible, else precomputed. */
export async function districtAnswer(
  placeId: DemoLocationId,
  index: DistrictIndex,
  own: DistrictInputs,
  app: AppAnswers,
  base: string,
  options: { fetcher?: typeof fetch; api?: string | null; translate?: <T>(value: T) => T } = {},
): Promise<DistrictAnswer | null> {
  const place = index.lugares[placeId]
  if (!place) return null
  return districtAnswerFor(place, own, app, base, options)
}

/** The same, for any district the caller already has (a demo place, or one of the national export: campo/national.ts). */
export async function districtAnswerFor(
  place: DistrictPlace,
  own: DistrictInputs,
  app: AppAnswers,
  base: string,
  options: { fetcher?: typeof fetch; api?: string | null; translate?: <T>(value: T) => T } = {},
): Promise<DistrictAnswer | null> {
  const fetcher = options.fetcher ?? fetch
  // the engine writes Spanish; in English the page passes its translation of the data (lib/dataI18n.ts)
  const tr = options.translate ?? (<T,>(value: T) => value)
  const inputs = effectiveInputs(place, own, app)
  const option = place.regimenes[inputs.agua]?.find((o) => o.id === inputs.rotacion)
  if (!option) return null
  const extra = givenLiveOnly(inputs)
  const api = options.api === undefined ? liveApi() : options.api
  let liveError: string | undefined
  if (api) {
    try {
      const response = await fetcher(`${api}/compare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lugar: place.municipio,
          estado: place.estado,
          rotacion_actual: option.estructura ?? option.rotacion,
          agua: inputs.agua,
          prioridades: inputs.prioridades,
          pendiente: inputs.pendiente,
          suelo: inputs.suelo,
          residuo: inputs.residuo,
          tiene_animales: inputs.animales,
          mes_siembra: inputs.mesSiembra,
          mes_cosecha: inputs.mesCosecha,
        }),
      })
      const body = (await response.json()) as DistrictResult & { error?: string }
      if (!response.ok || body.error) throw new Error(body.error ?? `HTTP ${response.status}`)
      return { result: tr(body), source: 'live', inputs, option: tr(option), notUsed: [] }
    } catch (error) {
      liveError = error instanceof Error ? error.message : String(error)
    }
  }
  if (!option.archivo) return null // a live-only option, and the live engine did not answer
  const packed = await getJson<Packed>(`${base}data/district/${option.archivo}`, fetcher)
  const result = unpack(packed, priorityKey(inputs.prioridades))
  if (!result) return null
  return { result: tr(result), source: 'precomputed', inputs, option: tr(option), notUsed: extra, ...(liveError ? { liveError } : {}) }
}

// ---- small readers used by the views and the chat ----

/** The current rotation, then the alternatives (the engine already ordered them: broad local practice first). */
export const currentOf = (result: DistrictResult) => result.rotaciones.find((r) => r.id === 'actual') ?? result.rotaciones[0]
export const alternativesOf = (result: DistrictResult) => result.rotaciones.filter((r) => r.id !== 'actual')

/** The alternative that best fits the priorities (highest score), or null when no alternative has one. */
export function bestAlternative(result: DistrictResult): DistrictRotation | null {
  const scored = alternativesOf(result).filter((r) => r.puntaje_prioridades !== null)
  if (scored.length === 0) return null
  return scored.reduce((best, r) => ((r.puntaje_prioridades ?? -1) > (best.puntaje_prioridades ?? -1) ? r : best))
}

/** "Con leguminosa: trigo – garbanzo" -> "trigo – garbanzo" (the template name stays as a kicker). */
export function splitName(nombre: string): { kind: string; crops: string } {
  const at = nombre.indexOf(':')
  return at < 0 ? { kind: '', crops: nombre } : { kind: nombre.slice(0, at), crops: nombre.slice(at + 1).trim() }
}

/** Income difference against the current rotation as engine text would say it, rounded to the peso. */
export const incomeDelta = (r: DistrictRotation) => (r.vs_actual_ingreso ? Math.round(r.vs_actual_ingreso.media) : null)

export const INDICATOR_ORDER = ['ingreso', 'ingreso_p10', 'riesgo', 'agua', 'nitrogeno', 'carbono', 'erosion', 'plagas', 'forraje', 'costo_equilibrio', 'costo_equilibrio_8de10'] as const
