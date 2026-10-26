import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { GLOSSARY, type TermId } from '../content/glossary'

/** A dotted term. Tap or click to see its definition; tap elsewhere or press Escape to close. */
export function Term({ id, children }: { id: TermId; children?: ReactNode }) {
  const entry = GLOSSARY[id]
  const [open, setOpen] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const popId = useId()

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => {
    const r = ref.current?.getBoundingClientRect()
    if (r) setAlignRight(r.left + 320 > window.innerWidth - 8)
    setOpen((o) => !o)
  }

  return (
    <span ref={ref} className="relative inline">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={popId}
        onClick={toggle}
        className="inline cursor-pointer border-b-2 border-dotted border-link p-0 text-inherit hover:bg-sun-soft"
      >
        {children ?? entry.term}
      </button>
      {open && (
        <span
          role="tooltip"
          id={popId}
          className={`absolute top-full z-20 mt-2 w-72 max-w-[85vw] border border-ink bg-surface p-4 text-left text-sm font-normal ${alignRight ? 'right-0' : 'left-0'}`}
        >
          <strong className="block text-ink">{entry.term}</strong>
          <span className="block text-ink-2">{entry.definition}</span>
        </span>
      )}
    </span>
  )
}
