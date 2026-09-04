import { describe, expect, it } from 'vitest'
import {
  canonicalGitHubRepositoryUrl,
  extractGitHubRepositoryUrls,
  serializeReference,
  type ReferenceRecord,
} from '../src/shared.ts'

const githubRecord: ReferenceRecord = {
  id: 'github:owner/repo',
  kind: 'github-project',
  title: 'Repository',
  category: 'tool',
  summary: 'A useful repository.',
  useFor: 'Architecture reference',
  tags: ['tool'],
  localPath: 'Res/owner/repo',
  absolutePath: 'F:\\VibeSpace\\codepen\\Res\\owner\\repo',
  entryPoints: ['README.md', 'src/index.ts'],
  card: 'cards/projects/owner-repo.md',
  sourceUrl: 'https://github.com/owner/repo.git',
  sourceRevision: '0123456789abcdef',
  sourceBranch: 'main',
  licenseType: 'MIT',
}

describe('GitHub repository URL normalization', () => {
  it('canonicalizes repository roots, .git URLs, and deep links', () => {
    expect(canonicalGitHubRepositoryUrl('https://github.com/owner/repo.git')).toBe('https://github.com/owner/repo')
    expect(canonicalGitHubRepositoryUrl('https://github.com/owner/repo/tree/main/src')).toBe('https://github.com/owner/repo')
  })

  it('rejects non-HTTPS, non-GitHub, and owner-only links', () => {
    expect(canonicalGitHubRepositoryUrl('http://github.com/owner/repo')).toBeUndefined()
    expect(canonicalGitHubRepositoryUrl('https://example.com/owner/repo')).toBeUndefined()
    expect(canonicalGitHubRepositoryUrl('https://github.com/owner')).toBeUndefined()
  })

  it('extracts unique canonical repositories from conversation text', () => {
    expect(extractGitHubRepositoryUrls([
      'See https://github.com/owner/repo/tree/main.',
      'Again: https://github.com/owner/repo.git',
      'And https://github.com/second/project/issues/12',
    ].join('\n'))).toEqual([
      'https://github.com/owner/repo',
      'https://github.com/second/project',
    ])
  })
})

describe('reference serialization', () => {
  it('preserves the canonical source, local checkout, revision, usage, entry points, and license', () => {
    expect(serializeReference(githubRecord)).toBe([
      '<reference-project source="github" id="github:owner/repo" path="F:\\VibeSpace\\codepen\\Res\\owner\\repo" url="https://github.com/owner/repo.git" revision="0123456789abcdef">',
      'Repository',
      'A useful repository.',
      'Use for: Architecture reference',
      'Entry points: README.md, src/index.ts',
      'License: MIT',
      '</reference-project>',
    ].join('\n'))
  })

  it('escapes attribute data without rewriting visible content', () => {
    expect(serializeReference({ ...githubRecord, id: 'a&"<b' })).toContain('id="a&amp;&quot;&lt;b"')
  })
})
