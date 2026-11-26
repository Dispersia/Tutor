declare const __TUTOR_BASE__: string
export const base: string = typeof __TUTOR_BASE__ === 'string' ? __TUTOR_BASE__ : ''

export function href(path: string): string {
  return `${base}${path}`
}

export function stripBase(pathname: string): string {
  return base && pathname.startsWith(base) ? pathname.slice(base.length) || '/' : pathname
}
