const encoder = new TextEncoder()
const PIN_HASH_ITERATIONS = 100_000
const PIN_REGEX = /^\d{4}$/

export interface PinHash {
  hash: string
  salt: string
}

export function isValidPin(pin: string): boolean {
  return PIN_REGEX.test(pin)
}

export async function hashPin(pin: string): Promise<PinHash> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derivePinHash(pin, salt)
  return {
    hash: bytesToHex(hash),
    salt: bytesToHex(salt),
  }
}

export async function verifyPin(
  pin: string,
  saltHex: string,
  expectedHashHex: string,
): Promise<boolean> {
  const hash = await derivePinHash(pin, hexToBytes(saltHex))
  return bytesToHex(hash) === expectedHashHex
}

async function derivePinHash(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: toArrayBuffer(salt),
      iterations: PIN_HASH_ITERATIONS,
    },
    keyMaterial,
    256,
  )
  return new Uint8Array(bits)
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('invalid hex')
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
}
