// Turns a FarmProfile run (the environmental package the source builder publishes to gs://gdfarming-farm-data, see
// gradientdescentfarmers/source_builder/README.md) into the compact file the app and the WhatsApp server read:
// public/data/environment/<id>.json.
//
//   node scripts/slim-profile.mjs <demo-location-id> <path/to/profile-run-folder>
//   node scripts/slim-profile.mjs sonora ~/Downloads/mexico_norte_02/runs/9849d2f76f944625
//
// It keeps every table of the profile (climate, daily weather, soil, terrain, vegetation, evapotranspiration, surface
// temperature, soil moisture, GPM rain, World Bank context), the status of every source, the model-readiness gates, the
// blockers and the limitations. Values are copied; numbers are rounded only to keep the file small (2-3 decimals).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { readCsv } from './csv.mjs'

const [id, dir] = process.argv.slice(2)
if (!id || !dir) {
  console.error('usage: node scripts/slim-profile.mjs <guanajuato|sinaloa|sonora> <profile-run-folder>')
  process.exit(1)
}

const json = (name) => JSON.parse(readFileSync(join(dir, name), 'utf8'))
const csv = (name) => readCsv(join(dir, 'standardized', name))

const num = (value, digits = 2) => {
  if (value === '' || value === undefined || value === null) return null
  const n = Number(value)
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null
}
const flag = (value) => String(value).toLowerCase() === 'true'
const day = (value) => String(value).slice(0, 10)

const profile = json('farm_profile.json')
const availability = json('availability.json')
const readiness = json('model_readiness.json')
const handoff = json('handoff_report.json')
const audit = json('audit_report.json')

const weather = csv('weather_daily.csv')
const slim = {
  version: 1,
  farmId: profile.farmer_inputs.farm_id,
  runId: profile.run_id,
  createdUtc: profile.created_utc,
  builderVersion: profile.builder_version,
  buildState: profile.build_state,
  integrityOk: audit.integrity_ok === true,
  qaOk: audit.qa_ok === true,
  latitude: profile.farmer_inputs.latitude,
  longitude: profile.farmer_inputs.longitude,
  country: profile.farmer_inputs.country_iso3,
  period: { from: day(weather[0].date), to: day(weather[weather.length - 1].date) },
  climate: {
    monthly: csv('climate_monthly_features.csv').map((r) => ({
      year: num(r.year, 0),
      month: num(r.month, 0),
      rainMm: num(r.precip_observed_mm),
      tmeanC: num(r.tmean_c),
      tminC: num(r.tmin_c),
      tmaxC: num(r.tmax_c),
    })),
    annual: csv('climate_annual_features.csv').map((r) => ({
      year: num(r.year, 0),
      rainMm: num(r.total_precip_observed_mm, 1),
      rainCoveragePct: num(r.rain_coverage_pct, 1),
      fullYear: flag(r.is_full_calendar_year),
      dryDays: num(r.dry_days_observed, 0),
      longestDryRunDays: num(r.longest_dry_run_days, 0),
      frostDays: num(r.frost_days_observed, 0),
      heatDays: num(r.heat_days_observed, 0),
      gddBase10: num(r.gdd_base10_approx_observed, 0),
    })),
  },
  // one column per variable, one entry per day from `start`
  daily: {
    start: day(weather[0].date),
    days: weather.length,
    rainMm: weather.map((r) => num(r.precip_mm)),
    tmeanC: weather.map((r) => num(r.tmean_c)),
    tminC: weather.map((r) => num(r.tmin_c)),
    tmaxC: weather.map((r) => num(r.tmax_c)),
    humidityPct: weather.map((r) => num(r.rh_pct, 1)),
    windMs: weather.map((r) => num(r.wind_m_s)),
    solarMjM2: weather.map((r) => num(r.solar_mj_m2_day, 1)),
  },
  soil: csv('soil_properties_raw.csv').map((r) => ({ property: r.property, depth: r.depth, value: num(r.value, 3), unit: r.unit })),
  terrain: {
    elevationM: profile.topography.elevation_m,
    slopeDeg: num(profile.topography.slope_deg_approx, 2),
    samples: csv('topography_samples.csv').map((r) => ({ sample: r.sample, elevationM: num(r.elevation_m, 1) })),
  },
  vegetation: csv('vegetation_timeseries.csv').map((r) => ({ date: day(r.date), ndvi: num(r.ndvi, 4), evi: num(r.evi, 4), qaPass: flag(r.qa_pass) })),
  evapotranspiration: csv('evapotranspiration.csv').map((r) => ({
    date: day(r.date),
    periodDays: num(r.period_days, 0),
    etMmDay: num(r.et_mm_day, 3),
    petMmDay: num(r.pet_mm_day, 3),
    ratio: num(r.et_pet_ratio, 3),
    qaPass: flag(r.qa_pass),
  })),
  surfaceTemperature: csv('land_surface_temperature.csv').map((r) => ({
    date: day(r.date),
    dayC: num(r.lst_day_c, 2),
    nightC: num(r.lst_night_c, 2),
    dayQaPass: flag(r.day_qa_pass),
    nightQaPass: flag(r.night_qa_pass),
  })),
  soilMoisture: csv('soil_moisture_timeseries.csv').map((r) => ({
    at: r.datetime_utc.replace(' ', 'T'),
    surface: num(r.soil_moisture_surface_m3_m3, 4),
    rootzone: num(r.soil_moisture_rootzone_m3_m3, 4),
    cellLat: num(r.cell_lat, 4),
    cellLon: num(r.cell_lon, 4),
  })),
  gpm: csv('gpm_daily.csv').map((r) => ({
    date: day(r.date_utc),
    totalMm: num(r.precip_total_mm, 2),
    max30minMm: num(r.max_30min_mm, 2),
    slots: num(r.slots, 0),
    validSlots: num(r.valid_slots, 0),
    complete: flag(r.complete_48_slots),
  })),
  country: csv('country_agriculture_context.csv').map((r) => ({ indicator: r.indicator, year: num(r.year, 0), value: num(r.value, 2), unit: r.unit })),
  sources: Object.entries(profile.source_status).map(([key, status]) => ({
    key,
    status: typeof status === 'string' ? status : (status?.status ?? 'unknown'),
    provider: availability[key]?.provider ?? null,
    rows: availability[key]?.rows ?? null,
    coverage: availability[key]?.coverage ?? null,
  })),
  readiness: Object.entries(readiness).map(([key, value]) => ({ key, ready: value.ready === true, reason: value.reason })),
  blockers: handoff.wofost_blockers,
  notes: handoff.notes,
  limitations: profile.limitations,
  // what the models still lack: nothing here was imputed
  missingInputs: {
    cropParameters: csv('crop_parameter_requirements.csv').filter((r) => r.parameter_validation === 'missing').map((r) => r.crop),
    prices: csv('economic_input_requirements.csv').filter((r) => r.status === 'missing').map((r) => r.crop),
    practices: csv('management_options.csv').filter((r) => r.model_parameter_status === 'missing').map((r) => r.practice),
  },
}

const out = new URL(`../public/data/environment/${id}.json`, import.meta.url)
mkdirSync(new URL('./', out), { recursive: true })
writeFileSync(out, `${JSON.stringify(slim)}\n`)
console.log(`wrote ${fileURLToPath(out)} (${(JSON.stringify(slim).length / 1024).toFixed(1)} KiB, run ${slim.runId}, ${slim.daily.days} days)`)
if (!existsSync(join(dir, 'standardized'))) console.warn('warning: no standardized/ folder found')
