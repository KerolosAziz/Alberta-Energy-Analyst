import { useState, type MouseEvent, type ReactNode } from 'react'

/** The query, line by line with numbers and keywords picked out, in a panel that can be folded away. A refused query never ran, and the title says so. */
export function SqlBlock({ sql, ran = true }: { sql: string; ran?: boolean }) {
  return (
    <details open className="group border border-line bg-wash">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 border-line px-4 py-2 text-sm font-bold text-ink group-open:border-b [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
            ›
          </span>
          {ran ? 'SQL that ran, read-only' : 'SQL the model wrote, not run'}
        </span>
        <CopyButton text={sql} label="Copy" />
      </summary>
      {/* One row per line, so a long line that wraps keeps its number. */}
      <div className="max-h-96 overflow-auto py-3 font-mono text-code leading-relaxed">
        {sql.split('\n').map((line, i) => (
          <div key={i} className="flex">
            <span aria-hidden="true" className="w-10 shrink-0 border-r border-line pr-2.5 text-right text-code-dim select-none">
              {i + 1}
            </span>
            <code className="min-w-0 flex-1 px-3.5 break-words whitespace-pre-wrap text-ink">{highlight(line)}</code>
          </div>
        ))}
      </div>
    </details>
  )
}

// The guard pretty-prints every query, so keywords and functions are upper case and names lower case.
const TOKEN = /('(?:[^']|'')*')|(--[^\n]*)|(\b\d+(?:\.\d+)?\b)|(\b[A-Z][A-Z_]+\b)/g

function highlight(sql: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of sql.matchAll(TOKEN)) {
    const [text, str, comment, num] = m
    if (m.index > last) out.push(sql.slice(last, m.index))
    const cls = str ? 'text-code-str' : num ? 'text-code-num' : comment ? 'text-muted italic' : 'text-code-key'
    out.push(
      <span key={m.index} className={cls}>
        {text}
      </span>,
    )
    last = m.index + text.length
  }
  out.push(sql.slice(last))
  return out
}

function CopyButton({ text, label, done = 'Copied' }: { text: string; label: string; done?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async (e: MouseEvent) => {
    e.preventDefault() // inside a <summary> the click would also fold the block
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('Copy this', text)
    }
  }
  return (
    <button type="button" onClick={copy} className="font-semibold text-link underline underline-offset-3 hover:text-ink">
      {copied ? done : label}
    </button>
  )
}
