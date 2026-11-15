import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { I18nProvider, useI18n } from '../i18n/index.tsx'
import { loadData } from '../lib/data.ts'
import { DEMO_LOCATIONS, demoLocation, type DemoLocationId } from '../lib/demoLocations.ts'
import { loadEnvironment, type EnvironmentByLocation } from '../lib/environment.ts'
import { loadRotations, type RotationsByLocation } from '../lib/rotations.ts'
import { liveApi, loadDistrictIndex, type DistrictIndex } from '../lib/district.ts'
import { loadTranslations, translateData, type Translations } from '../lib/dataI18n.ts'
import { llmEnabled, makeNarrator, probeNarrator, type Narrator } from '../llm/client.ts'
import type { DashboardData } from '../lib/types.ts'
import { EMPTY_CHAT, greeting, resultsKind, type BotBubble, type ChatState, type Env, type QuickReply } from './engine.ts'
import { richText } from './format.tsx'
import { appRoot } from './route.ts'
import { converse, TYPING_MS } from './session.ts'
import { WhatsAppMark } from './WhatsAppMark.tsx'
import './whatsapp.css'

interface Message {
  id: number
  from: 'user' | 'bot'
  text: string
  options?: QuickReply[]
  time: string
}

const SUGGESTIONS = ['plant', 'rain', 'harvest', 'compare', 'climate', 'soil', 'sources'] as const

const clock = (lang: 'es' | 'en') => new Date().toLocaleTimeString(lang === 'en' ? 'en-GB' : 'es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** ?lang=en (or es) in the address picks the chat's language, e.g. /demo/whatsapp?lang=en for English-speaking reviewers. */
function langFromAddress(): 'en' | 'es' | undefined {
  const lang = new URLSearchParams(window.location.search).get('lang') ?? new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('lang')
  return lang === 'en' || lang === 'es' ? lang : undefined
}

/** /demo/whatsapp: loads the stored model results (from this app's own files) and shows the chat. */
export default function WhatsAppDemo() {
  const [loaded, setLoaded] = useState<{ data: DashboardData; rotations: RotationsByLocation; environment: EnvironmentByLocation; district: DistrictIndex | null; narrate: Narrator | null; translations: Translations } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const base = appRoot(window.location)
    // a rotation file that is missing only leaves that location on "data unavailable"; the model results are required
    const withRotations = DEMO_LOCATIONS.filter((place) => place.results === 'rotations').map((place) => place.id)
    // a file that is missing only leaves that location without it; the model results are required
    // the district engine's answers are optional too: without them the chat answers from the WOFOST runs only, as before
    // the language model is used (and the banner says so) only when its endpoint is there and has a key
    Promise.all([loadData(base), loadRotations(withRotations, base), loadEnvironment(DEMO_LOCATIONS.map((place) => place.id), base), loadDistrictIndex(base), llmEnabled() ? probeNarrator(base) : Promise.resolve(false), loadTranslations(base)]).then(
      ([data, rotations, environment, district, llm, translations]) => setLoaded({ data, rotations, environment, district, narrate: llm ? makeNarrator(base) : null, translations }),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    )
  }, [])
  return (
    <I18nProvider initial={langFromAddress()}>
      {loaded ? <WhatsAppChat data={loaded.data} rotations={loaded.rotations} environment={loaded.environment} district={loaded.district} narrate={loaded.narrate} translations={loaded.translations} home={appRoot(window.location)} /> : <Loading error={error} />}
    </I18nProvider>
  )
}

function Loading({ error }: { error: string | null }) {
  return (
    <div className="wa-stage">
      <p className="wa-loading" role={error ? 'alert' : 'status'}>
        {error ? `No pude cargar los datos del modelo: ${error}` : 'Cargando los resultados del modelo…'}
      </p>
    </div>
  )
}

interface ChatProps {
  data: DashboardData
  /** Rotation results for the locations that have them; a location without an entry shows "data unavailable". */
  rotations?: RotationsByLocation
  /** Environmental packages for the places that have them; a place without one cannot answer about its climate or soil. */
  environment?: EnvironmentByLocation
  /** The SIAP district engine's precomputed answers; without them the chat answers from the WOFOST runs only. */
  district?: DistrictIndex | null
  /** The language model that phrases the summaries (llm/client.ts); null keeps the written templates. */
  narrate?: Narrator | null
  /** English for the engines' Spanish text (lib/dataI18n.ts), used when the chat is in English. */
  translations?: Translations
  /** The YoliA site this chat links to. */
  home: string
  typingMs?: number
}

export function WhatsAppChat({ data, rotations, environment, district, narrate, translations, home, typingMs = TYPING_MS }: ChatProps) {
  const { t, fmt, distance, lang, setLang } = useI18n()
  const base = home
  const env = useMemo<Env>(
    () => {
      // in English the engines' Spanish text is swapped for its translation; identifiers and figures are untouched
      const map = lang === 'en' ? (translations ?? null) : null
      const translate = <T,>(value: T): T => translateData(value, map)
      return {
        data, rotations: translate(rotations), environment, t, fmt, distance, lang, narrate: narrate ?? null,
        ...(district ? { district: { index: translate(district), base, api: liveApi(), translate } } : {}),
      }
    },
    [data, rotations, environment, t, fmt, distance, lang, narrate, district, base, translations],
  )
  useEffect(() => {
    document.title = 'YoliA · WhatsApp'
  }, [])
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [typing, setTyping] = useState(false)
  const [location, setLocation] = useState<DemoLocationId | null>(null)
  const chat = useRef<ChatState>(EMPTY_CHAT)
  const busy = useRef(false)
  const generation = useRef(0)
  const nextId = useRef(1)
  const endRef = useRef<HTMLDivElement>(null)

  const add = useCallback((from: Message['from'], bubble: BotBubble | { text: string }) => {
    const options = 'options' in bubble ? bubble.options : undefined
    setMessages((all) => [...all, { id: nextId.current++, from, text: bubble.text, options, time: clock(lang) }])
  }, [lang])

  const begin = useCallback(async () => {
    const mine = ++generation.current
    chat.current = EMPTY_CHAT
    busy.current = true
    setLocation(null)
    setMessages([])
    setTyping(true)
    try {
      for (const [i, bubble] of greeting(t).entries()) {
        await sleep(i === 0 ? 300 : Math.round(typingMs * 0.8))
        if (mine !== generation.current) return
        add('bot', bubble)
      }
    } finally {
      if (mine === generation.current) {
        setTyping(false)
        busy.current = false
      }
    }
  }, [add, t, typingMs])

  useEffect(() => {
    void begin()
    return () => {
      generation.current++
    }
  }, [begin])

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || busy.current) return
      busy.current = true
      const mine = generation.current
      setDraft('')
      add('user', { text })
      try {
        chat.current = await converse(text, chat.current, env, { typing: (on) => mine === generation.current && setTyping(on), show: (bubble) => add('bot', bubble), wait: sleep, alive: () => mine === generation.current }, typingMs)
        if (mine === generation.current) setLocation(chat.current.location)
      } finally {
        if (mine === generation.current) busy.current = false
      }
    },
    [add, env, typingMs],
  )

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [messages.length, typing])

  const picked = location ? demoLocation(location) : null
  const pickedKind = picked ? resultsKind(picked, env) : null
  const last = messages[messages.length - 1]
  const quick = !typing && last?.from === 'bot' ? last.options : undefined
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void send(draft)
  }

  return (
    <div className="wa-stage">
      <div className="wa-phone">
        <header className="wa-header">
          <span className="wa-avatar" aria-hidden="true">
            Y
            <span className="wa-badge">
              <WhatsAppMark size={22} />
            </span>
          </span>
          <div className="wa-who">
            <h1>
              Yol<span className="wa-ia">iA</span>
            </h1>
            <p>{t('whatsapp.status')}</p>
          </div>
          <div className="wa-lang" role="group" aria-label={t('whatsapp.languageLabel')}>
            {(['es', 'en'] as const).map((code) => (
              <button key={code} type="button" aria-pressed={lang === code} onClick={() => setLang(code)}>
                {code.toUpperCase()}
              </button>
            ))}
          </div>
          <button type="button" className="wa-reset" onClick={() => void begin()} aria-label={t('whatsapp.resetLabel')}>
            <span aria-hidden="true">↺</span>
            <span className="wa-reset-text"> {t('whatsapp.reset')}</span>
          </button>
        </header>

        <div className="wa-sitebar">
          <a href={home} className="wa-site">
            {t('whatsapp.openSite')} →
          </a>
        </div>

        <div className="wa-places" role="group" aria-label={t('whatsapp.locationLabel')}>
          {DEMO_LOCATIONS.map((place) => (
            <button key={place.id} type="button" className="wa-place" aria-pressed={location === place.id} disabled={typing} onClick={() => void send(place.name)}>
              {place.name}
            </button>
          ))}
          <p className={`wa-place-status${picked && !pickedKind ? ' none' : ''}`}>
            {picked ? `${picked.latitude}, ${picked.longitude} · ${t(pickedKind === 'rotations' ? 'whatsapp.statusRotations' : pickedKind === 'experimental' ? 'whatsapp.statusExperimental' : 'whatsapp.statusUnavailable')}` : t('whatsapp.noLocation')}
          </p>
        </div>

        <div className="wa-thread" role="log" aria-live="polite" aria-label={t('whatsapp.log')}>
          <p className="wa-day">{t('whatsapp.today')}</p>
          {messages.map((message) => (
            <div key={message.id} className={`wa-msg ${message.from === 'user' ? 'out' : 'in'}`}>
              <p>{richText(message.text)}</p>
              <span className="wa-time">{message.time}</span>
            </div>
          ))}
          {typing && (
            <div className="wa-msg in wa-typing" role="status" aria-label={t('whatsapp.typing')}>
              <span className="wa-dot" />
              <span className="wa-dot" />
              <span className="wa-dot" />
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="wa-chips" aria-label={t('whatsapp.suggested')}>
          {quick
            ? quick.map((option) => (
                <button key={option.label} type="button" className="wa-chip reply" onClick={() => void send(option.label)}>
                  {option.label}
                </button>
              ))
            : SUGGESTIONS.map((id) => (
                <button key={id} type="button" className="wa-chip" disabled={typing} onClick={() => void send(t(`whatsapp.suggestions.${id}`))}>
                  {t(`whatsapp.suggestions.${id}`)}
                </button>
              ))}
        </div>

        <form className="wa-composer" onSubmit={submit}>
          <label htmlFor="wa-input" className="wa-sr">
            {t('whatsapp.inputLabel')}
          </label>
          <input id="wa-input" type="text" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t('whatsapp.placeholder')} autoComplete="off" enterKeyHint="send" />
          <button type="submit" className="wa-send" disabled={typing || draft.trim() === ''} aria-label={t('whatsapp.send')}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M3 20.5 21 12 3 3.5l.01 6.6L15 12 3.01 13.9z" fill="currentColor" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  )
}
