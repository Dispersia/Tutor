import { api } from './api'
import { toast } from './toast.svelte'

const MAX = 5
const DURATIONS = [0, 6, 10, 16, 24, 35]

function clamp(n: number): number {
  return Math.max(0, Math.min(MAX, Math.round(n)))
}

export function vibrationSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

function vibrate(ms: number): boolean {
  if (ms <= 0 || !vibrationSupported()) return false
  return navigator.vibrate(ms)
}

class HapticsState {
  value = $state(0)
  private loading: Promise<void> | null = null
  private reported = false

  async ensure(): Promise<void> {
    if (!this.loading) this.loading = this.load()
    return this.loading
  }

  private async load(): Promise<void> {
    try {
      const reply = await api<{ haptics?: number }>('/api/settings')
      this.value = clamp(reply.haptics ?? 0)
      this.reported = false
    } catch {
      this.loading = null
      if (!this.reported) {
        this.reported = true
        toast('Could not load your vibration setting', 'error')
      }
    }
  }

  set(value: number): void {
    this.value = clamp(value)
  }

  pulse(): void {
    vibrate(DURATIONS[this.value] ?? 0)
  }

  preview(level: number): boolean {
    return vibrate(DURATIONS[clamp(level)] ?? 0)
  }
}

export const haptics = new HapticsState()
