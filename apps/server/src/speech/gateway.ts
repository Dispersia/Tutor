export interface GatewayHandle {
  readonly url: string
  ensure(): Promise<void>
  begin(): void
  end(): void
}

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
