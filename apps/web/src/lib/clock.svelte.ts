/**
 * One shared wall clock for every live countdown (rig run bars, bank counters).
 *
 * Reading `clock.now` inside a `$derived`, an `$effect` or the template
 * subscribes the reader: it re-runs once a second. The interval exists only
 * while something is subscribed, so a screen with nothing ticking costs no timer
 * — and four screens no longer each run their own.
 */
import { createSubscriber } from 'svelte/reactivity'

const TICK_MS = 1000

const subscribe = createSubscriber((update) => {
  const timer = setInterval(update, TICK_MS)
  return () => clearInterval(timer)
})

export const clock = {
  /** Epoch ms, re-read every second by whatever reactive scope touched it. */
  get now(): number {
    subscribe()
    return Date.now()
  },
}
