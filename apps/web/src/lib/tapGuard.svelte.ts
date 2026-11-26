const LINGER_MS = 1000

class TapGuard {
  active = $state(false)
  private timer: ReturnType<typeof setTimeout> | undefined

  arm(ms = LINGER_MS): void {
    this.active = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => (this.active = false), ms)
  }
}

export const tapGuard = new TapGuard()
