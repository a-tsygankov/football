/**
 * Downscale an image file for Gemini analysis.
 *
 * Returns a base64-encoded JPEG string (no data-URL prefix) sized to fit
 * within MAX_DIMENSION on its longest side. This keeps the payload small
 * enough for a vision model without losing the information visible on a TV
 * stats screen.
 */

const MAX_DIMENSION = 800
const JPEG_QUALITY = 0.7

export async function scaleImageForAnalysis(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')

    ctx.drawImage(bitmap, 0, 0, width, height)
    const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
    // Strip the "data:image/jpeg;base64," prefix — the worker sends raw base64.
    return dataUrl.split(',')[1]
  } finally {
    bitmap.close()
  }
}
