import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {
  InputTriggerCandidate,
  InputTriggerSource,
  ReferenceInsert,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import {
  canonicalGitHubRepositoryUrl,
  extractGitHubRepositoryUrls,
  serializeReference,
  type ReferenceCatalogResponse,
  type ReferenceKind,
  type ReferenceRecord,
} from '../shared.ts'
import { formatReference, resultSelection } from '../online/reference.ts'
import type { OnlineSearchOptions, OnlineSearchPayload, OnlineSearchResult, ReferenceProvider, ZLibrarySort } from '../online/types.ts'
import { en, NS, zh, type ReferenceLibraryKey } from './locales.ts'
import { ReferenceSettingsCard, type ReferenceSettingsCardInjected } from './ReferenceSettingsCard.tsx'
import { settingsStylesheet } from './settings-styles.ts'
import { css, stylesheet } from './styles.ts'
import { REFERENCE_LIBRARY_SETTINGS_NAMESPACE, type ReferenceLibrarySettings } from '../settings-contract.ts'
import type { PinterestBridgeStatus } from '../online/pinterest-bridge.ts'
import { PinterestMenuRefresh } from './PinterestMenuRefresh.ts'

export const name = 'dship-reference-library.client'
export const inject = ['inputTriggers', 'slots', 'locale', 'settingsScope']

const CATALOG_ENDPOINT = '/api/dship/reference-library/catalog'
const REQUEST_ENDPOINT = '/api/dship/reference-library/requests'
const ONLINE_SEARCH_ENDPOINT = '/api/dship/reference-library/online/search'
const CODEPEN_POSTER_ENDPOINT = '/api/dship/reference-library/codepen-poster'
const CODEPEN_PREVIEW_ENDPOINT = '/api/dship/reference-library/codepen-preview'
const PINTEREST_BRIDGE_ROOT = '/api/dship/reference-library/online/pinterest-bridge'
const PINTEREST_UPDATED_EVENT = 'dship:pinterest:updated'
const PINTEREST_LOAD_MORE_EVENT = 'dship:pinterest:load-more'

type MenuControl = { readonly id: string; readonly label: string; readonly active?: boolean; readonly disabled?: boolean }
type MorePage = { readonly items: readonly InputTriggerCandidate[]; readonly hasMore: boolean }
type EnhancedInputTriggerSource = InputTriggerSource & {
  menuControls?: () => readonly MenuControl[]
  onMenuControl?: (_session: unknown, id: string) => void | Promise<void>
  loadMore?: (_session: unknown, request: { readonly query: string; readonly offset: number; readonly signal: AbortSignal }) => Promise<MorePage>
}

type PromptInjected = {
  loadCatalog(signal?: AbortSignal): Promise<ReferenceCatalogResponse>
  queueRepository(url: string, signal?: AbortSignal): Promise<void>
}

type Translate = (key: ReferenceLibraryKey, params?: Record<string, unknown>) => string

type RichCandidate = InputTriggerCandidate & {
  readonly placeholder?: 'image' | 'book-cover' | 'project-preview'
  readonly eyebrow?: string
  readonly badges?: readonly string[]
  readonly action?: { readonly label: string; readonly href: string }
  readonly selectable?: boolean
}

type PromptProps = PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'dship.reference-library'>
  & PromptInjected

class CatalogClient {
  private cached: ReferenceCatalogResponse | undefined
  private pending: Promise<ReferenceCatalogResponse> | undefined

  load(signal?: AbortSignal): Promise<ReferenceCatalogResponse> {
    if (this.cached !== undefined) return Promise.resolve(this.cached)
    this.pending ??= fetch(CATALOG_ENDPOINT, { credentials: 'same-origin' })
      .then(async (response) => {
        const payload = await response.json() as ReferenceCatalogResponse | { error?: string }
        if (!response.ok) throw new Error('error' in payload && payload.error !== undefined ? payload.error : `catalog request failed (${String(response.status)})`)
        this.cached = payload as ReferenceCatalogResponse
        return this.cached
      })
      .finally(() => { this.pending = undefined })
    if (signal === undefined) return this.pending
    if (signal.aborted) return Promise.reject(signal.reason)
    return Promise.race([
      this.pending,
      new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
      }),
    ])
  }

  record(id: string): ReferenceRecord | undefined {
    return this.cached?.records.find(record => record.id === id)
  }

  markPending(url: string): void {
    if (this.cached === undefined || this.cached.pendingGitHubUrls.includes(url)) return
    this.cached = {
      ...this.cached,
      pendingGitHubUrls: [...this.cached.pendingGitHubUrls, url],
    }
  }

  invalidate(): void {
    this.cached = undefined
    this.pending = undefined
  }
}

class OnlineClient {
  async search(provider: ReferenceProvider, query: string, signal: AbortSignal, options: OnlineSearchOptions = {}): Promise<OnlineSearchPayload> {
    const normalized = query.replace(/\s+/g, ' ').trim()
    if (normalized.length === 1) return { provider, query: normalized, results: [] }
    const params = new URLSearchParams({ provider, q: normalized })
    if (options.offset !== undefined) params.set('offset', String(options.offset))
    if (options.limit !== undefined) params.set('limit', String(options.limit))
    if (options.sort !== undefined) params.set('sort', options.sort)
    if (options.refresh === true) params.set('refresh', '1')
    const response = await fetch(`${ONLINE_SEARCH_ENDPOINT}?${params.toString()}`, { credentials: 'same-origin', signal })
    const payload = await response.json() as OnlineSearchPayload | { error?: string }
    if (!response.ok) throw new Error('error' in payload && payload.error !== undefined ? payload.error : `search request failed (${String(response.status)})`)
    return payload as OnlineSearchPayload
  }
}

const ONLINE_PREFIX = 'online:'

function onlineRef(result: OnlineSearchResult): string { return `${ONLINE_PREFIX}${JSON.stringify(result)}` }

function parseOnlineRef(ref: string, expected?: ReferenceProvider): OnlineSearchResult | undefined {
  if (!ref.startsWith(ONLINE_PREFIX)) return undefined
  try {
    const value = JSON.parse(ref.slice(ONLINE_PREFIX.length)) as Partial<OnlineSearchResult>
    if ((value.provider !== 'codepen' && value.provider !== 'pinterest' && value.provider !== 'zlibrary') || (expected !== undefined && value.provider !== expected)) return undefined
    if (typeof value.id !== 'string' || typeof value.title !== 'string' || typeof value.url !== 'string' || new URL(value.url).protocol !== 'https:') return undefined
    return value as OnlineSearchResult
  } catch { return undefined }
}

function onlineCandidate(result: OnlineSearchResult, t: Translate, section?: string): RichCandidate {
  const description = result.provider === 'zlibrary'
    ? [result.author, result.year, result.language, result.extension, result.size].filter(Boolean).join(' · ') || 'Z-Library'
    : [result.author, result.description].filter(Boolean).join(' · ') || (result.provider === 'codepen' ? 'CodePen' : 'Pinterest')
  return {
    name: result.title,
    description,
    icon: 'file',
    value: onlineRef(result),
    placeholder: result.provider === 'zlibrary' ? 'book-cover' : 'image',
    action: {
      label: result.provider === 'zlibrary' ? t('action.download') : t('action.save'),
      href: result.url,
    },
    ...(result.imageUrl === undefined ? {} : { thumbnail: result.imageUrl }),
    ...(section === undefined ? {} : { section }),
  }
}

function onlineInsertion(result: OnlineSearchResult): ReferenceInsert {
  return { source: result.provider === 'codepen' ? 'CodePen' : result.provider === 'pinterest' ? 'Pinterest' : 'Z-Library', ref: onlineRef(result), label: result.title, appearance: 'file', clipboardText: formatReference(resultSelection(result)) }
}

function onlineCodec(provider: ReferenceProvider): NonNullable<InputTriggerSource['codec']> {
  return {
    clipboardText: ref => { const result = parseOnlineRef(ref, provider); return result === undefined ? ref : formatReference(resultSelection(result)) },
    serialize: async (ref) => {
      const result = parseOnlineRef(ref, provider)
      if (result === undefined) throw new Error(`${provider} reference is no longer valid`)
      return formatReference(resultSelection(result))
    },
  }
}

function recordMatches(record: ReferenceRecord, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return true
  return [record.title, record.category, record.summary, record.useFor, ...record.tags]
    .some(value => value.toLocaleLowerCase().includes(needle))
}

function candidate(record: ReferenceRecord, t: Translate, section?: string): RichCandidate {
  const repositoryUrl = record.kind === 'github-project' ? record.sourceUrl ?? undefined : undefined
  return {
    name: record.title,
    description: record.summary === '' ? record.category : `${record.category} · ${record.summary}`,
    icon: (record.kind === 'codepen' ? 'file' : 'link') as InputTriggerCandidate['icon'],
    value: record.id,
    eyebrow: record.kind === 'github-project'
      ? `${record.category} · ${record.sourceBranch ?? 'local'}`
      : record.category,
    badges: record.tags.slice(0, 4),
    ...(record.kind === 'codepen'
      ? {
          thumbnail: `${CODEPEN_POSTER_ENDPOINT}?id=${encodeURIComponent(record.id)}`,
          preview: `${CODEPEN_PREVIEW_ENDPOINT}/${encodeURIComponent(record.id)}/index.html`,
          placeholder: 'project-preview' as const,
        }
      : {}),
    ...(repositoryUrl === undefined
      ? {}
      : { action: { label: t('action.github'), href: repositoryUrl } }),
    ...(section === undefined ? {} : { section }),
  }
}

function clipboardText(record: ReferenceRecord): string {
  if (record.kind === 'github-project' && record.sourceUrl !== null) {
    return canonicalGitHubRepositoryUrl(record.sourceUrl) ?? record.sourceUrl
  }
  const path = record.absolutePath.replaceAll('\\', '/')
  return /\s/.test(path) ? `@"${path}"` : `@${path}`
}

function insertion(record: ReferenceRecord): ReferenceInsert {
  return {
    source: record.kind === 'codepen' ? 'CodePen' : 'GitHub',
    ref: record.id,
    label: record.title,
    appearance: (record.kind === 'codepen' ? 'file' : 'link') as ReferenceInsert['appearance'],
    clipboardText: clipboardText(record),
  }
}

function catalogCodec(kind: ReferenceKind, sourceName: 'CodePen' | 'GitHub', catalog: CatalogClient): NonNullable<InputTriggerSource['codec']> {
  return {
    clipboardText: (ref) => {
      const record = catalog.record(ref)
      return record === undefined ? ref : clipboardText(record)
    },
    serialize: async (ref, signal) => {
      const snapshot = await catalog.load(signal)
      const record = snapshot.records.find(item => item.id === ref && item.kind === kind)
      if (record === undefined) throw new Error(`${sourceName} reference "${ref}" is no longer in the catalog`)
      return serializeReference(record)
    },
  }
}

function createCatalogSource(kind: ReferenceKind, sourceName: 'GitHub', order: number, catalog: CatalogClient, t: Translate): InputTriggerSource {
  const source: InputTriggerSource & { readonly menuTab: true; readonly menuLayout: 'repository-list' } = {
    trigger: '@',
    name: sourceName,
    order,
    menuTab: true,
    menuLayout: 'repository-list',
    showGroupTitle: false,
    warm: () => { void catalog.load().catch(() => undefined) },
    candidates: async (_session, request) => {
      const snapshot = await catalog.load(request.signal)
      if (request.signal.aborted) return []
      return snapshot.records
        .filter(record => record.kind === kind && recordMatches(record, request.query))
        .map(record => candidate(record, t))
    },
    onPick: (pick) => {
      if (pick.action !== 'pick' || pick.candidate.value === undefined) return undefined
      const record = catalog.record(pick.candidate.value)
      return record === undefined || record.kind !== kind ? undefined : { insert: insertion(record) }
    },
    codec: catalogCodec(kind, sourceName, catalog),
  }
  return source
}

function createCodePenSource(catalog: CatalogClient, t: Translate): InputTriggerSource {
  const source: InputTriggerSource & { readonly menuTab: true; readonly menuLayout: 'project-grid' } = {
    trigger: '@',
    name: 'CodePen',
    order: 10,
    menuTab: true,
    menuLayout: 'project-grid',
    showGroupTitle: false,
    warm: () => { void catalog.load().catch(() => undefined) },
    candidates: async (_session, request) => {
      const snapshot = await catalog.load(request.signal)
      if (request.signal.aborted) return []
      return snapshot.records
        .filter(record => record.kind === 'codepen' && recordMatches(record, request.query))
        .map(record => candidate(record, t))
    },
    onPick: (pick) => {
      if (pick.action !== 'pick' || pick.candidate.value === undefined) return undefined
      const record = catalog.record(pick.candidate.value)
      return record?.kind === 'codepen' ? { insert: insertion(record) } : undefined
    },
    codec: catalogCodec('codepen', 'CodePen', catalog),
  }
  return source
}

function waitForPinterestCapture(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, 1_200)
    signal.addEventListener('abort', () => { window.clearTimeout(timer); reject(signal.reason) }, { once: true })
  })
}

function createOnlineSource(provider: 'pinterest' | 'zlibrary', name: 'Pinterest' | 'Z-Library', order: number, online: OnlineClient, t: Translate, pinterestRefresh?: PinterestMenuRefresh): InputTriggerSource {
  let zlibrarySort: ZLibrarySort = 'relevance'
  let refreshBooks = false
  const source: EnhancedInputTriggerSource & { readonly menuTab: true; readonly menuLayout: 'masonry' | 'book-list' } = {
    trigger: '@',
    name,
    order,
    menuTab: true,
    menuLayout: provider === 'pinterest' ? 'masonry' : 'book-list',
    showGroupTitle: false,
    candidates: async (_session, request) => {
      const refresh = provider === 'zlibrary' && refreshBooks
      refreshBooks = false
      const payload = await online.search(provider, request.query, request.signal, provider === 'zlibrary'
        ? { sort: zlibrarySort, refresh }
        : {}).catch(() => ({ provider, query: request.query, results: [] } as OnlineSearchPayload))
      const candidates = payload.results.map(result => onlineCandidate(result, t))
      if (payload.notice === 'pinterest-chrome-required') pinterestRefresh?.watch()
      else pinterestRefresh?.stop()
      if (payload.notice === undefined) return candidates
      return [...candidates, {
        name: t(`notice.${payload.notice}`),
        description: name,
        placeholder: 'image' as const,
        selectable: false,
        ...(payload.notice === 'pinterest-chrome-required' || payload.notice === 'pinterest-login-required'
          ? { action: { label: t(payload.notice === 'pinterest-login-required' ? 'action.pinterest-login' : 'action.pinterest-open'), href: `${PINTEREST_BRIDGE_ROOT}/open?q=${encodeURIComponent(payload.query)}` } }
          : {}),
      }]
    },
    ...(provider === 'zlibrary' ? {
      menuControls: () => ([
        { id: 'relevance', label: t('sort.relevance'), active: zlibrarySort === 'relevance' },
        { id: 'newest', label: t('sort.newest'), active: zlibrarySort === 'newest' },
        { id: 'oldest', label: t('sort.oldest'), active: zlibrarySort === 'oldest' },
        { id: 'title', label: t('sort.title'), active: zlibrarySort === 'title' },
      ]),
      onMenuControl: (_session: unknown, id: string) => {
        if (id !== 'relevance' && id !== 'newest' && id !== 'oldest' && id !== 'title') return
        zlibrarySort = id
        refreshBooks = true
      },
    } : {
      loadMore: async (_session: unknown, request: { readonly query: string; readonly offset: number; readonly signal: AbortSignal }) => {
        document.dispatchEvent(new Event(PINTEREST_LOAD_MORE_EVENT))
        await waitForPinterestCapture(request.signal)
        const payload = await online.search('pinterest', request.query, request.signal, { offset: request.offset })
        return { items: payload.results.map(result => onlineCandidate(result, t)), hasMore: payload.hasMore === true }
      },
    }),
    ...(pinterestRefresh === undefined ? {} : {
      lexicon: () => [],
      subscribeLexicon: (_session, listener) => pinterestRefresh.subscribe(listener),
    }),
    onPick: (pick) => {
      if (pick.action !== 'pick' || pick.candidate.value === undefined) return undefined
      const result = parseOnlineRef(pick.candidate.value, provider)
      return result === undefined ? undefined : { insert: onlineInsertion(result) }
    },
    codec: onlineCodec(provider),
  }
  return source
}

function conversationText(nodes: readonly unknown[]): string {
  const parts: string[] = []
  for (const value of nodes) {
    if (value === null || typeof value !== 'object') continue
    const kind = Reflect.get(value, 'kind')
    if (kind !== 'user' && kind !== 'steering' && kind !== 'assistant-step') continue
    const data = Reflect.get(value, 'data')
    try {
      parts.push(JSON.stringify(data))
    } catch {
      // Conversation node data is JSON-compatible; a faulty third-party node
      // is ignored so it cannot suppress prompts derived from other messages.
    }
  }
  return parts.join('\n')
}

export function ReferencePrompt({ useChat, loadCatalog, queueRepository, t }: PromptProps) {
  const nodes = useChat((snapshot: ChatSnapshot) => snapshot.nodes.values())
  const urls = useMemo(() => extractGitHubRepositoryUrls(conversationText(nodes)), [nodes])
  const [catalog, setCatalog] = useState<ReferenceCatalogResponse>()
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void loadCatalog(controller.signal).then(setCatalog, () => undefined)
    return () => { controller.abort() }
  }, [loadCatalog])

  const known = new Set(catalog?.knownGitHubUrls ?? [])
  const pending = new Set(catalog?.pendingGitHubUrls ?? [])
  const url = urls.find(candidateUrl => !known.has(candidateUrl) && !pending.has(candidateUrl) && !dismissed.has(candidateUrl))
  if (url === undefined) return null

  const dismiss = (): void => {
    setDismissed(previous => new Set([...previous, url]))
    setError(false)
  }
  const add = (): void => {
    setAdding(true)
    setError(false)
    const controller = new AbortController()
    void queueRepository(url, controller.signal).then(() => {
      setCatalog(previous => previous === undefined ? previous : {
        ...previous,
        pendingGitHubUrls: previous.pendingGitHubUrls.includes(url)
          ? previous.pendingGitHubUrls
          : [...previous.pendingGitHubUrls, url],
      })
    }, () => {
      setError(true)
    }).finally(() => { setAdding(false) })
  }

  return (
    <section className={css.prompt} aria-labelledby="dship-reference-prompt-title">
      <div className={css.copy}>
        <div id="dship-reference-prompt-title" className={css.title}>{t('prompt.title')}</div>
        <div className={css.body}>{t('prompt.body')}</div>
        <span className={css.url} title={url}>{url}</span>
      </div>
      <div className={css.actions}>
        <button type="button" className={css.button} disabled={adding} onClick={dismiss}>{t('prompt.dismiss')}</button>
        <button type="button" className={clsx(css.button, css.primary)} disabled={adding} onClick={add}>
          {adding ? t('prompt.adding') : t('prompt.add')}
        </button>
      </div>
      {error && <div className={css.error} role="alert">{t('prompt.failed')}</div>}
    </section>
  )
}

export function apply(ctx: Context): void {
  const catalog = new CatalogClient()
  const online = new OnlineClient()
  const pinterestRefresh = new PinterestMenuRefresh()
  const settingsScope = ctx.settingsScope.bind<ReferenceLibrarySettings>({ namespace: REFERENCE_LIBRARY_SETTINGS_NAMESPACE })
  const t = ctx.locale.bind(NS)
  const loadCatalog = (signal?: AbortSignal): Promise<ReferenceCatalogResponse> => catalog.load(signal)
  const queueRepository = async (url: string, signal?: AbortSignal): Promise<void> => {
    const response = await fetch(REQUEST_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
      signal,
    })
    const payload = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new Error(payload.error ?? `request queue failed (${String(response.status)})`)
    catalog.markPending(url)
  }

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.dataset.pluginCss = 'dship-reference-library'
    tag.textContent = `${stylesheet}\n${settingsStylesheet}`
    const previous = document.querySelector('style[data-plugin-css="dship-reference-library"]')
    if (previous === null) document.head.appendChild(tag)
    else previous.replaceWith(tag)
    return () => { tag.remove() }
  }, 'reference-library: prompt styles')
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'reference-library: dictionaries')
  ctx.effect(() => settingsScope.subscribe(() => { catalog.invalidate() }), 'reference-library: settings invalidation')
  ctx.effect(() => ctx.inputTriggers.registerSource(createCodePenSource(catalog, t)), 'reference-library: CodePen source')
  ctx.effect(() => ctx.inputTriggers.registerSource(createOnlineSource('pinterest', 'Pinterest', 20, online, t, pinterestRefresh)), 'reference-library: Pinterest source')
  ctx.effect(() => ctx.inputTriggers.registerSource(createOnlineSource('zlibrary', 'Z-Library', 30, online, t)), 'reference-library: Z-Library source')
  ctx.effect(() => ctx.inputTriggers.registerSource(createCatalogSource('github-project', 'GitHub', 40, catalog, t)), 'reference-library: GitHub source')
  ctx.effect(() => {
    const listener = (): void => { pinterestRefresh.notify() }
    document.addEventListener(PINTEREST_UPDATED_EVENT, listener)
    return () => { document.removeEventListener(PINTEREST_UPDATED_EVENT, listener) }
  }, 'reference-library: Pinterest Chrome update listener')
  const loadPinterestBridgeStatus = async (): Promise<PinterestBridgeStatus> => {
    const response = await fetch(`${PINTEREST_BRIDGE_ROOT}/status`, { credentials: 'same-origin' })
    const payload = await response.json() as PinterestBridgeStatus | { error?: string }
    if (!response.ok) throw new Error('error' in payload && payload.error !== undefined ? payload.error : `bridge status failed (${String(response.status)})`)
    return payload as PinterestBridgeStatus
  }
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: REFERENCE_LIBRARY_SETTINGS_NAMESPACE,
    locale: NS,
    inject: (): ReferenceSettingsCardInjected => ({
      settingsScope,
      pinterestOpenUrl: `${PINTEREST_BRIDGE_ROOT}/open`,
      loadPinterestBridgeStatus,
    }),
  }, ReferenceSettingsCard))
  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'reference-library-link-prompt',
    order: 5,
    locale: NS,
    inject: (): PromptInjected => ({ loadCatalog, queueRepository }),
  }, ReferencePrompt))
}
