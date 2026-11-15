import { useEffect, useMemo, useState } from 'react'
import { useI18n } from '../../i18n/index.tsx'
import type { DemoLocationId } from '../../lib/demoLocations.ts'
import {
  alternativesOf,
  bestAlternative,
  currentOf,
  districtAnswer,
  INDICATOR_ORDER,
  loadDistrictIndex,
  loadInputs,
  PRIORITY_IDS,
  RESIDUES,
  saveInputs,
  SLOPES,
  SOILS,
  splitName,
  type AppAnswers,
  type DistrictAnswer,
  type DistrictIndex,
  type DistrictInputs,
  type DistrictRotation,
  type PriorityId,
  type WaterRegime,
} from '../../lib/district.ts'
import { districtBubbles } from '../../whatsapp/districtAnswers.ts'
import { richText } from '../../whatsapp/format.tsx'
import { DataTable } from './DataTable.tsx'
import { Disclosure } from './Disclosure.tsx'
import '../../near.css'
import '../../district.css'

// The SIAP district engine on the web pages: a second, separate answer next to the WOFOST rotation run. It has its own inputs
// (current rotation, water, up to two priorities, and optional field details), stored apart, so nothing it asks changes the
// WOFOST part. Técnico sees every rotation the engine compared, with its indicators and evidence; Agricultor sees the short
// answer and can open the rest.

const PRIORITY_ORDER: PriorityId[] = ['ingreso', 'riesgo', 'agua', 'suelo', 'erosion', 'plagas', 'forraje']
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

let indexLoading: Promise<DistrictIndex | null> | null = null
const getIndex = () => (indexLoading ??= loadDistrictIndex(import.meta.env.BASE_URL))

/** The district answer for a place, with the farmer's inputs for this engine (saved on this phone, per account). */
export function useDistrict(placeId: DemoLocationId | null, app: AppAnswers) {
  const [index, setIndex] = useState<DistrictIndex | null | undefined>(undefined)
  const [inputs, setInputsState] = useState<DistrictInputs>(loadInputs)
  const [answer, setAnswer] = useState<DistrictAnswer | null | undefined>(undefined)
  const { water, goal, previous } = app

  useEffect(() => {
    let alive = true
    void getIndex().then((loaded) => alive && setIndex(loaded))
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (index === undefined) return
    if (!index || !placeId) {
      setAnswer(null)
      return
    }
    let alive = true
    setAnswer(undefined)
    districtAnswer(placeId, index, inputs, { water, goal, previous }, import.meta.env.BASE_URL).then(
      (next) => alive && setAnswer(next),
      () => alive && setAnswer(null),
    )
    return () => {
      alive = false
    }
  }, [index, placeId, inputs, water, goal, previous])

  const setInputs = (next: DistrictInputs) => {
    setInputsState(next)
    saveInputs(next)
  }
  return { index, answer, inputs, setInputs }
}

function Chips<T extends string>({ label, options, selected, onPick }: { label: string; options: { id: T; text: string }[]; selected: (id: T) => boolean; onPick: (id: T) => void }) {
  return (
    <fieldset className="dist-fieldset">
      <legend className="field-label">{label}</legend>
      <div className="chips">
        {options.map((o) => (
          <button key={o.id} type="button" className="chip" aria-pressed={selected(o.id)} onClick={() => onPick(o.id)}>
            {o.text}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

/** What this engine asks: water, current rotation, priorities, and (optional) the field details only the live engine uses. */
export function DistrictInputsForm({ index, placeId, inputs, answer, onChange, simple }: { index: DistrictIndex; placeId: DemoLocationId; inputs: DistrictInputs; answer: DistrictAnswer; onChange: (next: DistrictInputs) => void; simple?: boolean }) {
  const { t } = useI18n()
  const place = index.lugares[placeId]!
  const used = answer.inputs
  const regimes = (['riego', 'temporal'] as WaterRegime[]).filter((r) => (place.regimenes[r]?.length ?? 0) > 0)
  const togglePriority = (id: PriorityId) => {
    const now = used.prioridades
    const next = now.includes(id) ? now.filter((p) => p !== id) : [...now, id].slice(-index.max_prioridades)
    onChange({ ...inputs, prioridades: next })
  }
  const select = <K extends keyof DistrictInputs>(key: K, value: string, parse: (v: string) => DistrictInputs[K]) => onChange({ ...inputs, [key]: value === '' ? undefined : parse(value) })
  return (
    <div className="dist-form">
      <h3>{t('district.view.yourField')}</h3>
      <p className="muted">{t('district.view.yourFieldHint')}</p>
      <Chips label={t('district.view.water')} options={regimes.map((r) => ({ id: r, text: t(`district.regime.${r}`) }))} selected={(r) => used.agua === r} onPick={(r) => onChange({ ...inputs, agua: r, rotacion: undefined })} />
      <Chips label={t('district.view.rotation')} options={(place.regimenes[used.agua] ?? []).map((o) => ({ id: o.id, text: o.etiqueta }))} selected={(id) => used.rotacion === id} onPick={(id) => onChange({ ...inputs, agua: used.agua, rotacion: id })} />
      <Chips label={t('district.view.priorities')} options={(simple ? PRIORITY_ORDER.slice(0, 4) : PRIORITY_ORDER).filter((id) => PRIORITY_IDS.includes(id)).map((id) => ({ id, text: t(`district.priority.${id}`) }))} selected={(id) => used.prioridades.includes(id)} onPick={togglePriority} />
      <Disclosure title={t('district.view.more')}>
        <p className="muted">{t('district.view.moreHint')}</p>
        <div className="dist-grid">
          <label>
            <span className="field-label">{t('district.view.slope')}</span>
            <select value={inputs.pendiente ?? ''} onChange={(e) => select('pendiente', e.target.value, (v) => v as DistrictInputs['pendiente'])}>
              <option value="">—</option>
              {SLOPES.map((s) => (
                <option key={s} value={s}>
                  {t(`district.view.slopes.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">{t('district.view.soil')}</span>
            <select value={inputs.suelo ?? ''} onChange={(e) => select('suelo', e.target.value, (v) => v as DistrictInputs['suelo'])}>
              <option value="">{t('district.view.soils.unknown')}</option>
              {SOILS.map((s) => (
                <option key={s} value={s}>
                  {t(`district.view.soils.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">{t('district.view.residue')}</span>
            <select value={inputs.residuo ?? ''} onChange={(e) => select('residuo', e.target.value, (v) => v as DistrictInputs['residuo'])}>
              <option value="">—</option>
              {RESIDUES.map((s) => (
                <option key={s} value={s}>
                  {t(`district.view.residues.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">{t('district.view.sowing')}</span>
            <select value={inputs.mesSiembra ?? ''} onChange={(e) => select('mesSiembra', e.target.value, Number)}>
              <option value="">{t('district.view.anyMonth')}</option>
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="field-label">{t('district.view.harvest')}</span>
            <select value={inputs.mesCosecha ?? ''} onChange={(e) => select('mesCosecha', e.target.value, Number)}>
              <option value="">{t('district.view.anyMonth')}</option>
              {MONTHS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="dist-check">
            <input type="checkbox" checked={inputs.animales ?? false} onChange={(e) => onChange({ ...inputs, animales: e.target.checked || undefined })} />
            <span>{t('district.view.animals')}</span>
          </label>
        </div>
      </Disclosure>
    </div>
  )
}

/** One rotation with everything the engine wrote for it. */
function RotationCard({ rotation, isCurrent, best, prioritized }: { rotation: DistrictRotation; isCurrent: boolean; best: boolean; prioritized: boolean }) {
  const { t, fmt } = useI18n()
  const { kind, crops } = splitName(rotation.nombre)
  const card = rotation.tarjeta
  const d = rotation.vs_actual_ingreso
  const indicators = INDICATOR_ORDER.filter((key) => rotation.indicadores[key])
  const bad = rotation.años_malos
  const pct = (x: number | null) => (x === null ? '—' : `${fmt.number(Math.round(x * 100))} %`)
  return (
    <article className={`near-option dist-card${best ? ' is-best' : ''}`}>
      <p className="near-kicker">{isCurrent ? t('district.view.current') : best ? t(prioritized ? 'district.bestForYou' : 'district.bestBalanced') : `${t('district.view.alternative')} · ${kind}`}</p>
      <h2>{crops}</h2>
      <p className="muted">{rotation.secuencia}</p>
      {!isCurrent && (
        <p>
          <strong>{t('district.view.why')}:</strong> {card.por_que}
        </p>
      )}
      {d && (
        <p className={`callout ${d.clara ? '' : 'is-warn'}`}>
          {t(d.media >= 0 ? 'district.deltaMore' : 'district.deltaLess', { n: fmt.number(Math.abs(Math.round(d.media))), years: d.años, clear: d.clara ? t('district.clear') : t('district.notClear') })}
        </p>
      )}
      {rotation.puntaje_prioridades !== null && <p className="muted">{t('district.score', { score: rotation.puntaje_prioridades })}</p>}
      {(rotation.adopcion.condicional || rotation.busqueda_ampliada) && <p className="callout is-warn">{t('district.conditional')}</p>}
      {card.beneficios.length > 0 && (
        <>
          <h3>{t('district.view.benefits')}</h3>
          <ul className="near-facts">
            {card.beneficios.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      {card.riesgos.length > 0 && (
        <>
          <h3>{t('district.view.risks')}</h3>
          <ul className="near-facts">
            {card.riesgos.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
      <Disclosure title={t('district.view.indicators')}>
        <DataTable
          head={[t('district.view.indicator'), t('district.view.value'), t('district.view.scoreCol'), t('district.view.evidenceCol')]}
          rows={indicators.map((key) => {
            const i = rotation.indicadores[key]
            return [t(`district.view.ind.${key}`), `${i.texto} — ${i.unidad}`, i.puntaje === null ? '—' : fmt.number(Math.round(i.puntaje)), `${t(`district.evidence.${i.evidencia}`)} · ${i.fuente}`]
          })}
        />
      </Disclosure>
      <Disclosure title={t('district.view.evidenceList')}>
        <ul>
          {card.evidencia.map((e) => (
            <li key={e.texto}>
              {e.texto} <span className="muted">({e.fuente}; {t(`district.evidence.${e.evidencia}`)})</span>
            </li>
          ))}
        </ul>
        {bad && bad.años.length > 0 && <p>{t('district.view.badYears', { years: bad.años.join(', '), rel: pct(bad.relativo), relCurrent: pct(bad.relativo_actual) })}</p>}
      </Disclosure>
      {card.vacios.length > 0 && (
        <Disclosure title={t('district.view.gaps')}>
          <ul>
            {card.vacios.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Disclosure>
      )}
      {rotation.escenarios && (
        <Disclosure title={t('district.view.scenarios')}>
          <DataTable
            head={[`${t('district.view.scenarioTemp')} \\ ${t('district.view.scenarioRain')}`, ...rotation.escenarios.lluvia_pct.map((p) => `${p > 0 ? '+' : ''}${p} %`)]}
            rows={rotation.escenarios.temp_c.map((c, r) => [`+${fmt.number(c, 0)} °C`, ...rotation.escenarios!.valores[r].map((v) => (v === null ? '—' : rotation.escenarios!.unidad === 'mm_riego' ? `${fmt.number(Math.round(v))} mm` : fmt.number(v, 2)))])}
          />
        </Disclosure>
      )}
      {card.revisar_con_tecnico.length > 0 && (
        <>
          <h3>{t('district.view.tech')}</h3>
          <ul className="near-facts">
            {card.revisar_con_tecnico.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      )}
    </article>
  )
}

function Lines({ lines }: { lines: string[] }) {
  return (
    <ul>
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  )
}

/**
 * "Según el historial de tu distrito": the district engine's answer for the place of the parcel. `mode` decides how much is shown.
 * Every sentence of substance is the engine's; the page only lays it out.
 */
export function DistrictSection({ placeId, app, mode }: { placeId: DemoLocationId | null; app: AppAnswers; mode: 'tecnico' | 'agricultor' }) {
  const { t, fmt, lang } = useI18n()
  const { index, answer, inputs, setInputs } = useDistrict(placeId, app)
  const simple = mode === 'agricultor'
  const bubbles = useMemo(() => (answer ? districtBubbles('summary', answer, { t, fmt, simple: true }) : []), [answer, t, fmt])

  if (index === null || answer === null) return <p className="muted dist-section">{t('district.view.unavailable')}</p>
  if (index === undefined || answer === undefined || !placeId) {
    return (
      <p className="loading dist-section" role="status">
        <span className="spinner" aria-hidden="true" />
        {t('district.view.loading')}
      </p>
    )
  }
  const { result } = answer
  const current = currentOf(result)
  const best = bestAlternative(result)
  const form = <DistrictInputsForm index={index} placeId={placeId} inputs={inputs} answer={answer} onChange={setInputs} simple={simple} />

  return (
    <section className="dist-section" aria-labelledby="dist-heading">
      <p className="near-kicker">{t('district.engine')}</p>
      <h2 id="dist-heading">{simple ? t('district.view.simpleIntro') : t('district.view.heading')}</h2>
      <p className="muted">{t('district.view.sub')}</p>
      {lang === 'en' && <p className="muted">{t('district.view.english')}</p>}
      <p className="dist-badges">
        <span className="dist-badge">{t(`district.view.source.${answer.source}`)}</span>
        <span className="dist-badge">
          {result.lugar.municipio ?? '—'} · {result.lugar.distrito} · {result.lugar.estado} · {t(`district.regime.${result.lugar.agua}`)}
        </span>
      </p>
      {answer.liveError && <p className="callout is-warn">{t('district.view.liveFailed', { error: answer.liveError })}</p>}
      {answer.notUsed.length > 0 && <p className="callout is-warn">{t('district.notUsed', { list: answer.notUsed.map((key) => t(`district.inputs.${key}`)).join(', ') })}</p>}

      {simple ? (
        <>
          {bubbles.slice(1).map((bubble, i) => (
            <p key={i} className="zone-text">
              {richText(bubble.text)}
            </p>
          ))}
          <Disclosure title={t('district.view.adjust')}>{form}</Disclosure>
          <Disclosure title={t('district.view.showDetails')}>
            {[current, ...alternativesOf(result)].map((r) => (
              <RotationCard key={r.id + r.nombre} rotation={r} isCurrent={r === current} best={r === best} prioritized={result.prioridades.length > 0} />
            ))}
          </Disclosure>
        </>
      ) : (
        <>
          {form}
          {result.preguntar.length > 0 && (
            <div className="callout is-warn">
              <strong>{t('district.view.ask')}:</strong>
              <Lines lines={result.preguntar.map((q) => `${q.pregunta} ${q.por_que}`)} />
            </div>
          )}
          {result.nota_opciones && <p className="callout is-warn">{result.nota_opciones}</p>}
          {[current, ...alternativesOf(result)].map((r) => (
            <RotationCard key={r.id + r.nombre} rotation={r} isCurrent={r === current} best={r === best} prioritized={result.prioridades.length > 0} />
          ))}
          <Disclosure title={t('district.view.placeTitle')}>
            <Lines lines={[...result.tu_lugar, ...result.lugar.notas]} />
          </Disclosure>
          <Disclosure title={t('district.view.trends')}>
            <Lines lines={result.tendencias.lineas} />
          </Disclosure>
          {result.agua_region && (
            <Disclosure title={t('district.view.waterRegion')}>
              <Lines lines={result.agua_region.lineas} />
            </Disclosure>
          )}
          <Disclosure title={t('district.view.niche')}>
            <p>{result.cultivos_de_nicho.nota}</p>
            <Lines lines={result.cultivos_de_nicho.cultivos} />
            {result.no_evaluadas.length > 0 && (
              <>
                <h3>{t('district.view.notEvaluated')}</h3>
                <Lines lines={result.no_evaluadas.map((x) => `${x.secuencia}: ${x.motivo}`)} />
              </>
            )}
          </Disclosure>
          <Disclosure title={t('district.view.general')}>
            <p>{result.como_leer}</p>
            <Lines lines={[...result.vacios_generales, result.costos.nota]} />
          </Disclosure>
        </>
      )}
      {!simple && <p className="muted">{result.aviso}</p>}
    </section>
  )
}
