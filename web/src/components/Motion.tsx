import type { ReactNode } from 'react'
import { useInView } from '../lib/motion'

/** Children rise gently into view the first time they are scrolled to. */
export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const [ref, seen] = useInView<HTMLDivElement>()
  return (
    <div ref={ref} className={`reveal ${seen ? 'in' : ''} ${className}`}>
      {children}
    </div>
  )
}
