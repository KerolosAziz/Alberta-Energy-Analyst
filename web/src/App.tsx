import { AskPage } from './pages/AskPage'
import { InfoPage } from './pages/InfoPage'
import type { Site } from './lib/api'
import { usePath } from './lib/router'

/** Two pages: Info at /, and Ask at /ask (and /a/{id} for a saved answer). Both get the site data loaded before the first draw. */
export default function App({ site }: { site: Site | null }) {
  const path = usePath()
  if (path === '/ask' || path.startsWith('/a/')) return <AskPage path={path} site={site} />
  return <InfoPage site={site} />
}
