// The in-app assistant's answers: built from the zone's rotation run and environmental package, ranked by the farmer's goal and
// scaled to their hectares, with nothing from the old Texcoco planner.
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Published } from '../../hooks/useZoneData.ts'
import { I18nProvider } from '../../i18n/index.tsx'
import { parseEnvironment } from '../../lib/environment.ts'
import { parseRotations, pickForGoal, waterProductivity } from '../../lib/rotations.ts'
import { parseChat, type Body } from '../chat.ts'
import { ZoneAnswerView } from './ZoneAnswer.tsx'

const read = (kind: string, id: string): unknown => JSON.parse(readFileSync(new URL(`../../../public/data/${kind}/${id}.json`, import.meta.url), 'utf8'))
const ids = ['guanajuato', 'sinaloa', 'sonora'] as const
const published: Published = {
  rotations: Object.fromEntries(ids.map((id) => [id, parseRotations(read('rotations', id))])),
  environment: Object.fromEntries(ids.map((id) => [id, parseEnvironment(read('environment', id))])),
}
const answer = (body: Extract<Body, { kind: 'zone' }>, lang: 'es' | 'en' = 'es') =>
  renderToStaticMarkup(
    <I18nProvider initial={lang}>
      <ZoneAnswerView body={body} published={published} />
    </I18nProvider>,
  )
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('ranking the options by what matters to the farmer', () => {
  for (const id of ids) {
    const rotations = published.rotations[id]!
    it(`${id}: earn is the highest gross income, soil the best soil score, water the least irrigation (or the most income per m³ without irrigation)`, () => {
      for (const regime of ['irrigated', 'rainfed'] as const) {
        const options = rotations.options.filter((option) => option.regime === regime)
        const earn = pickForGoal(rotations, regime, 'earn')!
        expect(earn.gross!.median).toBe(Math.max(...options.map((option) => option.gross!.median!)))
        const water = pickForGoal(rotations, regime, 'water')!
        if (regime === 'irrigated') {
          const clean = options.filter((option) => option.failedHarvests === 0)
          expect(water.irrigationM3Ha).toBe(Math.min(...clean.map((option) => option.irrigationM3Ha!)))
        } else expect(waterProductivity(water)).toBe(Math.max(...options.map((option) => waterProductivity(option) ?? -Infinity)))
        const soil = pickForGoal(rotations, regime, 'soil')!
        expect(soil.soilScore).toBe(Math.max(...options.map((option) => option.soilScore ?? -Infinity)))
      }
    })
  }

  it('a different goal gives a different option where the run has a trade-off, and every pick is one of the run\'s own options', () => {
    const sonora = published.rotations.sonora!
    const picks = (['earn', 'water', 'soil'] as const).map((goal) => pickForGoal(sonora, 'irrigated', goal)!)
    expect(new Set(picks.map((pick) => pick.id)).size).toBeGreaterThan(1)
    for (const pick of picks) expect(sonora.options.some((option) => option.id === pick.id)).toBe(true)
    // optimizing water uses less irrigation than optimizing income, at some cost in income
    const [earn, water] = picks
    expect(water.irrigationM3Ha!).toBeLessThan(earn.irrigationM3Ha!)
  })

  it('water productivity is income over the water used (1 mm over a hectare is 10 m³), and null without data', () => {
    const option = published.rotations.sonora!.options[0]
    expect(waterProductivity(option)).toBeCloseTo(option.gross!.median! / (option.evapotranspirationMm! * 10), 6)
    expect(waterProductivity({ ...option, evapotranspirationMm: null })).toBeNull()
  })
})

describe('what the assistant answers for a parcel', () => {
  const ask = (place: (typeof ids)[number], topic: Extract<Body, { kind: 'zone' }>['topic'], extra: Partial<Extract<Body, { kind: 'zone' }>> = {}) => words(answer({ kind: 'zone', topic, place, km: 0, ...extra }))

  it.each(ids)('%s: the planting answer is the run\'s options for the goal, with the farmer\'s hectares', (id) => {
    const rotations = published.rotations[id]!
    const text = ask(id, 'plant', { goal: 'water', hectares: 5 })
    expect(text).toContain(pickForGoal(rotations, 'irrigated', 'water')!.descriptionEs)
    expect(text).toContain(pickForGoal(rotations, 'rainfed', 'water')!.descriptionEs)
    expect(text).toContain('optimizar el uso de agua')
    expect(text).toMatch(/Para tus 5 ha: ≈ [\d,]+ MXN/)
    expect(text).toContain('no es ganancia')
  })

  it('the regime the farmer has comes first', () => {
    const rainFirst = ask('sonora', 'plant', { goal: 'earn', water: 'rain' })
    expect(rainFirst.indexOf('Solo con lluvia')).toBeLessThan(rainFirst.indexOf('Con riego'))
    const irrigatedFirst = ask('sonora', 'plant', { goal: 'earn', water: 'regular' })
    expect(irrigatedFirst.indexOf('Con riego')).toBeLessThan(irrigatedFirst.indexOf('Solo con lluvia'))
  })

  it('money, rain and trust questions come from the same run', () => {
    expect(ask('sinaloa', 'money', { goal: 'earn', hectares: 2 })).toMatch(/Ingreso bruto: ≈ [\d,]+ MXN\/ha/)
    expect(ask('sinaloa', 'rain')).toContain('Lo que se observó en la zona')
    const trust = ask('sinaloa', 'trust')
    expect(trust).toContain(published.rotations.sinaloa!.confidence.labelEs)
  })

  it('data questions come from the environmental package', () => {
    expect(ask('guanajuato', 'climate')).toContain('2024: 813 mm de lluvia')
    expect(ask('sonora', 'soil')).toContain('pH 8.0')
  })

  it('names the place when the parcel is not inside its own area, and not otherwise', () => {
    expect(words(answer({ kind: 'zone', topic: 'plant', place: 'sonora', km: 300 }))).toContain('Los resultados que ves son de ese punto')
    expect(ask('sonora', 'plant')).not.toContain('Los resultados que ves son de ese punto')
  })

  it('never mentions Texcoco, El Batán, or missing data', () => {
    for (const id of ids) for (const topic of ['plant', 'money', 'rain', 'harvest', 'compare', 'trust', 'fertilizer', 'climate', 'soil', 'satellite', 'sources'] as const) {
      const text = ask(id, topic, { goal: 'soil', hectares: 3, water: 'some' })
      expect(text, `${id}/${topic}`).not.toMatch(/Texcoco|El Bat[aá]n|Datos no disponibles|no hay datos|todavía no/i)
    }
  })

  it('has an English version', () => {
    const text = words(answer({ kind: 'zone', topic: 'plant', place: 'sonora', km: 0, goal: 'water' }, 'en'))
    expect(text).toContain('With irrigation')
    expect(text).toContain('using water well')
  })
})

describe('a saved conversation', () => {
  it('drops the answers of the old Texcoco planner and keeps the rest', () => {
    const turns = [
      { id: 'a', at: 1, role: 'user', text: '¿Qué me conviene sembrar?' },
      { id: 'b', at: 2, role: 'bot', body: { kind: 'outside', km: 1443 } },
      { id: 'c', at: 3, role: 'bot', body: { kind: 'recommendation', focus: 'plant', rec: { result: {} } } },
      { id: 'd', at: 4, role: 'bot', body: { kind: 'zone', topic: 'plant', place: 'sonora', km: 0 } },
      { id: 'e', at: 5, role: 'bot', body: { kind: 'greeting' } },
    ]
    expect(parseChat(JSON.stringify(turns)).map((turn) => turn.id)).toEqual(['a', 'd', 'e'])
  })
})
