import { lazy, StrictMode, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/fraunces/opsz.css'
import './index.css'
import './home.css'
import './where.css'
import './assistant.css'
import './onboarding.css'
import './theme.css'
import { AccountProvider } from './account/AccountProvider.tsx'
import App from './App.tsx'
import { I18nProvider } from './i18n/index.tsx'
import { isWhatsAppDemo } from './whatsapp/route.ts'

// The WhatsApp simulator (/demo/whatsapp) is its own page: no sign-in, and its code loads only when it is opened.
const WhatsAppDemo = lazy(() => import('./whatsapp/WhatsAppDemo.tsx'))

// The simulator is also reached by a link on the home page (#/demo/whatsapp), which changes the address without loading
// the page again, so the choice between the two follows the address.
function Root() {
  const [demo, setDemo] = useState(() => isWhatsAppDemo(window.location))
  useEffect(() => {
    const follow = () => setDemo(isWhatsAppDemo(window.location))
    window.addEventListener('hashchange', follow)
    window.addEventListener('popstate', follow)
    return () => {
      window.removeEventListener('hashchange', follow)
      window.removeEventListener('popstate', follow)
    }
  }, [])
  return demo ? (
    <Suspense fallback={null}>
      <WhatsAppDemo />
    </Suspense>
  ) : (
    <I18nProvider>
      <AccountProvider>
        <App />
      </AccountProvider>
    </I18nProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
