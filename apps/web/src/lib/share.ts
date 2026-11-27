/**
 * Share links: the app itself, and an invite into a specific room.
 *
 * Both are built from the app's root rather than `location.href`. Installed
 * as an app there is no address bar to copy from, and the current URL may be
 * carrying a tab route (`#/wager`) that means nothing to the recipient.
 */

export interface JoinLink {
  roomId: string
  /** The room PIN, so the recipient does not have to type it; null if none. */
  pin: string | null
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

interface LocationLike {
  origin: string
}

/** `https://host/football/` — the same URL the installed app opens at. */
export function buildAppUrl(
  location: LocationLike = window.location,
  base: string = import.meta.env.BASE_URL,
): string {
  const path = base.startsWith('/') ? base : `/${base}`
  return `${location.origin}${path.endsWith('/') ? path : `${path}/`}`
}

/**
 * `…/football/#/join?room=<id>&pin=<pin>`
 *
 * The PIN rides in the hash, not the query string, so it is never sent to a
 * server or written to an access log — it only lives in the link itself.
 */
export function buildRoomInviteUrl(appUrl: string, roomId: string, pin: string | null): string {
  const params = new URLSearchParams({ room: roomId })
  if (pin) params.set('pin', pin)
  return `${appUrl}#/join?${params.toString()}`
}

/** Reads a join link out of a location hash; null if this is not one. */
export function parseJoinLink(hash: string): JoinLink | null {
  const match = /^#\/?join(?:\?(.*))?$/.exec(hash)
  if (!match) return null
  const params = new URLSearchParams(match[1] ?? '')
  const roomId = params.get('room')?.trim()
  if (!roomId) return null
  return { roomId, pin: params.get('pin')?.trim() || null }
}

export function isValidRoomPin(pin: string): boolean {
  return /^\d{4}$/.test(pin)
}

/*
 * The client used to forget the room PIN the moment it had joined. To put it
 * in a share link, the device that joined (or created) the room keeps it.
 * A four-digit room PIN is a soft lock between friends, not a credential, and
 * it is already in every invite link this device sends.
 */
const ROOM_PIN_KEY_PREFIX = 'fc26:room-pin:'

export function rememberRoomPin(roomId: string, pin: string): void {
  try {
    localStorage.setItem(`${ROOM_PIN_KEY_PREFIX}${roomId}`, pin)
  } catch {
    // Private mode or storage disabled: the share sheet will just ask.
  }
}

export function readRoomPin(roomId: string): string | null {
  try {
    return localStorage.getItem(`${ROOM_PIN_KEY_PREFIX}${roomId}`)
  } catch {
    return null
  }
}

export function forgetRoomPin(roomId: string): void {
  try {
    localStorage.removeItem(`${ROOM_PIN_KEY_PREFIX}${roomId}`)
  } catch {
    // Nothing to clean up.
  }
}

/**
 * Native share sheet where there is one (phones, installed PWAs), otherwise
 * the clipboard. Must be called straight from a tap: Safari refuses
 * `navigator.share` once the user gesture has been spent on an `await`.
 */
export async function shareLink(
  data: { title: string; text: string; url: string },
  nav: Navigator = navigator,
): Promise<ShareOutcome> {
  if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare(data))) {
    try {
      await nav.share(data)
      return 'shared'
    } catch (err) {
      // Closing the share sheet is not an error worth reporting.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      // Anything else (NotAllowedError on a lost gesture, say): try copying.
    }
  }
  try {
    await nav.clipboard.writeText(data.url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
