import { DataTable } from './DataTable.tsx'
import { MonthlyBars, TimeLine } from '../../components/DataCharts.tsx'
import { useI18n } from '../../i18n/index.tsx'
import { climateYears, mean, meanTemperatureC, monthlySeries, passing, soilDepths, soilProperties, soilValue, stats, type Environment, type Zone } from '../../lib/environment.ts'
import { Disclosure } from './Disclosure.tsx'
import '../../near.css'

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

function useShow() {
  const { t, fmt } = useI18n()
  const dash = '—'
  return {
    t,
    fmt,
    /** A number with its decimals, or a dash where the file has no value: never a zero. */
    n: (value: number | null | undefined, digits = 0) => (value === null || value === undefined ? dash : fmt.number(value, digits)),
    /** A sentence the builder wrote in English, in the language of the app when it is a known one. */
    known: (text: string) => {
      const key = `env.known.${slug(text)}`
      const translated = t(key)
      return translated === key ? text : translated
    },
    day: (date: string) => date.slice(0, 10),
  }
}

function Summary({ environment }: { environment: Environment }) {
  const { t, fmt, n } = useShow()
  const years = climateYears(environment)
  const rain = environment.climate.annual
    .filter((row) => row.rainMm !== null)
    .map((row) => t('env.year', { year: row.year, mm: fmt.number(row.rainMm!, 0) }))
    .join(' · ')
  const ph = soilValue(environment, 'phh2o', '0-5cm')?.value ?? null
  const clay = soilValue(environment, 'clay', '0-5cm')?.value ?? null
  const sand = soilValue(environment, 'sand', '0-5cm')?.value ?? null
  return (
    <dl className="env-summary">
      <div>
        <dt>{t('env.summary.rain')}</dt>
        <dd>{rain || (years.length ? '—' : '—')}</dd>
      </div>
      <div>
        <dt>{t('env.summary.temp')}</dt>
        <dd>{t('env.summary.tempValue', { mean: n(meanTemperatureC(environment), 1) })}</dd>
      </div>
      <div>
        <dt>{t('env.summary.soil')}</dt>
        <dd>{t('env.summary.soilValue', { ph: n(ph, 1), clay: n(clay, 0), sand: n(sand, 0) })}</dd>
      </div>
      <div>
        <dt>{t('env.summary.terrain')}</dt>
        <dd>{t('env.summary.terrainValue', { m: n(environment.terrain.elevationM, 0), slope: n(environment.terrain.slopeDeg, 1) })}</dd>
      </div>
    </dl>
  )
}

function Climate({ environment }: { environment: Environment }) {
  const { t, fmt, n } = useShow()
  const years = climateYears(environment)
  const range = (values: (number | null)[]) => {
    const s = stats(values)
    return s ? `${fmt.number(s.min, 0)}–${fmt.number(s.max, 0)}` : '—'
  }
  const rain = years.map((year) => ({ name: String(year), values: monthlySeries(environment, year, 'rainMm') }))
  const temp = years.map((year) => ({ name: String(year), values: monthlySeries(environment, year, 'tmeanC') }))
  return (
    <>
      <h3>{t('env.climate.rainChart')}</h3>
      <MonthlyBars series={rain} label={t('env.climate.chartLabel', { what: t('env.climate.rainChart'), range: rain.map((s) => `${s.name}: ${range(s.values)}`).join('; ') })} />
      <h3>{t('env.climate.tempChart')}</h3>
      <MonthlyBars series={temp} label={t('env.climate.chartLabel', { what: t('env.climate.tempChart'), range: temp.map((s) => `${s.name}: ${range(s.values)}`).join('; ') })} />
      <h3>{t('env.climate.annual')}</h3>
      <DataTable
        head={['', ...environment.climate.annual.map((row) => String(row.year))]}
        rows={[
          [t('env.climate.rain'), ...environment.climate.annual.map((row) => n(row.rainMm, 0))],
          [t('env.climate.dryDays'), ...environment.climate.annual.map((row) => n(row.dryDays))],
          [t('env.climate.longestDry'), ...environment.climate.annual.map((row) => n(row.longestDryRunDays))],
          [t('env.climate.frost'), ...environment.climate.annual.map((row) => n(row.frostDays))],
          [t('env.climate.heat'), ...environment.climate.annual.map((row) => n(row.heatDays))],
          [t('env.climate.gdd'), ...environment.climate.annual.map((row) => n(row.gddBase10))],
        ]}
      />
      <p className="muted">{t('env.climate.source')}</p>
    </>
  )
}

function Soil({ environment }: { environment: Environment }) {
  const { t, n } = useShow()
  const depths = soilDepths(environment)
  return (
    <>
      <p className="muted">{t('env.soil.note')}</p>
      <DataTable
        head={[t('env.soil.property'), ...depths.map((depth) => depth.replace('-', '–').replace('cm', ' cm'))]}
        rows={soilProperties(environment).map((property) => {
          const unit = soilValue(environment, property, depths[0])?.unit ?? ''
          return [`${t(`env.soil.property_.${property}`)}${unit ? ` (${unit})` : ''}`, ...depths.map((depth) => n(soilValue(environment, property, depth)?.value, property === 'phh2o' || property === 'bdod' ? 2 : 1))]
        })}
      />
    </>
  )
}

function Vegetation({ environment }: { environment: Environment }) {
  const { t, fmt, n } = useShow()
  const good = passing(environment.vegetation)
  const s = stats(good.map((row) => row.ndvi))
  return (
    <>
      <p className="muted">{t('env.vegetation.note')}</p>
      <TimeLine label={t('env.vegetation.chart')} decimals={2} series={[{ name: 'NDVI', points: environment.vegetation.map((row) => ({ date: row.date, value: row.qaPass ? row.ndvi : null })) }]} />
      {s && <p>{t('env.vegetation.range', { min: fmt.number(s.min, 2), max: fmt.number(s.max, 2), mean: fmt.number(s.mean, 2), n: s.count })}</p>}
      <p className="muted">EVI: {n(mean(good.map((row) => row.evi)), 2)}</p>
    </>
  )
}

function Water({ environment }: { environment: Environment }) {
  const { t, fmt, n, day } = useShow()
  const good = passing(environment.evapotranspiration)
  const ratio = mean(good.map((row) => row.ratio))
  const moisture = environment.soilMoisture[0]
  const rain = environment.gpm[0]
  return (
    <>
      <TimeLine label={t('env.water.chart')} series={[
        { name: t('env.water.et'), points: environment.evapotranspiration.map((row) => ({ date: row.date, value: row.qaPass ? row.etMmDay : null })) },
        { name: t('env.water.pet'), points: environment.evapotranspiration.map((row) => ({ date: row.date, value: row.qaPass ? row.petMmDay : null })) },
      ]} />
      <p className="muted">{t('env.water.chart')}</p>
      {ratio !== null && <p>{t('env.water.ratio', { ratio: fmt.number(ratio, 2), n: good.length })}</p>}
      {moisture && <p>{t('env.water.moisture', { surface: n(moisture.surface, 2), root: n(moisture.rootzone, 2), at: day(moisture.at) })}</p>}
      {rain && <p>{t('env.water.gpm', { date: rain.date, mm: n(rain.totalMm, 1), max: n(rain.max30minMm, 1) })}</p>}
    </>
  )
}

function Surface({ environment }: { environment: Environment }) {
  const { t } = useShow()
  return (
    <>
      <p className="muted">{t('env.surface.note')}</p>
      <TimeLine label={t('env.surface.chart')} series={[
        { name: t('env.surface.day'), points: environment.surfaceTemperature.map((row) => ({ date: row.date, value: row.dayQaPass ? row.dayC : null })) },
        { name: t('env.surface.night'), points: environment.surfaceTemperature.map((row) => ({ date: row.date, value: row.nightQaPass ? row.nightC : null })) },
      ]} />
    </>
  )
}

function Country({ environment }: { environment: Environment }) {
  const { t, n } = useShow()
  const indicators = [...new Set(environment.country.map((row) => row.indicator))]
  const years = [...new Set(environment.country.map((row) => row.year))].sort((a, b) => b - a).slice(0, 6).reverse()
  const value = (indicator: string, year: number) => environment.country.find((row) => row.indicator === indicator && row.year === year)?.value ?? null
  return (
    <>
      <p className="muted">{t('env.country.note')}</p>
      <DataTable
        head={['', ...years.map(String)]}
        rows={indicators.map((indicator) => [t(`env.country.indicator.${indicator}`) === `env.country.indicator.${indicator}` ? indicator : t(`env.country.indicator.${indicator}`), ...years.map((year) => n(value(indicator, year), 1))])}
      />
    </>
  )
}

function Quality({ environment }: { environment: Environment }) {
  const { t, known } = useShow()
  const label = (path: string, key: string) => {
    const text = t(`${path}.${key}`)
    return text === `${path}.${key}` ? key : text
  }
  // the sources that gave data, and what the data supports; the limits are the ones that apply to any result
  const used = environment.sources.filter((source) => source.status === 'available' || source.status === 'partial')
  const ready = environment.readiness.filter((gate) => gate.ready)
  return (
    <>
      <p>
        {t('env.quality.build', {
          state: label('env.quality.buildState', environment.buildState),
          integrity: t(environment.integrityOk ? 'env.quality.ok' : 'env.quality.notOk'),
          qa: t(environment.qaOk ? 'env.quality.ok' : 'env.quality.notOk'),
          run: environment.runId,
          date: environment.createdUtc.slice(0, 10),
        })}
      </p>
      <h3>{t('env.quality.sources')}</h3>
      <ul className="near-all">
        {used.map((source) => (
          <li key={source.key}>
            <strong>{label('env.quality.source', source.key)}</strong>
            {source.provider && <span className="muted">{source.provider}</span>}
          </li>
        ))}
      </ul>
      <h3>{t('env.quality.readiness')}</h3>
      <ul>
        {ready.map((gate) => (
          <li key={gate.key}>{label('env.quality.gate', gate.key)}</li>
        ))}
      </ul>
      <h3>{t('env.quality.limitations')}</h3>
      <ul>
        {[...environment.limitations, ...environment.notes].map((text) => (
          <li key={text}>{known(text)}</li>
        ))}
      </ul>
    </>
  )
}

/**
 * The environmental data the source builder gathered for a place: the main facts first, then each family of data in its
 * own section. It says plainly that these are satellite and model grids for a point, not measurements of a parcel.
 */
export function EnvironmentPanel({ zone }: { zone: Zone }) {
  const { t } = useI18n()
  const environment = zone.environment
  if (!environment) return null
  return (
    <section className="env" aria-labelledby="env-title">
      <h2 id="env-title">{t('env.title', { place: zone.name })}</h2>
      <p className="muted">{t('env.lede', { from: environment.period.from, to: environment.period.to })}</p>
      <Summary environment={environment} />
      <Disclosure title={t('env.climate.title')}>
        <Climate environment={environment} />
      </Disclosure>
      <Disclosure title={t('env.soil.title')}>
        <Soil environment={environment} />
      </Disclosure>
      <Disclosure title={t('env.terrain.title')}>
        <p>{t('env.terrain.body', { m: environment.terrain.elevationM ?? '—', slope: environment.terrain.slopeDeg ?? '—' })}</p>
      </Disclosure>
      <Disclosure title={t('env.vegetation.title')}>
        <Vegetation environment={environment} />
      </Disclosure>
      <Disclosure title={t('env.water.title')}>
        <Water environment={environment} />
      </Disclosure>
      <Disclosure title={t('env.surface.title')}>
        <Surface environment={environment} />
      </Disclosure>
      <Disclosure title={t('env.country.title')}>
        <Country environment={environment} />
      </Disclosure>
      <Disclosure title={t('env.quality.title')}>
        <Quality environment={environment} />
      </Disclosure>
    </section>
  )
}
