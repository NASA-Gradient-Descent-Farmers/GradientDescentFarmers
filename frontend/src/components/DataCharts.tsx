import { useI18n } from '../i18n/index.tsx'
import { niceTicks } from '../lib/ticks.ts'

// Two small charts for the environmental data. They draw only the values they are given (a missing value is a gap, never a
// zero) and carry a text label for assistive technology; the page puts the same facts in words next to each chart.

const W = 360
const H = 190
const M = { top: 10, right: 8, bottom: 24, left: 38 }
const COLORS = ['var(--black)', 'var(--orange-500)']

export interface BarSeries {
  name: string
  /** One value per month, January first; null where there is none. */
  values: (number | null)[]
}

function Legend({ names }: { names: string[] }) {
  return (
    <p className="chart-legend">
      {names.map((name, i) => (
        <span key={name}>
          <i style={{ background: COLORS[i % COLORS.length] }} aria-hidden="true" /> {name}
        </span>
      ))}
    </p>
  )
}

/** Values by month, one thin bar per series in each month. */
export function MonthlyBars({ series, label }: { series: BarSeries[]; label: string }) {
  const { fmt } = useI18n()
  const top = Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null)))
  const ticks = niceTicks(0, top, 4)
  const ceiling = Math.max(top, ticks[ticks.length - 1])
  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const group = plotW / 12
  const bar = Math.min(12, (group - 4) / series.length)
  const y = (v: number) => M.top + plotH - (v / ceiling) * plotH
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" />
            <text x={M.left - 6} y={y(tick) + 4} textAnchor="end" fontSize="11" fill="var(--text-2)">
              {fmt.tick(tick)}
            </text>
          </g>
        ))}
        {Array.from({ length: 12 }, (_, month) => (
          <g key={month}>
            {series.map((s, i) => {
              const v = s.values[month]
              if (v === null || v === undefined) return null
              const x = M.left + month * group + (group - bar * series.length) / 2 + i * bar
              return <rect key={s.name} x={x} y={y(v)} width={bar - 1} height={Math.max(0, M.top + plotH - y(v))} rx="2" fill={COLORS[i % COLORS.length]} />
            })}
            <text x={M.left + month * group + group / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--text-2)">
              {fmt.monthShort(month)}
            </text>
          </g>
        ))}
      </svg>
      <Legend names={series.map((s) => s.name)} />
    </figure>
  )
}

export interface LineSeries {
  name: string
  points: { date: string; value: number | null }[]
}

const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000

/** One or two series over time. A point without a value breaks the line instead of dropping to zero. */
export function TimeLine({ series, label, decimals = 1 }: { series: LineSeries[]; label: string; decimals?: number }) {
  const { fmt } = useI18n()
  const all = series.flatMap((s) => s.points.filter((p): p is { date: string; value: number } => p.value !== null))
  if (all.length === 0) return null
  const x0 = Math.min(...all.map((p) => dayNumber(p.date)))
  const x1 = Math.max(...all.map((p) => dayNumber(p.date)), x0 + 1)
  const lo = Math.min(...all.map((p) => p.value))
  const hi = Math.max(...all.map((p) => p.value))
  const ticks = niceTicks(Math.min(0, lo), hi, 4)
  const floor = Math.min(ticks[0], lo)
  const ceiling = Math.max(ticks[ticks.length - 1], hi)
  const plotW = W - M.left - M.right
  const plotH = H - M.top - M.bottom
  const px = (date: string) => M.left + ((dayNumber(date) - x0) / (x1 - x0)) * plotW
  const py = (v: number) => M.top + plotH - ((v - floor) / (ceiling - floor || 1)) * plotH
  // a label at the start of every third month
  const firstDate = new Date(x0 * 86_400_000)
  const marks: { x: number; text: string }[] = []
  for (let m = 0; m < 48; m++) {
    const at = Date.UTC(firstDate.getUTCFullYear(), firstDate.getUTCMonth() + m, 1) / 86_400_000
    if (at > x1) break
    if (at >= x0 && m % 3 === 0) marks.push({ x: M.left + ((at - x0) / (x1 - x0)) * plotW, text: `${fmt.monthShort(new Date(at * 86_400_000).getUTCMonth())} ${String(new Date(at * 86_400_000).getUTCFullYear()).slice(2)}` })
  }
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={M.left} x2={W - M.right} y1={py(tick)} y2={py(tick)} stroke="var(--line)" />
            <text x={M.left - 6} y={py(tick) + 4} textAnchor="end" fontSize="11" fill="var(--text-2)">
              {fmt.number(tick, decimals > 1 ? 1 : 0)}
            </text>
          </g>
        ))}
        {marks.map((mark) => (
          <text key={mark.x} x={mark.x} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--text-2)">
            {mark.text}
          </text>
        ))}
        {series.map((s, i) => {
          // consecutive points with values form one stroke; a gap starts a new one
          const strokes: string[] = []
          let current = ''
          for (const point of s.points) {
            if (point.value === null) {
              if (current) strokes.push(current)
              current = ''
            } else current += `${current ? 'L' : 'M'}${px(point.date).toFixed(1)} ${py(point.value).toFixed(1)}`
          }
          if (current) strokes.push(current)
          return strokes.map((d, k) => <path key={`${s.name}${k}`} d={d} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="2" strokeLinejoin="round" />)
        })}
      </svg>
      {series.length > 1 && <Legend names={series.map((s) => s.name)} />}
    </figure>
  )
}
