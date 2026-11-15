import { lazy, StrictMode, Suspense } from 'react'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isWhatsAppDemo(window.location) ? (
      <Suspense fallback={null}>
        <WhatsAppDemo />
      </Suspense>
    ) : (
      <I18nProvider>
        <AccountProvider>
          <App />
        </AccountProvider>
      </I18nProvider>
    )}
  </StrictMode>,
)
