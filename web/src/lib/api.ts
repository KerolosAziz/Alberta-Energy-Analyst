/** Calls to the FastAPI app. It serves the site and the API from one origin; in development Vite proxies /api to it. */

const API = '/api'

export type Cell = string | number | boolean | null
export type ChartKind = 'stat' | 'line' | 'bar' | 'table'

export interface Rows {
  columns: string[]
  rows: Cell[][]
  chart: ChartKind | null
}

export interface Example extends Partial<Rows> {
  question: string
  id: string | null
  answer: string | null
  sql?: string
}

interface Score {
  passed: number
  total: number
  date?: string
}

interface Point {
  as_of: string
  value: number
}

/** The market as the database has it: the latest settled hour, the week before it, and a few facts. */
export interface Market {
  price: Point | null
  load: Point | null
  /** Whole hours between the end of that hour and now: 0 or 1 while the hourly job runs. */
  hours_behind: number | null
  record_load: Point | null
  week: [string, number][]
  since: string | null
  hours: number
  year_avg_price: number | null
}

/** Everything the pages show at load, from GET /api/site. */
export interface Site {
  market: Market
  examples: Example[]
  score: Score | null
  limit: number
  repo: string | null
}

interface Saved extends Rows {
  id: string
  question: string
  sql: string | null
  answer: string
  outcome: string
  provider: string | null
}

type AskEvent =
  | { event: 'status'; data: { message: string } }
  | { event: 'sql'; data: { sql: string } }
  | { event: 'rows'; data: Rows }
  | { event: 'answer'; data: { text: string; cached: boolean } }
  | { event: 'done'; data: { id: string | null; provider: string | null; latency_ms: number } }
  | { event: 'error'; data: { reason: string; message?: string; sql?: string | null; limit?: number } }

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<T>
}

export const fetchSite = () => getJson<Site>('/site')
export const fetchSaved = (id: string) => getJson<Saved>(`/a/${encodeURIComponent(id)}`)

/** POST a question and hand each server-sent event to onEvent as it arrives. */
export async function ask(question: string, ownKey: string | null, onEvent: (ev: AskEvent) => void, signal?: AbortSignal) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (ownKey) headers['X-Gemini-Key'] = ownKey
  const res = await fetch(`${API}/ask`, { method: 'POST', headers, body: JSON.stringify({ question }), signal })
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let cut: number
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      const parsed = parseEvent(chunk)
      if (parsed) onEvent(parsed)
    }
  }
}

function parseEvent(chunk: string): AskEvent | null {
  let event = 'message'
  let data = ''
  for (const line of chunk.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data += line.slice(5).trim()
  }
  if (!data) return null
  return { event, data: JSON.parse(data) } as AskEvent
}
