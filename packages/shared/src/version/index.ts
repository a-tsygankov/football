/**
 * Semver comparison for the three-axis version check.
 *
 * The worker publishes `minClientVersion` from `/api/version`; the client
 * compares its own build against it and warns when it has fallen behind.
 * See `UpdateBanner` and its wiring in `apps/web/src/App.tsx`.
 */

/** Parsed `major.minor.patch`. Extra segments and pre-release tags are ignored. */
interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

function parseVersion(value: string): ParsedVersion | null {
  // Tolerate a leading `v` and a pre-release/build suffix ("1.2.3-rc.1"),
  // since those are legal semver and would otherwise fail to parse.
  const core = value.trim().replace(/^v/i, '').split(/[-+]/)[0] ?? ''
  const parts = core.split('.')
  if (parts.length !== 3) return null
  const [major, minor, patch] = parts.map((part) =>
    /^\d+$/.test(part) ? Number.parseInt(part, 10) : Number.NaN,
  )
  if (
    major === undefined ||
    minor === undefined ||
    patch === undefined ||
    !Number.isFinite(major) ||
    !Number.isFinite(minor) ||
    !Number.isFinite(patch)
  ) {
    return null
  }
  return { major, minor, patch }
}

/**
 * Compare two semver strings numerically.
 *
 * Returns a negative number when `a < b`, zero when equal, positive when
 * `a > b`. Returns `null` when either side can't be parsed, so callers can
 * distinguish "older" from "unknown" rather than treating a malformed
 * version as out of date.
 *
 * Numeric per segment, deliberately — a string compare would rank
 * "0.1.10" below "0.1.3", which is the classic way this check goes wrong
 * exactly when a project has shipped enough patches to need it.
 */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return null
  if (left.major !== right.major) return left.major - right.major
  if (left.minor !== right.minor) return left.minor - right.minor
  return left.patch - right.patch
}

/**
 * True when `clientVersion` is strictly older than `minClientVersion`.
 *
 * Unparsable input yields `false`: an unknown version is not evidence of
 * staleness, and nagging someone to reload over a version string we failed
 * to read would be worse than staying quiet.
 */
export function isClientOutdated(
  clientVersion: string,
  minClientVersion: string,
): boolean {
  const result = compareVersions(clientVersion, minClientVersion)
  return result !== null && result < 0
}
