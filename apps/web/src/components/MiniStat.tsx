export function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: 14,
        borderRadius: 18,
        background: 'rgba(236,253,245,0.08)',
        border: '1px solid rgba(236,253,245,0.12)',
      }}
    >
      <p style={{ margin: 0, fontSize: 12, opacity: 0.72, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
        {label}
      </p>
      <p style={{ margin: '8px 0 0', fontSize: 18 }}>{value}</p>
    </div>
  )
}
