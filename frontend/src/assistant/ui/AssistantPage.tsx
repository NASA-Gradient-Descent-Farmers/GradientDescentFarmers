import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WipeOrigin } from '../../components/LeafTransition.tsx'
import { useI18n } from '../../i18n/index.tsx'
import { isPreset, type Preset } from '../../lib/farm.ts'
import { distanceKm as kmBetween, type LatLon } from '../../lib/geo.ts'
import type { DashboardData } from '../../lib/types.ts'
import { farmInputs } from '../../onboarding/profile.ts'
import type { Profile } from '../../onboarding/types.ts'
import { demoBackend, type AssistantBackend } from '../backend.ts'
import {
  addTurn, loadStored, newConversation, newId, removeConversation, saveStored, updateAssistant, upsertConversation,
  type AssistantMessage, type Conversation, type Stored, type UserMessage,
} from '../history.ts'
import { byModelOrder } from '../models.ts'
import { runModel, runModels } from '../run.ts'
import type { ModelId, Settings } from '../types.ts'
import { AssistantMessageView, Suggestions } from './AssistantMessageView.tsx'
import { Composer } from './Composer.tsx'
import { ModelsPanel } from './ModelsPanel.tsx'
import { Sidebar } from './Sidebar.tsx'

export interface Seed {
  text: string
  nonce: number
  /** The priority the farmer's answers ask for: it becomes the planner setting for this visit. */
  preset?: Preset
}

interface Props {
  data: DashboardData
  pin: LatLon | null
  site: LatLon
  onEditPin: (from?: WipeOrigin) => void
  onOpenPlanner: (settings: Settings) => void
  /** A question to ask on arrival (from a card on the home page). */
  seed: Seed | null
  /** Called once the seed has been taken, so coming back to this page later does not ask it again. */
  onSeedUsed: () => void
  /** What the farmer said in the onboarding. */
  profile: Profile
  /** Open the onboarding summary to review or change those answers. */
  /** Reopen the questions about the field; without it (no questions are asked) the buttons for it are hidden. */
  onEditAnswers?: () => void
  backend?: AssistantBackend
}

/** Stored settings are kept only if they still fit the exported data (every crop has a price and a cost). */
function usableSettings(stored: Settings | null, data: DashboardData): Settings {
  const fallback: Settings = { world: 'calibrated', preset: 'sustainability', economics: data.meta.economics }
  if (!stored) return fallback
  const crops = Object.keys(data.meta.economics.prices)
  const ok =
    (stored.world === 'calibrated' || stored.world === 'default') &&
    isPreset(stored.preset) &&
    crops.every((c) => Number.isFinite(stored.economics.prices?.[c]) && Number.isFinite(stored.economics.other_costs?.[c])) &&
    Number.isFinite(stored.economics.n_price) &&
    Number.isFinite(stored.economics.stover_price)
  return ok ? stored : fallback
}

export function AssistantPage({ data, pin, site, onEditPin, onOpenPlanner, seed, onSeedUsed, profile, onEditAnswers, backend = demoBackend }: Props) {
  const { t, lang, coords } = useI18n()
  const [stored, setStored] = useState<Stored>(loadStored)
  // Arriving from the onboarding, the farmer's priority is the planner setting; otherwise the last settings are kept.
  const [settings, setSettings] = useState<Settings>(() => {
    const usable = usableSettings(stored.settings, data)
    return seed?.preset ? { ...usable, preset: seed.preset } : usable
  })
  const [mode, setMode] = useState<'auto' | 'manual'>('auto')
  const [chosen, setChosen] = useState<ModelId[]>(['planner'])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [manualWarn, setManualWarn] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<'history' | 'panel' | null>(null)

  const storedRef = useRef(stored)
  useEffect(() => {
    storedRef.current = stored // `send` reads the latest conversations without being rebuilt on every change
  })
  const busyRef = useRef(false)
  const threadRef = useRef<HTMLDivElement>(null)

  const km = useMemo(() => (pin ? kmBetween(pin, site) : null), [pin, site])
  const farm = useMemo(() => farmInputs(profile, data.meta), [profile, data.meta])
  const active = stored.conversations.find((c) => c.id === stored.activeId) ?? null

  // Keep what the farmer has said and set on this device.
  useEffect(() => {
    saveStored({ ...stored, settings })
  }, [stored, settings])

  const patchMessage = useCallback((conversationId: string, messageId: string, change: (m: AssistantMessage) => AssistantMessage) => {
    setStored((prev) => ({
      ...prev,
      conversations: prev.conversations.map((c) => (c.id === conversationId ? updateAssistant(c, messageId, change) : c)),
    }))
  }, [])

  const send = useCallback(
    async (raw: string, options: { fresh?: boolean } = {}) => {
      const text = raw.trim()
      if (!text || busyRef.current) return
      if (mode === 'manual' && chosen.length === 0) {
        setManualWarn(true) // the draft stays where it is
        return
      }
      busyRef.current = true
      setBusy(true)
      setSendError(null)
      setManualWarn(false)
      try {
        const manual = mode === 'manual' ? [...chosen].sort(byModelOrder) : undefined
        const interpretation = await backend.interpret(text, settings, { manual, pinDistanceKm: km, farm })
        const now = Date.now()
        const user: UserMessage = { id: newId(), role: 'user', text, at: now }
        const reply: AssistantMessage = {
          id: newId(), role: 'assistant', at: now, interpretation, progress: {}, outcomes: [],
          status: interpretation.models.length > 0 ? 'running' : 'done',
        }
        const current = options.fresh ? null : storedRef.current.conversations.find((c) => c.id === storedRef.current.activeId) ?? null
        const conversation = addTurn(current ?? newConversation(now), user, reply)
        setStored((prev) => ({ ...prev, activeId: conversation.id, conversations: upsertConversation(prev.conversations, conversation) }))
        setDraft('')
        setDrawer(null)
        if (interpretation.models.length === 0) return

        const outcomes = await runModels({ data, pin, interpretation }, (model, state) =>
          patchMessage(conversation.id, reply.id, (m) => ({ ...m, progress: { ...m.progress, [model]: state } })),
        )
        let narration: AssistantMessage['narration']
        if (backend.narrate) {
          try {
            narration = { by: backend.label, items: await backend.narrate(outcomes, interpretation, lang) }
          } catch {
            // the backend could not write a summary: the template summary is drawn instead
          }
        }
        patchMessage(conversation.id, reply.id, (m) => ({ ...m, status: 'done', outcomes, narration }))
      } catch (error) {
        setSendError(error instanceof Error ? error.message : String(error)) // the draft is kept
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [backend, chosen, data, farm, km, lang, mode, patchMessage, pin, settings],
  )

  // A card on the home page asks its question as soon as the assistant opens.
  const seeded = useRef<number | null>(null)
  useEffect(() => {
    if (!seed || seeded.current === seed.nonce) return
    seeded.current = seed.nonce
    void send(seed.text, { fresh: true })
    onSeedUsed()
  }, [seed, send, onSeedUsed])

  const retry = useCallback(
    async (conversation: Conversation, message: AssistantMessage, model: ModelId) => {
      patchMessage(conversation.id, message.id, (m) => ({ ...m, status: 'running', progress: { ...m.progress, [model]: 'running' } }))
      const outcome = await runModel(model, { data, pin, interpretation: message.interpretation })
      patchMessage(conversation.id, message.id, (m) => ({
        ...m,
        status: 'done',
        progress: { ...m.progress, [model]: outcome.ok ? 'done' : 'failed' },
        outcomes: [...m.outcomes.filter((o) => o.model !== model), outcome],
      }))
    },
    [data, patchMessage, pin],
  )

  // A new question brings itself to the top, so its answer reads from the start instead of landing at its end.
  const conversationId = active?.id
  const messageCount = active?.messages.length ?? 0
  useEffect(() => {
    const thread = threadRef.current
    const questions = thread?.querySelectorAll<HTMLElement>('.msg.user')
    const latest = questions?.[questions.length - 1]
    // Scroll the thread itself: scrollIntoView would also move the page around it.
    if (thread && latest) thread.scrollTo({ top: latest.offsetTop - 8, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [conversationId, messageCount])

  useEffect(() => {
    if (!drawer) return
    const close = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(null)
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [drawer])

  const latest = useMemo(() => {
    const last = [...(active?.messages ?? [])].reverse().find((m): m is AssistantMessage => m.role === 'assistant')
    return last?.interpretation.models ?? []
  }, [active])

  const messages = active?.messages ?? []
  const askAgain = (index: number) => {
    const before = messages.slice(0, index).reverse().find((m): m is UserMessage => m.role === 'user')
    if (before) void send(before.text)
  }
  const suggestions = [
    t('assistant.suggestions.planner'), t('assistant.suggestions.earn'), t('assistant.suggestions.risk'), t('assistant.suggestions.trust'),
    t('assistant.suggestions.price'), t('assistant.suggestions.sustain'), t('assistant.suggestions.trees'),
    ...(pin ? [t('assistant.suggestions.combo')] : []),
  ]

  return (
    <div className={`assistant-page${drawer ? ` drawer-${drawer}` : ''}`}>
      <div className="assistant-bar">
        <button type="button" onClick={() => setDrawer(drawer === 'history' ? null : 'history')} aria-expanded={drawer === 'history'}>
          {t('assistant.sidebar.open')}
        </button>
        <button type="button" onClick={() => setDrawer(drawer === 'panel' ? null : 'panel')} aria-expanded={drawer === 'panel'}>
          {t('assistant.panel.open')}
        </button>
      </div>

      <div className="history-col">
        <Sidebar
          conversations={stored.conversations}
          activeId={stored.activeId}
          onSelect={(id) => {
            setStored((prev) => ({ ...prev, activeId: id }))
            setDrawer(null)
          }}
          onNew={() => {
            setStored((prev) => ({ ...prev, activeId: null }))
            setDrawer(null)
          }}
          onDelete={(id) =>
            setStored((prev) => ({
              ...prev,
              conversations: removeConversation(prev.conversations, id),
              activeId: prev.activeId === id ? null : prev.activeId,
            }))
          }
        />
      </div>

      <section className="chat-col" aria-label={t('assistant.title')}>
        <div className="demo-banner">
          <span className="badge demo">{t('assistant.demo.badge')}</span>
          <details>
            <summary>{t('assistant.demo.title')}</summary>
            <p>{t('assistant.demo.body1')}</p>
            <p>{t('assistant.demo.body2')}</p>
            <p>{t('assistant.demo.body3')}</p>
          </details>
        </div>

        <div className="thread" ref={threadRef} role="log" aria-live="polite" aria-relevant="additions" tabIndex={-1}>
          {messages.length === 0 ? (
            <div className="empty-state">
              <h2>{t('assistant.empty.title')}</h2>
              <p>{t('assistant.empty.body')}</p>
              <h3>{t('assistant.empty.prompts')}</h3>
              <Suggestions items={suggestions} onAsk={(q) => void send(q)} />
            </div>
          ) : (
            messages.map((m, index) =>
              m.role === 'user' ? (
                <div key={m.id} className="msg user">
                  <p className="bubble">
                    <span className="sr-only">{t('assistant.message.you')}: </span>
                    {m.text}
                  </p>
                </div>
              ) : (
                <AssistantMessageView
                  key={m.id}
                  message={m}
                  data={data}
                  hasPin={pin !== null}
                  distanceKm={km}
                  onRetry={(model) => active && void retry(active, m, model)}
                  onAskAgain={() => askAgain(index)}
                  onAsk={(q) => void send(q)}
                  onEditPin={() => onEditPin()}
                  onOpenPlanner={onOpenPlanner}
                  onEditAnswers={onEditAnswers}
                />
              ),
            )
          )}
        </div>

        {sendError && (
          <p className="send-error" role="alert">
            {t('assistant.composer.failed', { message: sendError })}
          </p>
        )}
        <Composer
          value={draft}
          onChange={(value) => {
            setDraft(value)
            if (manualWarn) setManualWarn(false)
          }}
          onSend={() => void send(draft)}
          busy={busy}
          manualNone={manualWarn}
          manualModels={mode === 'manual' ? [...chosen].sort(byModelOrder) : null}
        />
      </section>

      <div className="panel-col">
        <ModelsPanel
          meta={data.meta}
          settings={settings}
          onSettings={setSettings}
          mode={mode}
          onMode={(next) => {
            setMode(next)
            setManualWarn(false)
          }}
          chosen={chosen}
          onChosen={(models) => {
            setChosen(models)
            setManualWarn(false)
          }}
          hasPin={pin !== null}
          pinText={pin ? coords(pin) : null}
          onEditPin={() => onEditPin()}
          latest={latest}
          profile={profile}
          pin={pin}
          onEditAnswers={onEditAnswers}
        />
      </div>

      {drawer && <button type="button" className="backdrop" aria-label={t('assistant.sidebar.close')} onClick={() => setDrawer(null)} />}
    </div>
  )
}
