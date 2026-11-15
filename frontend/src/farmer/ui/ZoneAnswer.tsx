import { useZoneData, type Published } from '../../hooks/useZoneData.ts'
import { useI18n } from '../../i18n/index.tsx'
import { DEMO_LOCATIONS } from '../../lib/demoLocations.ts'
import { INSIDE_KM } from '../../lib/coverage.ts'
import type { Body } from '../chat.ts'
import { environmentBubbles, type EnvironmentTopic } from '../../whatsapp/environmentAnswers.ts'
import { richText } from '../../whatsapp/format.tsx'
import { rotationBubbles, type RotationTopic } from '../../whatsapp/rotationAnswers.ts'
import { DistrictSection } from './DistrictSection.tsx'
import { useDataTranslation } from '../../lib/dataI18n.ts'
import '../../near.css'

const ENVIRONMENT: readonly string[] = ['climate', 'soil', 'satellite', 'sources']
const PLANTING: readonly string[] = ['plant', 'compare']

/**
 * An answer of the in-app assistant, built from what the data service published for the parcel's place: the rotation run
 * (`rotations.json` and the files beside it) and the environmental package. The sentences are the same ones WhatsApp uses, so
 * the two never disagree. When the parcel is not inside the place's own area, the first line says which place the answer is from.
 */
export function ZoneAnswer({ body }: { body: Extract<Body, { kind: 'zone' }> }) {
  const { t } = useI18n()
  const published = useZoneData()
  return published ? <ZoneAnswerView body={body} published={published} /> : <p className="loading">{t('farmer.chat.thinking')}</p>
}

/** The answer itself, from the published files it is given. */
export function ZoneAnswerView({ body, published }: { body: Extract<Body, { kind: 'zone' }>; published: Published }) {
  const { t, fmt, distance } = useI18n()
  const place = DEMO_LOCATIONS.find((candidate) => candidate.id === body.place)
  if (!place) return null
  const translate = useDataTranslation()
  const rotations = translate(published.rotations[body.place])
  const environment = published.environment[body.place] ?? null
  const ctx = { t, fmt, observed: environment, goal: body.goal ?? null, water: body.water ?? null }
  const bubbles = ENVIRONMENT.includes(body.topic)
    ? environment
      ? environmentBubbles(body.topic as EnvironmentTopic, place.name, environment, ctx)
      : []
    : rotations
      ? rotationBubbles(body.topic as RotationTopic, rotations, ctx)
      : environment
        ? environmentBubbles('climate', place.name, environment, ctx)
        : []
  return (
    <>
      {body.km > INSIDE_KM && <p className="muted">{t('near.nearest.body', { km: distance(body.km), place: place.name })}</p>}
      {bubbles.map((bubble, i) => (
        <p key={i} className="zone-text">
          {richText(bubble.text)}
        </p>
      ))}
      {/* a planting question also gets the district engine's short answer, as a second, separate tool */}
      {PLANTING.includes(body.topic) && <DistrictSection placeId={body.place} app={{ water: body.water, goal: body.goal }} mode="agricultor" />}
    </>
  )
}
