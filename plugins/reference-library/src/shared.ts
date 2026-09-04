export type ReferenceKind = 'codepen' | 'github-project'

export interface ReferenceRecord {
  readonly id: string
  readonly kind: ReferenceKind
  readonly title: string
  readonly category: string
  readonly summary: string
  readonly useFor: string
  readonly tags: readonly string[]
  readonly localPath: string
  readonly absolutePath: string
  readonly entryPoints: readonly string[]
  readonly card: string
  readonly sourceUrl: string | null
  readonly sourceRevision: string | null
  readonly sourceBranch: string | null
  readonly licenseType: string
}

export interface ReferenceCatalogResponse {
  readonly records: readonly ReferenceRecord[]
  readonly knownGitHubUrls: readonly string[]
  readonly pendingGitHubUrls: readonly string[]
}

/** Normalize any GitHub repository or deep link to its canonical repository root. */
export function canonicalGitHubRepositoryUrl(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') return undefined
  const [owner, rawRepo] = url.pathname.split('/').filter(Boolean)
  if (owner === undefined || rawRepo === undefined) return undefined
  const repo = rawRepo.replace(/\.git$/i, '')
  const valid = /^[A-Za-z0-9_.-]+$/
  if (!valid.test(owner) || !valid.test(repo) || owner === '.' || owner === '..' || repo === '.' || repo === '..') {
    return undefined
  }
  return `https://github.com/${owner}/${repo}`
}

/** Extract canonical GitHub repository roots from visible conversation text. */
export function extractGitHubRepositoryUrls(text: string): readonly string[] {
  const results = new Set<string>()
  for (const match of text.matchAll(/https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^\s<>()\[\]{}"']*)?/gi)) {
    const canonical = canonicalGitHubRepositoryUrl(match[0].replace(/[.,;:!?]+$/, ''))
    if (canonical !== undefined) results.add(canonical)
  }
  return [...results]
}

/** Stable model-visible serialization of one selected catalog record. */
export function serializeReference(record: ReferenceRecord): string {
  const attributes = [
    `source="${record.kind === 'codepen' ? 'codepen' : 'github'}"`,
    `id="${escapeAttribute(record.id)}"`,
    `path="${escapeAttribute(record.absolutePath)}"`,
    ...(record.sourceUrl === null ? [] : [`url="${escapeAttribute(record.sourceUrl)}"`]),
    ...(record.sourceRevision === null ? [] : [`revision="${escapeAttribute(record.sourceRevision)}"`]),
  ].join(' ')
  const details = [
    record.title,
    record.summary,
    record.useFor === '' ? '' : `Use for: ${record.useFor}`,
    record.entryPoints.length === 0 ? '' : `Entry points: ${record.entryPoints.join(', ')}`,
    `License: ${record.licenseType}`,
  ].filter(Boolean).join('\n')
  return `<reference-project ${attributes}>\n${details}\n</reference-project>`
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}
