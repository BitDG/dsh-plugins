export interface OnlineConfig {
  pinterestDefaultQuery?: string
  pinterestResultLimit?: number
  zlibraryDomain?: string
  zlibraryDefaultQuery?: string
  zlibraryRequestTimeoutMs?: number
  zlibraryResultLimit?: number
}

export interface ResolvedConfig {
  pinterestDefaultQuery: string
  pinterestResultLimit: number
  zlibraryDomain?: string
  zlibraryDefaultQuery: string
  zlibraryRequestTimeoutMs: number
  zlibraryResultLimit: number
}

export function resolveOnlineConfig(config: OnlineConfig): ResolvedConfig {
  return {
    pinterestDefaultQuery: config.pinterestDefaultQuery?.replace(/\s+/g, ' ').trim().slice(0, 200) || 'design inspiration',
    pinterestResultLimit: Math.max(30, Math.min(50, Math.floor(config.pinterestResultLimit ?? 30))),
    zlibraryDomain: config.zlibraryDomain?.trim() || undefined,
    zlibraryDefaultQuery: config.zlibraryDefaultQuery?.replace(/\s+/g, ' ').trim().slice(0, 200) || 'design',
    zlibraryRequestTimeoutMs: Math.max(2_000, Math.min(30_000, config.zlibraryRequestTimeoutMs ?? 15_000)),
    zlibraryResultLimit: Math.max(1, Math.min(20, Math.floor(config.zlibraryResultLimit ?? 10))),
  }
}
