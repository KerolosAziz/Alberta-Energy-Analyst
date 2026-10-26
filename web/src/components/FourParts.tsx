import { useEffect, useState, type ReactNode } from 'react'
import { Term } from './Term'
import generation from '../assets/photos/generation.jpg'
import transmission from '../assets/photos/transmission.jpg'
import distribution from '../assets/photos/distribution.jpg'
import retail from '../assets/photos/retail.jpg'

type PartId = 'generation' | 'transmission' | 'distribution' | 'retail'

const PARTS: { id: PartId; name: string; tag: string; photo: string; alt: string; text: ReactNode }[] = [
  { id: 'generation', name: 'Generation', tag: 'Power plants', photo: generation, alt: 'A power station', text: 'Power plants make electricity: gas, wind, solar and hydro.' },
  { id: 'transmission', name: 'Transmission', tag: 'High-voltage wires', photo: transmission, alt: 'High-voltage transmission towers', text: 'Big high-voltage wires carry it across the province.' },
  { id: 'distribution', name: 'Distribution', tag: 'Low-voltage wires', photo: distribution, alt: 'Utility poles along a street', text: 'Smaller wires bring it to your street and into your home.' },
  {
    id: 'retail',
    name: 'Retail',
    tag: 'Where you buy',
    photo: retail,
    alt: 'Houses in a residential neighbourhood',
    text: (
      <>
        Where you buy it: the regulated <Term id="last-resort" />, or a contract with a <Term id="retailer" />.
      </>
    ),
  },
]

/** How long each part stays selected while the section plays on its own. */
const STEP_MS = 4000

export function FourParts() {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [hovered, setHovered] = useState(false)
  const part = PARTS[index]

  // Step through the parts on their own until the reader picks one. Hover pauses it.
  // Readers who asked for reduced motion get a static section.
  useEffect(() => {
    if (!playing || hovered) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const t = setInterval(() => setIndex((i) => (i + 1) % PARTS.length), STEP_MS)
    return () => clearInterval(t)
  }, [playing, hovered])

  const choose = (i: number) => {
    setIndex(i)
    setPlaying(false)
  }

  return (
    <div onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4" role="group" aria-label="The four parts">
        {PARTS.map((p, i) => {
          const active = i === index
          return (
            <button key={p.id} type="button" aria-pressed={active} onClick={() => choose(i)} className="group text-left">
              <div className={`aspect-[4/3] overflow-hidden bg-wash ${active ? 'outline-2 outline-offset-2 outline-ink outline-solid' : ''}`}>
                <img src={p.photo} alt={p.alt} loading="lazy" width={800} height={600} className={`h-full w-full object-cover transition-transform duration-500 ${active ? 'scale-[1.03]' : 'group-hover:scale-[1.03]'}`} />
              </div>
              <div className="relative mt-3 h-0.5 bg-line" aria-hidden="true">
                {active && playing && !hovered && <div key={index} className="progress h-full bg-ink" style={{ animationDuration: `${STEP_MS}ms` }} />}
                {active && (!playing || hovered) && <div className="h-full bg-ink" />}
              </div>
              <div className="mt-3">
                <span className={`font-bold text-ink ${active ? 'current-mark' : ''}`}>
                  {i + 1}. {p.name}
                </span>
              </div>
              <div className="mt-0.5 text-sm text-muted">{p.tag}</div>
            </button>
          )
        })}
      </div>
      <p className="mt-6 min-h-18 border-t border-line pt-4 text-lg text-ink-2" aria-live="polite">
        <span key={part.id} className="fade-fast block">
          <b className="font-bold text-ink">{part.name}.</b> {part.text}
        </span>
      </p>
    </div>
  )
}
