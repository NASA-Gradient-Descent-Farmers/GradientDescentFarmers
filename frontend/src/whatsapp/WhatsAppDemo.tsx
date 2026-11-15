import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { I18nProvider, useI18n } from '../i18n/index.tsx'
import { loadData } from '../lib/data.ts'
import type { DashboardData } from '../lib/types.ts'
import { EMPTY_CHAT, greeting, type BotBubble, type ChatState, type Env, type QuickReply } from './engine.ts'
import { richText } from './format.tsx'
import { appRoot } from './route.ts'
import { converse, TYPING_MS } from './session.ts'
import './whatsapp.css'

interface Message {
  id: number
  from: 'user' | 'bot'
  text: string
  options?: QuickReply[]
  time: string
}

const SUGGESTIONS = ['plant', 'rain', 'harvest', 'compare'] as const

const clock = () => new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false })
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** /demo/whatsapp: loads the stored model results (from this app's own files) and shows the chat. */
export default function WhatsAppDemo() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    document.title = 'YolIA · WhatsApp (simulación)'
    loadData(appRoot(window.location)).then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  return (
    <I18nProvider initial="es">
      {data ? <WhatsAppChat data={data} home={appRoot(window.location)} /> : <Loading error={error} />}
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
  /** The YolIA site this chat links to. */
  home: string
  typingMs?: number
}

export function WhatsAppChat({ data, home, typingMs = TYPING_MS }: ChatProps) {
  const { t, fmt, distance } = useI18n()
  const env = useMemo<Env>(() => ({ data, t, fmt, distance }), [data, t, fmt, distance])
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [typing, setTyping] = useState(false)
  const chat = useRef<ChatState>(EMPTY_CHAT)
  const busy = useRef(false)
  const generation = useRef(0)
  const nextId = useRef(1)
  const endRef = useRef<HTMLDivElement>(null)

  const add = useCallback((from: Message['from'], bubble: BotBubble | { text: string }) => {
    const options = 'options' in bubble ? bubble.options : undefined
    setMessages((all) => [...all, { id: nextId.current++, from, text: bubble.text, options, time: clock() }])
  }, [])

  const begin = useCallback(async () => {
    const mine = ++generation.current
    chat.current = EMPTY_CHAT
    busy.current = true
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
      } finally {
        if (mine === generation.current) busy.current = false
      }
    },
    [add, env, typingMs],
  )

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [messages.length, typing])

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
          </span>
          <div className="wa-who">
            <h1>
              Yol<span className="wa-ia">IA</span>
            </h1>
            <p>{t('whatsapp.status')}</p>
          </div>
          <button type="button" className="wa-reset" onClick={() => void begin()} aria-label={t('whatsapp.resetLabel')}>
            ↺ {t('whatsapp.reset')}
          </button>
        </header>

        <div className="wa-banner" role="note">
          <strong>{t('whatsapp.badge')}</strong> {t('whatsapp.banner')}{' '}
          <a href={home} className="wa-site">
            {t('whatsapp.openSite')} →
          </a>
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
