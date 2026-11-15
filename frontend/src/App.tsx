import { useCallback, useEffect, useState } from 'react'
import { useAccount } from './account/AccountContext.ts'
import { AccountMenu } from './account/AccountMenu.tsx'
import type { Account } from './account/users.ts'
import { Brand } from './components/Brand.tsx'
import { TopBar } from './components/TopBar.tsx'
import { GitHubLink } from './components/GitHubLink.tsx'
import { LangToggle } from './components/LangToggle.tsx'
import { PinGlyph } from './components/icons.tsx'
import { LeafMark } from './components/Leaf.tsx'
import type { WipeOrigin } from './components/LeafTransition.tsx'
import { useI18n } from './i18n/index.tsx'
import { loadData } from './lib/data.ts'
import type { LatLon } from './lib/geo.ts'
import { loadPin, savePin } from './lib/location.ts'
import type { DashboardData } from './lib/types.ts'
import { PlannerScreen, type PlannerStart } from './screens/PlannerScreen.tsx'
import { FarmerHome } from './farmer/ui/FarmerHome.tsx'
import { ParcelTools } from './farmer/ui/ParcelTools.tsx'
import { HomeScreen } from './screens/HomeScreen.tsx'
import { SignInScreen } from './screens/SignInScreen.tsx'
import { WhereScreen } from './screens/WhereScreen.tsx'
import { AssistantPage, type Seed } from './assistant/ui/AssistantPage.tsx'
import type { Profile } from './onboarding/types.ts'

// Técnico's three pages: the assistant, the full planner, and the parcel tools (the guided questions and recommendation pages).
const TABS = ['assistant', 'planner', 'parcel'] as const
type AppRoute = (typeof TABS)[number]
// 'home' is the Agricultor home (the assistant and the parcel); the rest belong to Técnico.
type Route = 'home' | 'where' | AppRoute

const NO_SITE: LatLon = { lat: 0, lon: 0 } // only used before the data (and so the modeled site) has loaded
// The farmer is no longer asked questions: the assistant starts from the pin alone and learns the rest from the chat.
const NO_ANSWERS: Profile = {}

/**
 * Signed out: the home page, and from it the sign-in. Signed in: the app for how this account uses it, started afresh for
 * each account and mode.
 */
export default function App() {
  const { user } = useAccount()
  const [started, setStarted] = useState(false)
  if (user) return <Workspace key={`${user.id}:${user.mode}`} user={user} />
  return started ? <SignInScreen onBack={() => setStarted(false)} /> : <HomeScreen onStart={() => setStarted(true)} />
}

function Workspace({ user }: { user: Account }) {
  const { t, lang, coords } = useI18n()
  // Técnico opens on the full planner; Agricultor on its home.
  const [route, setRoute] = useState<Route>(user.mode === 'tecnico' ? 'planner' : 'home')
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pin, setPin] = useState<LatLon | null>(loadPin)
  // Where the map step leads once the pin is confirmed, and where its back button returns to.
  const [after, setAfter] = useState<AppRoute>('assistant')
  // A question from the home page (a card or the ask box), asked once the assistant opens; and settings the planner starts from.
  const [seed, setSeed] = useState<Seed | null>(null)
  const [plannerStart, setPlannerStart] = useState<{ start: PlannerStart; key: number } | null>(null)
  const [before, setBefore] = useState<Route>('planner')
  const seedUsed = useCallback(() => setSeed(null), [])

  const site: LatLon = data ? { lat: data.meta.site.latitude, lon: data.meta.site.longitude } : NO_SITE

  useEffect(() => {
    document.documentElement.lang = lang
    document.title = t('app.title')
  }, [lang, t])

  useEffect(() => {
    loadData().then(setData, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  /** Go to a page. (The second argument is where the old leaf wipe started; pages change plainly now.) */
  const go = (to: Route, _from?: WipeOrigin) => {
    setRoute(to)
    window.scrollTo(0, 0)
  }

  /** Open the map step; `then` is where it leads and where "back" returns. */
  const openMap = (then: AppRoute, from: WipeOrigin, returnTo: Route) => {
    setAfter(then)
    setBefore(returnTo)
    go('where', from)
  }

  const shellDestination: AppRoute = route === 'planner' || route === 'parcel' ? route : 'assistant'
  const centre = (): WipeOrigin => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
  const changePin = (point: LatLon) => {
    savePin(point)
    setPin(point)
  }

  let page
  if (route === 'home') {
    page = data ? (
      <FarmerHome pin={pin} onPin={changePin} site={site} />
    ) : (
      <div className="fa fa-solo">
        <TopBar />
        <main id="fa-main" className="page">
          <p className={error ? 'notice error' : 'loading'} role={error ? 'alert' : 'status'}>
            {error ? t('app.loadError', { message: error }) : t('app.loading')}
          </p>
        </main>
      </div>
    )
  } else if (route === 'where') {
    page = data ? (
      <WhereScreen
        initial={pin}
        onBack={(from) => go(before, from)}
        onConfirm={(point, from) => {
          changePin(point)
          go(after, from)
        }}
      />
    ) : (
      <p className="status">{error ? t('app.loadError', { message: error }) : t('app.loading')}</p>
    )
  } else {
    page = (
      <div className={`shell-wrap${route === 'assistant' ? ' assistant-mode' : ''}`}>
      <div className="shell">
        <header className="app-header">
          <div className="brand-link">
            <LeafMark className="brand-leaf" />
            <Brand className="brand-name" />
          </div>
          <p className="brand-tagline">{t('app.tagline')}</p>
          {pin && (
            <button
              type="button"
              className="pin-chip"
              onClick={(e) => {
                const box = e.currentTarget.getBoundingClientRect()
                openMap(shellDestination, { x: box.left + 16, y: box.top + box.height / 2 }, route)
              }}
            >
              <PinGlyph /> {t('where.pinLabel')}: {coords(pin)} · <u>{t('where.change')}</u>
            </button>
          )}
          <GitHubLink />
          <AccountMenu />
          <LangToggle />
        </header>

        <nav className="tabs" aria-label={t('nav.label')}>
          {TABS.map((id) => (
            <button key={id} type="button" aria-current={route === id ? 'page' : undefined} onClick={() => setRoute(id)}>
              {t(`assistant.tabs.${id}`)}
            </button>
          ))}
        </nav>

        <div className="caveat" role="note">
          <strong>{t('caveat.title')}</strong> {t('caveat.body')}
        </div>

        <main className={route === 'assistant' ? 'assistant-main' : undefined}>
          {error && <p className="status error">{t('app.loadError', { message: error })}</p>}
          {!error && !data && <p className="status">{t('app.loading')}</p>}
          {data && route === 'planner' && <PlannerScreen key={plannerStart?.key ?? 0} data={data} start={plannerStart?.start} />}
          {data && route === 'parcel' && (
            <ParcelTools data={data} pin={pin} onPin={changePin} site={site} onAsk={() => setRoute('assistant')} />
          )}
          {data && route === 'assistant' && (
            <AssistantPage
              data={data}
              pin={pin}
              site={site}
              seed={seed}
              onSeedUsed={seedUsed}
              profile={NO_ANSWERS}
              onEditPin={(from) => openMap('assistant', from ?? centre(), 'assistant')}
              onOpenPlanner={(settings) => {
                setPlannerStart({ start: settings, key: Date.now() })
                setRoute('planner')
                window.scrollTo(0, 0)
              }}
            />
          )}
        </main>
      </div>
      </div>
    )
  }

  return page
}
