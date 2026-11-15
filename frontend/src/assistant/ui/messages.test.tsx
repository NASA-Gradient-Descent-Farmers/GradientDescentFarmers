// Renders the answer the way the page does, in both languages, for every model and every failure state, and
// checks the text a farmer would read: nothing untranslated, nothing unfilled, every model named.
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../../i18n/index.tsx'
import type { Lang } from '../../lib/format.ts'
import type { AssistantMessage } from '../history.ts'
import { interpret } from '../interpret.ts'
import { runModels } from '../run.ts'
import { data, defaults, powerAnswer } from '../testdata.ts'
import { MODEL_IDS, type ModelId, type Outcome } from '../types.ts'
import { AssistantMessageView } from './AssistantMessageView.tsx'

const noop = () => {}
const PIN = { lat: 25.7, lon: -100.3 }

function html(message: AssistantMessage, lang: Lang, hasPin = true) {
  return renderToStaticMarkup(
    <I18nProvider initial={lang}>
      <AssistantMessageView
        message={message}
        data={data}
        hasPin={hasPin}
        distanceKm={hasPin ? 702 : null}
        onRetry={noop}
        onAskAgain={noop}
        onAsk={noop}
        onEditPin={noop}
        onOpenPlanner={noop}
        onEditAnswers={noop}
      />
    </I18nProvider>,
  )
}

async function answer(question: string, manual?: ModelId[]): Promise<AssistantMessage> {
  const interpretation = interpret(question, defaults, { manual })
  const outcomes = await runModels({ data, pin: PIN, interpretation })
  return { id: 'a1', role: 'assistant', at: 1, status: 'done', interpretation, progress: {}, outcomes }
}

const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ')
const LEAKS = /\b(assistant|planner|cards|summary|climate|coverage|where|home|objectives|rotations|crops)\.[a-zA-Z_]+|\{\w+\}|\bundefined\b|\bNaN\b/

afterEach(() => vi.unstubAllGlobals())

describe('the answer to a question that uses every model', () => {
  it.each(['es', 'en'] as const)('shows each model\'s card, its source and technical details in %s, with nothing untranslated', async (lang) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(powerAnswer(() => 2, () => 14, (i) => 3 - i)) })))
    const message = await answer('¿Y si llueve poco?', [...MODEL_IDS])
    expect(message.outcomes.every((o) => o.ok)).toBe(true)
    const markup = html(message, lang)
    const body = text(markup)
    expect(body, body.match(LEAKS)?.[0]).not.toMatch(LEAKS)
    for (const model of MODEL_IDS) expect(markup).toContain(`model-${model}`) // one card per model
    expect(markup.match(/<details/g)?.length).toBeGreaterThanOrEqual(MODEL_IDS.length) // technical details are expandable
    expect(markup).toContain('<table') // results are tables, not prose
    expect(markup).toContain('role="group"') // the cards are one labelled group
    // the summary says it is a template, never a model of language
    expect(body).toMatch(lang === 'es' ? /No es un modelo de lenguaje/ : /It is not a language model/)
  })

  it('attributes every sentence of the summary to a model or to the comparison of two', async () => {
    const markup = html(await answer('¿Qué sembrar y qué pasa si llueve poco?'), 'en')
    const tags = [...markup.matchAll(/<span class="tag">([^<]+)<\/span>/g)].map((m) => m[1])
    expect(tags.length).toBeGreaterThan(3)
    expect(new Set(tags)).toEqual(new Set(['Strategy planner', 'Rotation risk and scenarios', 'Combined']))
  })
})

describe('states other than success', () => {
  const failed = (model: ModelId, code: 'needs-pin' | 'offline' | 'failed'): Outcome => ({ model, ok: false, code, message: 'boom' }) as Outcome
  const base = async () => answer('¿Qué sembrar y cómo es mi clima?', ['planner', 'climate'])

  it.each([
    ['needs-pin', { es: 'Necesito tu pin para esto', en: 'I need your pin for this' }, { es: 'Poner mi pin', en: 'Drop my pin' }],
    ['offline', { es: 'Sin conexión con la NASA', en: 'No connection to NASA' }, { es: 'Reintentar', en: 'Try again' }],
    ['failed', { es: 'Este modelo no pudo responder', en: 'This model could not answer' }, { es: 'Reintentar', en: 'Try again' }],
  ] as const)('a failed model (%s) says what happened and offers a way forward, keeping the other results', async (code, title, action) => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')))
    const message = await base()
    const mixed = { ...message, outcomes: [message.outcomes.find((o) => o.model === 'planner')!, failed('climate', code)] }
    for (const lang of ['es', 'en'] as const) {
      const markup = html(mixed, lang)
      expect(markup).toContain('role="alert"')
      expect(text(markup)).toContain(title[lang])
      expect(text(markup)).toContain(action[lang])
      expect(markup).toContain('model-planner') // the plan is still there
      expect(text(markup)).not.toMatch(LEAKS)
    }
  })

  it('shows real progress while running, not a finished answer', async () => {
    const message = await base()
    const running: AssistantMessage = { ...message, status: 'running', outcomes: [], progress: { planner: 'running', climate: 'waiting' } }
    const body = text(html(running, 'en'))
    expect(body).toContain('There is no live answer to stream')
    expect(body).toContain('Working')
    expect(body).toContain('Waiting')
    expect(body).not.toContain('In short')
  })

  it('offers to ask again when the page was reloaded mid-answer', async () => {
    const message = await base()
    const interrupted: AssistantMessage = { ...message, status: 'interrupted', outcomes: [], progress: {} }
    expect(text(html(interrupted, 'es'))).toContain('Esta consulta se interrumpió')
    expect(text(html(interrupted, 'es'))).toContain('Volver a preguntar')
  })

  it('says it does not know which model to use instead of guessing, and suggests what it can answer', async () => {
    const message = await answer('hello there')
    expect(message.interpretation.models).toEqual([])
    const body = text(html(message, 'en'))
    expect(body).toContain('I am not sure which model to use')
    expect(body).toContain('What to plant and how much to fertilize?')
    expect(body).not.toContain('Models consulted')
  })

  it('lists what the parser understood, so a wrong reading is easy to spot', async () => {
    const message = await answer('¿Qué pasa si el haba baja a la mitad de precio?')
    const body = text(html(message, 'es'))
    expect(body).toContain('Lo que entendí')
    expect(body).toContain('Haba (MXN/t): ×0.50 el precio actual')
  })

  it('without a pin, the zone warning is left out and the plan still shows', async () => {
    const message = await answer('¿Qué sembrar?')
    expect(text(html(message, 'en', false))).not.toContain('outside the modeled area')
    expect(text(html(message, 'en', true))).toContain('You are outside the modeled area')
  })
})
