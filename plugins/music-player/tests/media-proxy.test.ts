import { describe, expect, it } from 'vitest'
import { isPrivateNetworkAddress, mediaHostnameAllowed } from '../src/media-proxy.ts'

describe('trusted media proxy policy', () => {
  it.each(['127.0.0.1', '10.2.3.4', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fd00::1', '::ffff:127.0.0.1'])('rejects private address %s', address => {
    expect(isPrivateNetworkAddress(address)).toBe(true)
  })

  it('matches only exact hosts or real wildcard subdomains', () => {
    expect(mediaHostnameAllowed('cdn.googlevideo.com', ['*.googlevideo.com'])).toBe(true)
    expect(mediaHostnameAllowed('googlevideo.com', ['*.googlevideo.com'])).toBe(false)
    expect(mediaHostnameAllowed('evilgooglevideo.com', ['*.googlevideo.com'])).toBe(false)
    expect(mediaHostnameAllowed('ice5.somafm.com', ['*.somafm.com'])).toBe(true)
  })
})
