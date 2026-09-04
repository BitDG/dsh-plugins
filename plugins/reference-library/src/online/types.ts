export type VisualReferenceProvider = 'pinterest' | 'codepen'
export type ReferenceProvider = VisualReferenceProvider | 'zlibrary'
export type ZLibrarySort = 'relevance' | 'newest' | 'oldest' | 'title'

export interface OnlineSearchOptions {
  readonly offset?: number
  readonly limit?: number
  readonly sort?: ZLibrarySort
  readonly refresh?: boolean
}

export interface OnlineSearchResult {
  readonly provider: ReferenceProvider
  readonly id: string
  readonly title: string
  readonly url: string
  readonly description?: string
  readonly imageUrl?: string
  readonly embedUrl?: string
  readonly author?: string
  readonly year?: string
  readonly language?: string
  readonly extension?: string
  readonly size?: string
}

export interface OnlineSearchPayload {
  readonly provider: ReferenceProvider
  readonly query: string
  readonly results: readonly OnlineSearchResult[]
  readonly source?: string
  readonly notice?: 'pinterest-chrome-required' | 'pinterest-login-required'
  readonly hasMore?: boolean
}

export interface ReferenceSelection {
  readonly provider: ReferenceProvider
  readonly url: string
  readonly title: string
  readonly imageUrl?: string
  readonly embedUrl?: string
  readonly author?: string
  readonly year?: string
  readonly language?: string
  readonly extension?: string
  readonly size?: string
}
