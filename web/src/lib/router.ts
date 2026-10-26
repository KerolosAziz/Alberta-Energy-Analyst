import { useEffect, useState } from 'react'

/** The current path, kept in sync with back and forward. */
export function usePath(): string {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onChange = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onChange)
    return () => window.removeEventListener('popstate', onChange)
  }, [])
  return path
}

/** `state` rides along in the history entry: the Info page sends its question to the Ask page this way. */
export function navigate(to: string, replace = false, state: object = {}) {
  if (replace) window.history.replaceState(state, '', to)
  else window.history.pushState(state, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
  if (!replace) window.scrollTo(0, 0)
}
