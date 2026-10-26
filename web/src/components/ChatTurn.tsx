import { useEffect, useState } from 'react'
import type { Turn } from '../lib/chat'
import { Chart } from './Chart'
import { SqlBlock } from './SqlBlock'

interface Props {
  turn: Turn
  onRetry?: () => void
  onUseOwnKey?: () => void
  /** The Info page's example: the question beside the answer instead of above it. */
  side?: boolean
}

/** One exchange: the question as a heading, then the answer in reading order: sentence, chart, then the query that made it. */
export function ChatTurn({ turn, onRetry, onUseOwnKey, side = false }: Props) {
  const step = !turn.sql ? 0 : !turn.data ? 1 : 2
  const hasRows = !!turn.data && turn.data.rows.length > 0
  // A single figure is shown as a stat; its one-line text would only repeat it.
  const sentence = turn.answer && turn.data?.chart !== 'stat' ? turn.answer : null
  const Question = side ? 'h3' : 'h2'
  return (
    <article className={side ? 'grid gap-6 lg:grid-cols-3 lg:gap-16' : 'border-t-2 border-ink pt-3'}>
      <Question className={`leading-tight font-bold tracking-tight break-words text-ink ${side ? 'text-3xl' : 'text-2xl'}`}>{turn.question}</Question>

      <div aria-live="polite" className={`min-w-0 space-y-6 ${side ? 'lg:col-span-2' : 'mt-5'}`}>
        {sentence && <p className="text-xl leading-relaxed text-pretty text-ink">{sentence}</p>}
        {hasRows && <Chart data={turn.data!} />}
        {turn.status === 'error' && turn.error && <ErrorNote error={turn.error} onRetry={onRetry} onUseOwnKey={onUseOwnKey} />}
        {turn.sql && <SqlBlock sql={turn.sql} ran={turn.error?.reason !== 'rejected'} />}
        {turn.status === 'loading' && <Thinking key={turn.id} step={step} note={turn.note} />}
        {turn.status === 'done' && <Footer turn={turn} />}
      </div>
    </article>
  )
}

const STEPS = ['Writing the query', 'Running it', 'Writing the answer']

/** The step in progress and a clock; the note is the server's word on a model being retried. */
function Thinking({ step, note }: { step: number; note?: string }) {
  // Keyed by turn in the parent, so a new or retried question remounts it and the clock restarts.
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const started = Date.now()
    const t = setInterval(() => setElapsed((Date.now() - started) / 1000), 500)
    return () => clearInterval(t)
  }, [])
  return (
    <p className="flex items-center gap-3 text-label text-ink-2">
      <span aria-hidden="true" className="blink h-2.5 w-2.5 shrink-0 bg-sun outline-1 outline-ink outline-solid" />
      <span>
        {STEPS[step]}… <span className="text-muted tabular-nums">{Math.floor(elapsed)} s</span>
        {note && <span className="block text-muted">{note}</span>}
      </span>
    </p>
  )
}

function Footer({ turn }: { turn: Turn }) {
  const parts: string[] = []
  if (turn.cached) parts.push('From the cache, no model call.')
  // The API names the model as "provider:model"; the model is enough here.
  else if (turn.provider) parts.push(`Answered by ${turn.provider.split(':').pop()}${typeof turn.latencyMs === 'number' && turn.latencyMs > 0 ? ` in ${(turn.latencyMs / 1000).toFixed(1)} s` : ''}.`)
  if (turn.data) parts.push(`${turn.data.rows.length} ${turn.data.rows.length === 1 ? 'row' : 'rows'} from the database.`)
  return <p className="text-sm text-muted">{parts.join(' ')}</p>
}

const ERRORS: Record<string, string> = {
  rate_limited: "You've used today's free questions. Come back tomorrow, or use your own Gemini API key. The key stays in your browser.",
  rejected: 'That question led to a query the site will not run. Try a narrower or simpler question about prices or demand.',
  timeout: 'That query took too long to run. Try a shorter date range.',
  empty: 'The query ran but found no rows. The SQL is below so you can see why.',
  provider_unavailable: "The model is not available right now: it is busy, or today's free quota is used up. Try again in a minute, or use your own key.",
  database_unavailable: 'The database is not reachable right now, so nothing can be looked up. Try again in a minute.',
  server_error: 'Something went wrong on the server. Try again.',
  network: "Could not reach the site's API. Is it running?",
  cut_off: 'The answer stopped before it finished. Try again.',
  stopped: 'Stopped.',
  interrupted: 'The page was closed while this answer was coming in.',
  not_found: 'That link does not point to a saved answer.',
}

// Worth another try: the cause is outside the question itself.
const RETRY = new Set(['provider_unavailable', 'database_unavailable', 'server_error', 'network', 'cut_off', 'stopped', 'interrupted'])

const button = 'border border-ink bg-surface px-3.5 py-1.5 text-sm font-bold text-ink hover:bg-sun'

function ErrorNote({ error, onRetry, onUseOwnKey }: { error: NonNullable<Turn['error']>; onRetry?: () => void; onUseOwnKey?: () => void }) {
  const text = error.message && error.reason !== 'rate_limited' ? error.message : (ERRORS[error.reason] ?? 'Something went wrong.')
  const ownKey = onUseOwnKey && (error.reason === 'rate_limited' || error.reason === 'provider_unavailable')
  const retry = onRetry && RETRY.has(error.reason)
  return (
    <div className="bg-sun-soft px-4 py-3 text-sun-ink">
      <p>{text}</p>
      {(ownKey || retry) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {ownKey && (
            <button type="button" onClick={onUseOwnKey} className={button}>
              Use my own key
            </button>
          )}
          {retry && (
            <button type="button" onClick={onRetry} className={button}>
              Ask again
            </button>
          )}
        </div>
      )}
    </div>
  )
}
