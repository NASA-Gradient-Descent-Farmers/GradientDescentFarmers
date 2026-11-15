import { parsePrecomputed } from './precomputed.ts'
import type { DashboardData, GridFile, Meta, ObjectiveKey, WorldKey } from './types.ts'
import { WORLDS } from './types.ts'

export function parseData(meta: Meta, file: GridFile, models: unknown): DashboardData {
  const grids = {} as Record<WorldKey, GridFile['worlds'][string]>
  for (const world of WORLDS) {
    if (!file.worlds[world]) throw new Error(`grid.json has no grid for ${world}`)
    grids[world] = file.worlds[world]
  }
  const maximize = Object.fromEntries(meta.objectives.map((o) => [o.key, o.maximize])) as Record<ObjectiveKey, boolean>
  return { meta, grids, maximize, models: parsePrecomputed(models) }
}

async function getJson<T>(name: string, base: string): Promise<T> {
  const response = await fetch(`${base}data/${name}`)
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
  return (await response.json()) as T
}

/** `base` is where the app's files live; a page served below the root (such as /demo/whatsapp) passes its own. */
export async function loadData(base: string = import.meta.env.BASE_URL): Promise<DashboardData> {
  const [meta, grid, models] = await Promise.all([getJson<Meta>('meta.json', base), getJson<GridFile>('grid.json', base), getJson<unknown>('models.json', base)])
  return parseData(meta, grid, models)
}
