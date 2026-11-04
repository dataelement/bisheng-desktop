export interface EarlyLinksProduct {
  fromArgv(argv: readonly string[]): Promise<{ url: string } | undefined>
  parse(value: string): Promise<{ url: string }>
  registerProtocol(): void
  sameOrigin(current: string, expected: string | undefined): boolean
}

export function createEarlyLinks(product: EarlyLinksProduct, target: () => {
  current: string
  expected: string | undefined
  send(url: string): void
} | undefined) {
  let pending: string | undefined
  function deliver(): void {
    if (!pending) return
    const destination = target()
    if (!destination || !product.sameOrigin(destination.current, destination.expected)) return
    destination.send(pending)
    pending = undefined
  }
  async function accept(value: string): Promise<boolean> {
    try {
      pending = (await product.parse(value)).url
    } catch (error) {
      console.warn(`[enterprise] rejected login link: ${error instanceof Error ? error.message : 'invalid link'}`)
      return false
    }
    deliver()
    return true
  }
  function start(argv: readonly string[], onOpenUrl: (handler: (url: string) => void) => void, lock: () => boolean): boolean {
    product.registerProtocol()
    void product.fromArgv(argv).then(link => {
      if (link) pending = link.url
      deliver()
    }).catch(() => undefined)
    onOpenUrl(url => { void accept(url) })
    return lock()
  }
  function secondInstance(argv: readonly string[]): void {
    void product.fromArgv(argv).then(link => {
      if (link) void accept(link.url)
    }).catch(() => undefined)
  }
  return { start, secondInstance, deliver }
}
