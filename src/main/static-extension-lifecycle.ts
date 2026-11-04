export type StaticExtension = (onDispose: (dispose: () => void | Promise<void>) => void) => void | Promise<void>

// Only host-owned, statically imported code is passed here; this is not a plugin loader.
export class StaticExtensionLifecycle {
  private readonly disposers: Array<() => void | Promise<void>> = []
  private startPromise: Promise<void> | undefined
  private stopPromise: Promise<void> | undefined
  private stopRequested = false

  start(extensions: readonly StaticExtension[]): Promise<void> {
    if (this.stopRequested) return Promise.reject(new Error('Extensions have already stopped'))
    if (this.startPromise) return this.startPromise
    this.startPromise = Promise.resolve().then(() => this.startExtensions(extensions))
    return this.startPromise
  }

  private async startExtensions(extensions: readonly StaticExtension[]): Promise<void> {
    try {
      for (const extension of extensions) {
        if (this.stopRequested) break
        await extension((dispose) => this.disposers.push(dispose))
      }
    } catch (error) {
      try { await this.disposeAll() }
      catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Extension startup and cleanup failed') }
      throw error
    }
  }

  runIfNotStopped(action: () => void): boolean {
    if (this.stopRequested) return false
    action()
    return true
  }

  stop(): Promise<void> {
    this.stopRequested = true
    if (!this.stopPromise) {
      this.stopPromise = (async () => {
        try { await this.startPromise } catch { /* Retry any cleanup that failed during startup. */ }
        await this.disposeAll()
      })().catch((error: unknown) => {
        this.stopPromise = undefined
        throw error
      })
    }
    return this.stopPromise
  }

  private async disposeAll(): Promise<void> {
    const errors: unknown[] = []
    const failed: Array<() => void | Promise<void>> = []
    while (this.disposers.length) {
      const dispose = this.disposers.pop()
      if (!dispose) continue
      try { await dispose() } catch (error) { errors.push(error); failed.push(dispose) }
    }
    // Preserve reverse acquisition order for a later retry.
    this.disposers.push(...failed.reverse())
    if (errors.length) throw new AggregateError(errors, 'Extension cleanup failed')
  }
}
