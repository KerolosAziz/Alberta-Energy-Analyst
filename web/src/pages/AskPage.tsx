import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { ChatTurn } from '../components/ChatTurn'
import { Nav } from '../components/Nav'
import { ask, fetchSaved, type Example, type Site } from '../lib/api'
import { fromExample, type Turn } from '../lib/chat'
import { navigate } from '../lib/router'

const CHAT_KEY = 'aea.chat'
const OWN_KEY = 'aea.gemini-key'
const MAX_TURNS = 30
const link = 'text-link underline decoration-link/30 underline-offset-3 hover:decoration-link'

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode, blocked or full storage: the page still works */
  }
}

const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)

/** A question typed on the Info page arrives in the history entry, with the id its turn will have. */
function sentQuestion(): { ask: string; id: string } | null {
  const sent = window.history.state as { ask?: string; id?: string } | null
  return sent?.ask && sent.id ? { ask: sent.ask, id: sent.id } : null
}

/** The chat saved in this browser, plus the question sent from the Info page. An answer still coming in when the page closed is marked as cut short. */
function loadChat(): Turn[] {
  const chat = readJson<Turn[]>(CHAT_KEY, []).map((t): Turn => (t.status === 'loading' ? { ...t, status: 'error', error: { reason: 'interrupted' } } : t))
  const sent = sentQuestion()
  return sent ? [...chat, { id: sent.id, question: sent.ask, status: 'loading' as const }].slice(-MAX_TURNS) : chat
}

export function AskPage({ path, site }: { path: string; site: Site | null }) {
  const [turns, setTurns] = useState<Turn[]>(loadChat)
  const [ready, setReady] = useState(() => !path.startsWith('/a/')) // a shared answer is fetched before the page shows
  const [draft, setDraft] = useState('')
  const [ownKey, setOwnKey] = useState<string>(() => readJson<string>(OWN_KEY, ''))
  const [keyOpen, setKeyOpen] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const stick = useRef(true) // follow the newest answer unless the reader has scrolled up
  const input = useRef<HTMLTextAreaElement>(null)
  const busy = turns.some((t) => t.status === 'loading')

  useEffect(() => writeJson(CHAT_KEY, turns), [turns])

  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement
      stick.current = window.innerHeight + window.scrollY >= el.scrollHeight - 120
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!turns.length || !stick.current) return
    const frame = requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    return () => cancelAnimationFrame(frame)
  }, [turns])

  // The question box grows with what is typed, up to its max height.
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [draft])

  const update = (id: string, patch: Partial<Turn>) => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  // A shared answer joins the chat once, even if the link is opened again.
  const add = (turn: Turn) => {
    stick.current = true
    setTurns((ts) => (turn.shareId && ts.some((t) => t.shareId === turn.shareId) ? ts : [...ts, turn].slice(-MAX_TURNS)))
  }

  // A shared link: /a/{id} adds the saved answer to the chat.
  useEffect(() => {
    if (!path.startsWith('/a/')) return
    const id = path.slice(3)
    fetchSaved(id)
      .then((s) =>
        add({
          id: newId(),
          question: s.question,
          status: 'done',
          sql: s.sql,
          data: { columns: s.columns, rows: s.rows, chart: s.chart },
          answer: s.answer,
          shareId: s.id,
          provider: s.provider,
          cached: true,
        }),
      )
      .catch(() => add({ id: newId(), question: 'A shared answer', status: 'error', error: { reason: 'not_found' }, shareId: id }))
      .finally(() => setReady(true))
  }, [path])

  const run = (id: string, question: string) => {
    const controller = new AbortController()
    abort.current = controller
    let finished = false
    ask(
      question,
      ownKey || null,
      (ev) => {
        if (ev.event === 'status') update(id, { note: ev.data.message })
        else if (ev.event === 'sql') update(id, { sql: ev.data.sql })
        else if (ev.event === 'rows') update(id, { data: ev.data })
        else if (ev.event === 'answer') update(id, { answer: ev.data.text, cached: ev.data.cached })
        else if (ev.event === 'done') {
          finished = true
          update(id, { status: 'done', shareId: ev.data.id, provider: ev.data.provider, latencyMs: ev.data.latency_ms })
        } else if (ev.event === 'error') {
          finished = true
          update(id, { status: 'error', error: ev.data, ...(ev.data.sql ? { sql: ev.data.sql } : {}) })
        }
      },
      controller.signal,
    )
      .then(() => {
        if (!finished) update(id, { status: 'error', error: { reason: 'cut_off' } })
      })
      .catch((err: unknown) => {
        update(id, { status: 'error', error: { reason: (err as Error).name === 'AbortError' ? 'stopped' : 'network' } })
      })
  }

  const submit = (q: string) => {
    const question = q.trim()
    if (question.length < 3 || busy) return
    const turn: Turn = { id: newId(), question, status: 'loading' }
    stick.current = true
    setTurns((ts) => [...ts, turn].slice(-MAX_TURNS))
    setDraft('')
    if (path !== '/ask') navigate('/ask', true)
    run(turn.id, question)
  }

  const retry = (turn: Turn) => {
    if (busy) return
    stick.current = true
    setTurns((ts) => ts.map((t) => (t.id === turn.id ? { id: t.id, question: t.question, status: 'loading' } : t)))
    run(turn.id, turn.question)
  }

  // The question sent from the Info page is already in the chat (loadChat); ask it once the page is up.
  // The history entry is cleared first, so a reload or Back does not ask it again.
  const askSent = useEffectEvent(() => {
    const sent = sentQuestion()
    if (!sent) return
    window.history.replaceState({}, '', window.location.pathname)
    run(sent.id, sent.ask)
  })
  useEffect(() => askSent(), [])

  // A precomputed example is already a full answer: show it without asking again.
  const pick = (ex: Example) => {
    if (ex.id && ex.columns && ex.rows) add(fromExample(ex, newId()))
    else submit(ex.question)
  }

  const newChat = () => {
    abort.current?.abort()
    setTurns([])
    if (path !== '/ask') navigate('/ask', true)
    window.scrollTo({ top: 0, behavior: 'instant' })
    input.current?.focus()
  }

  const saveKey = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const value = new FormData(e.currentTarget).get('key')?.toString().trim() ?? ''
    setOwnKey(value)
    writeJson(OWN_KEY, value)
    setKeyOpen(false)
  }

  const removeKey = () => {
    setOwnKey('')
    writeJson(OWN_KEY, '')
    setKeyOpen(false)
  }

  if (!ready) return null

  return (
    <div className="flex min-h-dvh flex-col">
      <Nav current={path} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-10 sm:px-8">
        {turns.length === 0 ? (
          <Welcome examples={site?.examples ?? []} onPick={pick} />
        ) : (
          <div className="space-y-14 pt-10">
            {turns.map((t) => (
              <ChatTurn key={t.id} turn={t} onRetry={() => retry(t)} onUseOwnKey={() => setKeyOpen(true)} />
            ))}
          </div>
        )}
      </main>

      <div className="sticky bottom-0 border-t border-line bg-page/90 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-8">
          {keyOpen && <KeyForm ownKey={ownKey} onSave={saveKey} onClose={() => setKeyOpen(false)} onRemove={removeKey} />}
          <form
            className="flex items-stretch border-2 border-ink bg-surface focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-link"
            onSubmit={(e) => {
              e.preventDefault()
              submit(draft)
            }}
          >
            <label htmlFor="question" className="sr-only">
              Your question
            </label>
            <textarea
              id="question"
              ref={input}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault()
                  submit(draft)
                }
              }}
              placeholder="Ask about prices or demand"
              maxLength={500}
              autoComplete="off"
              enterKeyHint="send"
              autoFocus={!path.startsWith('/a/')}
              className="max-h-40 min-w-0 flex-1 resize-none bg-transparent px-4 py-3 text-body text-ink placeholder:text-muted focus:outline-none"
            />
            {busy ? (
              <button type="button" onClick={() => abort.current?.abort()} className="border-l-2 border-ink bg-surface px-5 font-bold text-ink hover:bg-wash">
                Stop
              </button>
            ) : (
              <button type="submit" className="border-l-2 border-ink bg-sun px-6 font-bold text-ink hover:bg-sun-strong">
                Ask
              </button>
            )}
          </form>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted">
            <span>
              {ownKey ? 'Using your own Gemini key, no daily limit. ' : site ? `${site.limit} free questions a day. ` : 'Free questions are limited per day. '}
              <button type="button" onClick={() => setKeyOpen(true)} className={link}>
                {ownKey ? 'Change key' : 'Use your own key'}
              </button>
            </span>
            {turns.length > 0 && (
              <button type="button" onClick={newChat} className={link}>
                New chat
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function KeyForm({ ownKey, onSave, onClose, onRemove }: { ownKey: string; onSave: (e: FormEvent<HTMLFormElement>) => void; onClose: () => void; onRemove: () => void }) {
  return (
    <form onSubmit={onSave} className="mb-3 border border-ink bg-surface p-5 text-sm text-ink-2">
      <p className="font-bold text-ink">Your own Gemini API key</p>
      <p className="mt-1">
        Stored only in this browser and sent only with your questions. Removes the daily limit. A free key comes from{' '}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className={link}>
          Google AI Studio
        </a>
        ; Google sets its own daily allowance per model, and this site rotates through several models.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="own-key" className="sr-only">
          Gemini API key
        </label>
        <input id="own-key" name="key" type="password" defaultValue={ownKey} placeholder="Paste your key" autoFocus className="min-w-0 flex-1 border border-ink bg-surface px-3 py-2.5 text-ink focus:outline-2 focus:outline-offset-2 focus:outline-link" />
        <button type="submit" className="border-2 border-ink bg-sun px-5 py-2.5 font-bold text-ink hover:bg-sun-strong">
          Save
        </button>
        <button type="button" onClick={onClose} className="px-3 py-2.5 font-semibold text-ink-2 underline underline-offset-3 hover:text-ink">
          Close
        </button>
        {ownKey && (
          <button type="button" onClick={onRemove} className="px-3 py-2.5 font-semibold text-ink-2 underline underline-offset-3 hover:text-ink">
            Remove
          </button>
        )}
      </div>
    </form>
  )
}

/** Shown before the first question: a title and a few questions to start with. Everything else lives on the Info page. */
function Welcome({ examples, onPick }: { examples: Example[]; onPick: (ex: Example) => void }) {
  return (
    <div className="pt-12 sm:pt-16">
      <h1 className="text-5xl leading-none font-bold tracking-tight text-ink sm:text-6xl">Ask the data</h1>
      <p className="mt-4 text-lg text-ink-2">Alberta's hourly electricity prices and demand, from the AESO.</p>
      {examples.length > 0 && (
        <div className="mt-10 border-t-2 border-ink pt-2.5">
          <p className="text-label font-bold">Examples</p>
          <ul className="mt-1">
            {examples.slice(0, 4).map((ex) => (
              <li key={ex.question} className="border-b border-line">
                <button type="button" onClick={() => onPick(ex)} className="w-full py-3.5 text-left text-body text-ink underline decoration-muted/40 underline-offset-3 hover:decoration-ink">
                  {ex.question}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
