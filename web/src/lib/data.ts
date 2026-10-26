import { fetchSite, type Site } from './api'

/** The site data, loaded before the first draw so nothing fills in piece by piece. Null when the API is down.
 *  The fonts are the device's own, so there is nothing else to wait for. */
export function loadSite(): Promise<Site | null> {
  return fetchSite().catch(() => null)
}
