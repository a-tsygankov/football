import { useId, useRef } from 'react'

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

  function updateFromClientX(clientX: number): void {
    const track = trackRef.current
    if (!track) return
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return
    const relativeX = Math.max(0, Math.min(rect.width, clientX - rect.left))
    const normalized = relativeX / rect.width
    const next = Math.max(0, Math.min(10, Math.round(normalized * 10)))
    onChange(next)
  }

  return (
    <label htmlFor={inputId} style={{ display: 'grid', gap: 8 }}>
      {label ? <span style={{ fontSize: 13, opacity: 0.76 }}>{label}</span> : null}
      <input
        id={inputId}
        type="range"
        min={0}
        max={10}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
        style={{ display: 'none' }}
      />
      <div
        ref={trackRef}
        role="slider"
        aria-label={label ?? 'Rating'}
        aria-valuemin={0}
        aria-valuemax={10}
        aria-valuenow={value}
        aria-valuetext={`${(value / 2).toFixed(1)} stars`}
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
        onClick={(event) => {
          if (disabled) return
          updateFromClientX(event.clientX)
        }}
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault()
            onChange(Math.max(0, value - 1))
          } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault()
            onChange(Math.min(10, value + 1))
          } else if (event.key === 'Home') {
            event.preventDefault()
            onChange(0)
          } else if (event.key === 'End') {
            event.preventDefault()
            onChange(10)
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
        <StarRow rating10={value} />
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {(value / 2).toFixed(1)} stars
        </span>
      </div>
    </label>
  )
}

export function StarRow({ rating10 }: { rating10: number }) {
  const fillWidth = Math.max(0, Math.min(100, (rating10 / 10) * 100))

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
