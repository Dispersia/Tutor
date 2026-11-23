/**
 * One call to the speech gateway (docs/DESIGN.md §8.1): wake the sidecar if it
 * is asleep, count the call as in flight so the idle timer cannot stop the
 * gateway underneath it, and release it whatever the call does.
 */

/** The part of `SpeechSupervisor` a gateway call needs. */
export interface GatewayHandle {
  readonly url: string
  ensure(): Promise<void>
  begin(): void
  end(): void
}

/** Runs `fn` against the gateway's base URL, started and held busy for the duration. */
export async function withGateway<T>(
  sup: GatewayHandle,
  fn: (url: string) => Promise<T>,
): Promise<T> {
  await sup.ensure()
  sup.begin()
  try {
    return await fn(sup.url)
  } finally {
    sup.end()
  }
}
