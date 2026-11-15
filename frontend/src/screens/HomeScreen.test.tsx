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

  it('is about the places that have data, and does not mention Texcoco', () => {
    expect(words(html)).toContain('Sonora · Sinaloa · Guanajuato')
    expect(words(html)).not.toMatch(/Texcoco|El Batán/)
    expect(words(html)).toContain('Rotaciones de cultivos con satélites de la NASA')
    expect(words(html)).not.toContain('de temporal con satélites')
  })

  it('links to the WhatsApp simulation with the WhatsApp icon, and says it is a simulation', () => {
    const links = html.match(/<a [^>]*href="#\/demo\/whatsapp"/g) ?? []
    expect(links.length).toBe(2)
    expect(html).toContain('class="wa-mark"')
    expect(words(html)).toContain('Es una simulación: no se envía nada a WhatsApp.')
  })

  it('keeps the prototype notice, and does not promise results', () => {
    expect(words(html)).toContain('no es una recomendación agronómica')
    expect(words(html)).toContain('Sin prometer cosechas')
  })

  it('has an English version with the same structure', () => {
    const en = render('en')
    expect(words(en)).toContain('Hello! Welcome to')
    expect(words(en)).toContain('This is a simulation: nothing is sent to WhatsApp.')
    expect((en.match(/href="#\/demo\/whatsapp"/g) ?? []).length).toBe(2)
  })

  it('the simulator link is one the app follows', () => {
    expect(isWhatsAppDemo({ pathname: '/', hash: DEMO_HREF })).toBe(true)
    expect(isWhatsAppDemo({ pathname: '/', hash: '' })).toBe(false)
  })
})
