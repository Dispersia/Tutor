const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
}

export function wrapTarget<T>(items: T[], current: T | null, backwards: boolean): T | undefined {
  if (!items.length) return undefined
  const at = current === null ? -1 : items.indexOf(current)
  if (at === -1) return backwards ? items.at(-1) : items[0]
  if (backwards && at === 0) return items.at(-1)
  if (!backwards && at === items.length - 1) return items[0]
  return undefined
}

function keepInside(node: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== 'Tab') return
  const active = document.activeElement as HTMLElement | null
  const inside = active && node.contains(active) && active !== node ? active : null
  const target = wrapTarget(focusables(node), inside, e.shiftKey)
  if (!target) return
  e.preventDefault()
  target.focus()
}

let traps: HTMLElement[] = []

export function focusTrap(node: HTMLElement) {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  if (!node.hasAttribute('tabindex')) node.tabIndex = -1
  node.focus({ preventScroll: true })
  traps.push(node)
  const onKeydown = (e: KeyboardEvent) => {
    if (traps.at(-1) === node) keepInside(node, e)
  }
  document.addEventListener('keydown', onKeydown)
  return {
    destroy() {
      document.removeEventListener('keydown', onKeydown)
      traps = traps.filter((open) => open !== node)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    },
  }
}
