// What the chat says about a place's environmental data (climate, soil and terrain, satellite series, and where the data
// comes from), quoted from the package the source builder published for it. Nothing is computed beyond sums, means and
// ranges of the file's own values. Every answer says these are satellite and model grids for a point, not measurements of
// the parcel, and a missing value reads "sin datos", never zero.

import type { Format } from '../lib/format.ts'
import { climateYears, mean, meanTemperatureC, monthlySeries, passing, soilValue, stats, type Environment } from '../lib/environment.ts'
import type { BotBubble } from './engine.ts'

type T = (path: string, vars?: Record<string, string | number>) => string

/** The topics about a place's data. */
export type EnvironmentTopic = 'climate' | 'soil' | 'satellite' | 'sources'

interface Ctx {
  t: T
  fmt: Format
}

const bold = (text: string) => `*${text}*`

const none = ({ t }: Ctx) => t('whatsapp.env.noData')
const num = (value: number | null | undefined, digits: number, ctx: Ctx) => (value === null || value === undefined ? none(ctx) : ctx.fmt.number(value, digits))

/** Mid-sentence lists read better in lower case, but names such as "NASA POWER" keep their capitals. */
const lowerFirstUnlessAcronym = (text: string) => (/^[A-Z]{2,}/.test(text) ? text : text.charAt(0).toLowerCase() + text.slice(1))

const label = (path: string, key: string, t: T) => {
  const text = t(`${path}.${key}`)
  return text === `${path}.${key}` ? key : text
}

const head = (place: string, environment: Environment, { t }: Ctx): BotBubble => ({ text: t('whatsapp.env.label', { place, from: environment.period.from, to: environment.period.to }) })

/** The three months with the most (or highest) values, averaged over the years, in calendar order. */
function topMonths(environment: Environment, key: 'rainMm' | 'tmeanC', ctx: Ctx): string {
  const years = climateYears(environment)
  const averages = Array.from({ length: 12 }, (_, month) => mean(years.map((year) => monthlySeries(environment, year, key)[month])))
  const ranked = averages.map((value, month) => ({ value, month })).filter((row): row is { value: number; month: number } => row.value !== null).sort((a, b) => b.value - a.value).slice(0, 3)
  return ranked.sort((a, b) => a.month - b.month).map((row) => ctx.fmt.monthShort(row.month)).join(', ')
}

function climate(place: string, environment: Environment, ctx: Ctx): BotBubble[] {
  const { t } = ctx
  const rain = environment.climate.annual.map((row) => t('whatsapp.env.rainYear', { year: row.year, mm: num(row.rainMm, 0, ctx), dry: num(row.dryDays, 0, ctx), run: num(row.longestDryRunDays, 0, ctx) }))
  const lines = [
    bold(t('env.climate.title')),
    ...rain,
    t('whatsapp.env.temperature', { mean: num(meanTemperatureC(environment), 1, ctx) }),
    t('whatsapp.env.wettest', { months: topMonths(environment, 'rainMm', ctx) }),
    t('whatsapp.env.hottest', { months: topMonths(environment, 'tmeanC', ctx) }),
    t('whatsapp.env.extremes', { frost: environment.climate.annual.map((row) => `${row.year}: ${num(row.frostDays, 0, ctx)}`).join(', '), heat: environment.climate.annual.map((row) => `${row.year}: ${num(row.heatDays, 0, ctx)}`).join(', ') }),
  ]
  return [head(place, environment, ctx), { text: lines.join('\n') }, { text: t('whatsapp.env.climateNote') }]
}

function soil(place: string, environment: Environment, ctx: Ctx): BotBubble[] {
  const { t } = ctx
  const at = (property: string, depth: string, digits = 1) => num(soilValue(environment, property, depth)?.value, digits, ctx)
  const layer = (depth: string) =>
    t('whatsapp.env.soilLayer', {
      depth: depth.replace('-', '–').replace('cm', ' cm'),
      ph: at('phh2o', depth, 1),
      clay: at('clay', depth, 0),
      sand: at('sand', depth, 0),
      carbon: at('soc', depth, 1),
      nitrogen: at('nitrogen', depth, 1),
      field: at('wv0033', depth, 0),
      wilting: at('wv1500', depth, 0),
    })
  const lines = [bold(t('env.soil.title')), layer('0-5cm'), layer('15-30cm'), t('whatsapp.env.terrain', { m: num(environment.terrain.elevationM, 0, ctx), slope: num(environment.terrain.slopeDeg, 1, ctx) })]
  return [head(place, environment, ctx), { text: lines.join('\n') }, { text: t('whatsapp.env.soilNote') }]
}

function satellite(place: string, environment: Environment, ctx: Ctx): BotBubble[] {
  const { t, fmt } = ctx
  const ndvi = stats(passing(environment.vegetation).map((row) => row.ndvi))
  const ratio = mean(passing(environment.evapotranspiration).map((row) => row.ratio))
  const day = mean(environment.surfaceTemperature.filter((row) => row.dayQaPass).map((row) => row.dayC))
  const night = mean(environment.surfaceTemperature.filter((row) => row.nightQaPass).map((row) => row.nightC))
  const moisture = environment.soilMoisture[0]
  const rain = environment.gpm[0]
  const lines = [bold(t('env.vegetation.title'))]
  if (ndvi) lines.push(t('env.vegetation.range', { min: fmt.number(ndvi.min, 2), max: fmt.number(ndvi.max, 2), mean: fmt.number(ndvi.mean, 2), n: ndvi.count }))
  if (ratio !== null) lines.push(t('whatsapp.env.evapotranspiration', { ratio: fmt.number(ratio, 2) }))
  lines.push(t('whatsapp.env.surfaceTemperature', { day: num(day, 1, ctx), night: num(night, 1, ctx) }))
  if (moisture) lines.push(t('env.water.moisture', { surface: num(moisture.surface, 2, ctx), root: num(moisture.rootzone, 2, ctx), at: moisture.at.slice(0, 10) }))
  if (rain) lines.push(t('env.water.gpm', { date: rain.date, mm: num(rain.totalMm, 1, ctx), max: num(rain.max30minMm, 1, ctx) }))
  return [head(place, environment, ctx), { text: lines.join('\n') }, { text: t('whatsapp.env.satelliteNote') }]
}

function sources(place: string, environment: Environment, ctx: Ctx): BotBubble[] {
  const { t } = ctx
  const used = environment.sources.filter((source) => source.status === 'available' || source.status === 'partial').map((source) => lowerFirstUnlessAcronym(label('env.quality.source', source.key, t)))
  const supports = environment.readiness.filter((gate) => gate.ready).map((gate) => lowerFirstUnlessAcronym(label('env.quality.gate', gate.key, t)))
  const build = t('env.quality.build', {
    state: label('env.quality.buildState', environment.buildState, t),
    integrity: t(environment.integrityOk ? 'env.quality.ok' : 'env.quality.notOk'),
    qa: t(environment.qaOk ? 'env.quality.ok' : 'env.quality.notOk'),
    run: environment.runId,
    date: environment.createdUtc.slice(0, 10),
  })
  return [head(place, environment, ctx), { text: [bold(t('env.quality.sources')), t('whatsapp.env.sourcesUsed', { list: used.join(', ') })].join('\n') }, { text: [bold(t('env.quality.readiness')), t('whatsapp.env.supports', { list: supports.join(', ') })].join('\n') }, { text: build }]
}

/** The bubbles that answer one topic about a place's data. */
export function environmentBubbles(topic: EnvironmentTopic, place: string, environment: Environment, ctx: Ctx): BotBubble[] {
  switch (topic) {
    case 'climate':
      return climate(place, environment, ctx)
    case 'soil':
      return soil(place, environment, ctx)
    case 'satellite':
      return satellite(place, environment, ctx)
    case 'sources':
      return sources(place, environment, ctx)
  }
}

/** One line on what was observed in the place, for the rain question: the years' rain, dry spells and frost. */
export function observedRain(environment: Environment, ctx: Ctx): BotBubble | null {
  const { t } = ctx
  if (environment.climate.annual.length === 0) return null
  const years = environment.climate.annual.map((row) => t('whatsapp.env.rainYear', { year: row.year, mm: num(row.rainMm, 0, ctx), dry: num(row.dryDays, 0, ctx), run: num(row.longestDryRunDays, 0, ctx) }))
  return { text: [t('whatsapp.env.observed'), ...years].join('\n') }
}
