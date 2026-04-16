export function InlineNotice({
  tone,
  message,
}: {
  tone: 'warn' | 'info'
  message: string
}) {
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 14,
        background: tone === 'warn' ? '#fffbeb' : '#eff6ff',
        border: `1px solid ${tone === 'warn' ? '#fcd34d' : '#93c5fd'}`,
        fontSize: 13,
      }}
    >
      {message}
    </div>
  )
}
