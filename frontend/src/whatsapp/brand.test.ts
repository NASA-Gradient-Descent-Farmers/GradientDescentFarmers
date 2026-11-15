// Two things the product says about itself: the chat is WhatsApp, not a labelled "simulation", and the name is spelled YoliA.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DICTIONARIES } from '../i18n/translate.ts'

function strings(node: unknown, path = ''): [string, string][] {
  if (typeof node === 'string') return [[path, node]]
  if (typeof node !== 'object' || node === null) return []
  return Object.entries(node).flatMap(([key, value]) => strings(value, path ? `${path}.${key}` : key))
}

describe.each(['es', 'en'] as const)('the WhatsApp and home page copy in %s', (lang) => {
  it('never calls the chat a simulation', () => {
    // whatsapp.experimental is the label of the old planner path, which no place uses (only tests reach it)
    const offenders = ['whatsapp', 'landing']
      .flatMap((root) => strings((DICTIONARIES[lang] as unknown as Record<string, unknown>)[root], root))
      .filter(([path]) => path !== 'whatsapp.experimental')
      .filter(([, text]) => /\bsimulaci[oó]n\b|\bsimulation\b|\bsimulador\b|\bsimulator\b|\bdemo\b|demostraci[oó]n/i.test(text))
    expect(offenders).toEqual([])
  })
})

describe('the name', () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]))
  const root = new URL('../', import.meta.url).pathname

  it('is spelled YoliA everywhere in the source, never the old spelling', () => {
    const old = 'Yol' + 'IA' // written in two parts so that this file does not contain it
    const wrong = walk(root)
      .filter((file) => /\.(ts|tsx|css)$/.test(file))
      .filter((file) => readFileSync(file, 'utf8').includes(old))
      .map((file) => file.replace(root, ''))
    expect(wrong).toEqual([])
  })

  it('shows as Yol + iA in the wordmark', () => {
    const brand = readFileSync(join(root, 'components/Brand.tsx'), 'utf8')
    expect(brand).toContain('Yol<span className="ia">iA</span>')
  })
})
