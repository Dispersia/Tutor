import { createSubscriber } from 'svelte/reactivity'

const TICK_MS = 1000

const subscribe = createSubscriber((update) => {
  const timer = setInterval(update, TICK_MS)
  return () => clearInterval(timer)
})

export const clock = {
  get now(): number {
    subscribe()
    return Date.now()
  },
}
