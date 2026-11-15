import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n/index.tsx'
import { MonthlyBars, TimeLine } from './DataCharts.tsx'

const render = (node: React.ReactNode) => renderToStaticMarkup(<I18nProvider initial="es">{node}</I18nProvider>)

describe('the data charts', () => {
  it('draw one bar per month with a value, and none where the value is missing', () => {
    const values = [10, null, 5, ...Array.from({ length: 9 }, () => 0)]
    const html = render(<MonthlyBars label="Lluvia" series={[{ name: '2024', values }]} />)
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Lluvia"')
    expect((html.match(/<rect/g) ?? []).length).toBe(11)
  })

  it('a gap in a time series breaks the line instead of dropping to zero', () => {
    const points = [
      { date: '2024-01-01', value: 1 },
      { date: '2024-02-01', value: 2 },
      { date: '2024-03-01', value: null },
      { date: '2024-04-01', value: 3 },
    ]
    const html = render(<TimeLine label="NDVI" series={[{ name: 'NDVI', points }]} />)
    expect((html.match(/<path/g) ?? []).length).toBe(2)
  })

  it('draws nothing when there are no values at all', () => {
    expect(render(<TimeLine label="x" series={[{ name: 'x', points: [{ date: '2024-01-01', value: null }] }]} />)).not.toContain('<svg')
  })
})
