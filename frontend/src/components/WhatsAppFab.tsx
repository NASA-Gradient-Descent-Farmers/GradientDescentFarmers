import { useI18n } from '../i18n/index.tsx'
import { DEMO_HREF } from '../whatsapp/route.ts'
import { WhatsAppMark } from '../whatsapp/WhatsAppMark.tsx'
import '../landing.css'

/** A floating button, bottom right, that opens the WhatsApp simulation. */
export function WhatsAppFab() {
  const { t } = useI18n()
  return (
    <a className="wa-fab" href={DEMO_HREF} aria-label={t('landing.whatsapp.label')} title={t('landing.whatsapp.label')}>
      <WhatsAppMark size={34} />
      <span className="wa-fab-text">{t('landing.whatsapp.cta')}</span>
    </a>
  )
}
