import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { data } from '../assistant/testdata.ts'
import { I18nProvider } from '../i18n/index.tsx'
import { richText } from './format.tsx'
import { WhatsAppChat } from './WhatsAppDemo.tsx'

const html = renderToStaticMarkup(
  <I18nProvider initial="es">
    <WhatsAppChat data={data} home="/" />
  </I18nProvider>,
)
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

describe('the simulator screen', () => {
  it('is labelled as a simulation, in the header area and in the banner', () => {
    expect(text).toContain('Simulación · no es WhatsApp real')
    expect(text).toContain('SIMULACIÓN')
    expect(text).toMatch(/no se envía nada a WhatsApp/i)
  })

  it('shows the WhatsApp mark on the avatar, as a decorative icon that assistive technology skips', () => {
    expect(html).toMatch(/<span class="wa-badge"><svg class="wa-mark"[^>]*aria-hidden="true"/)
  })

  it('offers the four suggested questions', () => {
    for (const question of ['¿Qué me conviene sembrar?', '¿Qué pasa si llueve poco?', '¿Cuánto podría cosechar?', '¿Qué cultivo me conviene más?']) expect(text).toContain(question)
  })

  it('has a message box with a send button (off until something is typed), a reset button and a link to the YolIA site', () => {
    expect(html).toContain('type="text"')
    expect(html).toMatch(/<button[^>]*class="wa-send"[^>]*disabled/)
    expect(html).toContain('aria-label="Enviar"')
    expect(html).toContain('aria-label="Reiniciar la conversación"')
    expect(html).toMatch(/<a href="\/" class="wa-site">Abrir el sitio de YolIA/)
  })

  it('is labelled for assistive technology, and needs no key or network to render', () => {
    expect(html).toContain('role="log"')
    expect(html).toContain('<label for="wa-input"')
    expect(html).not.toMatch(/api[_-]?key|https?:\/\//i)
  })
})

describe('the location selector', () => {
  it('offers exactly the three locations, none chosen at first', () => {
    for (const name of ['Guanajuato', 'Sinaloa', 'Sonora']) expect(html).toMatch(new RegExp(`aria-pressed="false"[^>]*>${name}<`))
    expect((html.match(/class="wa-place"/g) ?? []).length).toBe(3)
    expect(text).toContain('Elige una ubicación')
  })
})

describe('richText', () => {
  it('turns *bold* into bold and leaves everything else alone', () => {
    expect(renderToStaticMarkup(<>{richText('Hola *mundo* y 2 * 3 *no*')}</>)).toBe('Hola <strong>mundo</strong> y 2 * 3 <strong>no</strong>')
  })
})
