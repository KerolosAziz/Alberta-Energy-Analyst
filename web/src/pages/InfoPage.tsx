import { useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { ChatTurn } from '../components/ChatTurn'
import { ExampleFigure } from '../components/ExampleFigure'
import { FourParts } from '../components/FourParts'
import { LiveStrip } from '../components/LiveStrip'
import { Reveal } from '../components/Motion'
import { Nav } from '../components/Nav'
import { Term } from '../components/Term'
import type { Site } from '../lib/api'
import { fromExample } from '../lib/chat'
import { fmtNumber, monthYear } from '../lib/format'
import { navigate } from '../lib/router'

const link = 'text-link underline decoration-link/30 underline-offset-3 hover:decoration-link'
const sectionHead = 'border-t-2 border-ink pt-2.5 text-label font-bold text-ink'

export function InfoPage({ site }: { site: Site | null }) {
  const market = site?.market ?? null
  const score = site?.score ?? null
  const repo = site?.repo ?? null
  const examples = (site?.examples ?? []).filter((e) => e.id) // the precomputed answers
  // The first ready-made answer with a real chart is shown in full; the others are listed.
  const featured = examples.find((e) => (e.chart === 'bar' || e.chart === 'line') && (e.rows?.length ?? 0) > 2)
  const others = examples.filter((e) => e !== featured)
  const since = market?.since ? ` since ${market.since.slice(0, 4)}` : ''
  return (
    <>
      <Nav current="/" />
      <main className="text-body">
        <section className="mx-auto grid max-w-6xl items-start gap-14 px-4 pt-12 pb-14 sm:px-8 lg:grid-cols-2 lg:pt-14">
          <div className="rise">
            <h1 className="text-5xl leading-none font-bold tracking-tight text-balance text-ink sm:text-6xl lg:text-hero">Ask Alberta's power market a question.</h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-pretty text-ink-2">Hourly pool prices and demand{since}, from the AESO. Each answer comes with a chart and the SQL that produced it.</p>
            <AskBox />
            {others.length > 0 && (
              <div className="mt-6">
                <p className="font-bold">Examples</p>
                <ul className="mt-1.5 space-y-1.5">
                  {others.slice(0, 3).map((ex) => (
                    <li key={ex.question}>
                      <a href={`/a/${ex.id}`} onClick={(e) => go(e, `/a/${ex.id}`)} className={link}>
                        {ex.question}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <LiveStrip market={market} />
        </section>

        {(market || score) && (
          <section className="mx-auto max-w-6xl px-4 sm:px-8">
            <Reveal className="grid border-y border-line border-t-ink sm:grid-cols-2 lg:grid-cols-4">
              {market && <Fact value={fmtNumber(market.hours)}>hours of data{since}</Fact>}
              {market?.year_avg_price != null && (
                <Fact value={`$${market.year_avg_price.toFixed(2)}`}>
                  average pool price per <Term id="mwh">megawatt-hour</Term>, last 12 months
                </Fact>
              )}
              {market?.record_load && (
                <Fact value={`${fmtNumber(market.record_load.value)} MW`}>record demand, {monthYear(market.record_load.as_of)}</Fact>
              )}
              {score && (
                <Fact value={`${score.passed} of ${score.total}`}>
                  test questions answered right{score.date && <span className="whitespace-nowrap"> ({score.date})</span>}.
                  {repo && (
                    <>
                      {' '}
                      <a href={`${repo}/blob/main/evals/history.md`} target="_blank" rel="noopener noreferrer" className={link}>
                        How it is measured
                      </a>
                    </>
                  )}
                </Fact>
              )}
            </Reveal>
          </section>
        )}

        {featured && (
          <section className="mx-auto max-w-6xl px-4 pt-20 sm:px-8">
            <Reveal>
              <h2 className={sectionHead}>Example answer</h2>
              <div className="mt-5">
                <ChatTurn turn={fromExample(featured, 'featured')} side />
              </div>
            </Reveal>
          </section>
        )}

        <section className="mx-auto max-w-6xl px-4 pt-20 sm:px-8">
          <Reveal>
            <h2 className={sectionHead}>How it works</h2>
            <ol className="mt-5 grid border-t border-l border-ink sm:grid-cols-2 lg:grid-cols-5">
              {HOW.map(({ title, text, guard }, i) => (
                <li key={title} className={`relative border-r border-b border-ink p-4 pb-5 ${guard ? 'bg-sun' : ''}`}>
                  <span className="block pr-6 font-bold text-ink">{title}</span>
                  <span className={`mt-1 block text-label ${guard ? 'text-ink' : 'text-ink-2'}`}>{text}</span>
                  {i < HOW.length - 1 && (
                    <span aria-hidden="true" className="absolute top-4 right-3.5 font-bold">
                      →
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </Reveal>
        </section>

        <section className="mx-auto max-w-6xl px-4 pt-20 sm:px-8">
          <Reveal>
            {others.length > 0 && (
              <>
                <h2 className={sectionHead}>More examples</h2>
                <ul className="mt-2">
                  {others.map((ex) => (
                    <li key={ex.question} className="border-b border-line">
                      <a href={`/a/${ex.id}`} onClick={(e) => go(e, `/a/${ex.id}`)} className="group flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5 py-4">
                        <span className="text-ink underline decoration-muted/40 underline-offset-3 group-hover:decoration-ink">{ex.question}</span>
                        <ExampleFigure ex={ex} />
                      </a>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <a href="/ask" onClick={(e) => go(e, '/ask')} className="mt-7 inline-flex border-2 border-ink bg-sun px-5 py-2.5 font-bold text-ink hover:bg-sun-strong">
              Ask your own question
            </a>
          </Reveal>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-20 sm:px-8">
          <Reveal>
            <h2 className={sectionHead}>The four parts of the system</h2>
            <p className="mt-4 max-w-3xl text-ink-2">Electricity reaches you in four steps. Select each one. Tap a dotted term for its meaning.</p>
            <div className="mt-6">
              <FourParts />
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-6 gap-y-2 px-4 py-6 text-sm text-muted sm:px-8">
          <span>
            Data from the{' '}
            <a href="https://www.aeso.ca/" target="_blank" rel="noopener noreferrer" className={link}>
              AESO
            </a>
          </span>
          <span>Photos from Pexels</span>
          {repo && (
            <a href={repo} target="_blank" rel="noopener noreferrer" className={link}>
              Source on GitHub
            </a>
          )}
        </div>
      </footer>
    </>
  )
}

/** The question box at the top. It opens the Ask page, which asks the question there. */
function AskBox() {
  const [draft, setDraft] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const question = draft.trim()
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    // The id is made here, so the Ask page can show the turn at once and fill it in as the answer streams.
    if (question.length >= 3) navigate('/ask', false, { ask: question, id: Date.now().toString(36) })
    else input.current?.focus()
  }
  return (
    <form onSubmit={submit} className="mt-7 flex max-w-xl border-2 border-ink bg-surface focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-link">
      <label htmlFor="home-question" className="sr-only">
        Your question
      </label>
      <input
        id="home-question"
        ref={input}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Ask about prices or demand"
        maxLength={500}
        autoComplete="off"
        enterKeyHint="send"
        className="min-w-0 flex-1 bg-transparent px-4 py-3.5 text-body text-ink placeholder:text-muted focus:outline-none"
      />
      <button type="submit" className="border-l-2 border-ink bg-sun px-6 font-bold text-ink hover:bg-sun-strong sm:px-7">
        Ask
      </button>
    </form>
  )
}

/** The path of every question. The guard, the step that keeps the database safe, is shown in yellow. */
const HOW: { title: string; text: string; guard?: boolean }[] = [
  { title: 'Your question', text: 'In plain English, about prices or demand.' },
  { title: 'A model writes SQL', text: 'One query from the table layout. It never sees the data.' },
  { title: 'The guard checks it', text: 'One read-only SELECT on the two market tables, with a row limit.', guard: true },
  { title: 'PostgreSQL runs it', text: 'As a read-only user, with a short time limit.' },
  { title: 'You get the answer', text: 'A sentence, a chart, and the SQL, so anyone can check it.' },
]

function go(e: MouseEvent<HTMLAnchorElement>, to: string) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
  e.preventDefault()
  navigate(to)
}

/** One figure in the row under the hero. Rules between them on wide screens, above them when stacked. */
function Fact({ value, children }: { value: string; children: ReactNode }) {
  return (
    <div className="border-line py-5 max-sm:not-first:border-t sm:pr-6 lg:not-first:border-l lg:not-first:pl-6">
      <p className="text-3xl leading-tight font-bold tracking-tight text-ink">{value}</p>
      <p className="text-label text-ink-2">{children}</p>
    </div>
  )
}
