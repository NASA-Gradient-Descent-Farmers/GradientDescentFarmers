import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AccountProvider } from '../account/AccountProvider.tsx'
import { I18nProvider } from '../i18n/index.tsx'
import { HomeScreen } from '../screens/HomeScreen.tsx'
import { GitHubLink, REPO_URL } from './GitHubLink.tsx'
import { TopBar } from './TopBar.tsx'

const render = (node: React.ReactNode, lang: 'es' | 'en' = 'es') =>
  renderToStaticMarkup(
    <I18nProvider initial={lang}>
      <AccountProvider>{node}</AccountProvider>
    </I18nProvider>,
  )

describe('the GitHub link in the top bar', () => {
  it('points to the project repository, opens in a new tab safely and is labelled for assistive technology', () => {
    const html = render(<GitHubLink />)
    expect(REPO_URL).toBe('https://github.com/NASA-Gradient-Descent-Farmers/GradientDescentFarmers')
    expect(html).toContain(`href="${REPO_URL}"`)
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('aria-label="Ver el código de YoliA en GitHub (se abre en otra pestaña)"')
    expect(html).toMatch(/<svg class="github-mark"[^>]*aria-hidden="true"/)
  })

  it('is in the top bar of every screen that has one, and in English when English is chosen', () => {
    expect(render(<TopBar />)).toContain(`href="${REPO_URL}"`)
    expect(render(<HomeScreen onStart={() => {}} />)).toContain(`href="${REPO_URL}"`)
    expect(render(<GitHubLink />, 'en')).toContain('Code on GitHub')
  })
})
