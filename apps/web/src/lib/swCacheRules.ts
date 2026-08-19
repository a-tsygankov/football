/**
 * URL patterns that decide what the service worker is allowed to cache.
 *
 * These live here, tested, rather than inline in `vite.config.ts`, because
 * getting one wrong is not a build failure — it is a gamer looking at a
 * scoreboard or a bet list that quietly disagrees with the room. The rules
 * are consumed by the `workbox.runtimeCaching` config and matched against
 * the full request URL, so they are deliberately unanchored.
 */

/**
 * Squad data addressed by an explicit version tag (`fc26-r12` and friends).
 * Immutable by construction: an ingest publishes a new tag rather than
 * rewriting an existing one, so a hit can be served from cache and revalidated
 * afterwards.
 *
 * `versions`, `latest` and `logos` are excluded on purpose — the first two are
 * mutable aliases that must reflect the newest ingest, and logos are assets on
 * a separate route with no version in the path.
 */
export const IMMUTABLE_SQUAD_PATTERN =
  /\/api\/squads\/(?!versions|latest|logos)[^/]+\/(clubs|leagues|players|diff)/

/**
 * Everything behind /api. Paired with a NetworkOnly handler registered after
 * the squad rule, so rooms, bets, the running game and the version floor are
 * never served from cache — not even as an offline fallback. Failing honestly
 * is the correct answer there.
 */
export const API_PATTERN = /\/api\//
