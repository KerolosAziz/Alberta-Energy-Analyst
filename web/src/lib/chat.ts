import type { Example, Rows } from './api'

/** One question and its answer, as the Ask page keeps them. */
export interface Turn {
  id: string
  question: string
  status: 'loading' | 'done' | 'error'
  note?: string
  sql?: string | null
  data?: Rows
  answer?: string
  cached?: boolean
  shareId?: string | null
  provider?: string | null
  latencyMs?: number
  error?: { reason: string; message?: string; limit?: number }
}

/** A precomputed example is already a full answer: it is shown as a finished turn, with no model call. */
export function fromExample(ex: Example, id: string): Turn {
  return {
    id,
    question: ex.question,
    status: 'done',
    sql: ex.sql,
    data: { columns: ex.columns ?? [], rows: ex.rows ?? [], chart: ex.chart ?? null },
    answer: ex.answer ?? undefined,
    shareId: ex.id,
    cached: true,
  }
}
