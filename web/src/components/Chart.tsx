import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { ChartKind, Rows } from '../lib/api'
import { bareLabel, figure, fmtCell, fmtTick, fmtValue, label, unit } from '../lib/format'

/** One chart picked by the API's hint, with the plain data table behind it for keyboards and screen readers. */
export function Chart({ data }: { data: Rows }) {
  const kind: ChartKind = data.chart ?? 'table'
  if (kind === 'stat' || figuresRow(data)) return <Figures data={data} />
  return (
    <div>
      {(kind === 'line' || kind === 'bar') && <Plot data={data} kind={kind} />}
      <details className="group mt-5" open={kind === 'table'}>
        <summary className="inline-flex cursor-pointer list-none items-center gap-2 border border-ink px-3 py-1 text-sm font-semibold text-ink hover:bg-wash [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="transition-transform group-open:rotate-90">
            ›
          </span>
          Data table, {data.rows.length} {data.rows.length === 1 ? 'row' : 'rows'}
        </summary>
        <DataTable data={data} />
      </details>
    </div>
  )
}

/** One row of up to three cells with at most one that is not a number ("December", 11505; or 45.71, 10283):
 *  a single bar would fill the chart, so each number is shown as a figure instead. */
function figuresRow(data: Rows): boolean {
  const row = data.rows[0]
  return data.rows.length === 1 && row.length <= 3 && row.filter((v) => typeof v !== 'number').length <= 1
}

/** Each number large under its column name, side by side; a lone label such as the month sits beneath them. */
function Figures({ data }: { data: Rows }) {
  const row = data.rows[0]
  const numbers = row.map((_, i) => i).filter((i) => typeof row[i] === 'number' || row.length === 1)
  const caption = row.findIndex((_, i) => !numbers.includes(i))
  return (
    <div>
      <div className="flex flex-wrap gap-x-16 gap-y-6">
        {numbers.map((i) => {
          const [value, after] = figure(row[i], data.columns[i])
          return (
            <div key={i}>
              <div className="text-label font-bold text-ink-2">{bareLabel(data.columns[i])}</div>
              <div className="flex flex-wrap items-baseline gap-x-2.5">
                <span className="text-6xl leading-none font-bold tracking-tight text-ink sm:text-7xl">{value}</span>
                {after && <span className="text-xl font-semibold text-ink-2">{after}</span>}
              </div>
            </div>
          )
        })}
      </div>
      {caption >= 0 && <div className="mt-1 text-lg text-ink-2">{fmtCell(row[caption], data.columns[caption])}</div>}
    </div>
  )
}

const H = 260
const PAD = { right: 12, top: 26, bottom: 32 }

/** The SVG is drawn at the width it is shown at, so text stays the same size on a phone. */
function useWidth<T extends HTMLElement = HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(640)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(Math.max(280, Math.round(el.clientWidth)))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

/** Round steps for the value axis: a few gridlines at numbers people can read. */
function axis(lo: number, hi: number) {
  const raw = (hi - lo || 1) / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag
  const bottom = Math.floor(lo / step) * step
  const top = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v)
  return { bottom, top, ticks }
}

/** A line over time or bars by category: the same frame, gridlines and labels for both.
 *  The highest and lowest values are labelled; hover, tap or the arrow keys read any other. */
function Plot({ data, kind }: { data: Rows; kind: 'line' | 'bar' }) {
  const [ref, W] = useWidth()
  const svg = useRef<SVGSVGElement>(null)
  const [active, setActive] = useState<number | null>(null)
  const [xCol, yCol] = data.columns
  const xs = data.rows.map((r) => fmtCell(r[0], xCol, true))
  const ys = data.rows.map((r) => Number(r[1]) || 0)
  const { bottom, top, ticks } = axis(Math.min(0, ...ys), Math.max(...ys))
  const left = 16 + 7 * Math.max(...ticks.map((t) => fmtTick(t).length))
  const inner = W - left - PAD.right
  const n = ys.length
  const slot = inner / n
  const sy = (y: number) => PAD.top + (H - PAD.bottom - PAD.top) * (1 - (y - bottom) / (top - bottom || 1))
  const base = sy(Math.min(0, top)) // bars grow from zero
  // A line spreads its points edge to edge; bars get one slot each, at most 22 px wide and 2 px apart.
  const sx = (i: number) => (kind === 'line' ? left + (inner * i) / Math.max(n - 1, 1) : left + slot * (i + 0.5))
  const bw = Math.min(22, Math.max(1, slot - 2))
  // One x label per slot wide enough for the longest label. A line also labels its first and last point, flush
  // with the edges, and drops any label in between that would run into those two.
  const textW = 6.5 * Math.max(...xs.map((x) => Math.min(x.length, 10)))
  const every = Math.ceil((n * (textW + 8)) / inner)
  const anchor = (i: number) => (kind === 'bar' ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle')
  const xLabels = xs
    .map((_, i) => i)
    .filter((i) => {
      if (kind === 'bar') return i % every === 0
      if (i === 0 || i === n - 1) return true
      return i % every === 0 && sx(i) - textW / 2 > sx(0) + textW + 8 && sx(i) + textW / 2 < sx(n - 1) - textW - 8
    })
  const u = unit(yCol)
  const title = label(yCol) + (u && !label(yCol).toLowerCase().includes(u.toLowerCase()) ? ` (${u})` : '')
  const hi = ys.indexOf(Math.max(...ys))
  const lo = ys.indexOf(Math.min(...ys))
  const marked = n < 2 ? [] : hi === lo ? [hi] : [hi, lo]
  const line = ys.map((y, i) => `${sx(i).toFixed(1)},${sy(y).toFixed(1)}`).join(' ')
  // The low point of a line is labelled under it when there is room above the x labels.
  const below = (i: number) => (kind === 'bar' ? ys[i] < 0 : i === lo && i !== hi && sy(ys[i]) + 20 < H - PAD.bottom - 2)

  const point = (e: PointerEvent<SVGRectElement>) => {
    const box = svg.current?.getBoundingClientRect()
    if (!box) return
    const x = ((e.clientX - box.left) * W) / box.width - left
    const i = kind === 'line' ? Math.round((x / inner) * (n - 1)) : Math.floor(x / slot)
    setActive(Math.max(0, Math.min(n - 1, i)))
  }
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') setActive(null)
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    setActive((a) => Math.max(0, Math.min(n - 1, a === null ? (step > 0 ? 0 : n - 1) : a + step)))
  }

  return (
    <figure ref={ref}>
      <figcaption className="mb-3 flex flex-wrap justify-between gap-x-3 text-label">
        <span className="font-bold text-ink">
          {bareLabel(yCol)} by {label(xCol).toLowerCase()}
        </span>
        {u && <span className="text-muted">{u}</span>}
      </figcaption>
      <div
        role="group"
        tabIndex={0}
        aria-label={`${title} by ${label(xCol)}. Use the arrow keys to read each value.`}
        onKeyDown={keys}
        onBlur={() => setActive(null)}
        className="relative focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-link"
      >
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" className="block max-w-full">
          <g fontSize={12} fill="var(--muted)">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={W - PAD.right} y1={sy(t)} y2={sy(t)} stroke={t === 0 ? 'var(--ink)' : 'var(--grid)'} />
                <text x={left - 10} y={sy(t) + 4} textAnchor="end">
                  {fmtTick(t)}
                </text>
              </g>
            ))}
            {xLabels.map((i) => (
              <text key={i} x={sx(i)} y={H - 10} textAnchor={anchor(i)}>
                {xs[i].length > 12 ? xs[i].slice(0, 10) : xs[i]}
              </text>
            ))}
          </g>
          {kind === 'line' ? (
            <>
              <polygon points={`${sx(0).toFixed(1)},${base} ${line} ${sx(n - 1).toFixed(1)},${base}`} fill="var(--accent)" fillOpacity={0.08} />
              <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {active !== null && <line x1={sx(active)} x2={sx(active)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--ink)" strokeOpacity={0.35} />}
              {ys.map((y, i) => (n <= 60 || marked.includes(i) || i === active) && <circle key={i} cx={sx(i)} cy={sy(y)} r={i === active ? 5 : 4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />)}
            </>
          ) : (
            ys.map((y, i) => (
              <rect key={i} x={sx(i) - bw / 2} y={Math.min(base, sy(y))} width={bw} height={Math.max(Math.abs(sy(y) - base), 1)} fill={i === active ? 'var(--accent-strong)' : 'var(--accent)'} />
            ))
          )}
          {/* A halo in the page colour keeps a label readable where it crosses the line. */}
          <g fontSize={13} fontWeight={700} fill="var(--ink)" stroke="var(--surface)" strokeWidth={4} strokeLinejoin="round" paintOrder="stroke">
            {marked.map((i) => (
              <text key={i} x={sx(i)} y={below(i) ? sy(ys[i]) + 20 : sy(ys[i]) - 10} textAnchor={sx(i) < left + 30 ? 'start' : sx(i) > W - PAD.right - 30 ? 'end' : 'middle'}>
                {fmtValue(ys[i], yCol)}
              </text>
            ))}
          </g>
          <rect x={left} y={0} width={Math.max(inner, 0)} height={H} fill="transparent" onPointerMove={point} onPointerDown={point} onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)} />
        </svg>
        {active !== null && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full bg-ink px-3 py-1.5 text-center text-sm whitespace-nowrap text-white"
            style={{ left: Math.min(Math.max(sx(active), 60), W - 60), top: Math.max((kind === 'bar' ? sy(Math.max(ys[active], 0)) : sy(ys[active])) - 12, 48) }}
          >
            <div className="font-bold">{fmtValue(ys[active], yCol)}</div>
            <div className="text-xs text-white/75">{fmtCell(data.rows[active][0], xCol)}</div>
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          {active !== null ? `${fmtCell(data.rows[active][0], xCol)}: ${fmtValue(ys[active], yCol)}` : ''}
        </p>
      </div>
    </figure>
  )
}

const MAX_TABLE_ROWS = 50

function DataTable({ data }: { data: Rows }) {
  const shown = data.rows.slice(0, MAX_TABLE_ROWS)
  return (
    <div className="mt-3 overflow-x-auto border border-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-wash">
          <tr className="text-xs text-ink-2">
            {data.columns.map((c) => (
              <th key={c} scope="col" className="px-4 py-2.5 font-bold">
                {label(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, i) => (
            <tr key={i} className="border-t border-line">
              {row.map((v, j) => (
                <td key={j} className={`px-4 py-2 ${typeof v === 'number' ? 'tabular-nums' : ''}`}>
                  {fmtCell(v, data.columns[j])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.rows.length > MAX_TABLE_ROWS && (
        <p className="border-t border-line px-4 py-2 text-xs text-muted">
          Showing the first {MAX_TABLE_ROWS} of {data.rows.length} rows.
        </p>
      )}
    </div>
  )
}

/** A small line from lowest to highest, with no axes: the shape of an example answer in the list. */
export function Spark({ values, width = 96, height = 24 }: { values: number[]; width?: number; height?: number }) {
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const sx = (i: number) => 2 + ((width - 4) * i) / Math.max(values.length - 1, 1)
  const sy = (v: number) => 2 + (height - 4) * (1 - (v - lo) / (hi - lo || 1))
  const points = values.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true" className="block shrink-0 overflow-visible">
      <polyline points={points} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
