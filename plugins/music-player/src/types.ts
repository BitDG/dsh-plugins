export interface MusicItem {
  id: string
  platform: string
  title: string
  artist: string
  album?: string
  duration?: number
  artwork?: string
  publishedAt?: string
  publishedLabel?: string
  url?: string
  license?: string
  licenseUrl?: string
  [key: string]: unknown
}

export interface MediaSource {
  url: string
  headers?: Record<string, string>
  userAgent?: string
}

export interface PluginDescriptor {
  id: string
  platform: string
  defaultQuery?: string
  version: string
  author: string
  description: string
  allowedHosts: string[]
  installed: boolean
  builtin: boolean
  trusted?: boolean
}

export interface ReviewResult {
  id: string
  accepted: boolean
  createdAt: number
  descriptor?: PluginDescriptor
  checks: Array<{ name: string; ok: boolean; detail: string }>
  codePath?: string
}

export interface GenerationJob {
  id: string
  createdAt: number
  sourceUrl: string
  query: string
  author: string
  status: 'waiting-for-ai' | 'reviewing' | 'reviewed' | 'installed' | 'failed'
  prompt: string
  directory: string
  outputPath: string
  review?: ReviewResult
  error?: string
}

export interface RunnerRequest {
  code: string
  method: 'inspect' | 'search' | 'getMediaSource'
  args: unknown[]
  allowedHosts: string[]
  requestTimeoutMs: number
  maxResponseBytes: number
}
