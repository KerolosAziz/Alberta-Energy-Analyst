import type { Cell } from './api'

const number = new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat('en-CA', { notation: 'compact', maximumFractionDigits: 1 })

function fmt(v: Cell): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return number.format(v)
  return String(v)
}

export function fmtNumber(v: number): string {
  return number.format(v)
}

/** A price with its cents: 24.28, 48.20. */
export function money(v: number): string {
  return v.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** An axis tick: 12K rather than 12,000, so the labels stay short. */
export function fmtTick(v: number): string {
  return Math.abs(v) >= 1000 ? compact.format(v) : number.format(v)
}

const CATEGORY = /\b(year|yr|month|day|hour|hour_of_day|week|isodow|dow)\b/i

/** A month's name from its number, 1 to 12, as the browser writes it: "December", or "Dec" when short. */
function monthName(month: number, short = false): string {
  return new Date(2000, month - 1, 1).toLocaleString('en-CA', { month: short ? 'short' : 'long' })
}

/** An hour of the day, 0 to 23: "12 am", "4 pm". */
export function hourLabel(h: number): string {
  return `${h % 12 || 12} ${h < 12 ? 'am' : 'pm'}`
}

/** "2026-10-19" to "Mon 19". Noon keeps the date the same in any time zone. */
export function dayLabel(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  return `${d.toLocaleString('en-CA', { weekday: 'short' })} ${d.getDate()}`
}

/** Like fmt, but a year, hour or month column is a label, not a quantity: 2015, not 2,015, and 12 in a month column is December (Dec when short). */
export function fmtCell(v: Cell, column: string, short = false): string {
  if (typeof v === 'number' && Number.isInteger(v) && CATEGORY.test(column)) {
    if (/\bmonth\b/i.test(column) && v >= 1 && v <= 12) return monthName(v, short)
    return String(v)
  }
  return fmt(v)
}

/** "avg_price" to "Average price", "peak_mw" to "Peak MW". */
export function label(column: string): string {
  const s = column.replace(/_/g, ' ').replace(/\bavg\b/gi, 'average').replace(/\bmw\b/gi, 'MW')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** The label without a unit at its end, where the unit is shown beside the value: "Average demand MW" to "Average demand". */
export function bareLabel(column: string): string {
  return label(column).replace(/\s(MW|hours?|pct|percent)$/i, '')
}

/** A unit guessed from the column name, or an empty string. Hours come first: high_price_hours counts hours, not dollars. */
export function unit(column: string): string {
  const c = column.toLowerCase()
  if (/pct|percent/.test(c)) return '%'
  if (/hours?$/.test(c)) return 'hours'
  if (/price|dollar|avg_2|cost/.test(c)) return '$/MWh'
  if (/_mw\b|mw$|load|demand|peak/.test(c)) return 'MW'
  return ''
}

/** A big figure and the words after it: ["$48.20", "per MWh"], ["11,505", "MW"], ["21.5%", ""]. */
export function figure(v: Cell, column: string): [string, string] {
  if (typeof v !== 'number') return [fmt(v), '']
  const u = unit(column)
  if (u === '$/MWh') return [`$${money(v)}`, 'per MWh']
  if (u === '%') return [`${fmtNumber(v)}%`, '']
  return [fmtNumber(v), u]
}

/** The same on one line, for chart labels and tooltips: $48.20, 21.5%, 12,785 MW. */
export function fmtValue(v: number, column: string): string {
  const [value, after] = figure(v, column)
  return after && after !== 'per MWh' ? `${value} ${after}` : value
}

/** "2026-10-19 16:00" to "4 pm, Oct 19". */
export function asOf(stamp: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(stamp)
  if (!m) return stamp
  return `${hourLabel(Number(m[4]))}, ${monthName(Number(m[2]), true)} ${Number(m[3])}`
}

/** "2025-12-11 17:00" to "December 2025". */
export function monthYear(stamp: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(stamp)
  return m ? `${monthName(Number(m[2]))} ${m[1]}` : stamp
}
