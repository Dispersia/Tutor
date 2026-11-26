export type ToastTone = 'success' | 'error' | 'info'

type ToastLive = 'assertive' | 'polite'

const toastLive = (tone: ToastTone): ToastLive => (tone === 'error' ? 'assertive' : 'polite')

interface ToastItem {
  id: number
  message: string
  tone: ToastTone
  live: ToastLive
}

const LIFETIME = 3200
const MAX = 3

class Toasts {
  items = $state<ToastItem[]>([])
  #next = 0

  show(message: string, tone: ToastTone = 'success'): number {
    const id = ++this.#next
    const next = [...this.items, { id, message, tone, live: toastLive(tone) }]
    this.items = next.slice(-MAX)
    setTimeout(() => this.dismiss(id), LIFETIME)
    return id
  }

  dismiss(id: number): void {
    this.items = this.items.filter((t) => t.id !== id)
  }
}

export const toasts = new Toasts()

export function toast(message: string, tone: ToastTone = 'success'): void {
  toasts.show(message, tone)
}
