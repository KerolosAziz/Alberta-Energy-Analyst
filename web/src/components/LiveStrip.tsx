import { Fragment, useState } from 'react'
import type { Market } from '../lib/api'
import { asOf, dayLabel, fmtNumber, hourLabel, money } from '../lib/format'

const STALE_HOURS = 3 // the hourly job keeps the data 0 or 1 hours behind

/** The latest hour in the database: price and demand, then the days before it hour by hour. Hidden when the API had nothing. */
export function LiveStrip({ market }: { market: Market | null }) {
  if (!market?.price || !market.load) return null
  const { price, load, week } = market
  const behind = market.hours_behind ?? 0
  return (
    <section aria-label="Latest data">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-t-2 border-ink pt-2.5">
        <h2 className="text-label font-bold">Pool price, latest hour</h2>
        <p className="text-sm text-muted">{asOf(price.as_of)}, Alberta time</p>
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-7 gap-y-1">
        <p className="flex items-baseline gap-2">
          <span className="text-figure font-bold tracking-tight">${money(price.value)}</span>
          <span className="text-ink-2">per MWh</span>
        </p>
        <p className="flex items-baseline gap-1.5">
          <span className="text-2xl font-bold tracking-tight">{fmtNumber(load.value)} MW</span>
          <span className="text-ink-2">demand</span>
        </p>
      </div>
      {behind >= STALE_HOURS && (
        <p role="status" className="mt-4 bg-sun-soft px-3 py-2 text-sm text-sun-ink">
          {behind} hours behind: the hourly update has not run since then.
        </p>
      )}
      {week.length > 1 && <Heatmap week={week} />}
    </section>
  )
}

/** The top of each price band in $/MWh, cheapest first; one more band holds everything above the last. Fixed on
 *  purpose, so a colour means the same price every week. Colours --heat-0 to --heat-5 are in index.css. */
const LIMITS = [25, 50, 100, 200, 500]
const BANDS = [...LIMITS, Infinity].map((max, i) => ({
  max,
  colour: `var(--heat-${i})`,
  name: i === 0 ? `under $${max}` : max === Infinity ? `$${LIMITS[i - 1]}+` : `$${LIMITS[i - 1]}–${max}`,
}))
const colour = (v: number) => BANDS.find((b) => v < b.max)!.colour
const DAY_COLUMN = '3.25rem' // the day labels down the left
const HOUR_TICKS = [0, 6, 12, 18]

/** One row per day, one cell per hour, coloured by price. Hover or tap an hour to read it; the line above shows the highest until then. */
function Heatmap({ week }: { week: [string, number][] }) {
  const [hover, setHover] = useState<[string, number] | null>(null)
  const days = [...new Set(week.map(([stamp]) => stamp.slice(0, 10)))]
  const byHour = new Map(week.map((point) => [point[0].slice(0, 13), point]))
  const values = week.map(([, v]) => v)
  const high = week[values.indexOf(Math.max(...values))]
  const cheap = values.filter((v) => v < BANDS[0].max).length
  const shown = hover ?? high
  return (
    <figure className="mt-7">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-label font-bold">Last {Math.round(week.length / 24)} days, hour by hour</span>
        <span className="text-sm text-muted" aria-live="polite">
          {hover ? '' : 'Highest: '}${money(shown[1])}, {asOf(shown[0])}
        </span>
      </figcaption>
      <div
        role="img"
        aria-label={`Hourly pool prices for ${days.length} days. ${cheap} of ${week.length} hours were ${BANDS[0].name}; the highest was $${money(high[1])} at ${asOf(high[0])}.`}
        onPointerLeave={() => setHover(null)}
        className="mt-2.5 grid gap-0.5"
        style={{ gridTemplateColumns: `${DAY_COLUMN} repeat(24, minmax(0, 1fr))` }}
      >
        <span />
        {HOUR_TICKS.map((h, i) => (
          <span key={h} className="text-xs text-muted" style={{ gridColumn: `span ${(HOUR_TICKS[i + 1] ?? 24) - h}` }}>
            {hourLabel(h)}
          </span>
        ))}
        {days.map((date) => (
          <Fragment key={date}>
            <span className="self-center text-xs text-muted">{dayLabel(date)}</span>
            {Array.from({ length: 24 }, (_, h) => {
              const point = byHour.get(`${date} ${String(h).padStart(2, '0')}`)
              return (
                <span
                  key={h}
                  onPointerEnter={() => point && setHover(point)}
                  onPointerDown={() => point && setHover(point)}
                  className={`h-4 sm:h-5 ${point && point === hover ? 'outline-2 outline-ink outline-solid' : ''}`}
                  style={{ background: point ? colour(point[1]) : 'var(--heat-none)' }}
                />
              )
            })}
          </Fragment>
        ))}
      </div>
      <ul aria-hidden="true" className="mt-3 flex flex-wrap gap-x-3.5 gap-y-1.5 text-xs text-ink-2" style={{ paddingLeft: `calc(${DAY_COLUMN} + 2px)` }}>
        {BANDS.map((b) => (
          <li key={b.name} className="flex items-center gap-1.5">
            <span className="h-2.5 w-3.5" style={{ background: b.colour }} />
            {b.name}
          </li>
        ))}
      </ul>
    </figure>
  )
}
