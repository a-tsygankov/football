import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

export function IdentityLayout({
  avatar,
  title,
  subtitle,
  trailing,
  nameStyle,
}: {
  avatar: ReactNode
  title: string
  subtitle?: string
  trailing?: ReactNode
  nameStyle?: CSSProperties
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
        {avatar}
        <div style={{ minWidth: 0 }}>
          <strong
            style={{
              display: 'block',
              fontSize: 16,
              lineHeight: 1.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              ...nameStyle,
            }}
          >
            {title}
          </strong>
          {subtitle ? (
            <span
              style={{
                display: 'block',
                marginTop: 2,
                fontSize: 13,
                opacity: 0.72,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {subtitle}
            </span>
          ) : null}
        </div>
      </div>
      {trailing ? <div style={{ flexShrink: 0 }}>{trailing}</div> : null}
    </div>
  )
}

export function AvatarImage({
  src,
  fallbackSrc,
  alt,
  size,
  shape,
}: {
  src: string | null | undefined
  fallbackSrc: string
  alt: string
  size: number
  shape: 'circle' | 'rounded'
}) {
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    setBroken(false)
  }, [src])

  const resolvedSrc = !broken && src ? src : fallbackSrc

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      width={size}
      height={size}
      onError={() => setBroken(true)}
      style={{
        width: size,
        height: size,
        objectFit: 'cover',
        flexShrink: 0,
        borderRadius: shape === 'circle' ? '50%' : Math.max(12, Math.round(size * 0.28)),
        border: '1px solid #bbf7d0',
        background: '#ffffff',
        boxShadow: '0 6px 16px rgba(5,46,22,0.08)',
      }}
    />
  )
}
