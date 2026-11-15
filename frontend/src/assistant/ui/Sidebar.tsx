import { useI18n } from '../../i18n/index.tsx'
import type { Conversation } from '../history.ts'

interface Props {
  conversations: Conversation[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

export function Sidebar({ conversations, activeId, onSelect, onNew, onDelete }: Props) {
  const { t, lang } = useI18n()
  const when = new Intl.DateTimeFormat(lang === 'es' ? 'es-MX' : 'en-US', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  const saved = conversations.filter((c) => c.messages.length > 0)
  return (
    <nav className="history" aria-label={t('assistant.sidebar.title')}>
      <button type="button" className="new-chat" onClick={onNew}>
        + {t('assistant.sidebar.new')}
      </button>
      <h2>{t('assistant.sidebar.title')}</h2>
      {saved.length === 0 ? (
        <p className="empty-note">{t('assistant.sidebar.empty')}</p>
      ) : (
        <ul>
          {saved.map((c) => (
            <li key={c.id} className={c.id === activeId ? 'active' : undefined}>
              <button type="button" className="open" aria-current={c.id === activeId ? 'true' : undefined} onClick={() => onSelect(c.id)}>
                <span className="title">{c.title || t('assistant.sidebar.untitled')}</span>
                <span className="when">{when.format(c.updatedAt)}</span>
              </button>
              <button type="button" className="delete" aria-label={`${t('assistant.sidebar.delete')}: ${c.title}`} title={t('assistant.sidebar.delete')} onClick={() => onDelete(c.id)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  )
}
