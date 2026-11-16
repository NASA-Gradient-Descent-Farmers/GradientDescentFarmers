import { useCallback, useEffect, useMemo, useState } from 'react'
import { Brand } from '../components/Brand.tsx'
import { LangToggle } from '../components/LangToggle.tsx'
import { currentPosition } from '../farmer/geolocate.ts'
import { loadPlaces, searchPlaces, stateLabel, type IndexedPlace } from '../farmer/places.ts'
import { I18nProvider, useI18n } from '../i18n/index.tsx'
import { useDataTranslation } from '../lib/dataI18n.ts'
import { DEMO_LOCATIONS } from '../lib/demoLocations.ts'
import {
  alternativesOf,
  bestAlternative,
  currentOf,
  districtAnswerFor,
  loadDistrictIndex,
  splitName,
  type CurrentRotationOption,
  type DistrictAnswer,
  type DistrictIndex,
  type DistrictPlace,
  type DistrictRotation,
  type PriorityId,
  type WaterRegime,
} from '../lib/district.ts'
import { loadRotations, type Rotations } from '../lib/rotations.ts'
import { DEMO_HREF, WA_HANDOFF_KEY } from '../whatsapp/route.ts'
import { regimeOf, wofostPick } from '../whatsapp/summary.ts'
import { needsSize, nearestSentences, SELL_LINKS, sellLines, GUARANTEE, type FarmSize } from '../lib/market.ts'
import { loadCentres, nearestCentres, type Centres } from '../lib/acopio.ts'
import { campoApi, liveDistrict, loadMunicipioRows, loadNationalIndex, nationalDistrictPlace, placeByName, placeByPoint, type FarmPlace, type MunicipioRow, type NationalIndex } from './national.ts'
import '../theme.css'
import './campo.css'

// The simple farmer view: four questions with big buttons (where, water, last crop, what matters most), then one clear
// answer from the district engine, with the WOFOST simulation beside it where a run exists. Its own page (/campo), its
// own stored answers; nothing in the main app reads or changes them.

const STORAGE_KEY = 'yolia-campo'
const GOALS: (PriorityId | null)[] = ['ingreso', 'riesgo', 'agua', 'suelo', null]
/** A claimed income gap this large held in 98% of held-out tests (resources/district_backtest). */
const BIG_GAP = 5000
const SOLID = ['alta', 'media']

type Step = 'place' | 'water' | 'crop' | 'goal' | 'answer'

interface Saved {
  place?: FarmPlace
  agua?: WaterRegime
  rotacion?: string
  prioridad?: PriorityId | null
  /** Farm size, asked only where a guarantee price depends on it. */
  ha?: FarmSize
  step: Step
}

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Saved | null
    return raw && typeof raw === 'object' && raw.step ? raw : { step: 'place' }
  } catch {
    return { step: 'place' }
  }
}

function save(state: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // storage blocked: the answers last for this visit
  }
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** The district for a place: the demo answers near a demo point, else the national export. */
function districtFor(place: FarmPlace, demo: DistrictIndex | null, national: NationalIndex | null): DistrictPlace | null {
  if (place.demoId && demo?.lugares[place.demoId]) return demo.lugares[place.demoId]!
  if (place.district) return place.district // looked up live
  return national && place.districtKey ? nationalDistrictPlace(national, place.districtKey) : null
}

export default function CampoPage() {
  return (
    <I18nProvider>
      <Campo />
    </I18nProvider>
  )
}

function Campo() {
  const { t } = useI18n()
  const base = import.meta.env.BASE_URL
  const [state, setStateRaw] = useState<Saved>(load)
  const [demo, setDemo] = useState<DistrictIndex | null>(null)
  const [national, setNational] = useState<NationalIndex | null>(null)
  const [rows, setRows] = useState<MunicipioRow[]>([])

  useEffect(() => {
    void loadDistrictIndex(base).then(setDemo)
    void loadNationalIndex(base).then(setNational)
    void loadMunicipioRows(base).then(setRows)
  }, [base])

  const setState = useCallback((next: Saved) => {
    setStateRaw(next)
    save(next)
  }, [])

  const district = state.place ? districtFor(state.place, demo, national) : null
  const regimes = district ? (['riego', 'temporal'] as WaterRegime[]).filter((r) => (district.regimenes[r]?.length ?? 0) > 0) : []
  const agua = state.agua && regimes.includes(state.agua) ? state.agua : regimes[0]
  const options = (district && agua && district.regimenes[agua]) || []

  const steps: Step[] = ['place', 'water', 'crop', 'goal']
  const stepIndex = steps.indexOf(state.step)
  const back = () => setState({ ...state, step: steps[Math.max(0, stepIndex - 1)] })

  return (
    <div className="campo">
      <header className="campo-top">
        <a className="campo-brand" href={base}>
          <Brand />
        </a>
        <LangToggle className="campo-lang" />
      </header>
      <main className="campo-main">
        {state.step !== 'answer' && (
          <nav className="campo-steps" aria-label={t('campo.title')}>
            {steps.map((s, i) => (
              <span key={s} className={i < stepIndex ? 'done' : i === stepIndex ? 'now' : ''}>
                {t(`campo.steps.${s}`)}
              </span>
            ))}
          </nav>
        )}
        {state.step === 'place' && <PlaceStep rows={rows} national={national} onPick={(place) => setState({ step: 'water', place })} />}
        {state.step === 'water' && state.place && (
          <Question title={t('campo.water.q')} onBack={back}>
            {(['riego', 'temporal'] as WaterRegime[]).map((r) => (
              <BigChoice key={r} label={t(`campo.water.${r}`)} hint={t(`campo.water.${r}Hint`)} selected={state.agua === r} onClick={() => setState({ ...state, agua: r, rotacion: undefined, step: 'crop' })} />
            ))}
          </Question>
        )}
        {state.step === 'crop' && state.place && (
          <Question title={t('campo.crop.q')} hint={t('campo.crop.hint')} onBack={back}>
            {state.agua && agua && state.agua !== agua && (
              <p className="campo-note">{t('campo.water.missing', { regime: t(`district.regime.${state.agua}`), other: t(`district.regime.${agua}`) })}</p>
            )}
            {options.map((o) => (
              <BigChoice key={o.id} label={capital(o.etiqueta)} selected={state.rotacion === o.id} onClick={() => setState({ ...state, agua, rotacion: o.id, step: 'goal' })} />
            ))}
          </Question>
        )}
        {state.step === 'goal' && state.place && (
          <Question title={t('campo.goal.q')} onBack={back}>
            {GOALS.map((g) => (
              <BigChoice key={g ?? 'none'} label={t(`campo.goal.${g ?? 'none'}`)} selected={state.prioridad === g} onClick={() => setState({ ...state, prioridad: g, step: 'answer' })} />
            ))}
          </Question>
        )}
        {state.step === 'answer' && state.place && district && agua && (
          <Answer
            place={state.place}
            district={district}
            agua={agua}
            option={options.find((o) => o.id === state.rotacion) ?? options[0]}
            prioridad={state.prioridad ?? null}
            size={state.ha ?? null}
            onSize={(ha) => setState({ ...state, ha })}
            onEdit={(step) => setState({ ...state, step })}
            onRestart={() => setState({ step: 'place', ha: state.ha })}
          />
        )}
      </main>
    </div>
  )
}

function Question({ title, hint, onBack, children }: { title: string; hint?: string; onBack?: () => void; children: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <section className="campo-q">
      <h1>{title}</h1>
      {hint && <p className="campo-hint">{hint}</p>}
      <div className="campo-choices">{children}</div>
      {onBack && (
        <button type="button" className="campo-back" onClick={onBack}>
          ← {t('campo.back')}
        </button>
      )}
    </section>
  )
}

function BigChoice({ label, hint, selected, onClick }: { label: string; hint?: string; selected?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="campo-choice" aria-pressed={selected ?? false} onClick={onClick}>
      <span>{label}</span>
      {hint && <small>{hint}</small>}
    </button>
  )
}

function PlaceStep({ rows, national, onPick }: { rows: MunicipioRow[]; national: NationalIndex | null; onPick: (place: FarmPlace) => void }) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState<IndexedPlace[]>([])
  const [gps, setGps] = useState<'idle' | 'busy' | 'failed'>('idle')
  const [problem, setProblem] = useState<string | null>(null)

  useEffect(() => {
    void loadPlaces().then(setIndex, () => setIndex([]))
  }, [])
  const hits = useMemo(() => searchPlaces(index, query, 6), [index, query])

  const [looking, setLooking] = useState(false)
  const pick = async (place: FarmPlace | null, label: string) => {
    if (!place) return setProblem(t('campo.place.gpsFailed'))
    setProblem(null)
    const api = campoApi()
    if (!place.demoId && api) {
      // the live engine says which district this is and what it grows
      setLooking(true)
      const district = await liveDistrict(api, place.municipality, place.state)
      setLooking(false)
      if (!district) return setProblem(t('campo.place.noDistrict', { place: label }))
      return onPick({ ...place, district })
    }
    if (!place.districtKey && !place.demoId) return setProblem(t('campo.place.noDistrict', { place: label }))
    onPick(place)
  }

  const useGps = async () => {
    setGps('busy')
    try {
      const point = await currentPosition()
      setGps('idle')
      const place = placeByPoint(rows, national, point)
      void pick(place, place ? `${place.municipality}, ${stateLabel(place.state)}` : '')
    } catch {
      setGps('failed')
    }
  }

  return (
    <Question title={t('campo.place.q')}>
      <button type="button" className="campo-choice is-primary" onClick={useGps} disabled={gps === 'busy'}>
        <span>📍 {gps === 'busy' ? t('campo.place.gpsBusy') : t('campo.place.gps')}</span>
      </button>
      {gps === 'failed' && <p className="campo-note">{t('campo.place.gpsFailed')}</p>}
      <label className="campo-search">
        <span>{t('campo.place.search')}</span>
        <input type="search" value={query} placeholder={t('campo.place.searchHint')} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
      </label>
      {hits.length > 0 && (
        <ul className="campo-hits">
          {hits.map((p) => (
            <li key={`${p.state}|${p.municipality}`}>
              <button type="button" disabled={looking} onClick={() => void pick(placeByName(rows, national, p.municipality, p.state), `${p.municipality}, ${p.state}`)}>
                <strong>{p.municipality}</strong> <span>{p.state}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {looking && <p className="campo-hint">{t('campo.place.looking')}</p>}
      {problem && <p className="campo-note">{problem}</p>}
      <p className="campo-hint">{t('campo.place.examples')}</p>
      <div className="campo-examples">
        {DEMO_LOCATIONS.map((d) => (
          <button
            key={d.id}
            type="button"
            className="chip"
            onClick={() => {
              const place = placeByPoint(rows, national, { lat: d.latitude, lon: d.longitude })
              void pick(place ? { ...place, how: 'example', demoId: d.id } : null, d.name)
            }}
          >
            {d.name}
          </button>
        ))}
      </div>
    </Question>
  )
}

function Money({ rotation }: { rotation: DistrictRotation }) {
  const { t, fmt } = useI18n()
  const d = rotation.vs_actual_ingreso
  if (!d) return null
  const n = Math.round(d.media)
  return (
    <div className={`campo-money ${n >= 0 ? 'up' : 'down'}`}>
      <p>
        <strong>
          {n >= 0 ? '+' : '−'}${fmt.number(Math.abs(n))}
        </strong>{' '}
        {t(n >= 0 ? 'campo.answer.more' : 'campo.answer.less')}
      </p>
      <p className="campo-small">{t('campo.answer.versus', { years: d.años })}</p>
      <p className="campo-small">{t(Math.abs(n) >= BIG_GAP ? 'campo.answer.bigGap' : 'campo.answer.smallGap')}</p>
    </div>
  )
}

/** The first risk that is not the income difference (already shown above it). */
const mainRisk = (r: DistrictRotation) => r.tarjeta.riesgos.find((x) => !/^(menos ingreso|diferencia de ingreso|less income|income difference)/i.test(x)) ?? r.tarjeta.riesgos[0]

interface SellContext {
  agua: WaterRegime
  state: string
  size: FarmSize | null
  onSize: (size: FarmSize) => void
  /** Ask the farm size here (the main suggestion only). */
  ask: boolean
  /** The official collection centres, when the directory is loaded; the farmer's point to measure from. */
  centres?: Centres | null
  point?: { lat: number; lon: number }
  municipality?: string
}

const SIZES: FarmSize[] = ['hasta5', 'hasta30', 'mas30']

function Sell({ rotation, sell, asked }: { rotation: DistrictRotation; sell: SellContext; asked: boolean }) {
  const { t, fmt } = useI18n()
  const lines = sellLines(rotation, sell.agua, sell.state, sell.size)
  if (!lines.length) return null
  const money = (n: number) => fmt.number(Math.round(n))
  const hasGuarantee = lines.some((l) => l.kind === 'guarantee')
  return (
    <div className="campo-sell">
      <p className="campo-sell-title">{t('campo.answer.sell.title')}</p>
      {asked && hasGuarantee && (
        <div className="campo-sell-size" role="group" aria-label={t('campo.answer.sell.size')}>
          <span>{t('campo.answer.sell.size')}</span>
          {SIZES.map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={sell.size === s} onClick={() => sell.onSize(s)}>
              {t(`campo.answer.sell.${s}`)}
            </button>
          ))}
        </div>
      )}
      <ul>
        {lines.map((l) =>
          l.kind === 'guarantee' ? (
            <li key={l.program}>
              <strong>{capital(t(`campo.answer.sell.crop.${l.program}`))}:</strong> {t('campo.answer.sell.guarantee', { crop: t(`campo.answer.sell.crop.${l.program}`), price: money(l.price), maxT: l.maxT, maxTHa: fmt.number(l.maxTHa, l.maxTHa % 1 ? 1 : 0) })}{' '}
              {l.eligible === null ? t('campo.answer.sell.ifSize', { ha: l.maxHa }) : l.eligible ? t('campo.answer.sell.eligible') : t('campo.answer.sell.notEligible', { ha: l.maxHa })}{' '}
              {l.districtPrice != null && l.eligible === false && t('campo.answer.sell.districtOnly', { price: money(l.districtPrice) })}
              {l.districtPrice != null &&
                l.eligible !== false &&
                t('campo.answer.sell.district', {
                  price: money(l.districtPrice),
                  diff: t(l.price >= l.districtPrice ? 'campo.answer.sell.above' : 'campo.answer.sell.below', { n: money(Math.abs(l.price - l.districtPrice)) }),
                })}{' '}
              {l.pigmented != null && t('campo.answer.sell.pigmented', { price: money(l.pigmented) })}
            </li>
          ) : (
            <li key="market">
              {t('campo.answer.sell.market', { crops: capital(l.crops.map((c) => c.crop.toLowerCase()).join(', ')) })}{' '}
              {l.crops.some((c) => c.price != null) &&
                t('campo.answer.sell.marketPrices', {
                  list: l.crops
                    .filter((c) => c.price != null)
                    .map((c) => `${c.crop.toLowerCase()} $${money(c.price!)}/t`)
                    .join(', '),
                })}
            </li>
          ),
        )}
      </ul>
      {hasGuarantee && sell.centres && sell.point && (
        <div className="campo-small">
          {nearestSentences(nearestCentres(sell.centres.centres, sell.point, sell.state, sell.municipality, 1), sell.centres.downloaded, t, fmt).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
      <p className="campo-small">
        {hasGuarantee && (
          <>
            <a href={SELL_LINKS.acopio} target="_blank" rel="noreferrer">
              {t('campo.answer.sell.centres')}
            </a>
            {' · '}
          </>
        )}
        <a href={SELL_LINKS.sniim} target="_blank" rel="noreferrer">
          {t('campo.answer.sell.sniim')}
        </a>
        {hasGuarantee && <> · {t('campo.answer.sell.check', { year: GUARANTEE.year })}</>}
      </p>
    </div>
  )
}

function Option({ rotation, open, sell }: { rotation: DistrictRotation; open?: boolean; sell: SellContext }) {
  const { t } = useI18n()
  const card = rotation.tarjeta
  const risk = mainRisk(rotation)
  const body = (
    <>
      <p className="campo-why">{card.por_que}</p>
      <Money rotation={rotation} />
      {(rotation.adopcion.condicional || rotation.busqueda_ampliada) && <p className="campo-note">{t('campo.answer.fewPlots')}</p>}
      {risk && (
        <p>
          <strong>{t('campo.answer.watch')}:</strong> {risk}
        </p>
      )}
      <Sell rotation={rotation} sell={sell} asked={sell.ask} />
      {card.revisar_con_tecnico[0] && (
        <p>
          <strong>{t('campo.answer.askTech')}:</strong> {card.revisar_con_tecnico[0]}
        </p>
      )}
      <details className="campo-more">
        <summary>{t('campo.answer.why')}</summary>
        <ul>
          {card.evidencia.map((e) => (
            <li key={e.texto}>{e.texto}</li>
          ))}
        </ul>
        {card.vacios.length > 0 && (
          <>
            <p>
              <strong>{t('campo.answer.unknown')}</strong>
            </p>
            <ul>
              {card.vacios.slice(0, 3).map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          </>
        )}
      </details>
    </>
  )
  if (open) return body
  const n = rotation.vs_actual_ingreso ? Math.round(rotation.vs_actual_ingreso.media) : null
  return (
    <details className="campo-other">
      <summary>
        <span>{capital(splitName(rotation.nombre).crops)}</span>
        {n !== null && <span className={n >= 0 ? 'up' : 'down'}>{n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('es-MX')}</span>}
      </summary>
      {body}
    </details>
  )
}

function Answer({ place, district, agua, option, prioridad, size, onSize, onEdit, onRestart }: {
  place: FarmPlace
  district: DistrictPlace
  agua: WaterRegime
  option: CurrentRotationOption | undefined
  prioridad: PriorityId | null
  size: FarmSize | null
  onSize: (size: FarmSize) => void
  onEdit: (step: Step) => void
  onRestart: () => void
}) {
  const { t, fmt, lang } = useI18n()
  const translate = useDataTranslation()
  const base = import.meta.env.BASE_URL
  const [answer, setAnswer] = useState<DistrictAnswer | null | undefined>(undefined)
  const [wofost, setWofost] = useState<Rotations | null>(null)
  const [centres, setCentres] = useState<Centres | null>(null)
  useEffect(() => {
    void loadCentres(base).then(setCentres)
  }, [base])

  useEffect(() => {
    let alive = true
    setAnswer(undefined)
    if (!option) {
      setAnswer(null)
      return
    }
    districtAnswerFor(district, { agua, rotacion: option.id, prioridades: prioridad ? [prioridad] : [] }, {}, base, { translate, api: place.district ? campoApi() : null }).then(
      (a) => alive && setAnswer(a),
      () => alive && setAnswer(null),
    )
    return () => {
      alive = false
    }
  }, [district, agua, option, prioridad, base, translate, place.district])

  useEffect(() => {
    if (!place.demoId) return setWofost(null)
    let alive = true
    void loadRotations([place.demoId], base).then((all) => alive && setWofost(all[place.demoId!] ?? null), () => alive && setWofost(null))
    return () => {
      alive = false
    }
  }, [place.demoId, base])

  if (answer === undefined) {
    return (
      <p className="loading campo-loading" role="status">
        <span className="spinner" aria-hidden="true" />
        {t('campo.answer.loading')}
      </p>
    )
  }
  if (!answer) {
    return (
      <section className="campo-q">
        <p className="campo-note">{t('campo.answer.unavailable')}</p>
        <button type="button" className="btn primary block" onClick={() => onEdit('crop')}>
          {t('campo.answer.edit')}
        </button>
      </section>
    )
  }
  const { result } = answer
  const current = currentOf(result)
  // "Earn more": only options whose income rests on recorded district yields (evidence alta/media); a figure built on an
  // assumed yield (milpa's beans and squash, a crop barely grown here) is never the headline pick.
  // The engine's income score saturates at 40,000 MXN/ha (scoring.SCALES), so irrigated options all score 100
  // and it cannot rank them; here the suggestion is the alternative that recorded the most income in the district.
  const byIncome = prioridad === 'ingreso' ? [...alternativesOf(result)].filter((r) => r.vs_actual_ingreso && !r.adopcion.condicional && SOLID.includes(r.indicadores.ingreso?.evidencia ?? 'baja')).sort((a, b) => b.vs_actual_ingreso!.media - a.vs_actual_ingreso!.media)[0] : undefined
  const best = byIncome ?? bestAlternative(result)
  const others = alternativesOf(result).filter((r) => r !== best)
  const sell: SellContext = { agua, state: place.state, size, onSize, ask: false, centres, point: place.point, municipality: place.municipality }
  // the size question goes on the main card; when only another option has maíz or frijol, it goes on the first of those
  const askOn = best && needsSize([best], agua, place.state) ? best : others.find((r) => needsSize([r], agua, place.state))
  const goalOf = prioridad === 'ingreso' ? 'earn' : prioridad === 'agua' ? 'water' : prioridad === 'suelo' ? 'soil' : null
  const wofostOption = wofost ? wofostPick(translate(wofost), regimeOf(agua), goalOf) : null
  const handoff = () => {
    try {
      const inputs = { agua, rotacion: option?.id, prioridades: prioridad ? [prioridad] : [] }
      const label = `${place.how === 'example' && place.demoId ? district.municipio : place.municipality}, ${stateLabel(place.state)}`
      sessionStorage.setItem(WA_HANDOFF_KEY, JSON.stringify(place.demoId ? { demoId: place.demoId, inputs } : { national: { label, place: district, api: place.district ? campoApi() : null, point: place.point }, inputs }))
    } catch {
      // the chat then simply starts at the greeting
    }
  }

  return (
    <section className="campo-answer">
      <p className="campo-where">
        <span>{t('campo.answer.where', { place: `${place.how === 'example' && place.demoId ? district.municipio : place.municipality}, ${stateLabel(place.state)}`, district: result.lugar.distrito, regime: t(`district.regime.${agua}`) })}</span>
        <button type="button" onClick={() => onEdit('place')}>
          {t('campo.answer.edit')}
        </button>
      </p>
      {place.how === 'gps' && <p className="campo-small">{t('campo.place.approx')}</p>}
      {lang === 'en' && !place.demoId && <p className="campo-small">{t('campo.answer.english')}</p>}

      {best ? (
        <article className="campo-card is-main">
          <p className="campo-kicker">{prioridad ? t('campo.answer.suggest') : t('campo.answer.balanced')}</p>
          {byIncome && <p className="campo-small">{t('campo.answer.byIncome')}</p>}
          <h1>{capital(splitName(best.nombre).crops)}</h1>
          <p className="campo-small">{best.secuencia}</p>
          <Option rotation={best} open sell={{ ...sell, ask: askOn === best }} />
        </article>
      ) : (
        <p className="campo-note">{result.nota_opciones ?? t('campo.answer.none')}</p>
      )}

      <div className="campo-card">
        <p className="campo-kicker">{t('campo.answer.now')}</p>
        <p>{t('campo.answer.nowLine', { crops: capital(splitName(current.nombre).crops), income: current.indicadores.ingreso?.texto ?? '—' })}</p>
        <div className="campo-edit">
          <button type="button" className="chip" onClick={() => onEdit('crop')}>
            {t('campo.steps.crop')}
          </button>
          <button type="button" className="chip" onClick={() => onEdit('water')}>
            {t('campo.steps.water')}
          </button>
          <button type="button" className="chip" onClick={() => onEdit('goal')}>
            {t('campo.steps.goal')}
          </button>
        </div>
      </div>

      {others.length > 0 && (
        <div className="campo-card">
          <p className="campo-kicker">{t('campo.answer.others')}</p>
          {others.map((r) => (
            <Option key={r.id + r.nombre} rotation={r} sell={{ ...sell, ask: askOn === r }} />
          ))}
        </div>
      )}

      {wofost && wofostOption && (
        <div className="campo-card is-sim">
          <p className="campo-kicker">{t('campo.answer.wofost')}</p>
          <p>
            {t('campo.answer.wofostLine', {
              plan: capital(wofostOption.descriptionEs),
              income: wofostOption.gross?.median != null ? fmt.number(Math.round(wofostOption.gross.median)) : '—',
              confidence: wofost.confidence.labelEs.toLowerCase(),
            })}
          </p>
          <p className="campo-small">{t('campo.answer.wofostNote')}</p>
        </div>
      )}

      <div className="campo-actions">
        <a className="btn primary block big" href={DEMO_HREF} onClick={handoff}>
          💬 {t('campo.answer.whatsapp')}
        </a>
        <button type="button" className="btn ghost block" onClick={onRestart}>
          {t('campo.answer.restart')}
        </button>
      </div>
      <p className="campo-small">
        {t('campo.answer.source')} {result.aviso}
      </p>
    </section>
  )
}
