// The in-app assistant's answers: built from the zone's rotation run and environmental package, ranked by the farmer's goal and
// scaled to their hectares, with nothing from the old Texcoco planner.
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Published } from '../../hooks/useZoneData.ts'
import { I18nProvider } from '../../i18n/index.tsx'
import { parseEnvironment } from '../../lib/environment.ts'
import { bestOption, parseRotations, pickForGoal, type RotationGoal } from '../../lib/rotations.ts'
import { makeFormat } from '../../lib/format.ts'
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

const fmt = makeFormat('es')
const OBJECTIVE: Record<RotationGoal, string> = { earn: 'income', water: 'water', soil: 'soil' }

describe('the option shown for what matters to the farmer is the one the service picked for it', () => {
  for (const id of ids) {
    const rotations = published.rotations[id]!
    it(`${id}: the pick carries the service's own label for the goal, or else its balance pick`, () => {
      for (const regime of ['irrigated', 'rainfed'] as const) {
        for (const goal of ['earn', 'water', 'soil'] as const) {
          const pick = pickForGoal(rotations, regime, goal)!
          const labelled = rotations.options.filter((option) => option.regime === regime && option.highlightObjectives.includes(OBJECTIVE[goal]))
          if (labelled.length > 0) {
            expect(pick.highlightObjectives, `${regime}/${goal}`).toContain(OBJECTIVE[goal])
            expect(pick.priorityScore).toBe(Math.max(...labelled.map((option) => option.priorityScore ?? -Infinity)))
          } else expect(pick.id).toBe(bestOption(rotations, regime)!.id)
        }
      }
    })
  }

  it('a different goal gives a different option where the service labelled different ones', () => {
    const sonora = published.rotations.sonora!
    const picks = (['earn', 'water', 'soil'] as const).map((goal) => pickForGoal(sonora, 'irrigated', goal)!)
    expect(new Set(picks.map((pick) => pick.id)).size).toBeGreaterThan(1)
    // the water pick is the one the service labelled "water", and it uses less irrigation than the reference
    const water = picks[1]
    expect(water.highlightObjectives).toContain('water')
    expect(water.irrigationSavingPct!).toBeGreaterThan(0)
  })
})

describe('what the assistant answers for a parcel', () => {
  const ask = (place: (typeof ids)[number], topic: Extract<Body, { kind: 'zone' }>['topic'], extra: Partial<Extract<Body, { kind: 'zone' }>> = {}) => words(answer({ kind: 'zone', topic, place, km: 0, ...extra }))

  it.each(ids)('%s: the planting answer is the options the service picked for the goal, with its own highlights word for word', (id) => {
    const rotations = published.rotations[id]!
    const text = ask(id, 'plant', { goal: 'water' })
    for (const regime of ['irrigated', 'rainfed'] as const) {
      const option = pickForGoal(rotations, regime, 'water')!
      expect(text).toContain(option.descriptionEs)
      for (const line of option.highlightsEs) expect(text, line).toContain(line)
    }
    expect(text).toContain('optimizar el uso de agua')
    expect(text).not.toMatch(/Para tus \d+ ha/)
  })

  it.each(ids)('%s: every figure is exact (to the peso), not rounded to the thousand', (id) => {
    const rotations = published.rotations[id]!
    const text = ask(id, 'plant', { goal: 'earn' })
    for (const regime of ['irrigated', 'rainfed'] as const) {
      const { gross } = pickForGoal(rotations, regime, 'earn')!
      // the service's own highlight states the median to the peso; the range is formatted from the same file
      expect(text).toContain(`Ingreso bruto de escenario: ${Math.round(gross!.median!)} MXN/ha`)
      expect(text).toContain(`${fmt.number(Math.round(gross!.p10!))} a ${fmt.number(Math.round(gross!.p90!))} MXN/ha`)
    }
  })

  it('the calendar uses the plan year each season starts and ends in, and no historical date', () => {
    const rotations = published.rotations.sonora!
    const option = pickForGoal(rotations, 'irrigated', 'earn')!
    const winter = option.campaigns.find((campaign) => campaign.planningYear !== campaign.planningYearEnd)!
    const text = ask('sonora', 'harvest', { goal: 'earn' })
    expect(text).toContain(`año ${winter.planningYear} nov → año ${winter.planningYearEnd} may`)
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('water: applied irrigation and total use are told apart, rain-only says it uses rain, and the saving names its reference', () => {
    const text = ask('sonora', 'plant', { goal: 'water' })
    expect(text).toMatch(/Riego aplicado de escenario: \d+ m³\/ha/)
    expect(text).toContain('Consumo total de agua de los cultivos (evapotranspiración)')
    expect(text).toContain('no es lo mismo que el riego aplicado')
    expect(text).toContain('Sin riego: el cultivo usa la lluvia.')
    expect(text).toMatch(/Usa \d+ % menos riego que la opción factible de mayor ingreso \(una comparación, no tu práctica actual\)/)
  })

  it('every option says it is an experiment, never an approved plan; the high-risk ones say so', () => {
    for (const id of ids) {
      const rotations = published.rotations[id]!
      for (const option of rotations.options) {
        const text = ask(id, 'plant', { goal: option.highlightObjectives.includes('water') ? 'water' : 'earn' })
        expect(text).toMatch(/experimento/)
      }
    }
    const sinaloa = published.rotations.sinaloa!
    const risky = sinaloa.options.find((option) => option.advisoryStatus === 'high_risk_experiment' && option.highlightObjectives.includes('income'))!
    expect(risky).toBeTruthy()
    expect(ask('sinaloa', 'plant', { goal: 'earn', water: 'rain' })).toContain('experimento de alto riesgo')
  })

  it('shows its affinity with the priorities as such, and what it stands out in', () => {
    const text = ask('sonora', 'plant', { goal: 'earn' })
    expect(text).toMatch(/Afinidad con las prioridades del modelo: \d+ de 100\. No es un porcentaje de éxito\./)
    expect(text).toMatch(/Destaca en: /)
  })

  it('the regime the farmer has comes first', () => {
    const rainFirst = ask('sonora', 'plant', { goal: 'earn', water: 'rain' })
    expect(rainFirst.indexOf('Solo con lluvia')).toBeLessThan(rainFirst.indexOf('Con riego'))
    const irrigatedFirst = ask('sonora', 'plant', { goal: 'earn', water: 'regular' })
    expect(irrigatedFirst.indexOf('Con riego')).toBeLessThan(irrigatedFirst.indexOf('Solo con lluvia'))
  })

  it('money, rain and trust questions come from the same run', () => {
    expect(ask('sinaloa', 'money', { goal: 'earn' })).toMatch(/Ingreso bruto: ≈ [\d,]+ MXN\/ha/)
    expect(ask('sinaloa', 'rain')).toContain('Lo que se observó en la zona')
    expect(ask('sinaloa', 'trust')).toContain(published.rotations.sinaloa!.confidence.labelEs)
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
      const text = ask(id, topic, { goal: 'soil', water: 'some' })
      expect(text, `${id}/${topic}`).not.toMatch(/Texcoco|El Bat[aá]n|Datos no disponibles|no hay datos|todavía no/i)
    }
  })

  it('has an English version', () => {
    const text = words(answer({ kind: 'zone', topic: 'plant', place: 'sonora', km: 0, goal: 'water' }, 'en'))
    expect(text).toContain('With irrigation')
    expect(text).toContain('using water well')
    expect(text).toContain('Affinity with the model priorities')
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
