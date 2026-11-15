// The precomputed results: the model results the web app serves (frontend/public/data) and the rotation results for the
// locations that have them (frontend/public/data/rotations), read from disk. Nothing is computed or estimated here beyond
// what the shared engine does from them.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { DEMO_LOCATIONS } from '../../frontend/src/lib/demoLocations.ts'
import { parseData } from '../../frontend/src/lib/data.ts'
import { parseEnvironment, type EnvironmentByLocation } from '../../frontend/src/lib/environment.ts'
import { parseRotations, type RotationsByLocation } from '../../frontend/src/lib/rotations.ts'
import type { DashboardData, GridFile, Meta } from '../../frontend/src/lib/types.ts'

const DATA_DIR = new URL('../../frontend/public/data/', import.meta.url)

export interface Results {
  data: DashboardData
  rotations: RotationsByLocation
  environment: EnvironmentByLocation
}

const readJson = (dir: URL, name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(name, dir)), 'utf8'))

/**
 * A location whose rotation file is missing or fails the check is left out with a warning: the bot then answers "data
 * unavailable" for it, the same as the web simulator, instead of failing to start.
 */
export function loadRotationResults(dir: URL = DATA_DIR): RotationsByLocation {
  const loaded: RotationsByLocation = {}
  for (const place of DEMO_LOCATIONS.filter((candidate) => candidate.results === 'rotations')) {
    try {
      loaded[place.id] = parseRotations(readJson(dir, `rotations/${place.id}.json`))
    } catch (error) {
      console.warn(`rotation results for ${place.id} not used:`, error instanceof Error ? error.message : 'unreadable')
    }
  }
  return loaded
}

/** The environmental package of each place, with the same leniency: a missing or invalid file leaves that place without it. */
export function loadEnvironmentResults(dir: URL = DATA_DIR): EnvironmentByLocation {
  const loaded: EnvironmentByLocation = {}
  for (const place of DEMO_LOCATIONS) {
    try {
      loaded[place.id] = parseEnvironment(readJson(dir, `environment/${place.id}.json`))
    } catch (error) {
      console.warn(`environment data for ${place.id} not used:`, error instanceof Error ? error.message : 'unreadable')
    }
  }
  return loaded
}

export function loadResults(dir: URL = DATA_DIR): Results {
  const data = parseData(readJson(dir, 'meta.json') as Meta, readJson(dir, 'grid.json') as GridFile, readJson(dir, 'models.json'))
  return { data, rotations: loadRotationResults(dir), environment: loadEnvironmentResults(dir) }
}
