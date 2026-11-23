/**
 * Focus management for a modal dialog (`use:focusTrap` on the `role="dialog"`
 * element): focus moves into the dialog when it opens, Tab and Shift+Tab cycle
 * inside it, and focus returns to whatever opened it when it closes. Escape is
 * left to the dialog, which owns its own close handler.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusables(node: HTMLElement): HTMLElement[] {
  return [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null)
}

/** Where Tab should land when focus is about to leave the dialog, if anywhere. */
export function wrapTarget<T>(items: T[], current: T | null, backwards: boolean): T | undefined {
  if (!items.length) return undefined
  const at = current === null ? -1 : items.indexOf(current)
  if (at === -1) return backwards ? items.at(-1) : items[0]
  if (backwards && at === 0) return items.at(-1)
  if (!backwards && at === items.length - 1) return items[0]
  return undefined
}

/** Keeps a Tab press inside `node`. */
function keepInside(node: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== 'Tab') return
  const active = document.activeElement as HTMLElement | null
  const inside = active && node.contains(active) && active !== node ? active : null
  const target = wrapTarget(focusables(node), inside, e.shiftKey)
  if (!target) return
  e.preventDefault()
  target.focus()
}

export function focusTrap(node: HTMLElement) {
  const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const onKeydown = (e: KeyboardEvent) => keepInside(node, e)
  // The dialog itself takes focus, so a screen reader announces its title and
  // the first Tab lands on its first control.
  if (!node.hasAttribute('tabindex')) node.tabIndex = -1
  node.focus({ preventScroll: true })
  document.addEventListener('keydown', onKeydown)
  return {
    destroy() {
      document.removeEventListener('keydown', onKeydown)
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    },
  }
}
