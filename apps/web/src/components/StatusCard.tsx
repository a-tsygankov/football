export function StatusCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'light' | 'warn'
}) {
  return (
    <div
      style={{
        padding: '14px 16px',
        borderRadius: 20,
        background: tone === 'warn' ? '#fef2f2' : 'rgba(255,255,255,0.78)',
        border: `1px solid ${tone === 'warn' ? '#fecaca' : 'rgba(5,46,22,0.08)'}`,
      }}
    >
      <p style={{ margin: 0, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', opacity: 0.6 }}>
        {label}
      </p>
      <p style={{ margin: '6px 0 0', fontSize: 15 }}>{value}</p>
    </div>
  )
}
