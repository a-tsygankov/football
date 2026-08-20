import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The document head and manifest, checked as text.
 *
 * Nothing else can catch these. A missing standalone tag is invisible in every
 * browser and in every test that renders a component — it only shows up when
 * somebody adds the app to their Home Screen and gets Safari's URL bar and
 * toolbar wrapped around it. So the file is read and asserted on directly.
 */
const here = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(resolve(here, '../index.html'), 'utf-8')
const manifest = JSON.parse(
  readFileSync(resolve(here, '../public/manifest.json'), 'utf-8'),
) as Record<string, unknown>

describe('installed-app metadata', () => {
  it('declares standalone display in the manifest', () => {
    expect(manifest.display).toBe('standalone')
  })

  it('scopes the app to where the worker actually serves it', () => {
    // `workers/football-app` stages the client under /football/ so shortcuts
    // from the old GitHub Pages URL still resolve. A scope that disagrees
    // means the service worker never controls the page it was installed from.
    expect(manifest.start_url).toBe('/football/')
    expect(manifest.scope).toBe('/football/')
  })

  it('carries the tags iOS keys standalone launch on', () => {
    // Safari honours the manifest from 16.4; everything before it needs these,
    // and Apple still documents them. Without them a Home Screen launch opens
    // in the browser with its chrome showing.
    expect(html).toMatch(/<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"/)
    expect(html).toMatch(/<meta\s+name="mobile-web-app-capable"\s+content="yes"/)
  })

  it('links the manifest and an apple-touch-icon from the served path', () => {
    expect(html).toMatch(/<link\s+rel="manifest"\s+href="\/football\/manifest\.json"/)
    expect(html).toMatch(/<link\s+rel="apple-touch-icon"\s+href="\/football\//)
  })

  it('draws under the notch, which the safe-area padding then pays back', () => {
    // `viewport-fit=cover` without safe-area insets would put the bottom nav
    // under the home indicator; BottomNav and App pad for it.
    expect(html).toMatch(/viewport-fit=cover/)
  })
})
