// Translates the engines' Spanish text in public/data (the SIAP district answers and the WOFOST rotation runs) into English,
// once, ahead of time, into public/data/i18n/en.json: { strings: { "<español>": "<English>" } }. The app swaps them in when the
// page is in English (src/lib/dataI18n.ts), so English needs no network or key at run time. Figures are not touched: a
// translation whose numbers differ from the original's is dropped (the Spanish stays).
//
//   ANTHROPIC_API_KEY=... node scripts/translate-data.mjs        # or put the key in frontend/.env.local
//   node scripts/translate-data.mjs --check                      # list strings still missing, no API calls
//
// Incremental: strings already in en.json are kept. Re-run after refreshing public/data/district or public/data/rotations.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectStrings } from '../src/lib/dataStrings.ts'

const here = dirname(fileURLToPath(import.meta.url))
const publicData = join(here, '..', 'public', 'data')
const out = join(publicData, 'i18n', 'en.json')
const MODEL = process.env.YOLIA_LLM_MODEL || 'claude-sonnet-5-5'
const BATCH = 50
const PARALLEL = Number(process.env.TRANSLATE_PARALLEL || 5)

function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  const local = join(here, '..', '.env.local')
  if (existsSync(local)) for (const line of readFileSync(local, 'utf8').split('\n')) if (line.startsWith('ANTHROPIC_API_KEY=')) return line.slice(18).trim()
  return null
}

const files = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : name.endsWith('.json') ? [join(dir, name)] : []))

const numbers = (text) => [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/,/g, '')).sort().join('|')

const GLOSSARY = `Glossary (use consistently): temporal = rainfed; riego = irrigated / irrigation; otoño-invierno = autumn-winter; primavera-verano = spring-summer;
distrito = district; ha = ha; SIAP, NASA, FAO-56, GRACE, CHIRPS, MODIS, SMAP stay as they are; milpa stays "milpa"; barbecho = fallow;
maíz = maize; frijol = bean; garbanzo = chickpea; sorgo = sorghum; cebada = barley; trigo = wheat; cártamo = safflower; ajonjolí = sesame;
cacahuate = peanut; soya = soybean; avena forrajera = forage oats; avena (grano) = oats (grain); calabaza = squash; rastrojo = stover;
ene, feb, mar, abr, may, jun, jul, ago, sep, oct, nov, dic = Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec;
año = year; técnico / extensionista = technician / extension agent; precio medio rural = average farm-gate price.`

async function translateBatch(key, batch) {
  const body = {
    model: MODEL,
    max_tokens: 16000,
    system: `You translate Spanish agricultural decision-support text for Mexican farmers into clear, plain English for international evaluators. Keep every number, currency sign, unit, percentage, range, sign (+, −, -) and symbol (→, –, ≈, ≥, ≤) exactly as written. Keep *asterisks* and line breaks. Do not add or remove information. Keep the second person ("you", "your field"). ${GLOSSARY}
Answer with only a JSON array of strings: the translations, in the same order and the same count as the input.`,
    messages: [{ role: 'user', content: JSON.stringify(batch) }],
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error?.message ?? `HTTP ${response.status}`)
      const text = json.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
      const list = JSON.parse(text)
      if (!Array.isArray(list) || list.length !== batch.length) throw new Error(`got ${Array.isArray(list) ? list.length : typeof list} items for ${batch.length}`)
      return list
    } catch (error) {
      console.warn(`  batch failed (attempt ${attempt}): ${error.message}`)
      if (attempt === 3) return null
    }
  }
}

const existing = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')).strings : {}
const all = new Set()
for (const file of files(publicData).filter((f) => /[\\/](district|rotations)[\\/]/.test(f))) collectStrings(JSON.parse(readFileSync(file, 'utf8')), all)
const missing = [...all].filter((s) => !(s in existing)).sort()
console.log(`${all.size} strings, ${missing.length} to translate`)
if (process.argv.includes('--check')) process.exit(missing.length ? 1 : 0)

const key = apiKey()
if (!key) {
  console.error('No ANTHROPIC_API_KEY (environment or frontend/.env.local)')
  process.exit(1)
}
const strings = { ...existing }
let dropped = 0
const batches = []
for (let i = 0; i < missing.length; i += BATCH) batches.push(missing.slice(i, i + BATCH))
for (let i = 0; i < batches.length; i += PARALLEL) {
  const results = await Promise.all(batches.slice(i, i + PARALLEL).map((batch) => translateBatch(key, batch)))
  results.forEach((list, j) => {
    const batch = batches[i + j]
    if (!list) return
    batch.forEach((es, k) => {
      const en = String(list[k] ?? '').trim()
      if (en && numbers(en) === numbers(es)) strings[es] = en
      else dropped++
    })
  })
  console.log(`  ${Math.min(i + PARALLEL, batches.length)}/${batches.length} batches`)
}
mkdirSync(dirname(out), { recursive: true })
const sorted = Object.fromEntries(Object.entries(strings).filter(([es]) => all.has(es)).sort(([a], [b]) => a.localeCompare(b)))
writeFileSync(out, JSON.stringify({ version: 1, model: MODEL, generated: new Date().toISOString(), note: 'Machine translation of the engines\' Spanish output (scripts/translate-data.mjs); figures checked unchanged.', strings: sorted }, null, 1) + '\n')
console.log(`wrote ${Object.keys(sorted).length} translations; ${dropped} dropped (numbers changed or no answer), left in Spanish`)
