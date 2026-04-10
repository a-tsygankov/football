/**
 * Time conventions for the project:
 *  - All timestamps stored in D1 are UTC milliseconds since epoch (`number`).
 *  - The Worker NEVER formats dates — it always returns raw millis.
 *  - The client renders timestamps via `Intl.DateTimeFormat` in the user's
 *    resolved time zone.
 *
 * Keep these helpers free of any external date library.
 */

/** UTC millis for "right now". Inject this in tests via a Clock interface. */
export function nowUtcMillis(): number {
  return Date.now()
}

export function toUtcMillis(date: Date): number {
  return date.getTime()
}

export function fromUtcMillis(millis: number): Date {
  return new Date(millis)
}

export function userTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

export function formatLocal(
  millis: number,
  opts: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' },
): string {
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(millis))
}

const RELATIVE_THRESHOLDS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 1000],
  ['minute', 60_000],
  ['hour', 3_600_000],
  ['day', 86_400_000],
  ['week', 604_800_000],
  ['month', 2_592_000_000],
  ['year', 31_536_000_000],
]

/** "3 minutes ago", "in 2 days", etc. Pure — pass `now` for deterministic tests. */
export function formatRelative(millis: number, now: number = Date.now()): string {
  const diff = millis - now
  const absDiff = Math.abs(diff)

  let unit: Intl.RelativeTimeFormatUnit = 'second'
  let divisor = 1000

  for (let i = RELATIVE_THRESHOLDS.length - 1; i >= 0; i--) {
    const [u, d] = RELATIVE_THRESHOLDS[i]!
    if (absDiff >= d) {
      unit = u
      divisor = d
      break
    }
  }

  const value = Math.round(diff / divisor)
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(value, unit)
}

/**
 * Clock interface — inject this everywhere instead of calling `Date.now()`
 * directly inside business logic. Composition roots build a real clock; tests
 * build a fake one that returns fixed values.
 */
export interface Clock {
  now(): number
}

export const SystemClock: Clock = {
  now: () => Date.now(),
}

export function fixedClock(millis: number): Clock {
  return { now: () => millis }
}
