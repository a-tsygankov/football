export interface RosterUpdatePlatformMetadata {
  readonly platform: string
  readonly squadVersion: string
  readonly squadLocation: string | null
  readonly futVersion: string | null
  readonly futLocation: string | null
}

const T3DB_HEADER = Uint8Array.from([0x44, 0x42, 0x00, 0x08])
const SHORT_COPY = 0x80
const MEDIUM_COPY = 0x40
const LONG_COPY = 0x20

export function extractRosterUpdatePlatformMetadata(
  xml: string,
  platform: string,
): RosterUpdatePlatformMetadata {
  const escapedPlatform = escapeRegExp(platform)
  const blockPattern = new RegExp(
    `<([A-Za-z0-9:_-]+)[^>]*platform=["']${escapedPlatform}["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    'i',
  )
  const block = blockPattern.exec(xml)?.[2]
  if (!block) {
    throw new Error(`platform ${platform} not found in rosterupdate.xml`)
  }
  const squadVersion = readXmlTag(block, 'dbMajor')
  if (!squadVersion) {
    throw new Error(`platform ${platform} does not expose dbMajor in rosterupdate.xml`)
  }
  return {
    platform,
    squadVersion,
    squadLocation: readXmlTag(block, 'dbMajorLoc'),
    futVersion: readXmlTag(block, 'dbFUTVer'),
    futLocation: readXmlTag(block, 'dbFUTLoc'),
  }
}

export function buildEaContentUrl(discoveryUrl: string, assetPath: string): string {
  const trimmedAssetPath = assetPath.trim().replace(/^\/+/, '')
  if (!trimmedAssetPath) {
    throw new Error('EA asset path must not be empty')
  }
  const discovery = new URL(discoveryUrl)
  const pivot = discovery.pathname.indexOf('/fc/fclive/')
  if (pivot < 0) {
    throw new Error(`unable to derive EA asset root from discovery URL: ${discoveryUrl}`)
  }
  const rootPath = discovery.pathname.slice(0, pivot + 1)
  return new URL(`${rootPath}${trimmedAssetPath}`, discovery).toString()
}

export function unpackEaRosterBinary(
  input: ArrayBuffer | Uint8Array,
): Uint8Array {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (data.length < 10) {
    throw new Error('EA roster payload is too small to unpack')
  }
  const expectedSize = ((data[2] ?? 0) << 16) | ((data[3] ?? 0) << 8) | (data[4] ?? 0)
  if (expectedSize <= T3DB_HEADER.length) {
    throw new Error('EA roster payload declares an invalid unpacked size')
  }

  const out = new Uint8Array(expectedSize)
  out.set(T3DB_HEADER, 0)

  let inputOffset = 10
  let outputOffset = T3DB_HEADER.length
  let lastControl = 0

  while (inputOffset < data.length && outputOffset < out.length) {
    const control = data[inputOffset]!
    lastControl = control
    inputOffset += 1

    if ((control & SHORT_COPY) === 0) {
      const offsetByte = data[inputOffset]!
      inputOffset += 1
      const literalCount = control & 0x03
      if (literalCount > 0) {
        copyLiteralBytes(data, out, inputOffset, outputOffset, literalCount)
        inputOffset += literalCount
        outputOffset += literalCount
      }
      const length = ((control >> 2) & 0x07) + 3
      const copyOffset = offsetByte + ((control & 0x60) << 3) + 1
      copyFromOutput(out, outputOffset, copyOffset, length)
      outputOffset += length
      continue
    }

    if ((control & MEDIUM_COPY) === 0) {
      const byte2 = data[inputOffset]!
      const byte3 = data[inputOffset + 1]!
      inputOffset += 2
      const literalCount = byte2 >> 6
      if (literalCount > 0) {
        copyLiteralBytes(data, out, inputOffset, outputOffset, literalCount)
        inputOffset += literalCount
        outputOffset += literalCount
      }
      const length = (control & 0x3f) + 4
      const copyOffset = (((byte2 & 0x3f) << 8) | byte3) + 1
      copyFromOutput(out, outputOffset, copyOffset, length)
      outputOffset += length
      continue
    }

    if ((control & LONG_COPY) === 0) {
      const byte2 = data[inputOffset]!
      const byte3 = data[inputOffset + 1]!
      const byte4 = data[inputOffset + 2]!
      inputOffset += 3
      const literalCount = control & 0x03
      if (literalCount > 0) {
        copyLiteralBytes(data, out, inputOffset, outputOffset, literalCount)
        inputOffset += literalCount
        outputOffset += literalCount
      }
      const length = byte4 + ((control & 0x0c) << 6) + 5
      const copyOffset = (((control & 0x10) << 12) | (byte2 << 8) | byte3) + 1
      copyFromOutput(out, outputOffset, copyOffset, length)
      outputOffset += length
      continue
    }

    const literalCount = (control & 0x1f) * 4 + 4
    if (literalCount > 0x70) {
      break
    }
    copyLiteralBytes(data, out, inputOffset, outputOffset, literalCount)
    inputOffset += literalCount
    outputOffset += literalCount
  }

  const trailingLiteralCount = lastControl & 0x03
  if (trailingLiteralCount > 0 && outputOffset < out.length) {
    const safeTrailingCount = Math.min(trailingLiteralCount, out.length - outputOffset)
    copyLiteralBytes(data, out, inputOffset, outputOffset, safeTrailingCount)
  }

  return out
}

export function decodeEaRosterText(
  input: ArrayBuffer | Uint8Array,
): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  return new TextDecoder('latin1').decode(bytes)
}

function copyLiteralBytes(
  input: Uint8Array,
  output: Uint8Array,
  inputOffset: number,
  outputOffset: number,
  count: number,
): void {
  output.set(input.subarray(inputOffset, inputOffset + count), outputOffset)
}

function copyFromOutput(
  output: Uint8Array,
  outputOffset: number,
  copyOffset: number,
  count: number,
): void {
  let sourceOffset = outputOffset - copyOffset
  if (sourceOffset < 0) {
    throw new Error('EA roster back-reference underflow while unpacking')
  }
  for (let index = 0; index < count; index += 1) {
    output[outputOffset + index] = output[sourceOffset]!
    sourceOffset += 1
  }
}

function readXmlTag(xmlBlock: string, tagName: string): string | null {
  const match = new RegExp(`<${tagName}>([^<]+)<\\/${tagName}>`, 'i').exec(xmlBlock)
  return match?.[1]?.trim() ?? null
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
