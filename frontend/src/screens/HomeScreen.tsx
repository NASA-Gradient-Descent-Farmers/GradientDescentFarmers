import { Brand } from '../components/Brand.tsx'
import { TopBar } from '../components/TopBar.tsx'
import { WhatsAppFab } from '../components/WhatsAppFab.tsx'
import { useI18n } from '../i18n/index.tsx'
import '../landing.css'

const STEPS = [0, 1, 2] as const

/**
 * The home page, shown before signing in: what YolIA is and the way into the app. The WhatsApp simulation is a floating
 * button in the bottom right; it opens its own page, which says on arrival that it is not real WhatsApp.
 */
export function HomeScreen({ onStart }: { onStart: () => void }) {
  const { t } = useI18n()
  return (
    <div className="calm landing">
      <TopBar />
      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
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

        <p className="calm-foot">{t('welcome.foot')}</p>
      </main>
      <WhatsAppFab />
    </div>
  )
}
