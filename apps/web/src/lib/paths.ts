/** Base path the app is served under ('' or '/tutor'); injected by vite. */
declare const __TUTOR_BASE__: string
export const base: string = typeof __TUTOR_BASE__ === 'string' ? __TUTOR_BASE__ : ''

/**
 * Prefixes a root-relative path with the app's base path (DESIGN §14.1).
 * When built with `TUTOR_BASE_PATH=/tutor`, links and API calls become
 * `/tutor/...` so the app can live behind a tailnet-gateway subpath.
 */
export function href(path: string): string {
  return `${base}${path}`
}

/** Same as `href`, named for API calls. */
export function apiPath(path: string): string {
  return `${base}${path}`
}

/** Strips the base from a location pathname (for active-tab checks). */
export function stripBase(pathname: string): string {
  return base && pathname.startsWith(base) ? pathname.slice(base.length) || '/' : pathname
}
