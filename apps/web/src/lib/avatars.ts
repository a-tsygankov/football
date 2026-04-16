/**
 * Avatar helpers.
 *
 * Phase 2 avatar UX (per design doc): any gamer/room/club/fc_player can carry
 * an avatar. Until we ship the full upload-to-R2 pipeline we keep things
 * dependency-free: read the picked image, downscale it to a square on a
 * canvas, and store the result as a `data:` URL. The Worker accepts any
 * `URL`-parseable string, and `data:` URLs parse fine, so this round-trips
 * through the existing `/api/rooms/:id/gamers` schema without backend changes.
 */

export const AVATAR_MAX_DIMENSION = 256
export const AVATAR_OUTPUT_MIME = 'image/webp'
export const AVATAR_OUTPUT_QUALITY = 0.82

export type AvatarKind = 'gamer' | 'room' | 'club' | 'fc_player'

/**
 * Inline SVG silhouettes, one per entity kind, returned as data URLs so they
 * drop straight into `<img src>` without any asset pipeline work. Kept tiny
 * on purpose — these are visual placeholders, not branding.
 */
export const DEFAULT_AVATARS: Readonly<Record<AvatarKind, string>> = {
  gamer: svgDataUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
       <rect width='64' height='64' rx='32' fill='#dcfce7'/>
       <circle cx='32' cy='24' r='12' fill='#166534'/>
       <path d='M10 56c4-12 14-18 22-18s18 6 22 18' fill='#166534'/>
     </svg>`,
  ),
  room: svgDataUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
       <rect width='64' height='64' rx='12' fill='#ecfdf5'/>
       <path d='M10 30 L32 12 L54 30 V52 H10 Z' fill='#166534'/>
       <rect x='26' y='34' width='12' height='18' fill='#ecfdf5'/>
     </svg>`,
  ),
  club: svgDataUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
       <rect width='64' height='64' rx='32' fill='#fef3c7'/>
       <path d='M12 16 L52 16 L48 48 L32 56 L16 48 Z' fill='#92400e'/>
     </svg>`,
  ),
  fc_player: svgDataUrl(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>
       <rect width='64' height='64' rx='32' fill='#dbeafe'/>
       <circle cx='32' cy='22' r='10' fill='#1e3a8a'/>
       <path d='M14 54c3-12 12-16 18-16s15 4 18 16' fill='#1e3a8a'/>
     </svg>`,
  ),
} as const

function svgDataUrl(svg: string): string {
  // encodeURIComponent keeps us safe for the `#` characters in hex colors.
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.trim())}`
}

export function defaultAvatar(kind: AvatarKind): string {
  return DEFAULT_AVATARS[kind]
}

/**
 * Reads a picked image file, square-crops it, downscales to AVATAR_MAX_DIMENSION,
 * and returns a `data:` URL. Throws on unreadable files so the caller can show
 * a friendly error.
 */
export async function imageFileToAvatarDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Not an image file')
  }

  const bitmap = await loadBitmap(file)
  try {
    const size = Math.min(bitmap.width, bitmap.height)
    const sx = Math.floor((bitmap.width - size) / 2)
    const sy = Math.floor((bitmap.height - size) / 2)
    const target = Math.min(AVATAR_MAX_DIMENSION, size)

    const canvas = document.createElement('canvas')
    canvas.width = target
    canvas.height = target
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')

    ctx.drawImage(bitmap, sx, sy, size, size, 0, 0, target, target)
    return canvas.toDataURL(AVATAR_OUTPUT_MIME, AVATAR_OUTPUT_QUALITY)
  } finally {
    if ('close' in bitmap && typeof bitmap.close === 'function') {
      ;(bitmap as ImageBitmap).close()
    }
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file)
  }
  // Fallback for browsers / jsdom without createImageBitmap.
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    await new Promise<void>((resolveImg, rejectImg) => {
      img.onload = () => resolveImg()
      img.onerror = () => rejectImg(new Error('Failed to decode image'))
      img.src = url
    })
    return img
  } finally {
    URL.revokeObjectURL(url)
  }
}
