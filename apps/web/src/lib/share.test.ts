import { describe, expect, it, vi } from 'vitest'
import {
  buildAppUrl,
  buildRoomInviteUrl,
  forgetRoomPin,
  isValidRoomPin,
  parseJoinLink,
  readRoomPin,
  rememberRoomPin,
  shareLink,
} from './share.js'

describe('share links', () => {
  it('builds the app root from origin and base', () => {
    expect(buildAppUrl({ origin: 'https://example.com' }, '/football/')).toBe(
      'https://example.com/football/',
    )
    expect(buildAppUrl({ origin: 'https://example.com' }, 'football')).toBe(
      'https://example.com/football/',
    )
  })

  it('round-trips a room invite link', () => {
    const url = buildRoomInviteUrl('https://example.com/football/', 'Q4Pk6LJwTG', '0123')
    expect(url).toBe('https://example.com/football/#/join?room=Q4Pk6LJwTG&pin=0123')
    expect(parseJoinLink(new URL(url).hash)).toEqual({ roomId: 'Q4Pk6LJwTG', pin: '0123' })
  })

  it('omits the PIN for rooms without a PIN', () => {
    const url = buildRoomInviteUrl('https://example.com/football/', 'open-room', null)
    expect(url).toBe('https://example.com/football/#/join?room=open-room')
    expect(parseJoinLink(new URL(url).hash)).toEqual({ roomId: 'open-room', pin: null })
  })

  it('ignores hashes that are not join links', () => {
    expect(parseJoinLink('')).toBeNull()
    expect(parseJoinLink('#/wager')).toBeNull()
    expect(parseJoinLink('#/join')).toBeNull()
    expect(parseJoinLink('#/joined?room=x')).toBeNull()
  })
})

describe('remembered room PINs', () => {
  it('stores, reads and forgets a PIN per room', () => {
    rememberRoomPin('room-a', '1234')
    expect(readRoomPin('room-a')).toBe('1234')
    expect(readRoomPin('room-b')).toBeNull()
    forgetRoomPin('room-a')
    expect(readRoomPin('room-a')).toBeNull()
  })

  it('validates the four-digit format', () => {
    expect(isValidRoomPin('0123')).toBe(true)
    expect(isValidRoomPin('123')).toBe(false)
    expect(isValidRoomPin('12a4')).toBe(false)
  })
})

describe('shareLink', () => {
  const data = { title: 't', text: 'x', url: 'https://example.com/football/' }

  it('uses the native share sheet when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const nav = { share, clipboard: { writeText: vi.fn() } } as unknown as Navigator
    expect(await shareLink(data, nav)).toBe('shared')
    expect(share).toHaveBeenCalledWith(data)
  })

  it('treats a dismissed share sheet as cancelled', async () => {
    const writeText = vi.fn()
    const nav = {
      share: vi.fn().mockRejectedValue(new DOMException('closed', 'AbortError')),
      clipboard: { writeText },
    } as unknown as Navigator
    expect(await shareLink(data, nav)).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const nav = { clipboard: { writeText } } as unknown as Navigator
    expect(await shareLink(data, nav)).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(data.url)
  })

  it('reports failure when nothing works', async () => {
    const nav = {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    } as unknown as Navigator
    expect(await shareLink(data, nav)).toBe('failed')
  })
})
