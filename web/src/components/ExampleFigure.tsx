import type { Example } from '../lib/api'
import { figure, fmtCell, fmtValue } from '../lib/format'
import { Spark } from './Chart'

/** The key figure of a precomputed example: its one value, a before and after, or the highest point with the shape
 *  of the rest. Nothing while it is not cached yet. */
export function ExampleFigure({ ex }: { ex: Example }) {
  const { rows, columns } = ex
  if (!rows?.length || !columns) return null
  const [xCol, yCol] = columns
  if (rows.length === 1) {
    const col = columns.length === 2 ? 1 : 0
    const [value, after] = figure(rows[0][col], columns[col])
    return (
      <span className="text-body font-bold whitespace-nowrap text-ink">
        {columns.length === 2 && `${fmtCell(rows[0][0], xCol)} · `}
        {value}
        {after && ` ${after}`}
      </span>
    )
  }
  const ys = rows.map((r) => Number(r[1]) || 0)
  if (rows.length === 2) {
    return (
      <span className="text-body font-bold whitespace-nowrap text-ink">
        {figure(ys[0], yCol)[0]} → {fmtValue(ys[1], yCol)}
      </span>
    )
  }
  const top = ys.indexOf(Math.max(...ys))
  return (
    <span className="flex items-center gap-3 text-body font-bold whitespace-nowrap text-ink">
      <Spark values={ys} />
      {fmtValue(ys[top], yCol)} in {fmtCell(rows[top][0], xCol)}
    </span>
  )
}
