import type { CSSProperties } from 'react'

const containerStyle = {
  padding: 14,
  borderRadius: 18,
  background: 'rgba(236,253,245,0.08)',
  border: '1px solid rgba(236,253,245,0.12)',
} satisfies CSSProperties

export function MiniStat({
  label,
  value,
  onClick,
}: {
  label: string
  value: string
  onClick?: (() => void) | undefined
}) {
  const content = (
    <>
      <p style={{ margin: 0, fontSize: 12, opacity: 0.72, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
        {label}
      </p>
      <p style={{ margin: '8px 0 0', fontSize: 18 }}>{value}</p>
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          ...containerStyle,
          textAlign: 'left',
          color: 'inherit',
          cursor: 'pointer',
        }}
      >
        {content}
      </button>
    )
  }

  return <div style={containerStyle}>{content}</div>
}
