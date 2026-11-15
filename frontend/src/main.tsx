import { StrictMode } from 'react'
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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AccountProvider>
        <App />
      </AccountProvider>
    </I18nProvider>
  </StrictMode>,
)
