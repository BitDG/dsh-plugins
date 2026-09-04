import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Pinterest Chrome extension', () => {
  it('has Pinterest-only page access and loopback-only host access', async () => {
    const manifest = JSON.parse(await readFile(new URL('../chrome-extension/manifest.json', import.meta.url), 'utf8')) as Record<string, any>
    expect(manifest.manifest_version).toBe(3)
    expect(manifest.permissions).toEqual([])
    expect(manifest.host_permissions).toEqual(['http://127.0.0.1/*', 'http://localhost/*'])
    expect(manifest.content_scripts[0].matches).toEqual(['http://127.0.0.1/*', 'http://localhost/*'])
    expect(manifest.content_scripts[1].matches).toEqual(['https://pinterest.com/*', 'https://*.pinterest.com/*'])
  })

  it('does not inspect cookies, storage, passwords, or browser profiles', async () => {
    const source = `${await readFile(new URL('../chrome-extension/background.js', import.meta.url), 'utf8')}\n${await readFile(new URL('../chrome-extension/content.js', import.meta.url), 'utf8')}\n${await readFile(new URL('../chrome-extension/dsh.js', import.meta.url), 'utf8')}`
    expect(source).not.toMatch(/chrome\.cookies|document\.cookie|localStorage|sessionStorage|chrome\.history|chrome\.bookmarks|chrome\.passwords/i)
    expect(source).toContain("document.querySelectorAll('a[href*=\"/pin/\"]')")
    expect(source).toContain("chrome.runtime.sendMessage")
    expect(source).toContain("chrome.tabs.sendMessage")
    expect(source).toContain("document.dispatchEvent")
    expect(source).toContain("dship:pinterest:load-more")
    expect(source).toContain("window.scrollBy")
    expect(source).toContain('if (timer !== undefined) return')
  })
})
