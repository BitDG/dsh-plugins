chrome.runtime.onMessage.addListener((message) => {
  if (message?.kind !== 'dship:pinterest:updated') return false
  document.dispatchEvent(new Event('dship:pinterest:updated'))
  return false
})

document.addEventListener('dship:pinterest:load-more', () => {
  void chrome.runtime.sendMessage({ kind: 'dship:pinterest:load-more' })
})
