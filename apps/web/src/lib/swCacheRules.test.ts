import { describe, expect, it } from 'vitest'
import { API_PATTERN, IMMUTABLE_SQUAD_PATTERN } from './swCacheRules.js'

describe('IMMUTABLE_SQUAD_PATTERN', () => {
  it.each([
    '/api/squads/fc26-r12/clubs',
    '/api/squads/fc26-r12/leagues',
    '/api/squads/fc26-r12/players/1234',
    '/api/squads/fc26-r12/diff?from=fc26-r11',
  ])('caches %s, which is immutable for the life of that version tag', (path) => {
    expect(IMMUTABLE_SQUAD_PATTERN.test(`https://fc26.example${path}`)).toBe(true)
  })

  it.each([
    // Mutable aliases: `latest` moves to a new tag on every ingest, and the
    // registry grows. Serving either from cache would pin the browser to a
    // squad release that has since been superseded.
    '/api/squads/versions',
    '/api/squads/latest',
    '/api/squads/latest/leagues',
    // Logos are assets behind their own route, not version-scoped data.
    '/api/squads/logos/1234',
  ])('leaves %s to the network', (path) => {
    expect(IMMUTABLE_SQUAD_PATTERN.test(`https://fc26.example${path}`)).toBe(false)
  })

  it.each([
    // Live state. A stale scoreboard or bet list is a wrong answer, not an
    // old one — this is the failure the runtime caching must never cause.
    '/api/rooms/abc123/scoreboard',
    '/api/rooms/abc123/bets',
    '/api/rooms/abc123/current-game',
    '/api/rooms/abc123/settings/squads/retrieve',
    '/api/version',
  ])('never matches live room route %s', (path) => {
    expect(IMMUTABLE_SQUAD_PATTERN.test(`https://fc26.example${path}`)).toBe(false)
  })
})

describe('API_PATTERN', () => {
  it.each(['/api/version', '/api/rooms/abc123/bets', '/api/squads/versions'])(
    'covers %s so it is handled NetworkOnly',
    (path) => {
      expect(API_PATTERN.test(`https://fc26.example${path}`)).toBe(true)
    },
  )

  it.each(['/football/index.html', '/football/assets/index-abc.js', '/football/manifest.json'])(
    'leaves app shell asset %s to the precache',
    (path) => {
      expect(API_PATTERN.test(`https://fc26.example${path}`)).toBe(false)
    },
  )
})
