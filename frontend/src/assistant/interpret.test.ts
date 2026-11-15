import { describe, expect, it } from 'vitest'
import { DICTIONARIES } from '../i18n/translate.ts'
import { interpret, normalize } from './interpret.ts'
import type { Settings } from './types.ts'

const base: Settings = {
  world: 'calibrated',
  preset: 'sustainability',
  economics: {
    prices: { maize: 8000, barley: 5000, fababean: 16000 },
    other_costs: { maize: 14000, barley: 9000, fababean: 11000 },
    n_price: 25,
    stover_price: 1000,
    carbon_fraction: 0.45,
  },
}
const models = (text: string, options = {}) => interpret(text, base, options).models

describe('which models a question needs', () => {
  it.each([
    ['es', 'planner', 'planner'],
    ['es', 'economics', 'planner'],
    ['es', 'reality', 'calibration+statistical'],
    ['es', 'whatifs', 'risk'],
    ['en', 'planner', 'planner'],
    ['en', 'economics', 'planner'],
    ['en', 'reality', 'calibration+statistical'],
    ['en', 'whatifs', 'risk'],
  ] as const)('the home card %s/%s asks for %s', (lang, card, expected) => {
    const question = DICTIONARIES[lang].home.options[card].title
    expect(models(question).join('+'), question).toBe(expected)
  })

  it('reads more than one need in one question and answers in the registry order', () => {
    expect(models('¿Qué conviene sembrar en mi zona y cómo es mi clima?')).toEqual(['planner', 'climate'])
    expect(models('What should I plant, and is the model reliable?')).toEqual(['planner', 'calibration', 'statistical'])
  })

  it('takes "llueve poco" as a dry year, not as the climate of the pin', () => {
    expect(models('¿Y si llueve poco?')).toEqual(['risk'])
    expect(models('Cuéntame del clima y de la lluvia')).toEqual(['climate'])
  })

  it('asks for the tree and ensemble models by name', () => {
    expect(models('¿Sirven los árboles y XGBoost para predecir el rendimiento?')).toEqual(['statistical'])
  })

  it('does not guess when it does not know: no models and no intent', () => {
    const answer = interpret('hola, buenos días', base)
    expect(answer.models).toEqual([])
    expect(answer.intents).toEqual([])
  })

  it('uses only the models picked by hand, still reading the numbers in the question', () => {
    const answer = interpret('¿Y si el haba baja a la mitad?', base, { manual: ['planner', 'risk'] })
    expect(answer.mode).toBe('manual')
    expect(answer.models).toEqual(['planner', 'risk'])
    expect(answer.settings.economics.prices.fababean).toBe(8000)
  })

  it('adds the NASA climate to a plan when the pin is between "inside" and "far", and says why', () => {
    const answer = interpret('¿Qué sembrar?', base, { pinDistanceKm: 60 })
    expect(answer.models).toEqual(['planner', 'climate'])
    expect(answer.added).toEqual([{ model: 'climate', reason: 'zone' }])
    expect(interpret('¿Qué sembrar?', base, { pinDistanceKm: 5 }).models).toEqual(['planner'])
    expect(interpret('¿Qué sembrar?', base, { pinDistanceKm: 700 }).models).toEqual(['planner'])
  })
})

describe('priorities and crop model', () => {
  it('sets the priority from the words used', () => {
    expect(interpret('¿Cuánto voy a ganar?', base).settings.preset).toBe('profit')
    expect(interpret('Quiero cuidar el suelo: ¿qué plan me sugieres?', base).settings.preset).toBe('sustainability')
    expect(interpret('Quiero ganar sin dañar el suelo', base).settings.preset).toBe('sustainability') // both: keeps the current one
  })

  it('reads which crop model is wanted', () => {
    expect(interpret('¿Qué sembrar con el modelo estándar?', base).settings.world).toBe('default')
    expect(interpret('What to plant with the standard model?', base).settings.world).toBe('default')
    expect(interpret('¿Qué sembrar con el modelo calibrado?', { ...base, world: 'default' } as never).settings.world).toBe('calibrated')
  })
})

describe('prices said in the question', () => {
  const prices = (text: string) => interpret(text, base).settings.economics

  it('reads an absolute price with thousands separators, k and mil', () => {
    expect(prices('¿Qué sembrar si el haba paga $5,000 por tonelada?').prices.fababean).toBe(5000)
    expect(prices('What if maize is 9.500 MXN per ton?').prices.maize).toBe(9500)
    expect(prices('el maíz a 9 mil pesos la tonelada').prices.maize).toBe(9000)
    expect(prices('la cebada a 6k pesos').prices.barley).toBe(6000)
  })

  it('reads a change relative to the current price', () => {
    expect(prices('¿Qué pasa si el haba baja a la mitad de precio?').prices.fababean).toBe(8000)
    expect(prices('si el maíz sube 25%').prices.maize).toBe(10000)
    expect(prices('si el maíz baja 25 % y la cebada sube 10%').prices).toMatchObject({ maize: 6000, barley: 5500 })
    expect(prices('what if the faba price falls by half').prices.fababean).toBe(8000)
    expect(prices('si el haba baja a un cuarto de precio').prices.fababean).toBe(4000)
  })

  it('reads fertilizer and stover prices', () => {
    expect(prices('si el abono cuesta 40 pesos por kilo').n_price).toBe(40)
    expect(prices('si el abono sube 50%').n_price).toBeCloseTo(37.5)
    expect(prices('el rastrojo a 2000 pesos').stover_price).toBe(2000)
  })

  it('does not take a year, a share or a lone number for a price', () => {
    const e = prices('¿Qué sembrar de maíz en 2024 con 30% menos lluvia?')
    expect(e.prices.maize).toBe(8000)
    expect(prices('el haba, 5000 años').prices.fababean).toBe(16000) // no price cue
    expect(prices('el abono a 5000 pesos').n_price).toBe(25) // out of range for a fertilizer price
  })

  it('turns a price on its own into a question about the plan, and lists what it understood', () => {
    const answer = interpret('el haba a 5000 pesos la tonelada', base)
    expect(answer.models).toEqual(['planner'])
    expect(answer.understood).toContainEqual({ kind: 'price', item: 'fababean', value: 5000 })
  })

  it('never changes the settings it was given', () => {
    interpret('el haba a 5000 pesos', base)
    expect(base.economics.prices.fababean).toBe(16000)
  })
})

describe('which scenarios a risk question asks for', () => {
  it('asks for the one named, or all of them when none is', () => {
    expect(interpret('¿Y si hay helada?', base).scenarios).toEqual(['frost_minus2'])
    expect(interpret('¿Y si llueve poco?', base).scenarios).toEqual(['rain80', 'rain60'])
    expect(interpret('¿Qué pasa en un mal año?', base).scenarios).toHaveLength(6)
    expect(interpret('¿Qué sembrar?', base).scenarios).toEqual([])
  })
})

describe('normalize', () => {
  it('drops accents and case', () => {
    expect(normalize('¿Qué MAÍZ sembrar?')).toBe('¿que maiz sembrar?')
  })
})
