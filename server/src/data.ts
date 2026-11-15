// The precomputed model results: the same three files the web app serves (frontend/public/data), read from disk.
// Nothing is computed or estimated here beyond what the shared engine does from them.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseData } from '../../frontend/src/lib/data.ts'
import type { DashboardData, GridFile, Meta } from '../../frontend/src/lib/types.ts'

const DATA_DIR = new URL('../../frontend/public/data/', import.meta.url)

export function loadResults(dir: URL = DATA_DIR): DashboardData {
  const read = <T>(name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(name, dir)), 'utf8')) as T
  return parseData(read<Meta>('meta.json'), read<GridFile>('grid.json'), read<unknown>('models.json'))
}
