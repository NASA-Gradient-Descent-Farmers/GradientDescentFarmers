import type { LatLon } from '../../../lib/geo.ts'
import type { DashboardData } from '../../../lib/types.ts'
import type { Profile } from '../../types.ts'
import type { Drafts, Position } from '../hooks.ts'

/** What every question gets: the answers so far, the data the models use, and a way to keep an answer. */
export interface StepProps {
  profile: Profile
  pin: LatLon | null
  data: DashboardData
  /** The one site the crop model covers. */
  site: LatLon
  drafts: Drafts
  position: Position
  /** Keep answers and move on. */
  commit: (patch: Partial<Profile>) => void
}
