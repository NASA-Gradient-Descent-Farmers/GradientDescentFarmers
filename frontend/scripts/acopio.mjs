// Turns the official directory of collection centres (Alimentación para el Bienestar, "Directorio de centros de acopio del
// Programa de Acopio para el Bienestar", datos.gob.mx, CSV) into public/data/acopio.json for the "where to sell" lines.
//
//   node scripts/acopio.mjs <downloaded.csv> [out.json] [--downloaded=YYYY-MM-DD]
//
// The CSV has no coordinates: each centre is placed at its municipality's point from public/data/municipios.json (the
// median of its rural localities), so distances are approximate, straight-line, municipality to municipality. The state comes
// from the INEGI state code inside clave_centro (B-SS-MMM-LLLL-NNN), else from the state name. Centres whose municipality is
// not found are kept without a point and reported.
import { readFileSync, writeFileSync } from 'node:fs'
import { parseCsv } from './csv.mjs'

const [input, output = new URL('../public/data/acopio.json', import.meta.url).pathname, ...flags] = process.argv.slice(2)
if (!input) {
  console.error('usage: node scripts/acopio.mjs <downloaded.csv> [out.json] [--downloaded=YYYY-MM-DD]')
  process.exit(1)
}
const downloaded = flags.find((f) => f.startsWith('--downloaded='))?.split('=')[1] ?? new Date().toISOString().slice(0, 10)

// INEGI state codes, in the names municipios.json uses
const STATES = ['Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche', 'Coahuila de Zaragoza', 'Colima', 'Chiapas', 'Chihuahua', 'Ciudad de México', 'Durango', 'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco', 'México', 'Michoacán de Ocampo', 'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro', 'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora', 'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz de Ignacio de la Llave', 'Yucatán', 'Zacatecas']

const fold = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const stateKey = (name) => fold(name).replace(/ de (zaragoza|ocampo|ignacio de la llave)$/, '').replace(/^estado de /, '')

/** UTF-8, else Latin-1 (government CSVs are often saved as Windows-1252). */
function decode(bytes) {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  return utf8.includes('�') ? new TextDecoder('latin1').decode(bytes) : utf8
}

const municipios = JSON.parse(readFileSync(new URL('../public/data/municipios.json', import.meta.url), 'utf8')).places
const byState = new Map()
for (const [state, municipality, lat, lon] of municipios) {
  const key = stateKey(state)
  if (!byState.has(key)) byState.set(key, { name: state, places: new Map() })
  byState.get(key).places.set(fold(municipality), { municipality, lat, lon })
}

const rows = parseCsv(decode(readFileSync(input)))
const pick = (row, ...names) => {
  for (const name of names) for (const key of Object.keys(row)) if (fold(key) === fold(name)) return (row[key] ?? '').trim()
  return ''
}
const centres = []
const missing = []
for (const row of rows) {
  const clave = pick(row, 'clave_centro', 'clave del centro')
  const code = /^B-(\d{2})-/.exec(clave)?.[1]
  const stateName = code && STATES[Number(code) - 1] ? STATES[Number(code) - 1] : pick(row, 'estado')
  const state = byState.get(stateKey(stateName))
  const municipality = pick(row, 'municipio')
  const found = state?.places.get(fold(municipality)) ?? [...(state?.places.values() ?? [])].find((p) => fold(p.municipality).startsWith(fold(municipality)) || fold(municipality).startsWith(fold(p.municipality)))
  if (!found) missing.push(`${pick(row, 'estado')} / ${municipality} (${clave})`)
  centres.push([state?.name ?? pick(row, 'estado'), found?.municipality ?? municipality, pick(row, 'localidad'), pick(row, 'nombre_centro_acopio', 'nombre del centro de acopio'), pick(row, 'direccion', 'dirección'), found?.lat ?? null, found?.lon ?? null, clave])
}

const out = {
  source: 'Alimentación para el Bienestar, Directorio de centros de acopio del Programa de Acopio para el Bienestar (datos.gob.mx).',
  url: 'https://www.datos.gob.mx/dataset/directorio_centros_acopio_programa_acopio_bienestar',
  downloaded,
  located: 'municipio',
  columns: ['estado', 'municipio', 'localidad', 'nombre', 'direccion', 'lat', 'lon', 'clave'],
  centros: centres,
}
writeFileSync(output, JSON.stringify(out))
console.log(`${centres.length} centres, ${centres.length - missing.length} placed, ${missing.length} without a municipality point → ${output}`)
for (const m of missing.slice(0, 30)) console.log(`  not found: ${m}`)
