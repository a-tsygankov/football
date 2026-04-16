import { RoomId, type RoomId as RoomIdType } from '@fc26/shared'

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const ROOM_SESSION_COOKIE = 'fc26_room_session'
export const ROOM_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface RoomSessionPayload {
  roomId: RoomIdType
  exp: number
}

export async function signRoomSession(
  payload: RoomSessionPayload,
  secret: string,
): Promise<string> {
  const payloadBase64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)))
  const signature = await sign(payloadBase64, secret)
  return `${payloadBase64}.${signature}`
}

export async function verifyRoomSession(
  token: string,
  secret: string,
): Promise<RoomSessionPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [payloadBase64, signature] = parts
  if (!payloadBase64 || !signature) return null

  const expected = await sign(payloadBase64, secret)
  if (signature !== expected) return null

  try {
    const payload = JSON.parse(
      decoder.decode(base64UrlDecode(payloadBase64)),
    ) as { roomId?: string; exp?: number }
    if (typeof payload.exp !== 'number' || typeof payload.roomId !== 'string') {
      return null
    }
    return {
      roomId: RoomId(payload.roomId),
      exp: payload.exp,
    }
  } catch {
    return null
  }
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return base64UrlEncode(new Uint8Array(signature))
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const remainder = padded.length % 4
  const full = remainder === 0 ? padded : `${padded}${'='.repeat(4 - remainder)}`
  return Uint8Array.from(atob(full), (char) => char.charCodeAt(0))
}
