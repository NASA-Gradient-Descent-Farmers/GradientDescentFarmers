// Which strings of the engines' data files are display text to translate, shared by scripts/translate-data.mjs and
// dataI18n.ts. Identifiers, enums and place names are never translated: the code
// compares them (evidence levels, regimes, crop keys) or sends them back to the engine (the current rotation).

/** Keys whose string values are identifiers, enums, file names or proper names. */
export const KEEP_KEYS = new Set([
  'rotacion', 'archivo', 'id', 'municipio', 'distrito', 'estado', 'agua', 'evidencia', 'dato', 'ciclo', 'clave', 'fuente_cosecha',
  'tipo_usado', 'usado', 'municipality', 'regime', 'advisoryStatus', 'highlightObjectives', 'kind', 'farmId', 'sourceRunId',
  'rotationRunId', 'status', 'version', 'unidad_escenario', 'nivel', 'textura', 'parecido_a',
])

/** Single words are translated only under these keys (display names); elsewhere a translatable string has a space. */
const WORD_KEYS = new Set(['etiqueta', 'cultivo', 'cropEs', 'labelEs', 'referencia'])

export function translatable(text: unknown, key: string | null): text is string {
  if (typeof text !== 'string' || (key && KEEP_KEYS.has(key))) return false
  if (!/[A-Za-zÁÉÍÓÚáéíóúñÑ]{3}/.test(text)) return false
  return /\s/.test(text) || (key ? key.endsWith('Es') || WORD_KEYS.has(key) : false)
}

/** Adds every translatable string under `value` to `out`. */
export function collectStrings(value: unknown, out: Set<string>, key: string | null = null): Set<string> {
  if (Array.isArray(value)) for (const item of value) collectStrings(item, out, key)
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) collectStrings(v, out, k)
  else if (translatable(value, key)) out.add(value)
  return out
}
