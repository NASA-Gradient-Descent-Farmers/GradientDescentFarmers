// English strings: the source of truth for the key set. es.ts must have exactly the same keys (checked by i18n.test.ts).

import { assistantEn } from './assistant.en.ts'
import { onboardingEn } from './onboarding.en.ts'
import { farmerEn } from './farmer.en.ts'
import { accountEn } from './account.en.ts'
import { whatsappEn } from './whatsapp.en.ts'
import { landingEn } from './landing.en.ts'
import { nearEn } from './near.en.ts'
import { envEn } from './env.en.ts'

export const en = {
  assistant: assistantEn,
  onboarding: onboardingEn,
  farmer: farmerEn,
  account: accountEn,
  whatsapp: whatsappEn,
  landing: landingEn,
  near: nearEn,
  env: envEn,
  app: {
    title: 'YoliA',
    tagline: 'NASA data and a crop model',
    home: 'Back to the start',
    techMode: 'Technical mode',
    hemispheres: 'N,S,E,W',
    language: 'Language',
    loading: 'Loading the model results…',
    loadError: 'Could not load the model results ({message}). Reload the page; if it keeps happening, the exported results are missing.',
  },
  welcome: {
    eyebrow: 'Texcoco · State of Mexico · rainfed',
    hello: 'Hello! Welcome to',
    title: 'YoliA',
    tagline: 'Rainfed crop rotations, from NASA satellites and a crop model.',
    hint: 'Touch the leaf to begin',
    leafLabel: 'Enter YoliA and choose your version',
    choose: 'How do you want to come in?',
    versions: {
      agricultor: {
        name: 'Agricultor',
        tag: 'No jargon',
        body: 'Simple questions about your field and clear answers: what to plant, how much to fertilize and what you could earn.',
        cta: 'Enter as a farmer',
      },
      tecnico: {
        name: 'Técnico',
        tag: 'Models and data',
        body: 'The full planner, with prices, costs and weights you can edit, and the assistant that names the model behind each number.',
        cta: 'Enter as a technician',
      },
    },
    last: 'Your last choice',
    foot: 'Prototype. Costs and the fertilizer price are placeholders; this is not farm advice.',
  },
  home: {
    eyebrow: 'Texcoco · State of Mexico · rainfed',
    title: 'YoliA',
    tagline: 'Rainfed crop rotations, from NASA satellites and a crop model.',
    hello: 'Hello, farmer!',
    ask: 'What do you want to know?',
    askLabel: 'Your question for YoliA',
    askPlaceholder: 'Type your question…',
    askSend: 'Ask',
    orPick: 'Or start with one of these:',
    lead: 'Ask',
    leadBody: 'Type a question about your field, or start with one of these.',
    parcel: 'Your field',
    pinNeeded: 'Set your pin so the models use the climate of your field.',
    number: 'No. {n}',
    options: {
      planner: {
        title: 'What to plant and how much to fertilize?',
        body: 'Compare rotations, fertilizer and stover; we suggest a plan for your hectare.',
      },
      economics: {
        title: 'How much will I earn?',
        body: 'Income per hectare for each rotation, with your prices and your costs.',
      },
      reality: {
        title: 'How true is the model?',
        body: 'What the model says next to what Texcoco farms report to SIAP.',
      },
      whatifs: {
        title: 'What if it barely rains?',
        body: 'Drought, frost and less fertilizer: how each rotation copes with a bad year.',
      },
    },
    version: 'Agricultor version',
    changeVersion: 'Switch version',
    foot: 'Prototype. Costs and the fertilizer price are placeholders; this is not farm advice.',
  },
  where: {
    back: 'Back',
    eyebrow: 'Before we start',
    title: 'Where is your field?',
    lede: 'Tap the map to drop your pin and drag it to adjust. Being right to a few kilometres is enough.',
    mapLabel: 'Map for placing the pin of your field',
    layers: { label: 'Map layer', street: 'Streets', satellite: 'NASA satellite' },
    hintPlace: 'Tap the map to drop the pin',
    hintMove: 'Drag the pin to adjust it',
    offline: 'The map could not load. Check your internet connection.',
    pin: 'Your pin',
    noPin: 'You have not dropped the pin yet.',
    zonesHint: 'The circles mark the areas with data: Sonora, Sinaloa and Guanajuato. Tap one to pick it.',
    distanceNearest: 'The nearest point with data is {place}, {km} km away.',
    distanceZone: 'You are {km} km from {place}, a point with published data.',
    inPlace: 'I am in {place}',
    lessThanOne: 'less than 1',
    continue: 'Continue with this location',
    needPin: 'Drop your pin to continue',
    privacy:
      'The pin stays on this device. To show your climate we send NASA an approximate location (within about 10 km), and the map downloads images from OpenStreetMap and NASA.',
    pinLabel: 'My field',
    change: 'change',
  },
  climate: {
    title: 'Your climate',
    source: 'NASA POWER: many-year averages for your area',
    loading: 'Asking NASA…',
    error: 'Could not get the climate from NASA ({message}).',
    retry: 'Try again',
    rain: 'Rain per year',
    temp: 'Mean temperature',
    cold: 'Coldest night',
    coldNote: 'Coldest night: the lowest temperature NASA estimates in your area over its whole record. A single night, not an average.',
    vs: '{delta} vs Texcoco',
    chartTitle: 'Rain per month (mm)',
    you: 'Your field',
    model: 'El Batán (model)',
    table: 'Show the table',
    month: 'Month',
    chartLabel: 'Rain per month at your field and at El Batán, in millimetres',
  },
  coverage: {
    pending: 'Comparing your climate with Texcoco’s…',
    seeClimate: 'See my climate',
    inside: {
      title: 'You are inside the modeled area',
      body: 'The planner applies to your field: you are {km} km from El Batán, where it was calibrated.',
    },
    near: {
      title: 'You are near the modeled area',
      body: '{km} km from El Batán with a similar climate. The planner works as a reference, but it is not tuned to your field.',
    },
    nearUnchecked: {
      title: 'You are near the modeled area',
      body: '{km} km from El Batán. We could not compare the climate, so take the planner as a reference only.',
    },
    outsideDistance: {
      title: 'You are outside the modeled area',
      body: '{km} km from El Batán. The planner’s numbers are from Texcoco: use them to compare options, not as figures for your field.',
    },
    outsideClimate: {
      title: 'Your climate differs from the modeled area’s',
      body: '{km} km from El Batán, with different rain or temperature. The planner’s numbers are from Texcoco: use them to compare options, not as figures for your field.',
    },
  },
  nav: {
    label: 'Sections',
  },
  caveat: {
    title: 'Early prototype, not farm advice.',
    body:
      'Crop prices come from SIAP, but production costs, the nitrogen price and the stover price are placeholders. ' +
      'The two crop models also disagree about what fertilizer buys. Compare plans within one model.',
  },
  crops: { maize: 'Maize', barley: 'Barley', fababean: 'Faba bean' },
  rotations: {
    maize: 'Maize every year',
    'maize-barley': 'Maize – barley',
    'maize-fababean': 'Maize – faba bean',
    'maize-barley-fababean': 'Maize – barley – faba bean',
  },
  objectives: {
    yield_t_ha: { name: 'Grain yield', unit: 't/ha/yr', hint: 'Grain dry matter, all crops of the rotation averaged.' },
    net_mxn_ha: { name: 'Net income', unit: 'MXN/ha/yr', hint: 'Grain and stover sales minus costs and fertilizer.' },
    n_loss_kg_ha: { name: 'Nitrogen lost', unit: 'kg N/ha/yr', hint: 'Fertilizer nitrogen the crop did not take up. Less is better.' },
    c_input_t_ha: { name: 'Carbon to the soil', unit: 't C/ha/yr', hint: 'Carbon in roots and the stover left in the field.' },
    cvar_net_mxn_ha: { name: 'Bad-year income', unit: 'MXN/ha/yr', hint: 'Average net income of the worst quarter of years.' },
  },
  planner: {
    title: 'Strategy planner',
    intro:
      'Each point is a way to farm one hectare: a rotation, an amount of fertilizer and a share of the stover left in the field. ' +
      'Only strategies that no other beats on everything you care about are shown. Say what matters and we suggest a compromise.',
    world: {
      label: 'Crop model',
      calibrated: {
        name: 'Calibrated to Texcoco farms',
        note: 'WOFOST tuned so yields match what Texcoco farms report to SIAP. In this model the crop barely responds to fertilizer.',
      },
      default: {
        name: 'Standard WOFOST',
        note: 'European crop parameters. Crops respond to fertilizer, but yields are 2.5–5× what farms report and money is about 8× larger.',
      },
    },
    weights: {
      title: 'What matters to you',
      hint: '0 ignores an objective; higher matters more.',
      sustainability: 'Sustainability first',
      profit: 'Profit first',
      yield: 'Yield first',
      steady: 'Steady income first',
      costs: 'Spend less',
    },
    prices: {
      title: 'Prices and costs',
      intro: 'Change a number and every strategy is scored again. Grain prices are SIAP medians; the other figures are placeholders.',
      crop: 'Crop',
      grain: 'Grain (MXN/t)',
      cost: 'Other costs (MXN/ha)',
      nPrice: 'Nitrogen (MXN/kg N)',
      stoverPrice: 'Stover (MXN/t)',
      siap: 'SIAP',
      placeholder: 'placeholder',
      siapHint: 'SIAP {year}: {latest} · 3-year median: {median}',
      useLatest: 'use {value}',
      reset: 'Back to the original figures',
      invalid: 'Enter a number, 0 or more',
    },
    chart: {
      view: 'View',
      chart: 'Chart',
      table: 'Table',
      x: 'Horizontal axis',
      y: 'Vertical axis',
      count: '{shown} strategies on the trade-off curve (of {total} scored in this model)',
      shape: 'Rotation',
      color: 'Nitrogen lost (kg N/ha)',
      pick: 'Suggested plan',
      yours: 'Your pick',
      clickHint: 'Click a point to see its plan.',
      ariaLabel: 'Scatter plot of {y} against {x} for the strategies on the trade-off curve',
    },
    table: { rotation: 'Rotation', nitrogen: 'N, maize (kg/ha)', stover: 'Stover left' },
    plan: {
      title: 'Suggested plan',
      yourTitle: 'Plan you picked',
      back: 'Back to the suggestion',
      rotation: 'Rotation',
      fertilizer: 'Nitrogen fertilizer',
      fertilizerValue: '{kg} kg N/ha',
      stover: 'Stover left in the field',
      results: 'Per hectare, per year, with {from}–{to} weather',
      baseline: 'With the original figures the suggestion was {rotation}, {kg} kg N/ha on maize and {stover} of the stover left.',
      meter: 'Bar: where this plan sits among the strategies shown (full = best of them).',
      noteCalibrated:
        'In this model fertilizer does not raise yield, so every search lands on little or no nitrogen. That is a property of the model, not a farm finding: a fertilizer trial on farm soils would settle it.',
      noteDefault:
        'In this model yield rises almost in line with nitrogen, but its yields and money are well above what farms report. Compare plans with each other, not with real farm income.',
    },
  },
}

export type Dict = typeof en
