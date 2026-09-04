(() => {
  const params = new URLSearchParams(location.hash.slice(1))
  const token = params.get('dship_ref_token') || ''
  const origin = params.get('dship_ref_origin') || ''
  const initialLimit = Math.max(1, Math.min(50, Number(params.get('dship_ref_limit')) || 30))
  const maxResults = 1000
  if (!token || !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return

  const endpoint = `${origin}/api/dship/reference-library/online/pinterest-bridge/ingest`
  const clean = new URL(location.href)
  clean.hash = ''
  history.replaceState(history.state, '', clean.href)

  function imageUrl(image) {
    if (!(image instanceof HTMLImageElement)) return undefined
    const candidates = (image.srcset || '').split(',').map(part => part.trim().split(/\s+/)[0]).filter(Boolean)
    const value = candidates.at(-1) || image.currentSrc || image.src
    try {
      const url = new URL(value)
      return url.protocol === 'https:' && (url.hostname === 'pinimg.com' || url.hostname.endsWith('.pinimg.com')) ? url.href : undefined
    } catch { return undefined }
  }

  function compact(value, max = 240) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max) }

  function card(anchor) {
    const url = new URL(anchor.href, location.href)
    const match = /^\/pin\/([^/?#]+)\/?$/i.exec(url.pathname)
    if (!match) return undefined
    const scope = anchor.closest('[data-grid-item]') || anchor.closest('[role="listitem"]') || anchor.parentElement?.parentElement || anchor
    const image = scope.querySelector?.('img[src*="pinimg.com"], img[srcset*="pinimg.com"]')
    const src = imageUrl(image)
    if (!src) return undefined
    const heading = compact(scope.querySelector?.('h2')?.textContent, 240).replace(/\s*Pin 图页面$/u, '')
    const alt = compact(image?.alt, 240).replace(/^(其中包括图片：|其中包括：|Image may contain:|Pin includes:)\s*/iu, '')
    const title = heading || alt || compact(anchor.getAttribute('aria-label') || scope.textContent, 240) || `Pinterest Pin ${match[1]}`
    const description = compact(scope.textContent, 480)
    return {
      url: `https://www.pinterest.com/pin/${encodeURIComponent(decodeURIComponent(match[1]))}/`,
      title,
      imageUrl: src,
      ...(description && description !== title ? { description } : {}),
    }
  }

  function signedOut() {
    return /\/login\/?$/i.test(location.pathname)
      || Boolean(document.querySelector('input[name="id"], input[name="password"], [data-test-id="simple-login-button"]'))
  }

  const collected = new Map()
  const sent = new Set()
  const pending = new Set()
  let initialScrolls = 0
  let timer
  function capture() {
    // Pinterest mutates its virtualized grid continuously. A trailing debounce
    // can therefore be postponed forever; keep the first scheduled pass instead.
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      if (signedOut()) {
        void chrome.runtime.sendMessage({ kind: 'dship:pinterest:capture', endpoint, token, status: 'login-required', results: [] })
        return
      }
      for (const anchor of document.querySelectorAll('a[href*="/pin/"]')) {
        const value = card(anchor)
        if (value) collected.set(value.url, value)
        if (collected.size >= maxResults) break
      }
      const results = [...collected.values()].filter(item => !sent.has(item.url) && !pending.has(item.url)).slice(0, 60)
      if (results.length > 0) {
        for (const result of results) pending.add(result.url)
        void chrome.runtime.sendMessage({ kind: 'dship:pinterest:capture', endpoint, token, status: 'ok', results }).then(response => {
          for (const result of results) {
            pending.delete(result.url)
            if (response?.ok) sent.add(result.url)
          }
        }, () => {
          for (const result of results) pending.delete(result.url)
        })
      }
      if (collected.size < initialLimit && initialScrolls < 16) {
        initialScrolls += 1
        window.scrollBy({ top: Math.max(480, window.innerHeight * 0.9), behavior: 'smooth' })
        setTimeout(capture, 850)
      }
    }, 450)
  }

  function start() {
    const observer = new MutationObserver(capture)
    observer.observe(document.documentElement, { childList: true, subtree: true })
    capture()
    setTimeout(capture, 1500)
    setTimeout(capture, 4000)
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.kind !== 'dship:pinterest:load-more') return false
      window.scrollBy({ top: Math.max(640, window.innerHeight * 1.8), behavior: 'smooth' })
      setTimeout(capture, 300)
      setTimeout(capture, 900)
      setTimeout(capture, 1600)
      return false
    })
  }

  if (document.documentElement) start()
  else document.addEventListener('readystatechange', start, { once: true })
})()
