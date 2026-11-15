// The demo "understanding" of a question: plain keyword rules, in Spanish and English, with no language model.
// It decides which models to consult and reads a few numbers (prices) out of the text. What it understood is
// always shown back to the farmer. To use a real language model instead, replace `AssistantBackend.interpret`
// (see backend.ts): everything downstream only needs an `Interpretation`.

import { INSIDE_KM, NEAR_KM } from '../lib/coverage.ts'
import { DRY_SCENARIOS, SCENARIOS, byModelOrder } from './models.ts'
import type { FarmInputs, Intent, Interpretation, ModelId, PriceItem, ScenarioId, Settings, Understood } from './types.ts'

/** Lower case without accents, so "Maíz" and "maiz" read the same. */
export const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

const INTENTS: Record<Intent, RegExp> = {
  plan: /(sembr|plant|cultiv|rotaci|\babon|fertili|conviene|recomiend|sugier|\bplan\b|estrategia|strategy|what to grow|\bgrow\b|\bcrop)/,
  earn: /(ganancia|ganar|gane\b|dinero|ingres|rentab|profit|\bearn|income|money|revenue)/,
  sustain: /(sustentab|sostenib|sustainab|suelo|carbono|ambient|environment|\bsoil|nitrogeno perdido|nitrogen lost)/,
  risk: /(mal ano|malos anos|riesgo|sequia|llueve poco|llueva poco|llueve menos|poca lluvia|menos lluvia|barely rain|little rain|rains little|less rain|dry year|drought|helada|frio|frost|canicula|escenario|scenario|bad year|\brisk)/,
  climate: /(clima|climate|weather|temperatura|temperature|lluvia|\brain\b|donde estoy|mi zona|my area|my region)/,
  trust: /(cierto|confiab|confia|fiable|validar|validez|realidad|siap|calibr|precis|error|acert|\btrust|accura|reliab|how true|\btrue\b|valid|reality|how good)/,
  statistical: /(arbol|bosque|xgboost|ensambl|predic|machine learning|random forest|\btree|ensemble|forecast|aprendizaje)/,
}

/** Words that name a price or cost item. */
const ITEMS: { item: PriceItem; words: RegExp; min: number; max: number; needsCue: boolean }[] = [
  { item: 'maize', words: /\b(maiz|maize|corn)\b/g, min: 500, max: 200000, needsCue: true },
  { item: 'barley', words: /\b(cebada|barley)\b/g, min: 500, max: 200000, needsCue: true },
  { item: 'fababean', words: /\b(habas?|faba|fava)\b/g, min: 500, max: 200000, needsCue: true },
  { item: 'nitrogen', words: /\b(abono|fertilizante|nitrogeno|urea|fertili[sz]er|nitrogen)\b/g, min: 1, max: 500, needsCue: false },
  { item: 'stover', words: /\b(rastrojo|stover)\b/g, min: 0, max: 20000, needsCue: false },
]

const CUE = /(precio|pesos|mxn|\$|tonelada|\/t\b|\bton\b|price|per ton|pagan|pagar|paga\b|vale\b|cuesta|cost|sell|vend)/
// A clause ends at punctuation (but not at the comma or dot inside "5,000" or "9.500") or at a conjunction.
const CLAUSE_END = /[;:?!]|(?<!\d)[.,]|[.,](?!\d)| y | and | pero | but | mientras | while /
/** What a nearby percentage or "half" is about when it is not a price: rain, yield, area... */
const NOT_A_PRICE = /(lluvia|rain|rendimiento|yield|temperatura|temperature|hectarea|\barea\b|superficie)/
const DOWN = /(baja|bajar|baje|cae\b|caiga|caer|menos|disminu|reduc|desciende|\bdown|drop|fall|less|lower|cheaper|decrease)/
const UP = /(sube|subir|suba|aumenta|aumente|\bmas\b|\bup\b|\brise|more|higher|increase|expensive)/

function parseAmount(raw: string, suffix: string | undefined): number {
  const grouped = /^\d{1,3}([,. ]\d{3})+$/.test(raw)
  const value = Number(grouped ? raw.replace(/[,. ]/g, '') : raw.replace(',', '.'))
  return suffix ? value * 1000 : value
}

/** Prices, or changes of prices, said in the question: "el haba a 5,000", "el abono sube 20%", "el maíz a la mitad". */
function readPrices(text: string): Understood[] {
  const found: Understood[] = []
  for (const { item, words, min, max, needsCue } of ITEMS) {
    for (const match of text.matchAll(words)) {
      const rest = text.slice((match.index ?? 0) + match[0].length)
      const clause = rest.slice(0, rest.search(CLAUSE_END) === -1 ? undefined : rest.search(CLAUSE_END))
      // A number that is not a percentage: an absolute price.
      const amounts = [...clause.matchAll(/(\d{1,3}(?:[,. ]\d{3})+|\d+(?:[.,]\d+)?)\s*(k\b|mil\b)?(\s*%)?/g)].filter((m) => !m[3])
      const amount = amounts[0] && parseAmount(amounts[0][1], amounts[0][2])
      if (amount !== undefined && amount >= min && amount <= max && (!needsCue || CUE.test(text))) {
        found.push({ kind: 'price', item, value: amount })
        break
      }
      const percent = clause.match(/(\d+(?:[.,]\d+)?)\s*%/)
      let factor: number | null = null
      if (NOT_A_PRICE.test(clause) && !CUE.test(clause)) factor = null
      else if (percent) {
        const share = Number(percent[1].replace(',', '.')) / 100
        factor = DOWN.test(clause) ? 1 - share : UP.test(clause) ? 1 + share : null
      } else if (/(mitad|\bhalf\b)/.test(clause)) factor = 0.5
      else if (/(cuarta parte|un cuarto|\bquarter)/.test(clause)) factor = 0.25
      else if (/(triple)/.test(clause)) factor = 3
      else if (/(doble|double|twice|duplic)/.test(clause)) factor = 2
      if (factor !== null && factor > 0) {
        found.push({ kind: 'priceFactor', item, factor })
        break
      }
    }
  }
  return found
}

function readScenarios(text: string): ScenarioId[] {
  const found: ScenarioId[] = []
  const add = (id: ScenarioId, pattern: RegExp) => pattern.test(text) && found.push(id)
  add('rain80', /(llueve poco|llueva poco|llueve menos|poca lluvia|menos lluvia|sequia|barely rain|little rain|rains little|less rain|drought|dry year)/)
  add('rain60', /(llueve poco|llueva poco|poca lluvia|sequia fuerte|barely rain|little rain|rains little|severe drought|drought)/)
  add('canicula50', /(canicula)/)
  add('frost_minus2', /(helada|frio|frost|colder|cold)/)
  add('no_fertilizer', /(sin abono|sin fertili|no fertili|without fertili|unfertili)/)
  add('fixed_sowing', /(fecha fija|siembra fija|fixed sow|fixed date)/)
  return [...new Set(found)]
}

export interface InterpretOptions {
  /** Models picked by hand in the models panel: used instead of reading them from the question. */
  manual?: ModelId[]
  /** Distance of the farmer's pin to the modeled site, if there is a pin. */
  pinDistanceKm?: number | null
  /** What the farmer said about their field in the onboarding: it narrows the planner and travels with the answer. */
  farm?: FarmInputs | null
}

/** Apply what the question said to the current settings. Prices given as a change are relative to the current ones. */
export function applyUnderstood(base: Settings, understood: Understood[]): Settings {
  const settings: Settings = { ...base, economics: { ...base.economics, prices: { ...base.economics.prices } } }
  const e = settings.economics
  for (const u of understood) {
    if (u.kind === 'world') settings.world = u.world
    else if (u.kind === 'preset') settings.preset = u.preset
    else if (u.kind === 'price' || u.kind === 'priceFactor') {
      const apply = (current: number) => (u.kind === 'price' ? u.value : current * u.factor)
      if (u.item === 'nitrogen') e.n_price = apply(e.n_price)
      else if (u.item === 'stover') e.stover_price = apply(e.stover_price)
      else e.prices[u.item] = apply(e.prices[u.item])
    }
  }
  return settings
}

export function interpret(message: string, base: Settings, options: InterpretOptions = {}): Interpretation {
  const text = normalize(message)
  const understood: Understood[] = readPrices(text)

  const matched = (Object.keys(INTENTS) as Intent[]).filter((intent) => INTENTS[intent].test(text))
  // "llueve poco" is about a dry year, not about the climate of the pin.
  const intents = matched.includes('risk') && !/(clima|climate|weather|temperatura|temperature)/.test(text) ? matched.filter((i) => i !== 'climate') : matched
  // Prices on their own mean "what does this do to my plan".
  if (intents.length === 0 && understood.some((u) => u.kind === 'price' || u.kind === 'priceFactor')) intents.push('plan')

  if (/(estandar|standard|default|europe)/.test(text)) understood.push({ kind: 'world', world: 'default' })
  else if (/(calibrad)/.test(text)) understood.push({ kind: 'world', world: 'calibrated' })
  const profit = intents.includes('earn')
  const sustain = intents.includes('sustain')
  if (profit !== sustain) understood.push({ kind: 'preset', preset: profit ? 'profit' : 'sustainability' })

  const wanted = new Set<ModelId>()
  for (const intent of intents) {
    if (intent === 'plan' || intent === 'earn' || intent === 'sustain') wanted.add('planner')
    else if (intent === 'risk') wanted.add('risk')
    else if (intent === 'climate') wanted.add('climate')
    else if (intent === 'trust') {
      wanted.add('calibration')
      wanted.add('statistical')
    } else if (intent === 'statistical') wanted.add('statistical')
  }

  const manual = options.manual && options.manual.length > 0 ? options.manual : null
  const models = [...(manual ?? wanted)].sort(byModelOrder)
  const added: Interpretation['added'] = []
  const km = options.pinDistanceKm
  // A pin between "inside" and "far" can only be judged against its climate, so the climate comes along.
  if (models.includes('planner') && !models.includes('climate') && km != null && km > INSIDE_KM && km <= NEAR_KM) {
    models.push('climate')
    models.sort(byModelOrder)
    added.push({ model: 'climate', reason: 'zone' })
  }

  // The planner does not measure water use. A farmer who wants to save water gets the closest thing the project has:
  // how each rotation does in the drier scenarios of the risk model, beside the plan.
  const farm = options.farm ?? null
  const forWater = !manual && farm?.priority === 'water' && models.includes('planner') && !models.includes('risk')
  if (forWater) {
    models.push('risk')
    models.sort(byModelOrder)
    added.push({ model: 'risk', reason: 'water' })
  }

  const scenarios = models.includes('risk') ? readScenarios(text) : []
  const requested = scenarios.length > 0 ? scenarios : models.includes('risk') ? (forWater ? DRY_SCENARIOS : SCENARIOS) : []
  for (const scenario of scenarios) understood.push({ kind: 'scenario', scenario })

  return {
    mode: manual ? 'manual' : 'auto',
    intents,
    models,
    added,
    understood,
    scenarios: requested,
    settings: applyUnderstood(base, understood),
    ...(farm ? { farm } : {}),
  }
}
