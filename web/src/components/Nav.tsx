import type { MouseEvent } from 'react'
import { navigate } from '../lib/router'

const LINKS = [
  { to: '/', label: 'Info' },
  { to: '/ask', label: 'Ask' },
]

/** The top bar on both pages: the name, which leads home, and the two page links. Ask covers saved answers at /a/{id} too. */
export function Nav({ current }: { current: string }) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-8">
        <a href="/" onClick={(e) => go(e, '/')} className="text-body font-bold tracking-tight text-ink sm:text-lg">
          Alberta Energy Analyst
        </a>
        <nav aria-label="Pages" className="flex gap-6 font-semibold sm:gap-7">
          {LINKS.map((l) => {
            const isActive = (l.to === '/') === (current === '/')
            return (
              <a
                key={l.to}
                href={l.to}
                aria-current={isActive ? 'page' : undefined}
                onClick={(e) => go(e, l.to)}
                className={`py-1 ${isActive ? 'current-mark text-ink' : 'text-ink-2 hover:text-ink'}`}
              >
                {l.label}
              </a>
            )
          })}
        </nav>
      </div>
    </header>
  )
}

function go(e: MouseEvent<HTMLAnchorElement>, to: string) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
  e.preventDefault()
  navigate(to)
}
