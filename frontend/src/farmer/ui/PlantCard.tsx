// The planting answer for a place with rotation results, drawn so a farmer can read it at a glance: the plan as steps, three
// figures that matter, and what the model says about itself. Nothing here is computed beyond rounding: every figure and every
// sentence of the service is still on the page, word for word, under "see all the data".
import { cropName, describeOption } from '../../lib/rotationText.ts'
import { topIncomeOption, type Rotations, type RotationOption } from '../../lib/rotations.ts'
import { caution, chosen, irrigationComparison, label, monthOf, money, optionLines, regimeName, regimesFor, type Ctx } from '../../whatsapp/rotationAnswers.ts'
import { richText } from '../../whatsapp/format.tsx'

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

function PlanCard({ option, eyebrow, rotations, ctx }: { option: RotationOption; eyebrow: string; rotations: Rotations; ctx: Ctx }) {
  const { t, fmt } = ctx
  const lang = ctx.lang ?? 'es'
  const risky = option.advisoryStatus === 'high_risk_experiment'
  const { gross } = option
  const low = gross?.p10 != null ? money(gross.p10, ctx) : null
  const high = gross?.p90 != null ? money(gross.p90, ctx) : null
  const comparison = irrigationComparison(option, ctx, rotations)
  return (
    <section className={`plan-card${risky ? ' risky' : ''}`}>
      <p className="plan-eyebrow">{eyebrow}</p>
      <ol className="plan-steps" aria-label={t('whatsapp.rotations.card.planTitle')}>
        {option.campaigns.map((campaign, i) => (
          <li key={i} className={campaign.fallow ? 'fallow' : undefined}>
            <span className="plan-year">{t('whatsapp.rotations.card.year', { n: campaign.planningYear })}</span>
            <strong>{capital(cropName(campaign.cropEs, lang))}</strong>
            <span className="plan-months">
              {campaign.fallow ? `${t('whatsapp.rotations.card.fallow')} · ` : ''}
              {fmt.monthShort(monthOf(campaign.sowing))}–{fmt.monthShort(monthOf(campaign.end))}
            </span>
          </li>
        ))}
      </ol>
      <p className={`plan-note${risky ? ' warn' : ''}`}>{t(`whatsapp.rotations.status.${option.advisoryStatus}`)}</p>
      <dl className="plan-tiles">
        <div>
          <dt>{t('whatsapp.rotations.card.incomeLabel')}</dt>
          <dd className="plan-big">{t('whatsapp.rotations.card.incomeValue', { amount: money(gross?.median ?? null, ctx) })}</dd>
          <dd>{t('whatsapp.rotations.card.incomeNote')}</dd>
          {low !== null && high !== null && low !== high && <dd>{t('whatsapp.rotations.card.incomeRange', { low, high })}</dd>}
        </div>
        <div>
          <dt>{t('whatsapp.rotations.card.waterLabel')}</dt>
          {option.regime === 'rainfed' || option.irrigationM3Ha === null ? (
            <>
              <dd className="plan-big">{t('whatsapp.rotations.card.waterRain')}</dd>
              {option.rainfallMm !== null && <dd>{t('whatsapp.rotations.card.waterRainNote', { mm: fmt.number(Math.round(option.rainfallMm)) })}</dd>}
            </>
          ) : (
            <>
              <dd className="plan-big">{t('whatsapp.rotations.card.waterIrrigated', { m3: fmt.number(Math.round(option.irrigationM3Ha)) })}</dd>
              <dd>{comparison ?? t('whatsapp.rotations.card.waterIrrigatedNote')}</dd>
            </>
          )}
        </div>
        {option.priorityScore !== null && (
          <div>
            <dt>{t('whatsapp.rotations.card.fitLabel')}</dt>
            <dd className="plan-big">{t('whatsapp.rotations.card.fitValue', { score: fmt.number(Math.round(option.priorityScore)) })}</dd>
            <dd>{t('whatsapp.rotations.card.fitNote')}</dd>
          </div>
        )}
      </dl>
      <details className="plan-more">
        <summary>{t('whatsapp.rotations.card.more')}</summary>
        <p className="zone-text">{richText([describeOption(option, lang, fmt), ...optionLines(option, ctx, rotations)].join('\n'))}</p>
      </details>
    </section>
  )
}

/** The planting answer: the option for the farmer's water first, the other under a one-line summary, then the model's own caution. */
export function PlantAnswer({ rotations, ctx, compare }: { rotations: Rotations; ctx: Ctx; compare: boolean }) {
  const { t } = ctx
  const regimes = regimesFor(ctx)
  return (
    <>
      <p className="zone-text muted">{label(rotations, ctx).text}</p>
      {regimes.map((regime, index) => {
        const option = chosen(rotations, regime, ctx)
        if (!option) return null
        const eyebrow = `${regimeName(regime, ctx)} · ${ctx.goal ? t('whatsapp.rotations.card.eyebrowGoal', { goal: t(`farmer.rec.goals.${ctx.goal}`) }) : t('whatsapp.rotations.card.eyebrowBest')}`
        const top = compare ? topIncomeOption(rotations, regime) : null
        const cards = (
          <>
            <PlanCard option={option} eyebrow={eyebrow} rotations={rotations} ctx={ctx} />
            {top && top.id !== option.id && <PlanCard option={top} eyebrow={`${regimeName(regime, ctx)} · ${t('whatsapp.rotations.card.eyebrowTop')}`} rotations={rotations} ctx={ctx} />}
          </>
        )
        // the regime the farmer says they have is open; the other is one line until it is asked for
        return index === 0 ? (
          <div key={regime}>{cards}</div>
        ) : (
          <details key={regime} className="plan-other">
            <summary>
              {t('whatsapp.rotations.card.alsoIf', { regime: regimeName(regime, ctx).toLowerCase() })}
              {option.gross?.median != null && ` · ${t('whatsapp.rotations.card.alsoIncome', { amount: money(option.gross.median, ctx) })}`}
            </summary>
            {cards}
          </details>
        )
      })}
      <p className="zone-text muted">{caution(rotations, ctx).text}</p>
    </>
  )
}
