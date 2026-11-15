// Turns the rotations service's rotations.json (see gradientdescentfarmers/rotations_service/README.md) into the small
// file the app and the WhatsApp server read: public/data/rotations/<id>.json.
//
//   node scripts/slim-rotations.mjs <demo-location-id> <path/to/rotations.json>
//   node scripts/slim-rotations.mjs sinaloa ~/Downloads/mexico_norte_01/rotations.json
//
// It keeps only what the answers quote (options, calendars, gross income, irrigation, confidence and its reasons) and
// drops the server paths, hashes and per-year price tables. Nothing is computed or estimated: every number is copied.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readCsv } from './csv.mjs'

const [id, source] = process.argv.slice(2)
if (!id || !source) {
  console.error('usage: node scripts/slim-rotations.mjs <guanajuato|sinaloa|sonora> <rotations.json>')
  process.exit(1)
}

const raw = JSON.parse(readFileSync(source, 'utf8'))
if (String(raw.schema_version) !== '1.0') throw new Error(`unsupported schema_version ${raw.schema_version}`)

// The other files of the same run folder, when they are next to rotations.json: the prices the scenarios used, the soil
// model, the rejected simulations and how the run was set up.
const folder = dirname(source)
const sibling = (name) => (existsSync(join(folder, name)) ? join(folder, name) : null)
const siblingJson = (name) => (sibling(name) ? JSON.parse(readFileSync(sibling(name), 'utf8')) : null)

const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

const slim = {
  version: 1,
  farmId: raw.farm_id,
  sourceRunId: raw.source_run_id,
  rotationRunId: raw.rotation_run_id,
  generatedAt: raw.generated_at,
  status: raw.status,
  basis: raw.planning_basis,
  municipality: raw.geography?.nomgeo ?? null,
  confidence: {
    overall: raw.confidence.overall,
    labelEs: raw.confidence.label_es,
    reasonsEs: raw.confidence.reasons_es,
    fieldValidated: raw.confidence.field_validated === true,
    probabilityOfSuccess: number(raw.confidence.probability_of_success),
  },
  weatherYears: raw.confidence.weather_record_years,
  best: {
    irrigated: raw.optimization?.groups?.irrigated?.best_by_priorities ?? null,
    rainfed: raw.optimization?.groups?.rainfed?.best_by_priorities ?? null,
  },
  options: raw.options.map((option) => ({
    id: option.option_id,
    regime: option.water_regime,
    descriptionEs: option.description_es,
    priorityScore: number(option.priority_score),
    irrigationM3Ha: number(option.irrigation_gross_m3_ha),
    evapotranspirationMm: number(option.evapotranspiration_mm),
    soilScore: number(option.indicators?.soil_proxy_score),
    failedHarvests: option.failed_harvests,
    requiresIrrigationConfirmation: option.requires_irrigation_confirmation === true,
    highlightsEs: option.highlights_es,
    gross: option.economics?.available
      ? { median: number(option.economics.gross_median_mxn_ha), p10: number(option.economics.gross_p10_mxn_ha), p90: number(option.economics.gross_p90_mxn_ha) }
      : null,
    campaigns: option.campaigns.map((campaign) => ({
      cropEs: campaign.crop_label,
      fallow: campaign.crop === null,
      planningYear: campaign.planning_year,
      sowing: campaign.sowing_month_day,
      end: campaign.calendar_end_month_day,
      grainTHa: campaign.crop === null ? null : number(campaign.marketable_grain_t_ha),
      grossMxnHa: campaign.crop === null ? null : number(campaign.gross_at_median_price_mxn_ha),
    })),
  })),
}

const soilModel = siblingJson('soil_parameters.json')
const rejections = siblingJson('simulation_rejections.json')
// the settings the run actually used (defaults filled in); the request file only holds what was asked for
const provenance = siblingJson('provenance.json')
const request = provenance?.effective_model_settings ? { model: provenance.effective_model_settings } : siblingJson('request.json')
const varieties = siblingJson('crop_parameter_manifest.json')
const financial = siblingJson('financial_provenance.json')
if (sibling('economic_reference.csv') || soilModel || rejections || request || varieties || financial) {
  slim.details = {
    prices: sibling('economic_reference.csv')
      ? readCsv(sibling('economic_reference.csv')).map((r) => ({ crop: r.crop, regime: r.water_regime, year: Number(r.year), mxnPerT: number(Number(Number(r.price_mxn_t).toFixed(0))), scope: r.scope, state: r.state, cycle: r.cycle, modality: r.modality }))
      : [],
    soilModel: soilModel && {
      method: soilModel.method,
      fieldValidated: soilModel.field_validated === true,
      assumptions: soilModel.assumptions,
      inputs: soilModel.inputs,
      parameters: soilModel.parameters,
    },
    rejected: rejections && {
      modelFailures: rejections.model_failures?.length ?? 0,
      optimizationRejected: (rejections.optimization_rejected ?? []).map((r) => r.reasons),
    },
    runSettings: request && {
      crops: request.model?.crops,
      horizonYears: request.model?.horizon_years,
      waterRegimes: request.model?.water_regimes,
      irrigationEfficiency: request.model?.irrigation_efficiency,
      rootableDepthCm: request.model?.rootable_depth_cm,
      initialAvailableWaterFraction: request.model?.initial_available_water_fraction,
      priceYears: request.model?.siap_years,
    },
    cropVarieties: varieties && { fieldValidated: varieties.cultivars_field_validated === true, varieties: Object.fromEntries(Object.entries(varieties.files ?? {}).map(([crop, f]) => [crop, f.variety])) },
    priceSource: financial && { dataset: financial.dataset_url, note: financial.note, years: financial.available_years },
  }
}

const out = new URL(`../public/data/rotations/${id}.json`, import.meta.url)
mkdirSync(new URL('./', out), { recursive: true })
writeFileSync(out, `${JSON.stringify(slim, null, 1)}\n`)
console.log(`wrote ${fileURLToPath(out)} (${slim.options.length} options, run ${slim.rotationRunId})`)
