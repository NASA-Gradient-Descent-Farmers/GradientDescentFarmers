import { useEffect, useState } from 'react'
import { useAccount } from './account/AccountContext.ts'
import { AccountMenu } from './account/AccountMenu.tsx'
import type { Account } from './account/users.ts'
import { Brand } from './components/Brand.tsx'
import { TopBar } from './components/TopBar.tsx'
import { LangToggle } from './components/LangToggle.tsx'
import { PinGlyph } from './components/icons.tsx'
import { LeafMark } from './components/Leaf.tsx'
import type { WipeOrigin } from './components/LeafTransition.tsx'
import { useI18n } from './i18n/index.tsx'
import { loadData } from './lib/data.ts'
import type { LatLon } from './lib/geo.ts'
import { loadPin, savePin } from './lib/location.ts'
import type { DashboardData } from './lib/types.ts'
import { FarmerHome } from './farmer/ui/FarmerHome.tsx'
import { ParcelTools } from './farmer/ui/ParcelTools.tsx'
import { HomeScreen } from './screens/HomeScreen.tsx'
import { SignInScreen } from './screens/SignInScreen.tsx'
import { WhereScreen } from './screens/WhereScreen.tsx'

// Técnico is one page, the parcel tools (Mi parcela, Qué sembrar, Preguntar a YolIA); 'home' is the Agricultor home.
type Route = 'home' | 'where' | 'parcel'

const NO_SITE: LatLon = { lat: 0, lon: 0 } // only used before the data (and so the modeled site) has loaded

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
  // Técnico opens on the parcel tools; Agricultor on its home.
  const [route, setRoute] = useState<Route>(user.mode === 'tecnico' ? 'parcel' : 'home')
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pin, setPin] = useState<LatLon | null>(loadPin)
  // Where the map step leads once the pin is confirmed, and where its back button returns to.
  const [after, setAfter] = useState<Route>('parcel')
  const [before, setBefore] = useState<Route>('parcel')

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
  const openMap = (then: Route, from: WipeOrigin, returnTo: Route) => {
    setAfter(then)
    setBefore(returnTo)
    go('where', from)
  }

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
      <div className="shell-wrap">
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
                  openMap('parcel', { x: box.left + 16, y: box.top + box.height / 2 }, route)
                }}
              >
                <PinGlyph /> {t('where.pinLabel')}: {coords(pin)} · <u>{t('where.change')}</u>
              </button>
            )}
            <AccountMenu />
            <LangToggle />
          </header>

          <div className="caveat" role="note">
            <strong>{t('caveat.title')}</strong> {t('caveat.body')}
          </div>

          <main>
            {error && <p className="status error">{t('app.loadError', { message: error })}</p>}
            {!error && !data && <p className="status">{t('app.loading')}</p>}
            {data && <ParcelTools pin={pin} onPin={changePin} site={site} />}
          </main>
        </div>
      </div>
    )
  }

  return page
}
