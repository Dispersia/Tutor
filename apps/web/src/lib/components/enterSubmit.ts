export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target instanceof HTMLElement ? target : null
  return Boolean(el?.closest('input, textarea, select, a') || el?.isContentEditable)
}

export function primaryActionButton(e: KeyboardEvent): HTMLButtonElement | null {
  if (e.key !== 'Enter' || e.repeat || isTypingTarget(e.target)) return null
  return document.querySelector<HTMLButtonElement>('[data-enter-action]:not(:disabled)')
}
