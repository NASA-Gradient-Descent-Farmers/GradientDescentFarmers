import type { ReactNode } from 'react'
import { useI18n } from '../../i18n/index.tsx'
import { CheckIcon, InfoIcon, WarnIcon } from './glyphs.tsx'

export type TagKind = 'estimate' | 'fact' | 'general' | 'careful' | 'unproven'

const ICON: Record<TagKind, ReactNode> = {
  estimate: '≈',
  fact: <CheckIcon />,
  general: <InfoIcon />,
  careful: <WarnIcon />,
  unproven: <WarnIcon />,
}

/** Says what kind of statement follows: a model estimate, an observed figure, a general explanation. Always an icon and words, never colour alone. */
export function Tag({ kind }: { kind: TagKind }) {
  const { t } = useI18n()
  return (
    <span className={`kind-tag is-${kind}`}>
      <span className="tag-icon" aria-hidden="true">
        {ICON[kind]}
      </span>
      {t(`farmer.tags.${kind}`)}
    </span>
  )
}
