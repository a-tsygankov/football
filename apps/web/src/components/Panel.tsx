import type React from 'react'

export function Panel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <section
      style={{
        padding: 20,
        borderRadius: 24,
        background: 'rgba(255,255,255,0.82)',
        border: '1px solid rgba(5,46,22,0.08)',
        boxShadow: '0 14px 36px rgba(5,46,22,0.08)',
      }}
    >
      <h3 style={{ margin: 0, fontSize: 24 }}>{title}</h3>
      <p style={{ margin: '8px 0 16px', fontSize: 14, opacity: 0.7 }}>{subtitle}</p>
      {children}
    </section>
  )
}
