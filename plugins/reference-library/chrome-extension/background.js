const INGEST_PATH = '/api/dship/reference-library/online/pinterest-bridge/ingest'

async function notifyDshTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://127.0.0.1/*', 'http://localhost/*'] })
  await Promise.allSettled(tabs.map(tab => tab.id === undefined
    ? Promise.resolve()
    : chrome.tabs.sendMessage(tab.id, { kind: 'dship:pinterest:updated' })))
}

function safeEndpoint(value, token) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' || (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost')) return undefined
    if (url.pathname !== INGEST_PATH || url.username !== '' || url.password !== '') return undefined
    url.search = new URLSearchParams({ token }).toString()
    url.hash = ''
    return url.href
  } catch { return undefined }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.kind === 'dship:pinterest:load-more') {
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(sender.url || '')) return false
    void chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs.map(tab => tab.id === undefined
      ? Promise.resolve()
      : chrome.tabs.sendMessage(tab.id, { kind: 'dship:pinterest:load-more' })))).then(() => {
      sendResponse({ forwarded: true })
    }).catch(() => {
      sendResponse({ forwarded: false })
    })
    return true
  }
  if (message?.kind !== 'dship:pinterest:capture') return false
  const endpoint = safeEndpoint(message.endpoint, message.token)
  if (endpoint === undefined) { sendResponse({ ok: false, error: 'invalid-endpoint' }); return false }
  void fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: message.status, results: message.results }),
  }).then(async response => {
    const body = await response.json().catch(() => undefined)
    if (response.ok) await notifyDshTabs()
    sendResponse({ ok: response.ok, status: response.status, body })
  }, error => {
    sendResponse({ ok: false, error: String(error) })
  })
  return true
})
