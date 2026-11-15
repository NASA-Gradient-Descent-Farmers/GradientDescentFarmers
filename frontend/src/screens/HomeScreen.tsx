import { Brand } from '../components/Brand.tsx'
import { TopBar } from '../components/TopBar.tsx'
import { useI18n } from '../i18n/index.tsx'
import { DEMO_HREF } from '../whatsapp/route.ts'
import { WhatsAppMark } from '../whatsapp/WhatsAppMark.tsx'
import '../landing.css'

const STEPS = [0, 1, 2] as const

/**
 * The home page, shown before signing in: what YolIA is, the way into the app, and the WhatsApp simulation. The
 * simulation is a link, not an embedded chat: it is its own page, and says on arrival that it is not real WhatsApp.
 */
export function HomeScreen({ onStart }: { onStart: () => void }) {
  const { t } = useI18n()
  return (
    <div className="calm landing">
      <TopBar />
      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <p className="landing-eyebrow">{t('landing.eyebrow')}</p>
          <h1 id="landing-title" className="statement">
            <strong>
              {t('welcome.hello')} <Brand />.
            </strong>{' '}
            {t('landing.tagline')}
          </h1>
          <p className="landing-lede">{t('landing.lede')}</p>
          <div className="landing-actions">
            <button type="button" className="btn primary big" onClick={onStart}>
              {t('landing.start')}
            </button>
            <a className="btn secondary big landing-wa-link" href={DEMO_HREF}>
              <WhatsAppMark size={30} />
              {t('landing.channels.whatsapp.cta')}
            </a>
          </div>
          <p className="landing-hint">{t('landing.startHint')}</p>
        </section>

        <section className="landing-block" aria-labelledby="landing-how">
          <h2 id="landing-how">{t('landing.how.title')}</h2>
          <ol className="landing-steps">
            {STEPS.map((i) => (
              <li key={i}>
                <span className="landing-step-n" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <h3>{t(`landing.how.steps.${i}.title`)}</h3>
                  <p>{t(`landing.how.steps.${i}.body`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="landing-block" aria-labelledby="landing-channels">
          <h2 id="landing-channels">{t('landing.channels.title')}</h2>
          <div className="landing-cards">
            <article className="landing-card landing-card-wa">
              <WhatsAppMark size={56} />
              <h3>{t('landing.channels.whatsapp.title')}</h3>
              <p>{t('landing.channels.whatsapp.body')}</p>
              <p className="landing-note">{t('landing.channels.whatsapp.note')}</p>
              <a className="btn big landing-card-link" href={DEMO_HREF}>
                {t('landing.channels.whatsapp.cta')} →
              </a>
            </article>
            <article className="landing-card">
              <h3>{t('landing.channels.app.title')}</h3>
              <p>{t('landing.channels.app.body')}</p>
              <button type="button" className="btn secondary big" onClick={onStart}>
                {t('landing.start')} →
              </button>
            </article>
          </div>
        </section>

        <p className="calm-foot">{t('welcome.foot')}</p>
      </main>
    </div>
  )
}
