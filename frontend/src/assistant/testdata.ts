// Shared by the assistant's tests: the real exported data and default settings.
import { readFileSync } from 'node:fs'
import { parseData } from '../lib/data.ts'
import type { GridFile, Meta } from '../lib/types.ts'
import type { Settings } from './types.ts'

const read = <T>(name: string) => JSON.parse(readFileSync(new URL(`../../public/data/${name}`, import.meta.url), 'utf8')) as T

export const data = parseData(read<Meta>('meta.json'), read<GridFile>('grid.json'), read<unknown>('models.json'))

export const defaults: Settings = { world: 'calibrated', preset: 'sustainability', economics: data.meta.economics }

export const site = { lat: data.meta.site.latitude, lon: data.meta.site.longitude }

/** A NASA POWER climatology answer with the monthly means given by the three functions (January first). */
export const powerAnswer = (rain: (i: number) => number, temp: (i: number) => number, minimum: (i: number) => number) => {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  const table = (f: (i: number) => number) => Object.fromEntries(months.map((m, i) => [m, f(i)]))
  return { properties: { parameter: { PRECTOTCORR: table(rain), T2M: table(temp), T2M_MIN: table(minimum) } } }
}
