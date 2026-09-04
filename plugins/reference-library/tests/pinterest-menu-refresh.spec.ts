import { describe, expect, it, vi } from 'vitest'
import { PinterestMenuRefresh } from '../src/client/PinterestMenuRefresh.ts'

describe('PinterestMenuRefresh', () => {
  it('notifies the open @ menu when the extension reports a completed ingest', () => {
    const refresh = new PinterestMenuRefresh()
    const listener = vi.fn()
    const unsubscribe = refresh.subscribe(listener)

    refresh.watch()
    refresh.notify()

    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('ignores extension notifications after real results stop the watcher', () => {
    const listener = vi.fn()
    const refresh = new PinterestMenuRefresh()
    const unsubscribe = refresh.subscribe(listener)

    refresh.watch()
    refresh.stop()
    refresh.notify()

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })
})
