import { ZLibrarySearchService } from './book.ts'
import type { ResolvedConfig } from './config.ts'
import { PinterestChromeBridge } from './pinterest-bridge.ts'
import type { OnlineSearchOptions, OnlineSearchPayload, ReferenceProvider } from './types.ts'

export class OnlineReferenceService {
  private readonly books: ZLibrarySearchService
  readonly pinterest: PinterestChromeBridge

  constructor(config: ResolvedConfig, extensionPath: string) {
    this.books = new ZLibrarySearchService({ domain: config.zlibraryDomain, defaultQuery: config.zlibraryDefaultQuery, timeoutMs: config.zlibraryRequestTimeoutMs, resultLimit: config.zlibraryResultLimit })
    this.pinterest = new PinterestChromeBridge({ defaultQuery: config.pinterestDefaultQuery, resultLimit: config.pinterestResultLimit, extensionPath })
  }

  search(provider: ReferenceProvider, query: string, signal?: AbortSignal, options: OnlineSearchOptions = {}): Promise<OnlineSearchPayload> {
    if (provider === 'zlibrary') return this.books.search(query, signal, options)
    if (provider === 'codepen') return Promise.resolve({ provider, query, results: [], source: 'local-catalog-only' })
    return Promise.resolve(this.pinterest.search(query, options.offset, options.limit))
  }

  dispose(): Promise<void> { return Promise.resolve() }
}
