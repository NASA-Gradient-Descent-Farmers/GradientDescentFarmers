// Plain-language summary of what the models returned. Every sentence is a template filled with numbers from the
// outcomes: nothing is generated, and each one says which model it speaks for (or "combined" when it compares two).
// It runs when a message is drawn, so changing the language re-words the same results.

import { coverage, type Verdict } from '../lib/coverage.ts'
import type { Format } from '../lib/format.ts'
import type { RiskRow } from '../lib/precomputed.ts'
import type { CalibrationResult, ClassicPreset, Interpretation, ModelId, Outcome, PlannerResult, Preset, ResultMap, RiskResult, StatisticalResult, StrategyView } from './types.ts'

export interface Say {
  t: (path: string, vars?: Record<string, string | number>) => string
  fmt: Format
}

export interface SummaryItem {
  /** The model this sentence speaks for, or `combined` when it sets two models against each other. */
  source: ModelId | 'combined'
  text: string
  /** A limit the reader should keep in mind rather than a finding. */
  caution?: boolean
}

function result<M extends ModelId>(outcomes: Outcome[], model: M): ResultMap[M] | null {
  const outcome = outcomes.find((o) => o.model === model)
  return outcome && outcome.ok ? (outcome.result as ResultMap[M]) : null
}

// ---- planner ----

/** A name used inside a sentence: "Maize – faba bean" becomes "maize – faba bean". */
const inSentence = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

/** The classic pick to set beside the farmer's: the opposite end of income and soil, and soil for any other priority. */
const otherPreset = (preset: Preset): ClassicPreset => (preset === 'sustainability' ? 'profit' : 'sustainability')

const same = (a: StrategyView, b: StrategyView) => a.rotation === b.rotation && Math.abs(a.nScale - b.nScale) < 1e-9 && Math.abs(a.retention - b.retention) < 1e-9

function nitrogen({ t, fmt }: Say, strategy: StrategyView): string {
  const kg = strategy.doses.maize ?? 0
  return kg < 1 ? t('assistant.summary.noNitrogen') : t('assistant.summary.nitrogen', { kg: fmt.number(kg) })
}

function plannerItems(r: PlannerResult, say: Say): SummaryItem[] {
  const { t, fmt } = say
  const items: SummaryItem[] = []
  const s = r.strategy
  items.push({
    source: 'planner',
    text: t('assistant.summary.planner.pick', {
      world: t(`planner.world.${r.world}.name`),
      preset: t(`assistant.presets.${r.preset}`),
      rotation: inSentence(t(`rotations.${s.rotation}`)),
      nitrogen: nitrogen(say, s),
      stover: fmt.percent(s.retention),
      net: fmt.number(s.values.net_mxn_ha),
    }),
  })
  if (r.economicsEdited && r.atOriginalPrices) {
    items.push({
      source: 'planner',
      text: t('assistant.summary.planner.changed', {
        rotation: inSentence(t(`rotations.${r.atOriginalPrices.rotation}`)),
        nitrogen: nitrogen(say, r.atOriginalPrices),
        stover: fmt.percent(r.atOriginalPrices.retention),
      }),
    })
  } else if (r.economicsEdited) {
    items.push({ source: 'planner', text: t('assistant.summary.planner.unchanged') })
  }
  const alternative = r.picks[otherPreset(r.preset)]
  items.push({
    source: 'planner',
    text: same(alternative, s)
      ? t('assistant.summary.planner.sameEitherWay')
      : t('assistant.summary.planner.alternative', {
          preset: t(`assistant.presets.${otherPreset(r.preset)}`),
          rotation: inSentence(t(`rotations.${alternative.rotation}`)),
          nitrogen: nitrogen(say, alternative),
        }),
  })
  if (r.world === 'calibrated' && s.nScale < 0.05) {
    items.push({ source: 'planner', text: t('assistant.summary.planner.calibratedNote'), caution: true })
  } else if (r.world === 'default') {
    items.push({ source: 'planner', text: t('assistant.summary.planner.defaultNote'), caution: true })
  }
  items.push({ source: 'planner', text: t('assistant.summary.planner.placeholders'), caution: true })
  return items
}

// ---- climate ----

function climateItems(r: ResultMap['climate'], say: Say): SummaryItem[] {
  const { t, fmt } = say
  return [
    {
      source: 'climate',
      text: t('assistant.summary.climate.here', {
        mm: fmt.number(r.here.rainAnnualMm),
        rainDelta: `${fmt.signed(r.comparison.rainDiffShare * 100)}%`,
        temp: fmt.number(r.here.meanTempC, 1),
        tempDelta: `${fmt.signed(r.comparison.meanTempDiffC, 1)} °C`,
        min: fmt.number(r.here.lowestMinC, 1),
      }),
    },
  ]
}

// ---- risk ----

export const riskRow = (r: RiskResult, scenario: string, rotation: string): RiskRow | undefined =>
  r.rows.find((row) => row.scenario === scenario && row.rotation === rotation)

/** The rotation that beats the reference most in a scenario, if any beats it on average. */
function bestRotation(r: RiskResult, scenario: string): RiskRow | null {
  const rows = r.rows.filter((row) => row.scenario === scenario && row.rotation !== r.referenceRotation)
  const best = rows.reduce<RiskRow | null>((a, b) => (!a || b.advantage > a.advantage ? b : a), null)
  return best && best.advantage > 0 ? best : null
}

function riskItems(r: RiskResult, say: Say): SummaryItem[] {
  const { t, fmt } = say
  // The harshest scenario asked for: the one where continuous maize does worst.
  const reference = (scenario: string) => riskRow(r, scenario, r.referenceRotation)
  const asked = r.scenarios.filter((s) => reference(s))
  const harshest = asked.reduce<string | null>((a, b) => (!a || reference(b)!.meanYield < reference(a)!.meanYield ? b : a), null)
  const items: SummaryItem[] = []
  const baseline = reference('baseline')
  if (harshest && baseline) {
    const row = reference(harshest)!
    items.push({
      source: 'risk',
      text: t('assistant.summary.risk.drop', {
        scenario: t(`assistant.scenarios.${harshest}`),
        sev: fmt.number(row.meanYield, 1),
        base: fmt.number(baseline.meanYield, 1),
        fail: fmt.number(row.failedHarvestFraction * 100),
        threshold: fmt.number(r.settings.failureThresholdTHa, 0),
      }),
    })
    const best = bestRotation(r, harshest)
    if (!best) {
      items.push({ source: 'risk', text: t('assistant.summary.risk.noRotationBeats') })
    } else {
      const vars = {
        rotation: inSentence(t(`rotations.${best.rotation}`)),
        adv: fmt.number(best.advantage, 1),
        lo: fmt.signed(best.ciLow, 1),
        hi: fmt.signed(best.ciHigh, 1),
      }
      items.push({ source: 'risk', text: t(best.ciLow > 0 ? 'assistant.summary.risk.clearAdvantage' : 'assistant.summary.risk.unclearAdvantage', vars) })
    }
  } else if (baseline) {
    items.push({ source: 'risk', text: t('assistant.summary.risk.baselineOnly', { base: fmt.number(baseline.meanYield, 1) }) })
  }
  items.push({ source: 'risk', text: t('assistant.summary.risk.caution'), caution: true })
  return items
}

// ---- calibration ----

function calibrationItems(r: CalibrationResult, say: Say): SummaryItem[] {
  const { t, fmt } = say
  const row = (label: string, split: string) => r.rows.find((x) => x.label === label && x.split === split && x.crop === 'maize')
  const fit = row('calibrated', 'calibration')
  const holdout = row('calibrated', 'holdout')
  const baseline = row('climatology', 'holdout')
  const items: SummaryItem[] = []
  if (fit) {
    items.push({
      source: 'calibration',
      text: t('assistant.summary.calibration.level', {
        from: r.fitYears[0],
        to: r.fitYears[1],
        sim: fmt.number(fit.simulatedMean, 1),
        obs: fmt.number(fit.observedMean, 1),
        ratio: fmt.number(fit.ratio, 2),
      }),
    })
  }
  if (holdout && baseline && holdout.correlation !== null) {
    items.push({
      source: 'calibration',
      text: t(holdout.rmse > baseline.rmse ? 'assistant.summary.calibration.patternWorse' : 'assistant.summary.calibration.patternBetter', {
        from: r.holdoutYears[0],
        to: r.holdoutYears[1],
        r: fmt.number(holdout.correlation, 2),
        rmse: fmt.number(holdout.rmse, 2),
        base: fmt.number(baseline.rmse, 2),
      }),
    })
  }
  items.push({
    source: 'calibration',
    text: t('assistant.summary.calibration.standard', {
      standard: fmt.number(r.maizeLevels.standard, 1),
      times: fmt.number(r.maizeLevels.standard / r.maizeLevels.observed, 1),
      obs: fmt.number(r.maizeLevels.observed, 1),
    }),
  })
  return items
}

// ---- statistical ----

function statisticalItems(r: StatisticalResult, say: Say): SummaryItem[] {
  const { t, fmt } = say
  const holdout = r.observed.rows.filter((row) => row.split === 'holdout' && row.model !== r.baseline.model)
  const worse = holdout.filter((row) => row.rmse > r.baseline.rmse).length
  const gap = (r.baseline.rmse - r.best.rmse) / r.baseline.rmse
  const items: SummaryItem[] = [
    {
      source: 'statistical',
      text: t('assistant.summary.statistical.observed', {
        from: r.observed.holdoutYears[0],
        to: r.observed.holdoutYears[1],
        worse,
        n: holdout.length,
        mean: fmt.number(r.baseline.rmse, 2),
      }),
    },
    {
      source: 'statistical',
      text: t(gap < 0.05 ? 'assistant.summary.statistical.bestBarely' : 'assistant.summary.statistical.bestClearly', {
        model: t(`assistant.statModels.${r.best.model}`),
        rmse: fmt.number(r.best.rmse, 2),
        mean: fmt.number(r.baseline.rmse, 2),
        pct: fmt.percent(gap),
      }),
    },
  ]
  const emulation = r.emulation.rows.filter((row) => row.split === 'holdout' && row.model !== 'mean')
  const bestEmulator = emulation.reduce<(typeof emulation)[number] | null>((a, b) => (!a || b.r2 > a.r2 ? b : a), null)
  if (bestEmulator) {
    items.push({
      source: 'statistical',
      text: t('assistant.summary.statistical.emulation', {
        model: t(`assistant.statModels.${bestEmulator.model}`),
        pct: fmt.percent(Math.max(0, bestEmulator.r2)),
      }),
    })
  }
  return items
}

// ---- combined ----

function combinedItems(outcomes: Outcome[], say: Say): SummaryItem[] {
  const { t, fmt } = say
  const items: SummaryItem[] = []
  const planner = result(outcomes, 'planner')
  const risk = result(outcomes, 'risk')
  if (planner && risk) {
    const rotation = planner.strategy.rotation
    const row = riskRow(risk, 'baseline', rotation)
    if (rotation === risk.referenceRotation) {
      items.push({ source: 'combined', text: t('assistant.summary.combined.reference', { rotation: inSentence(t(`rotations.${rotation}`)) }) })
    } else if (row) {
      const vars = {
        rotation: inSentence(t(`rotations.${rotation}`)),
        adv: fmt.number(row.advantage, 1),
        lo: fmt.signed(row.ciLow, 1),
        hi: fmt.signed(row.ciHigh, 1),
      }
      items.push({ source: 'combined', text: t(row.ciLow > 0 ? 'assistant.summary.combined.riskAgrees' : 'assistant.summary.combined.riskUnsure', vars) })
    }
  }
  const calibration = result(outcomes, 'calibration')
  if (planner && calibration && planner.world === 'default') {
    items.push({
      source: 'combined',
      text: t('assistant.summary.combined.standardWorld', {
        times: fmt.number(calibration.maizeLevels.standard / calibration.maizeLevels.observed, 1),
      }),
      caution: true,
    })
  }
  return items
}

/** The summary of every model that answered, then what the answers say together. */
export function summarize(outcomes: Outcome[], say: Say): SummaryItem[] {
  const items: SummaryItem[] = []
  for (const outcome of outcomes) {
    if (!outcome.ok) continue
    if (outcome.model === 'planner') items.push(...plannerItems(outcome.result, say))
    else if (outcome.model === 'climate') items.push(...climateItems(outcome.result, say))
    else if (outcome.model === 'risk') items.push(...riskItems(outcome.result, say))
    else if (outcome.model === 'calibration') items.push(...calibrationItems(outcome.result, say))
    else items.push(...statisticalItems(outcome.result, say))
  }
  return [...items, ...combinedItems(outcomes, say)]
}

/**
 * Whether the planner applies where the farmer is. A climate result carries its own verdict; otherwise the
 * distance decides when it can (inside, or far), and a pin in between without a climate is "near, unchecked".
 */
export function zoneVerdict(outcomes: Outcome[], distanceKm: number | null): Verdict | null {
  if (distanceKm === null) return null
  const climate = result(outcomes, 'climate')
  if (climate?.verdict) return climate.verdict
  return coverage(distanceKm, 'unavailable')
}

/** Questions worth asking next, in the language of the interface; never one the answer already covers. */
export function followUps(outcomes: Outcome[], interpretation: Interpretation, hasPin: boolean, say: Say): string[] {
  const { t } = say
  const asked = new Set(interpretation.models)
  const next: string[] = []
  const planner = outcomes.some((o) => o.model === 'planner' && o.ok)
  if (planner) {
    if (!asked.has('risk')) next.push(t('assistant.suggestions.risk'))
    if (!asked.has('calibration')) next.push(t('assistant.suggestions.trust'))
    if (!asked.has('climate') && hasPin) next.push(t('assistant.suggestions.climate'))
  } else {
    if (!asked.has('planner')) next.push(t('assistant.suggestions.planner'))
    if (asked.has('calibration') && !asked.has('statistical')) next.push(t('assistant.suggestions.trees'))
    if (asked.has('risk') && !asked.has('planner')) next.push(t('assistant.suggestions.earn'))
  }
  return [...new Set(next)].slice(0, 3)
}
