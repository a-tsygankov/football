import type React from 'react'

export function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label style={{ display: 'grid', gap: 6, marginBottom: 12, fontSize: 14 }}>
      <span style={{ opacity: 0.78 }}>{label}</span>
      {children}
    </label>
  )
}
