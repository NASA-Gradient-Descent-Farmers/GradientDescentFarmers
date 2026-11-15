import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AccountProvider } from '../account/AccountProvider.tsx'
import { I18nProvider } from '../i18n/index.tsx'
import { DEMO_HREF, isWhatsAppDemo } from '../whatsapp/route.ts'
import { HomeScreen } from './HomeScreen.tsx'

const render = (lang: 'es' | 'en') =>
  renderToStaticMarkup(
    <I18nProvider initial={lang}>
      <AccountProvider>
        <HomeScreen onStart={() => {}} />
      </AccountProvider>
    </I18nProvider>,
  )
const words = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('the home page', () => {
  const html = render('es')

  it('greets, says what YolIA is, and offers the way into the app', () => {
    expect(words(html)).toContain('¡Hola! Bienvenido a')
    expect(words(html)).toContain('satélites de la NASA')
    expect(html).toMatch(/<button[^>]*>Entrar a YolIA<\/button>/)
  })

  it('does not list the places, and does not mention Texcoco', () => {
    expect(words(html)).not.toMatch(/Sonora|Sinaloa|Guanajuato|Texcoco|El Batán/)
    expect(words(html)).toContain('Rotaciones de cultivos con satélites de la NASA')
  })

  it('has the WhatsApp simulation as one floating button, not as buttons in the page', () => {
    const links = html.match(/<a [^>]*href="#\/demo\/whatsapp"[^>]*>/g) ?? []
    expect(links).toHaveLength(1)
    expect(links[0]).toContain('class="wa-fab"')
    expect(links[0]).toContain('aria-label="Abrir la simulación de WhatsApp (simulación, no es WhatsApp real)"')
    expect(html).toContain('class="wa-mark"')
    expect(words(html)).toContain('Probar por WhatsApp')
  })

  it('keeps the prototype notice, and does not promise results', () => {
    expect(words(html)).toContain('no es una recomendación agronómica')
    expect(words(html)).toContain('Sin prometer cosechas')
  })

  it('has an English version with the same structure', () => {
    const en = render('en')
    expect(words(en)).toContain('Hello! Welcome to')
    expect(words(en)).toContain('Try it on WhatsApp')
    expect((en.match(/href="#\/demo\/whatsapp"/g) ?? []).length).toBe(1)
  })

  it('the simulator link is one the app follows', () => {
    expect(isWhatsAppDemo({ pathname: '/', hash: DEMO_HREF })).toBe(true)
    expect(isWhatsAppDemo({ pathname: '/', hash: '' })).toBe(false)
  })
})
