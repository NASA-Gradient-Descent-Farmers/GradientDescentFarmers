import { useState } from 'react'
import { useI18n } from '../../i18n/index.tsx'
import type { Precomputed } from '../../lib/precomputed.ts'
import type { Meta } from '../../lib/types.ts'
import type { Recommendation } from '../recommend.ts'
import { TrashIcon } from './glyphs.tsx'
import { RecommendationCard } from './RecommendationCard.tsx'

interface Props {
  saved: Recommendation[]
  meta: Meta
  models: Precomputed
  onRemove: (id: string) => void
  onGoPlant: () => void
}

/** Mis recomendaciones: what the farmer chose to keep, as it was that day. */
export function SavedPage({ saved, meta, models, onRemove, onGoPlant }: Props) {
  const { t, lang } = useI18n()
  const [open, setOpen] = useState<string | null>(null)
  const date = (at: number) => new Date(at).toLocaleDateString(lang === 'es' ? 'es-MX' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' })

  return (
    <div className="page">
      <h1 className="page-title">{t('farmer.saved.title')}</h1>
      <p className="page-lede">{t('farmer.saved.lede')}</p>

      {saved.length === 0 ? (
        <div className="empty-card">
          <p>{t('farmer.saved.empty')}</p>
          <button type="button" className="btn primary big block" onClick={onGoPlant}>
            {t('farmer.saved.goPlant')}
          </button>
        </div>
      ) : (
        <>
          <ul className="saved-list">
            {saved.map((rec) => {
              const shown = open === rec.id
              return (
                <li key={rec.id} className="saved-item">
                  <div className="saved-head">
                    <div>
                      <p className="saved-crop">{t(`rotations.${rec.result.strategy.rotation}`)}</p>
                      <p className="muted">
                        {rec.place ?? t('farmer.saved.unknownPlace')} · {t('farmer.saved.savedOn', { date: date(rec.at) })}
                      </p>
                    </div>
                    <div className="saved-buttons">
                      <button type="button" className="btn secondary" onClick={() => setOpen(shown ? null : rec.id)} aria-expanded={shown}>
                        {shown ? t('farmer.saved.hide') : t('farmer.saved.open')}
                      </button>
                      <button type="button" className="btn ghost" onClick={() => onRemove(rec.id)} aria-label={`${t('farmer.saved.remove')}: ${t(`rotations.${rec.result.strategy.rotation}`)}`}>
                        <TrashIcon />
                        {t('farmer.saved.remove')}
                      </button>
                    </div>
                  </div>
                  {shown && <RecommendationCard rec={rec} meta={meta} models={models} level={3} />}
                </li>
              )
            })}
          </ul>
          <p className="help">{t('farmer.saved.note')}</p>
        </>
      )}
    </div>
  )
}
