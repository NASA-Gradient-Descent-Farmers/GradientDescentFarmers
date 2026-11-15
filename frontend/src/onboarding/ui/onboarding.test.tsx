// Renders every question and the summary in both languages and checks what a farmer would read and what a screen
// reader would find: a labelled heading, real radios and checkboxes in labelled groups, honest progress, nothing
// untranslated. Behaviour (what Continue does with each answer) is tested in resolve.test.ts and profile.test.ts.
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { data, site } from '../../assistant/testdata.ts'
import { I18nProvider } from '../../i18n/index.tsx'
import { DICTIONARIES, translate } from '../../i18n/translate.ts'
import type { Lang } from '../../lib/format.ts'
import { makeFormat } from '../../lib/format.ts'
import { describeAnswer } from '../describe.ts'
import { sure, unsure, STEPS, type Profile, type StepId } from '../types.ts'
import { OnboardingPage, type Start } from './OnboardingPage.tsx'

// Leaflet needs a browser window to load; the map itself is not what these tests are about.
vi.mock('../../components/PinMap.tsx', () => ({ PinMap: () => null }))

const noop = () => {}
const PIN = { lat: 19.53, lon: -98.85 }

function html(start: Start, lang: Lang, profile: Profile = {}, pin: typeof PIN | null = null) {
  return renderToStaticMarkup(
    <I18nProvider initial={lang}>
      <OnboardingPage data={data} site={site} profile={profile} pin={pin} start={start} onProfile={noop} onPin={noop} onFinish={noop} onExit={noop} onSkipAll={noop} onClear={noop} />
    </I18nProvider>,
  )
}
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z#0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
const LEAKS = /\b(onboarding|assistant|planner|where|home|coverage|rotations|crops|app)\.[a-zA-Z_]+|\{\w+\}|\bundefined\b|\bNaN\b/
const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0

const complete: Profile = {
  crops: { help: false, crops: ['maize', 'fababean'], unmodelled: ['trigo'] },
  land: sure({ amount: 2, unit: 'ha' }),
  when: sure({ kind: 'month', month: 5, part: 'mid' }),
  budget: sure({ currency: 'MXN', rate: null, low: 28000, high: 32000, basis: 'total' }),
  water: sure('rain'),
  priority: sure('soil'),
}

describe.each(['es', 'en'] as const)('each question in %s', (lang) => {
  it.each(STEPS)('%s: one labelled question, a control, a Continue and a way back', (step) => {
    const markup = html({ kind: 'edit', step }, lang, complete, PIN)
    const body = text(markup)
    expect(body, body.match(LEAKS)?.[0]).not.toMatch(LEAKS)
    const title = translate(DICTIONARIES[lang], `onboarding.steps.${step}.title`)
    expect(markup).toMatch(/<h1 id="ob-title" class="ob-title" tabindex="-1"/) // the question takes the focus
    expect(markup).toContain('aria-labelledby="ob-title"')
    expect(body).toContain(title)
    expect(count(markup, /<h1/g)).toBe(1) // one prominent question per screen
    expect(markup).toContain('type="submit"')
    expect(markup).toMatch(/class="ob-back"/)
    expect(count(markup, /<form/g)).toBe(1)
  })

  it('shows one question at a time: no other question’s text is on the screen', () => {
    const markup = html({ kind: 'edit', step: 'land' }, lang, complete, PIN)
    for (const other of STEPS.filter((s) => s !== 'land')) {
      expect(text(markup)).not.toContain(translate(DICTIONARIES[lang], `onboarding.steps.${other}.title`))
    }
  })
})

describe('the controls are native and labelled', () => {
  const groups = (markup: string) => count(markup, /<fieldset/g)
  const edit = (step: StepId, profile: Profile = {}) => html({ kind: 'edit', step }, 'es', profile, PIN)

  it('crops: checkboxes for the three crops and "help me choose", and a text field with a label', () => {
    const markup = edit('crops')
    expect(count(markup, /type="checkbox"/g)).toBe(4)
    expect(markup).toMatch(/<label for="ob-other-crop"/)
    expect(groups(markup)).toBe(1)
    expect(markup).toContain('<legend class="sr-only">')
  })

  it('land: a labelled number field, the unit as radios and a few sizes as radios', () => {
    const markup = edit('land')
    expect(markup).toMatch(/<label for="ob-land"/)
    expect(markup).toContain('inputMode="decimal"')
    expect(count(markup, /name="unit"/g)).toBe(3)
    expect(count(markup, /name="size"/g)).toBe(5)
    expect(groups(markup)).toBe(2)
  })

  it('when: twelve months, the part of the month, "when the rains start", free text, and a quiet skip', () => {
    const markup = edit('when')
    expect(count(markup, /name="month"/g)).toBe(12)
    expect(count(markup, /name="part"/g)).toBe(4)
    expect(count(markup, /name="rains"/g)).toBe(1)
    expect(markup).toMatch(/<label for="ob-when-text"/)
    expect(markup).toContain('class="ob-skip"')
  })

  it('water and priority: every option is a radio with its explanation, including "not sure"', () => {
    const water = edit('water')
    expect(count(water, /name="water"/g)).toBe(4)
    const priority = edit('priority')
    expect(count(priority, /name="priority"/g)).toBe(7)
    expect(text(priority)).toContain('lo más cercano') // saving water says it is the closest the models have
  })

  it('the questions that can wait offer "not yet", and the two that cannot do not', () => {
    for (const step of ['land', 'when', 'budget'] as const) expect(edit(step)).toContain('class="ob-skip"')
    for (const step of ['crops', 'where', 'water', 'priority'] as const) expect(edit(step)).not.toContain('class="ob-skip"')
  })
})

describe('the questions adapt to what is already known', () => {
  it('skips what is known, and counts only what is left', () => {
    const fresh = html({ kind: 'ask' }, 'es')
    expect(fresh).toContain('aria-valuemax="8"') // seven questions and the summary
    expect(fresh).toContain('aria-valuetext="Pregunta 1 de 7"')
    expect(text(fresh)).toContain(translate(DICTIONARIES.es, 'onboarding.steps.crops.title'))

    const known = html({ kind: 'ask' }, 'es', { crops: complete.crops }, PIN)
    expect(known).toContain('aria-valuetext="Pregunta 1 de 5"') // crops and the map are done
    expect(known).toContain('aria-valuemax="6"')
    expect(text(known)).toContain(translate(DICTIONARIES.es, 'onboarding.steps.land.title'))
    expect(text(known)).not.toContain(translate(DICTIONARIES.es, 'onboarding.steps.where.title'))
  })

  it('goes straight to the summary when everything is known', () => {
    const markup = html({ kind: 'ask' }, 'es', complete, PIN)
    expect(text(markup)).toContain(translate(DICTIONARIES.es, 'onboarding.summary.title'))
    expect(markup).not.toContain('role="progressbar"')
  })

  it('offers budget ranges as totals for the land given, and per hectare when the area is not known', () => {
    const withLand = html({ kind: 'edit', step: 'budget' }, 'en', { land: sure({ amount: 2, unit: 'ha' }) }, PIN)
    expect(text(withLand)).toContain('Up to 28,000 MXN') // 14,000 per hectare x 2 ha
    expect(text(withLand)).toContain('in total on your 2 ha')
    const without = html({ kind: 'edit', step: 'budget' }, 'en', {}, PIN)
    expect(text(without)).toContain('Up to 14,000 MXN')
    expect(text(without)).toContain('per hectare')
  })

  it('builds the budget ranges from the rotations that include the crops asked for', () => {
    const all = html({ kind: 'edit', step: 'budget' }, 'en', {}, PIN)
    const three = html({ kind: 'edit', step: 'budget' }, 'en', { crops: { help: false, crops: ['barley', 'fababean'], unmodelled: [] } }, PIN)
    expect(text(three)).not.toBe(text(all))
    expect(text(three)).toContain('Up to 12,000 MXN') // only maize – barley – faba bean: its costs run 11,333 to 14,042
  })

  it('offers dollars with a visible, editable rate and says it is approximate', () => {
    const markup = html({ kind: 'edit', step: 'budget' }, 'en', { budget: sure({ currency: 'USD', rate: 20, low: 0, high: 1000, basis: 'perHa' }) }, PIN)
    expect(markup).toMatch(/<label for="ob-rate"/)
    expect(markup).toContain('value="20"')
    expect(text(markup)).toContain('approximate value I suggest')
  })

  it('shows the rain of the pin’s area on the planting question, or says it is being looked up', () => {
    const markup = html({ kind: 'edit', step: 'when' }, 'es', {}, PIN)
    expect(text(markup)).toContain('Buscando la lluvia de tu zona')
  })

  it('explains how the model sows, with the dates it exports, for the crops asked for', () => {
    const markup = html({ kind: 'edit', step: 'when' }, 'es', { crops: { help: false, crops: ['maize'], unmodelled: [] } }, PIN)
    const body = text(markup)
    expect(body).toContain('al menos 20 mm de lluvia en 5 días')
    expect(body).toContain('Maíz: desde el 15 de mayo')
    expect(body).not.toContain('Cebada: desde')
  })
})

describe('the summary', () => {
  it.each(['es', 'en'] as const)('lists all seven answers with a way to change each, in %s', (lang) => {
    const markup = html({ kind: 'summary' }, lang, complete, PIN)
    const body = text(markup)
    expect(body, body.match(LEAKS)?.[0]).not.toMatch(LEAKS)
    expect(count(markup, /class="ob-row-summary/g)).toBe(7)
    expect(count(markup, /<button type="button" class="link-quiet"/g)).toBe(7 + 1) // the seven rows and the way out to the assistant
    expect(markup).toMatch(/aria-label="(Cambiar|Change): /)
    expect(markup).not.toMatch(/<button type="submit"[^>]*disabled/)
    expect(markup).not.toMatch(/class="cv-button ob-next" disabled/)
  })

  it('says how each answer will be used, so no answer is used silently', () => {
    const body = text(html({ kind: 'summary' }, 'en', complete, PIN))
    expect(body).toContain('I compare the rotations that include what you ticked')
    expect(body).toContain('multiply them by your 2 ha')
    expect(body).toContain('sowing window')
    expect(body).toContain('A ceiling of about 16,000 pesos per hectare per year')
    expect(body).toContain('That is exactly what the project’s models describe')
    expect(body).toContain('no model: trigo')
  })

  it('shows unanswered questions as such, and keeps the way to the recommendations shut until the basics are in', () => {
    const markup = html({ kind: 'summary' }, 'es', { land: unsure() })
    expect(count(markup, /class="ob-row-summary open/g)).toBe(6) // all but the one answered "not sure"
    expect(markup).toContain('Falta lo básico')
    expect(markup).toMatch(/class="cv-button ob-next" disabled/)
    const ready = html({ kind: 'summary' }, 'es', { crops: complete.crops }, PIN)
    expect(ready).not.toMatch(/class="cv-button ob-next" disabled/)
    expect(ready).not.toContain('Falta lo básico')
  })

  it('opens from the assistant with a way back that leaves, and from the questions with one that goes back a step', () => {
    expect(text(html({ kind: 'summary' }, 'es', complete, PIN))).toContain('Volver')
    expect(text(html({ kind: 'ask' }, 'es', {}, null))).not.toContain('Volver')
  })
})

describe('describeAnswer: each answer in words and how it is used', () => {
  const i18n = (lang: Lang) => ({
    lang,
    setLang: noop,
    t: (path: string, vars?: Record<string, string | number>) => translate(DICTIONARIES[lang], path, vars),
    fmt: makeFormat(lang),
    distance: String,
    coords: () => '19.53° N, 98.85° W',
  })

  it('answered, not sure, and open', () => {
    const t = i18n('en')
    expect(describeAnswer('land', complete, PIN, data.meta, t)).toMatchObject({ state: 'answered', value: '2 hectares' })
    expect(describeAnswer('land', { land: unsure() }, PIN, data.meta, t)).toMatchObject({ state: 'unsure', value: 'Not sure' })
    expect(describeAnswer('land', {}, PIN, data.meta, t)).toMatchObject({ state: 'open', value: '', used: null })
    expect(describeAnswer('where', {}, null, data.meta, t).state).toBe('open')
    expect(describeAnswer('where', {}, PIN, data.meta, t)).toMatchObject({ state: 'answered', value: '19.53° N, 98.85° W' })
  })

  it('every priority and water answer has a line saying how it is used', () => {
    const t = i18n('es')
    for (const priority of ['income', 'yield', 'costs', 'soil', 'steady', 'water'] as const) {
      const described = describeAnswer('priority', { priority: sure(priority) }, PIN, data.meta, t)
      expect(described.used, priority).toBeTruthy()
      expect(`${described.value} ${described.used}`).not.toMatch(LEAKS)
    }
    for (const water of ['rain', 'some', 'regular'] as const) {
      expect(describeAnswer('water', { water: sure(water) }, PIN, data.meta, t).used).toBeTruthy()
    }
  })

  it('a total budget without an area says it cannot be compared yet; "more than" says there is no ceiling', () => {
    const t = i18n('en')
    const total = { currency: 'MXN' as const, rate: null, low: 0, high: 20000, basis: 'total' as const }
    expect(describeAnswer('budget', { budget: sure(total) }, PIN, data.meta, t).used).toMatch(/needs your area/)
    expect(describeAnswer('budget', { budget: sure({ ...total, low: 30000, high: null }) }, PIN, data.meta, t).used).toMatch(/No ceiling/)
    expect(describeAnswer('budget', { budget: sure({ ...total, low: 15000, high: 15000 }), land: sure({ amount: 1, unit: 'ha' }) }, PIN, data.meta, t).value).toBe('about 15,000 MXN in total')
  })
})
