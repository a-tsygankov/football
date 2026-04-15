import { useId, useRef } from 'react'

const MAX_HALF_STARS = 10
const STAR_COUNT = MAX_HALF_STARS / 2

/**
 * Half-star rating selector.
 *
 * - `value` is the number of half-stars (0..10): 0★ → 0, 1★ → 2, 3.5★ → 7, 5★ → 10.
 * - The slider is rendered as five star icons; the user can click the LEFT half
 *   of any star for a half value or the RIGHT half for the full value, so every
 *   half-step (0, 0.5, 1, 1.5, ..., 5) is reachable in a single click.
 * - Pointer drag and keyboard navigation step by half-stars (1 unit) and pin
 *   to the nearest legal value. Shift+arrow steps by a full star.
 */
export function RatingSelector({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label?: string
  value: number
  onChange: (value: number) => void
  disabled?: boolean
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const inputId = useId()

  const safeValue = clampHalfStars(value)

  function commit(next: number): void {
    const clamped = clampHalfStars(next)
    if (clamped === safeValue) return
    onChange(clamped)
  }

  function updateFromClientX(clientX: number): void {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return
    const relativeX = Math.max(0, Math.min(rect.width, clientX - rect.left))
    const ratio = relativeX / rect.width
    // Map [0..1] → [0..MAX_HALF_STARS] with quarter-snap so the boundary
    // between left/right halves of a star feels precise.
    const next = Math.round(ratio * MAX_HALF_STARS)
    commit(next)
  }

  return (
    <label htmlFor={inputId} style={{ display: 'grid', gap: 8 }}>
      {label ? <span style={{ fontSize: 13, opacity: 0.76 }}>{label}</span> : null}
      <input
        id={inputId}
        type="range"
        min={0}
        max={MAX_HALF_STARS}
        step={1}
        value={safeValue}
        disabled={disabled}
        onChange={(event) => commit(Number.parseInt(event.target.value, 10))}
        style={{ display: 'none' }}
      />
      <div
        ref={trackRef}
        role="slider"
        aria-label={label ?? 'Rating'}
        aria-valuemin={0}
        aria-valuemax={MAX_HALF_STARS}
        aria-valuenow={safeValue}
        aria-valuetext={formatStars(safeValue)}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={(event) => {
          if (disabled) return
          pointerIdRef.current = event.pointerId
          event.currentTarget.setPointerCapture(event.pointerId)
          updateFromClientX(event.clientX)
        }}
        onPointerMove={(event) => {
          if (disabled) return
          if (pointerIdRef.current !== event.pointerId) return
          updateFromClientX(event.clientX)
        }}
        onPointerUp={(event) => {
          if (pointerIdRef.current === event.pointerId) {
            pointerIdRef.current = null
          }
        }}
        onPointerCancel={() => {
          pointerIdRef.current = null
        }}
        onKeyDown={(event) => {
          if (disabled) return
          const stepSize = event.shiftKey ? 2 : 1
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault()
            commit(safeValue - stepSize)
          } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault()
            commit(safeValue + stepSize)
          } else if (event.key === 'Home') {
            event.preventDefault()
            commit(0)
          } else if (event.key === 'End') {
            event.preventDefault()
            commit(MAX_HALF_STARS)
          }
        }}
        style={{
          display: 'grid',
          gap: 6,
          cursor: disabled ? 'not-allowed' : 'pointer',
          userSelect: 'none',
          touchAction: 'none',
          outline: 'none',
        }}
      >
        <InteractiveStarRow value={safeValue} disabled={disabled} onSelect={commit} />
        <span style={{ fontSize: 12, opacity: 0.7 }}>{formatStars(safeValue)}</span>
      </div>
    </label>
  )
}

function InteractiveStarRow({
  value,
  disabled,
  onSelect,
}: {
  value: number
  disabled: boolean
  onSelect: (next: number) => void
}) {
  return (
    <div
      style={{
        display: 'inline-flex',
        gap: 2,
        fontSize: 22,
        lineHeight: 1,
      }}
    >
      {Array.from({ length: STAR_COUNT }, (_, index) => {
        const fullValue = (index + 1) * 2
        const halfValue = fullValue - 1
        const filledHalves = Math.max(0, Math.min(2, value - index * 2))
        return (
          <span
            key={index}
            style={{
              position: 'relative',
              display: 'inline-block',
              width: '1em',
              height: '1em',
            }}
          >
            <span style={{ color: '#94a3b8' }}>★</span>
            <span
              style={{
                position: 'absolute',
                inset: 0,
                width: `${(filledHalves / 2) * 100}%`,
                overflow: 'hidden',
                color: '#facc15',
                whiteSpace: 'nowrap',
              }}
            >
              ★
            </span>
            {/* Click overlays — left half = 0.5 increment, right half = whole star. */}
            <button
              type="button"
              aria-label={`${(halfValue / 2).toFixed(1)} stars`}
              disabled={disabled}
              onPointerDown={(event) => {
                // Stop the parent slider from re-mapping this click via pointer math.
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                if (disabled) return
                onSelect(halfValue)
              }}
              style={overlayStyle('left')}
              tabIndex={-1}
            />
            <button
              type="button"
              aria-label={`${(fullValue / 2).toFixed(1)} stars`}
              disabled={disabled}
              onPointerDown={(event) => {
                event.stopPropagation()
              }}
              onClick={(event) => {
                event.stopPropagation()
                if (disabled) return
                onSelect(fullValue)
              }}
              style={overlayStyle('right')}
              tabIndex={-1}
            />
          </span>
        )
      })}
    </div>
  )
}

function overlayStyle(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'absolute',
    top: 0,
    bottom: 0,
    [side]: 0,
    width: '50%',
    padding: 0,
    margin: 0,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
  }
}

/**
 * Render-only star row used by other surfaces (preview cards, club summaries).
 * Accepts the same half-star integer (0..10) as RatingSelector's value.
 */
export function StarRow({ rating10 }: { rating10: number }) {
  const safe = clampHalfStars(rating10)
  const fillWidth = (safe / MAX_HALF_STARS) * 100

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-block',
        fontSize: 16,
        letterSpacing: 1.5,
        lineHeight: 1,
      }}
    >
      <span style={{ color: '#94a3b8' }}>★★★★★</span>
      <span
        style={{
          position: 'absolute',
          inset: 0,
          width: `${fillWidth}%`,
          overflow: 'hidden',
          color: '#facc15',
          whiteSpace: 'nowrap',
        }}
      >
        ★★★★★
      </span>
    </div>
  )
}

function clampHalfStars(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(MAX_HALF_STARS, Math.round(value)))
}

function formatStars(halfStars: number): string {
  return `${(halfStars / 2).toFixed(1)} stars`
}
