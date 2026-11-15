import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useI18n } from '../../i18n/index.tsx'
import type { DashboardData } from '../../lib/types.ts'
import { botTurn, loadChat, nextAsk, planReply, storeChat, userTurn, type Body, type Turn } from '../chat.ts'
import { evidenceFor, yearsText } from '../evidence.ts'
import { recommend, type Recommendation, type Zone } from '../recommend.ts'
import { createRecognizer, speechSupported, type Recognizer } from '../speech.ts'
import type { Field, FarmerState, Parcel, Situation } from '../state.ts'
import { BigChoice } from './BigChoice.tsx'
import { MicIcon, SendIcon } from './glyphs.tsx'
import { HectaresField } from './HectaresField.tsx'
import { goalOptions, previousOptions, waterOptions } from './options.tsx'
import { RecommendationCard } from './RecommendationCard.tsx'
import { Tag } from './Tag.tsx'

const SUGGESTIONS = ['plant', 'money', 'rain', 'trust', 'fertilizer'] as const
const UNKNOWN_ZONE: Zone = { status: 'unknown', key: null, km: 0 }

const lowerFirst = (text: string) => text.replace(/^(¿?)(.)/, (_, mark: string, letter: string) => mark + letter.toLowerCase())
const upperFirst = (text: string) => text.replace(/^(¿?)(.)/, (_, mark: string, letter: string) => mark + letter.toUpperCase())

interface Props {
  data: DashboardData
  state: FarmerState
  parcel: Parcel | null
  zone: Zone | null
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
 * Preguntar a YolIA: a conversation that answers from the models and nothing else. A question about planting first asks, one
 * by one with large buttons, for whatever is still missing; then the planner runs and the answer comes as the same card as in
 * "Qué sembrar". What the models do not cover is declined, not invented. The reply is chosen in chat.ts from plain rules (there
 * is no language model here yet), so every sentence is written text and every number is a model's.
 */
export function AskPage({ data, state, parcel, zone, heading, lede, onSituation, onGoParcel, seed, onSeedUsed }: Props) {
  const { t, lang } = useI18n()
  const [turns, setTurns] = useState<Turn[]>(loadChat)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [voiceFailed, setVoiceFailed] = useState(false)
  const busyRef = useRef(false)
  const focusRef = useRef<'plant' | 'money' | 'rain'>('plant')
  const endRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const recognizer = useRef<Recognizer | null>(null)
  const voice = useMemo(() => speechSupported(), [])

  useEffect(() => storeChat(turns), [turns])
  useEffect(() => () => recognizer.current?.stop(), [])

  const append = useCallback((...items: Turn[]) => setTurns((previous) => [...previous, ...items]), [])

  const lastRec = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const turn = turns[i]
      if (turn.role === 'bot' && turn.body.kind === 'recommendation') return turn.body.rec
    }
    return null
  }, [turns])

  const runPlanner = useCallback(
    async (focus: 'plant' | 'money' | 'rain', situation: Situation) => {
      if (!parcel) return
      busyRef.current = true
      setBusy(true)
      try {
        const rec = await recommend({ data, point: parcel.point, place: parcel.label, situation, zone: zone ?? UNKNOWN_ZONE })
        append(botTurn({ kind: 'recommendation', rec, focus }))
      } catch (error) {
        append(botTurn({ kind: 'error', message: error instanceof Error ? error.message : String(error) }))
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [append, data, parcel, zone],
  )

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim()
      if (!text || busyRef.current) return
      setDraft('')
      const { patch, focus, plan } = planReply(text, { hasParcel: parcel !== null, situation: state.situation, zone, last: lastRec })
      if (Object.keys(patch).length > 0) onSituation(patch)
      if (focus) focusRef.current = focus
      append(userTurn(text))
      if (plan.kind === 'say') append(...plan.bodies.map((body) => botTurn(body)))
      else await runPlanner(plan.focus, { ...state.situation, ...patch })
    },
    [append, lastRec, onSituation, parcel, runPlanner, state.situation, zone],
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
    else if (zone?.status === 'outside') append(botTurn({ kind: 'outside', km: zone.km }))
    else void runPlanner(focusRef.current, situation)
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
    if (turns.length === seenTurns.current && !busy) return
    seenTurns.current = turns.length
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    if (busy) {
      endRef.current?.scrollIntoView({ block: 'end', behavior })
      return
    }
    const messages = threadRef.current?.querySelectorAll('.fa-msg')
    messages?.[messages.length - 1]?.scrollIntoView({ block: 'start', behavior })
  }, [turns.length, busy])

  const last = turns[turns.length - 1]
  const askingNow = !busy && last?.role === 'bot' && last.body.kind === 'ask'

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
              data={data}
              onAnswer={answer}
              onGoParcel={onGoParcel}
            />
          ),
        )}
        {busy && (
          <p className="loading" role="status">
            <span className="spinner" aria-hidden="true" />
            {t('farmer.chat.thinking')}
          </p>
        )}
        <div ref={endRef} className="thread-end" />
      </div>

      {!busy && !askingNow && (
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
        <button type="submit" className="btn primary chat-send" disabled={busy || draft.trim() === ''}>
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
  data: DashboardData
  onAnswer: (field: Field, value: Situation[Field], label: string) => void
  onGoParcel: () => void
}

function BotMessage({ body, active, data, onAnswer, onGoParcel }: BotProps) {
  const { t, fmt, distance } = useI18n()
  const [hectares, setHectares] = useState<number | undefined>()
  const cropList = (rec: Recommendation) =>
    Object.entries(rec.result.strategy.doses)
      .filter(([, kg]) => kg > 0)
      .map(([crop, kg]) => ({ crop, kg }))
  const evidence = evidenceFor(data.models)

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
    case 'recommendation':
      content = (
        <>
          <p>{t(`farmer.chat.recommendation.${body.focus}`)}</p>
          <RecommendationCard rec={body.rec} meta={data.meta} models={data.models} level={3} variant="brief" />
        </>
      )
      break
    case 'outside':
      content = <p>{t('farmer.chat.outside', { km: distance(body.km) })}</p>
      break
    case 'fertilizer': {
      const doses = body.rec ? cropList(body.rec) : []
      content = (
        <>
          <Tag kind="general" />
          <p>{t('farmer.chat.fertilizer.general')}</p>
          <p>{t('farmer.chat.fertilizer.advice')}</p>
          {body.rec && (
            <>
              <Tag kind="estimate" />
              <p>
                {doses.length === 0
                  ? t('farmer.chat.fertilizer.none')
                  : doses.map(({ crop, kg }) => t('farmer.chat.fertilizer.yours', { kg: fmt.number(kg), crops: t(`crops.${crop}`).toLowerCase() })).join(' ')}
              </p>
            </>
          )}
        </>
      )
      break
    }
    case 'trust':
      content = (
        <>
          <Tag kind="general" />
          <p>{t('farmer.chat.trust.intro')}</p>
          <ul className="evidence">
            {evidence.level && (
              <li>
                <Tag kind="fact" />
                {t('farmer.rec.confidence.evidenceLevel', { sim: fmt.number(evidence.level.sim, 1), obs: fmt.number(evidence.level.obs, 1), years: yearsText(evidence.level.years) })}
              </li>
            )}
            {evidence.holdoutWorse && (
              <li>
                <Tag kind="fact" />
                {t('farmer.rec.confidence.evidenceYears', { holdout: yearsText(evidence.holdoutWorse) })}
              </li>
            )}
            <li>
              <Tag kind="general" />
              {t('farmer.rec.confidence.evidenceSource')}
            </li>
          </ul>
          <p>{t('farmer.chat.trust.outro')}</p>
        </>
      )
      break
    case 'unknown':
      content = (
        <p>{t('farmer.chat.unknown')}</p>
      )
      break
    case 'error':
      content = <p className="callout is-error">{t('farmer.chat.error', { message: body.message })}</p>
      break
  }

  return (
    <div className={`fa-msg from-bot${body.kind === 'recommendation' ? ' wide' : ''}`}>
      <p className="who">{t('farmer.chat.bot')}</p>
      {content}
    </div>
  )
}
