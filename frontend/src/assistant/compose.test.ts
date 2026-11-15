import { afterEach, describe, expect, it, vi } from 'vitest'
import { DICTIONARIES, translate } from '../i18n/translate.ts'
import { makeFormat, type Lang } from '../lib/format.ts'
import { followUps, summarize, zoneVerdict, type Say } from './compose.ts'
import { interpret } from './interpret.ts'
import { runModels } from './run.ts'
import { data, defaults, powerAnswer } from './testdata.ts'
import { MODEL_IDS, type ModelId, type Outcome } from './types.ts'

const say = (lang: Lang): Say => ({ t: (path, vars) => translate(DICTIONARIES[lang], path, vars), fmt: makeFormat(lang) })
const PIN = { lat: 25.7, lon: -100.3 }

async function ask(question: string, manual?: ModelId[], settings = defaults, pin = PIN) {
  const interpretation = interpret(question, settings, { manual })
  const outcomes = await runModels({ data, pin, interpretation })
  return { interpretation, outcomes }
}
const text = (items: { text: string }[]) => items.map((i) => i.text).join('\n')

afterEach(() => vi.unstubAllGlobals())
const climateWorks = () =>
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(powerAnswer(() => 2, () => 14, (i) => 3 - i)) })))

describe('every combination of models, in both languages', () => {
  it('writes every sentence, with no missing translation and no unfilled placeholder', async () => {
    climateWorks()
    const subsets = Array.from({ length: 2 ** MODEL_IDS.length - 1 }, (_, mask) => MODEL_IDS.filter((_, i) => ((mask + 1) >> i) & 1))
    expect(subsets).toHaveLength(31)
    for (const models of subsets) {
      const { outcomes } = await ask('¿Y si llueve poco?', models)
      expect(outcomes.every((o) => o.ok), models.join('+')).toBe(true)
      for (const lang of ['es', 'en'] as const) {
        const items = summarize(outcomes, say(lang))
        expect(items.length, `${models.join('+')} ${lang}`).toBeGreaterThan(0)
        for (const item of items) {
          expect(item.text, item.text).not.toMatch(/assistant\.|\{\w+\}|NaN|undefined/)
        }
      }
    }
  })
})

describe('what each model says', () => {
  it('planner: the pick, the other priority and the calibrated-model caution, with the document\'s numbers', async () => {
    const { outcomes } = await ask('¿Qué sembrar y cuánto abonar?')
    const items = summarize(outcomes, say('en'))
    expect(items[0].text).toContain('maize – faba bean')
    expect(items[0].text).toContain('11,457 MXN')
    expect(items[0].text).toContain('90%')
    expect(items.some((i) => i.caution && /barely raises yield/.test(i.text))).toBe(true)
    expect(items.every((i) => i.source === 'planner')).toBe(true)
    expect(text(items)).toMatch(/prioritized profit first instead, the model suggests maize every year with no nitrogen/) // the other priority gives maize
  })

  it('planner with edited prices says what changed', async () => {
    const { outcomes } = await ask('¿Qué pasa si el haba baja a un cuarto de precio?')
    const body = text(summarize(outcomes, say('es')))
    expect(body).toContain('Tus precios y costos cambiaron el plan')
    expect(body).toContain('maíz todos los años') // the plan at the original prices
  })

  it('risk: the drop, the failed harvests, and an advantage that is not clear when the interval includes zero', async () => {
    const { outcomes } = await ask('¿Y si llueve poco?')
    const items = summarize(outcomes, say('en'))
    expect(items[0].text).toContain('40% less rain')
    expect(items[0].text).toContain('2.4 t/ha') // continuous maize in rain60
    expect(items[0].text).toContain('50 in every 100') // 49.6% of harvests fail
    expect(items[1].text).toMatch(/includes zero/)
    expect(items.some((i) => i.caution && /standard WOFOST/.test(i.text))).toBe(true)
  })

  it('calibration: right level, wrong year-by-year pattern, and the standard model\'s inflated level', async () => {
    const { outcomes } = await ask('¿Qué tan cierto es el modelo?', ['calibration'])
    const body = text(summarize(outcomes, say('en')))
    expect(body).toContain('gets the level right (ratio 0.90)')
    expect(body).toMatch(/worse than just repeating SIAP/)
    expect(body).toContain('times what SIAP reports')
  })

  it('statistical: most models miss by more than the average and the best is barely better', async () => {
    const { outcomes } = await ask('¿Sirven los árboles y XGBoost?')
    const body = text(summarize(outcomes, say('en')))
    expect(body).toContain('6 of 7 models') // ridge is the only one under the plain average (0.719 vs 0.731)
    expect(body).toContain('ridge-stacked ensemble')
    expect(body).toMatch(/barely better/)
    expect(body).toMatch(/explain/)
  })

  it('climate: rain and temperature against Texcoco', async () => {
    climateWorks()
    const { outcomes } = await ask('¿Cómo es mi clima?')
    const body = text(summarize(outcomes, say('en')))
    expect(body).toMatch(/mm of rain a year \(\+?[-−]?0%/)
    expect(body).toMatch(/coldest night NASA estimates/)
  })
})

describe('combining models', () => {
  it('planner + risk: says whether the risk model backs the choice, from the interval', async () => {
    const { outcomes } = await ask('¿Qué sembrar y qué pasa en un mal año?')
    const combined = summarize(outcomes, say('en')).filter((i) => i.source === 'combined')
    expect(combined).toHaveLength(1)
    expect(combined[0].text).toMatch(/does not confirm that choice/) // maize–faba bean: interval -0.3 to +2.1 includes zero
  })

  it('planner + risk with a plan that is the risk reference says so instead', async () => {
    const { outcomes } = await ask('¿Qué sembrar y qué pasa en un mal año?', ['planner', 'risk'], { ...defaults, preset: 'profit' })
    const combined = summarize(outcomes, say('en')).filter((i) => i.source === 'combined')
    expect(combined[0].text).toMatch(/does not confirm|reference the risk model compares against/)
  })

  it('planner on the standard model + calibration: warns how inflated the standard model is', async () => {
    const { outcomes } = await ask('¿Qué sembrar con el modelo estándar y qué tan cierto es?')
    const combined = summarize(outcomes, say('es')).filter((i) => i.source === 'combined')
    expect(combined.some((i) => i.caution && /veces lo que se reporta/.test(i.text))).toBe(true)
  })

  it('the same results read the same numbers in either language', async () => {
    const { outcomes } = await ask('¿Qué sembrar?')
    const en = summarize(outcomes, say('en'))[0].text
    const es = summarize(outcomes, say('es'))[0].text
    expect(en).not.toBe(es)
    for (const figure of ['11,457', '90%']) {
      expect(en).toContain(figure)
      expect(es).toContain(figure)
    }
  })

  it('skips a model that failed and still summarizes the others', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    // a pin NASA has not been asked about in this run, so no earlier answer is cached
    const { outcomes } = await ask('¿Qué sembrar y cómo es mi clima?', undefined, defaults, { lat: 21.4, lon: -104.6 })
    expect(outcomes.find((o) => o.model === 'climate')?.ok).toBe(false)
    const items = summarize(outcomes, say('en'))
    expect(items.length).toBeGreaterThan(0)
    expect(items.every((i) => i.source !== 'climate')).toBe(true)
  })
})

describe('zoneVerdict', () => {
  const planner: Outcome[] = []
  it('uses the distance when it is enough, and the climate verdict when there is one', async () => {
    expect(zoneVerdict(planner, 5)).toEqual({ status: 'inside', reason: null })
    expect(zoneVerdict(planner, 700)).toEqual({ status: 'outside', reason: 'distance' })
    expect(zoneVerdict(planner, 60)).toEqual({ status: 'near', reason: 'unchecked' }) // between, and no climate to compare
    expect(zoneVerdict(planner, null)).toBeNull()
    climateWorks()
    const { outcomes } = await ask('clima', ['climate'])
    expect(zoneVerdict(outcomes, 700)).toEqual({ status: 'outside', reason: 'distance' })
  })
})

describe('followUps', () => {
  it('suggests what is not yet covered, never the question just answered, at most three', async () => {
    const { interpretation, outcomes } = await ask('¿Qué sembrar y cuánto abonar?')
    const next = followUps(outcomes, interpretation, true, say('es'))
    expect(next.length).toBeLessThanOrEqual(3)
    expect(next).toContain('¿Y si llueve poco?')
    expect(next).toContain('¿Qué tan cierto es el modelo?')
    expect(next).not.toContain('¿Qué sembrar y cuánto abonar?')
  })

  it('suggests the plan after an answer that had none, and only suggests climate when there is a pin', async () => {
    const risk = await ask('¿Y si llueve poco?')
    expect(followUps(risk.outcomes, risk.interpretation, true, say('en'))).toContain('What to plant and how much to fertilize?')
    const plan = await ask('¿Qué sembrar?')
    expect(followUps(plan.outcomes, plan.interpretation, false, say('en')).some((q) => /climate/.test(q))).toBe(false)
  })
})
