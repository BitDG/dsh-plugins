/** Refreshes an already-open @ menu after the Chrome bridge finishes ingesting Pins. */
export class PinterestMenuRefresh {
  private readonly listeners = new Set<() => void>()
  private watching = false

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  watch(): void {
    this.watching = true
  }

  stop(): void {
    this.watching = false
  }

  notify(): void {
    if (!this.watching) return
    for (const listener of this.listeners) listener()
  }
}
