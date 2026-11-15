import { useI18n } from '../../../i18n/index.tsx'
import { capitalize } from '../../../lib/format.ts'
import { OBJECTIVES } from '../../../lib/types.ts'
import type { ClassicPreset, PlannerResult, StrategyView } from '../../types.ts'
import { ResultCard } from '../ResultCard.tsx'

interface Props {
  result: PlannerResult
  gridHash: string
  onOpenPlanner: () => void
}

const CLASSIC: ClassicPreset[] = ['sustainability', 'profit']

export function PlannerResultCard({ result, gridHash, onOpenPlanner }: Props) {
  const { t, fmt } = useI18n()
  const s = result.strategy
  const classic = result.preset === 'sustainability' || result.preset === 'profit'
  const doses = Object.entries(s.doses)
  const nitrogen = (strategy: StrategyView) =>
    Object.entries(strategy.doses).map(([crop, kg]) => `${t(`crops.${crop}`)} ${t('assistant.cards.planner.nitrogenValue', { kg: fmt.number(kg) })}`).join(' · ')
  const e = result.economics

  return (
    <ResultCard
      model="planner"
      details={
        <>
          <p>{t('assistant.details.world', { world: t(`planner.world.${result.world}.name`) })}</p>
          <p>{t('assistant.details.priority', { preset: t(`assistant.presets.${result.preset}`) })}</p>
          <p>{t('assistant.details.grid', { hash: gridHash.slice(0, 10), from: result.designYears[0], to: result.designYears[1] })}</p>
          <p>{t('assistant.details.lattice', { scored: fmt.number(result.scored) })}</p>
          <h5>{t('assistant.cards.planner.detailsRange')}</h5>
          <table>
            <tbody>
              {OBJECTIVES.map((key) => (
                <tr key={key}>
                  <th scope="row">{t(`objectives.${key}.name`)}</th>
                  <td className="num">
                    {fmt.objective(key, result.ranges[key][0])} – {fmt.objective(key, result.ranges[key][1])} {t(`objectives.${key}.unit`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h5>{t('assistant.cards.planner.edited')}{result.economicsEdited ? ` (${t('assistant.settings.edited')})` : ''}</h5>
          <table>
            <tbody>
              {(['maize', 'barley', 'fababean'] as const).map((crop) => (
                <tr key={crop}>
                  <th scope="row">{t(`assistant.cards.planner.price${crop === 'maize' ? 'Maize' : crop === 'barley' ? 'Barley' : 'Fababean'}`)}</th>
                  <td className="num">{fmt.number(e.prices[crop])}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">{t('assistant.cards.planner.nPrice')}</th>
                <td className="num">{fmt.number(e.n_price, 1)}</td>
              </tr>
              <tr>
                <th scope="row">{t('assistant.cards.planner.stoverPrice')}</th>
                <td className="num">{fmt.number(e.stover_price)}</td>
              </tr>
            </tbody>
          </table>
        </>
      }
    >
      <h3 className="card-title">{t('assistant.cards.planner.title')}</h3>
      <dl className="facts">
        <div>
          <dt>{t('assistant.cards.planner.rotation')}</dt>
          <dd>{t(`rotations.${s.rotation}`)}</dd>
        </div>
        <div>
          <dt>{t('assistant.cards.planner.nitrogen')}</dt>
          <dd>{doses.length ? nitrogen(s) : '–'}</dd>
        </div>
        <div>
          <dt>{t('assistant.cards.planner.stover')}</dt>
          <dd>{fmt.percent(s.retention)}</dd>
        </div>
      </dl>

      <table className="plain">
        <caption>{t('assistant.cards.planner.outcomes', { from: result.designYears[0], to: result.designYears[1] })}</caption>
        <thead>
          <tr>
            <th scope="col">{t('assistant.cards.planner.measure')}</th>
            <th scope="col" className="num">
              {t('assistant.cards.planner.value')}
            </th>
          </tr>
        </thead>
        <tbody>
          {OBJECTIVES.map((key) => (
            <tr key={key} title={t(`objectives.${key}.hint`)}>
              <th scope="row">{t(`objectives.${key}.name`)}</th>
              <td className="num">
                {fmt.objective(key, s.values[key])} <small>{t(`objectives.${key}.unit`)}</small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="plain">
        <caption>{t('assistant.cards.planner.picks')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('assistant.cards.planner.pickName')}</th>
            <th scope="col">{t('assistant.cards.planner.rotation')}</th>
            <th scope="col" className="num">
              {t('objectives.net_mxn_ha.name')}
            </th>
          </tr>
        </thead>
        <tbody>
          {/* A priority beyond the two classic ones (yield, steady income, lower costs) gets its own row first. */}
          {[...(classic ? [] : [[result.preset, result.strategy] as const]), ...CLASSIC.map((preset) => [preset, result.picks[preset]] as const)].map(([preset, pick]) => (
            <tr key={preset} className={preset === result.preset ? 'current' : undefined}>
              <th scope="row">{capitalize(t(`assistant.presets.${preset}`))}</th>
              <td>
                {t(`rotations.${pick.rotation}`)}
                <br />
                <small>{nitrogen(pick)}</small>
              </td>
              <td className="num">{fmt.number(pick.values.net_mxn_ha)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="card-note">{t('assistant.cards.planner.front', { scored: fmt.number(result.scored), front: fmt.number(result.frontSize) })}</p>
      <button type="button" className="link" onClick={onOpenPlanner}>
        {t('assistant.cards.planner.open')} →
      </button>
    </ResultCard>
  )
}
