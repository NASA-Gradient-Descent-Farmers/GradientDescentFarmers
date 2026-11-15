import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { loadZoneData } from '../../hooks/useZoneData.ts'
import { useI18n } from '../../i18n/index.tsx'
import { zoneFor } from '../../lib/environment.ts'
import { botTurn, loadChat, nextAsk, planReply, storeChat, userTurn, type Body, type Turn } from '../chat.ts'
import { createRecognizer, speechSupported, type Recognizer } from '../speech.ts'
import type { Field, FarmerState, Parcel, Situation } from '../state.ts'
import { environmentTopicOf } from '../topics.ts'
import { BigChoice } from './BigChoice.tsx'
import { MicIcon, SendIcon } from './glyphs.tsx'
import { HectaresField } from './HectaresField.tsx'
import { goalOptions, previousOptions, waterOptions } from './options.tsx'
import { ZoneAnswer } from './ZoneAnswer.tsx'

const SUGGESTIONS = ['plant', 'money', 'rain', 'trust', 'climate', 'soil'] as const

const lowerFirst = (text: string) => text.replace(/^(¿?)(.)/, (_, mark: string, letter: string) => mark + letter.toLowerCase())
const upperFirst = (text: string) => text.replace(/^(¿?)(.)/, (_, mark: string, letter: string) => mark + letter.toUpperCase())

interface Props {
  state: FarmerState
  parcel: Parcel | null
  /** The page's title and the line under it. */
  heading: string
  lede: string
  onSituation: (patch: Situation) => void
  onGoParcel: () => void
  /** A question to ask on arrival (from another page); `nonce` makes the same text askable twice. */
  seed: { text: string; nonce: number } | null
  onSeedUsed: () => void
}

/**
 * Preguntar a YolIA: a conversation that answers from the data the service published for the parcel's place (its rotation run
 * and environmental package) and nothing else. A question about planting first asks, one by one with large buttons, for whatever
 * is still missing; then the answer is built from the place's rotation options, ranked by what matters to the farmer and scaled
 * to their hectares. The reply is chosen in chat.ts from plain rules (there is no language model here yet), so every sentence is
 * written text and every number is the data's.
 */
export function AskPage({ state, parcel, heading, lede, onSituation, onGoParcel, seed, onSeedUsed }: Props) {
  const { t, lang } = useI18n()
  const [turns, setTurns] = useState<Turn[]>(loadChat)
  const [draft, setDraft] = useState('')
  const [listening, setListening] = useState(false)
  const [voiceFailed, setVoiceFailed] = useState(false)
  const focusRef = useRef<'plant' | 'money' | 'rain'>('plant')
  const endRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const recognizer = useRef<Recognizer | null>(null)
  const voice = useMemo(() => speechSupported(), [])

  useEffect(() => storeChat(turns), [turns])
  useEffect(() => () => recognizer.current?.stop(), [])

  const append = useCallback((...items: Turn[]) => setTurns((previous) => [...previous, ...items]), [])

  /** The answer to a question, from the place the parcel is in or nearest to. It waits for the files if they are still loading. */
  const answerFromZone = useCallback(
    async (topic: Extract<Body, { kind: 'zone' }>['topic'], situation: Situation) => {
      if (!parcel) return
      try {
        const zone = zoneFor(parcel.point, await loadZoneData())
        if (!zone) throw new Error(t('farmer.plant.loading'))
        append(botTurn({ kind: 'zone', topic, place: zone.id, km: zone.km, goal: situation.goal, water: situation.water }))
      } catch (error) {
        append(botTurn({ kind: 'error', message: error instanceof Error ? error.message : String(error) }))
      }
    },
    [append, parcel, t],
  )

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text) return
      setDraft('')
      const { patch, focus, plan } = planReply(text, { hasParcel: parcel !== null, situation: state.situation, zone: null, last: null })
      if (Object.keys(patch).length > 0) onSituation(patch)
      if (focus) focusRef.current = focus
      append(userTurn(text))
      // a question about the place's own data (its climate, soil, satellite series, sources)
      const dataTopic = environmentTopicOf(text)
      if (dataTopic) {
        if (parcel) answerFromZone(dataTopic, state.situation)
        else append(botTurn({ kind: 'ask', field: 'parcel', lead: true }))
        return
      }
      if (plan.kind === 'say') {
        // the answers about reliability and fertilizer come from the place's data too, so they need the parcel
        for (const body of plan.bodies) {
          if (body.kind === 'trust' || body.kind === 'fertilizer') {
            if (parcel) answerFromZone(body.kind, state.situation)
            else append(botTurn({ kind: 'ask', field: 'parcel', lead: true }))
          } else append(botTurn(body))
        }
      } else answerFromZone(plan.focus, { ...state.situation, ...patch })
    },
    [answerFromZone, append, onSituation, parcel, state.situation],
  )

  // a question handed over from another page is asked once, as if typed
  const seeded = useRef<number | null>(null)
  useEffect(() => {
    if (!seed || seeded.current === seed.nonce) return
    seeded.current = seed.nonce
    void send(seed.text)
    onSeedUsed()
  }, [seed, send, onSeedUsed])

  /** A tap on an answer button: the answer is noted, then the next question, or the answer to the original question. */
  const answer = (field: Field, value: Situation[Field], label: string) => {
    const situation = { ...state.situation, [field]: value }
    onSituation({ [field]: value } as Situation)
    append(userTurn(label))
    const ask = nextAsk(parcel !== null, situation)
    if (ask) append(botTurn({ kind: 'ask', field: ask, lead: false }))
    else answerFromZone(focusRef.current, situation)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void send(draft)
  }

  const toggleVoice = () => {
    if (listening) {
      recognizer.current?.stop()
      return
    }
    setVoiceFailed(false)
    const next = createRecognizer(lang, {
      onText: setDraft,
      onEnd: () => {
        setListening(false)
        inputRef.current?.focus()
      },
      onError: () => {
        setListening(false)
        setVoiceFailed(true)
      },
    })
    if (!next) return
    recognizer.current = next
    try {
      next.start()
      setListening(true)
    } catch {
      setVoiceFailed(true)
    }
  }

  // each new message scrolls into view from its start (a tall recommendation is read from the top); not on arrival
  const seenTurns = useRef(turns.length)
  useEffect(() => {
    if (turns.length === seenTurns.current) return
    seenTurns.current = turns.length
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    const messages = threadRef.current?.querySelectorAll('.fa-msg')
    messages?.[messages.length - 1]?.scrollIntoView({ block: 'start', behavior })
  }, [turns.length])

  const last = turns[turns.length - 1]
  const askingNow = last?.role === 'bot' && last.body.kind === 'ask'

  return (
    <div className="page chat-page">
      <div className="chat-head">
        <h1 className="page-title">{heading}</h1>
        {turns.length > 0 && (
          <button type="button" className="btn ghost" onClick={() => setTurns([])}>
            {t('farmer.chat.restart')}
          </button>
        )}
      </div>
      <p className="page-lede">{lede}</p>

      <div ref={threadRef} className="fa-thread" role="log" aria-live="polite" aria-label={t('farmer.chat.title')}>
        {turns.length === 0 && (
          <div className="fa-msg from-bot">
            <p className="who">{t('farmer.chat.bot')}</p>
            <p>{t('farmer.chat.intro')}</p>
          </div>
        )}
        {turns.map((turn, index) =>
          turn.role === 'user' ? (
            <div key={turn.id} className="fa-msg from-user">
              <p className="who">{t('farmer.chat.you')}</p>
              <p>{turn.text}</p>
            </div>
          ) : (
            <BotMessage
              key={turn.id}
              body={turn.body}
              active={index === turns.length - 1 && askingNow}
              onAnswer={answer}
              onGoParcel={onGoParcel}
            />
          ),
        )}
        <div ref={endRef} className="thread-end" />
      </div>

      {!askingNow && (
        <div className="suggest">
          <p className="help">{t('farmer.chat.suggested')}</p>
          <div className="chips">
            {SUGGESTIONS.map((id) => (
              <button key={id} type="button" className="chip" onClick={() => void send(t(`farmer.chat.suggestions.${id}`))}>
                {t(`farmer.chat.suggestions.${id}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      <form className="composer-bar" onSubmit={submit}>
        <label htmlFor="chat-input" className="sr-only">
          {t('farmer.chat.inputLabel')}
        </label>
        <input
          id="chat-input"
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={listening ? t('farmer.chat.listening') : t('farmer.chat.placeholder')}
          enterKeyHint="send"
          autoComplete="off"
        />
        {voice && (
          <button type="button" className="btn secondary round mic" onClick={toggleVoice} aria-pressed={listening} aria-label={listening ? t('farmer.chat.listening') : t('farmer.chat.mic')}>
            <MicIcon />
          </button>
        )}
        <button type="submit" className="btn primary chat-send" disabled={draft.trim() === ''}>
          <SendIcon />
          {t('farmer.chat.send')}
        </button>
      </form>
      {voiceFailed && (
        <p className="callout is-error" role="alert">
          {t('farmer.chat.micFailed')}
        </p>
      )}
    </div>
  )
}

interface BotProps {
  body: Body
  /** The latest message, still waiting for its answer: only then are the answer buttons shown. */
  active: boolean
  onAnswer: (field: Field, value: Situation[Field], label: string) => void
  onGoParcel: () => void
}

function BotMessage({ body, active, onAnswer, onGoParcel }: BotProps) {
  const { t } = useI18n()
  const [hectares, setHectares] = useState<number | undefined>()
  let content
  switch (body.kind) {
    case 'greeting':
      content = <p>{t('farmer.chat.hello')}</p>
      break
    case 'ask': {
      const question = body.field === 'parcel' ? t('farmer.chat.ask.parcel') : t(`farmer.parcel.steps.${body.field}.q`)
      content = (
        <>
          <p>{body.lead ? `${t('farmer.chat.ask.lead')} ${lowerFirst(question)}` : upperFirst(question)}</p>
          {active && body.field === 'parcel' && (
            <button type="button" className="btn primary" onClick={onGoParcel}>
              {t('farmer.chat.ask.chooseParcel')}
            </button>
          )}
          {active && body.field === 'previous' && (
            <BigChoice label={question} value={undefined} options={previousOptions(t)} onChange={(value) => onAnswer('previous', value, t(`farmer.parcel.previous.${value}`))} />
          )}
          {active && body.field === 'water' && (
            <BigChoice label={question} value={undefined} options={waterOptions(t)} onChange={(value) => onAnswer('water', value, t(`farmer.parcel.water.${value}.label`))} />
          )}
          {active && body.field === 'goal' && (
            <BigChoice label={question} value={undefined} options={goalOptions(t)} onChange={(value) => onAnswer('goal', value, t(`farmer.parcel.goal.${value}.label`))} />
          )}
          {active && body.field === 'hectares' && (
            <div className="inline-hectares">
              <HectaresField id="chat-hectares" value={hectares} onChange={setHectares} />
              <button type="button" className="btn primary" disabled={hectares === undefined} onClick={() => hectares !== undefined && onAnswer('hectares', hectares, t('farmer.parcel.hectares.quick', { n: hectares }))}>
                {t('farmer.common.next')}
              </button>
            </div>
          )}
        </>
      )
      break
    }
    case 'zone':
      content = <ZoneAnswer body={body} />
      break
    case 'unknown':
      content = (
        <p>{t('farmer.chat.unknown')}</p>
      )
      break
    case 'error':
      content = <p className="callout is-error">{t('farmer.chat.error', { message: body.message })}</p>
      break
    default:
      // answers of the old planner, which are no longer produced or kept
      content = null
  }

  return (
    <div className={`fa-msg from-bot${body.kind === 'zone' ? ' wide' : ''}`}>
      <p className="who">{t('farmer.chat.bot')}</p>
      {content}
    </div>
  )
}
