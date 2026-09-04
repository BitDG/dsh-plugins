import type { OnlineSearchResult, ReferenceSelection, VisualReferenceProvider } from './types.ts'

export interface CapturePayload {
  readonly url: unknown
  readonly title?: unknown
  readonly imageUrl?: unknown
  readonly description?: unknown
}

function compactText(value: unknown, fallback: string, limit = 240): string {
  if (typeof value !== 'string') return fallback
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact === '' ? fallback : compact.slice(0, limit)
}

function optionalText(value: unknown, limit = 240): string | undefined {
  const compact = compactText(value, '', limit)
  return compact === '' ? undefined : compact
}

function optionalHttpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4096) return undefined
  try { const parsed = new URL(value); return parsed.protocol === 'https:' ? parsed.href : undefined } catch { return undefined }
}

export function providerStartUrl(provider: VisualReferenceProvider, query = ''): string {
  const q = query.trim()
  if (provider === 'pinterest') return q === '' ? 'https://www.pinterest.com/' : `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}`
  return q === '' ? 'https://codepen.io/trending' : `https://codepen.io/search/pens?q=${encodeURIComponent(q)}`
}

export function normalizeSelection(provider: VisualReferenceProvider, payload: CapturePayload): OnlineSearchResult {
  if (typeof payload.url !== 'string' || payload.url.length > 4096) throw new Error('页面地址无效')
  const parsed = new URL(payload.url)
  if (parsed.protocol !== 'https:') throw new Error('只接受 HTTPS 在线页面')
  const description = optionalText(payload.description)
  const imageUrl = optionalHttpsUrl(payload.imageUrl)
  if (provider === 'pinterest') {
    if (!(parsed.hostname === 'pinterest.com' || parsed.hostname.endsWith('.pinterest.com'))) throw new Error('不是 Pinterest 页面')
    const match = /^\/pin\/([^/?#]+)\/?$/i.exec(parsed.pathname)
    if (match === null) throw new Error('不是 Pinterest Pin 详情地址')
    const id = decodeURIComponent(match[1]!)
    return { provider, id, url: `https://www.pinterest.com/pin/${encodeURIComponent(id)}/`, title: compactText(payload.title, 'Pinterest Pin'), ...(description === undefined ? {} : { description }), ...(imageUrl === undefined ? {} : { imageUrl }) }
  }
  if (parsed.hostname !== 'codepen.io') throw new Error('不是 CodePen 页面')
  const match = /^\/([^/?#]+)\/pen\/([^/?#]+)\/?$/i.exec(parsed.pathname)
  if (match === null) throw new Error('不是 CodePen Pen 详情地址')
  const author = decodeURIComponent(match[1]!)
  const id = decodeURIComponent(match[2]!)
  return { provider, id, author, url: `https://codepen.io/${encodeURIComponent(author)}/pen/${encodeURIComponent(id)}`, title: compactText(payload.title, 'CodePen Pen'), embedUrl: `https://codepen.io/${encodeURIComponent(author)}/embed/${encodeURIComponent(id)}`, ...(description === undefined ? {} : { description }), ...(imageUrl === undefined ? {} : { imageUrl }) }
}

export function formatReference(selection: ReferenceSelection): string {
  if (selection.provider === 'zlibrary') {
    const details = [selection.author, selection.year, selection.language, selection.extension, selection.size].filter(Boolean).join(' · ')
    return [`[Z-Library：${selection.title}](${selection.url})`, details].filter(Boolean).join('\n')
  }
  const label = selection.provider === 'pinterest' ? 'Pinterest' : 'CodePen'
  const lines = [`[${label}：${selection.title}](${selection.url})`]
  if (selection.provider === 'pinterest' && selection.imageUrl !== undefined) lines.push(`图片：${selection.imageUrl}`)
  if (selection.provider === 'codepen' && selection.embedUrl !== undefined) lines.push(`预览：${selection.embedUrl}`)
  return lines.join('\n')
}

export function appendReferenceToDraft(draft: string, selection: ReferenceSelection): string {
  if (draft.includes(selection.url)) return draft
  const reference = formatReference(selection)
  return draft.trimEnd() === '' ? reference : `${draft.trimEnd()}\n\n${reference}`
}

export function resultSelection(result: OnlineSearchResult): ReferenceSelection { return { ...result } }
