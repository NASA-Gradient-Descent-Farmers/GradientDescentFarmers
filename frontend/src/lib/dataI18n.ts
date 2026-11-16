// English for the engines' Spanish output. The district engine and the WOFOST runs write their explanations in Spanish; their
// translations were made once, ahead of time (scripts/translate-data.mjs, public/data/i18n/en.json), with every number checked
// unchanged. In English the data is passed through `translateData` before it is shown; a string with no translation (e.g. an
// answer from the live engine that was never exported) stays in Spanish. Nothing here calls a network service at run time
// except loading that one file.

import { useCallback, useEffect, useState } from 'react'
import { useI18n } from '../i18n/index.tsx'
import { collectStrings, translatable } from './dataStrings.ts'

export type Translations = ReadonlyMap<string, string>

let loading: Promise<Translations> | null = null

/** The translations file, loaded once; an empty map when it is missing. */
export function loadTranslations(base: string, fetcher: typeof fetch = fetch): Promise<Translations> {
  loading ??= fetcher(`${base}data/i18n/en.json`)
    .then((response) => (response.ok ? response.json() : { strings: {} }))
    .then((json: { strings?: Record<string, string> }) => new Map(Object.entries(json.strings ?? {})))
    .catch(() => new Map())
  return loading
}

/** Translations fetched during this visit for live engine text (translateLive), used alongside the file's. */
const live = new Map<string, string>()

/** A copy of `value` with every translatable string that has a translation replaced; identifiers and enums are kept. */
export function translateData<T>(value: T, map: Translations | null, key: string | null = null): T {
  if (!map || (map.size === 0 && live.size === 0)) return value
  if (Array.isArray(value)) return value.map((item) => translateData(item, map, key)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = translateData(v, map, k)
    return out as T
  }
  if (translatable(value, key)) return (map.get(value) ?? live.get(value) ?? value) as T
  return value
}

/** For components: a function that translates engine data into the page's language (identity in Spanish). */
export function useDataTranslation(): <T>(value: T) => T {
  const { lang } = useI18n()
  const [map, setMap] = useState<Translations | null>(null)
  useEffect(() => {
    if (lang !== 'en') return
    let alive = true
    void loadTranslations(import.meta.env.BASE_URL).then((loaded) => alive && setMap(loaded))
    return () => {
      alive = false
    }
  }, [lang])
  // stable between renders, so it can be an effect dependency; it changes when the language or the file changes
  return useCallback(<T,>(value: T): T => (lang === 'en' ? translateData(value, map) : value), [lang, map])
}

const TRANSLATE_PATH = 'api/yolia-translate'
const BATCH = 60

/** The Spanish strings of `value` with no translation yet, from the file or from this visit. */
export function missingStrings(value: unknown, map: Translations): string[] {
  return [...collectStrings(value, new Set<string>())].filter((s) => !map.has(s) && !live.has(s))
}

/**
 * English for live engine text: the strings the file does not have are asked of /api/yolia-translate (the server keeps a
 * translation only when its numbers are the original's), remembered for the visit, and the translated copy is returned.
 * Whatever fails stays in Spanish; `complete` says whether anything is left.
 */
export async function translateLive<T>(value: T, base: string, fetcher: typeof fetch = fetch, timeoutMs = 30_000): Promise<{ value: T; complete: boolean }> {
  const map = await loadTranslations(base, fetcher)
  const missing = missingStrings(value, map)
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetcher(`${base}${TRANSLATE_PATH}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strings: batch }), signal: controller.signal })
      if (!response.ok) break
      const body = (await response.json()) as { translations?: unknown }
      if (!Array.isArray(body.translations)) break
      batch.forEach((spanish, j) => {
        const english = (body.translations as unknown[])[j]
        if (typeof english === 'string' && english) live.set(spanish, english)
      })
    } catch {
      break
    } finally {
      clearTimeout(timer)
    }
  }
  return { value: translateData(value, map), complete: missing.every((s) => live.has(s)) }
}

/** For tests. */
export const resetLiveTranslations = () => live.clear()
