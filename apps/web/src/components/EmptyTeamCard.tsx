/**
 * Placeholder card shown when no FC team has been selected for a side.
 * Matches the visual size/shape of `EaTeamCard` at `size="medium"` so the
 * two cards sit side-by-side without layout jank.
 */
export function EmptyTeamCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        borderRadius: 22,
        padding: 14,
        minHeight: 200,
        display: 'grid',
        alignContent: 'space-between',
        gap: 14,
        background:
          'linear-gradient(180deg, rgba(3,7,18,0.10) 0%, rgba(255,255,255,0.04) 100%), linear-gradient(145deg, #1e1e1e 0%, #2a2a2a 48%, #3a3a3a 100%)',
        color: '#94a3b8',
        border: '1px solid rgba(148,163,184,0.32)',
        boxShadow: '0 8px 24px rgba(2,6,23,0.10)',
        boxSizing: 'border-box',
        width: '100%',
        cursor: 'pointer',
        textAlign: 'center',
        font: 'inherit',
      }}
    >
      {/* Spacer matching the caption row */}
      <div style={{ fontSize: 11, opacity: 0 }}>&nbsp;</div>

      {/* Silhouette badge + empty star meter */}
      <div style={{ display: 'grid', justifyItems: 'center', gap: 14 }}>
        {/* Gray shield silhouette */}
        <div
          style={{
            width: 76,
            height: 76,
            borderRadius: '50%',
            background: 'rgba(148,163,184,0.18)',
            border: '2px solid rgba(148,163,184,0.22)',
          }}
        />
        <div style={{ display: 'grid', gap: 6, justifyItems: 'center' }}>
          <strong
            style={{
              display: 'block',
              fontSize: 16,
              lineHeight: 1.2,
              fontFamily: 'Georgia, serif',
              color: '#cbd5e1',
            }}
          >
            Click to select
          </strong>
          {/* Gray empty stars */}
          <div style={{ fontSize: 16, letterSpacing: 1.5, lineHeight: 1, color: 'rgba(148,163,184,0.32)' }}>
            ★★★★★
          </div>
        </div>
      </div>

      {/* Empty ATT/MID/DEF boxes */}
      <div
        style={{
          display: 'grid',
          gap: 8,
          borderRadius: 16,
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.04)',
          padding: 10,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 6,
          }}
        >
          {['ATT', 'MID', 'DEF'].map((label) => (
            <div
              key={label}
              style={{
                borderRadius: 12,
                padding: '6px 4px',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.04)',
                textAlign: 'center',
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  opacity: 0.5,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                }}
              >
                {label}
              </div>
              <strong style={{ fontSize: 20, lineHeight: 1, marginTop: 4, display: 'block' }}>
                --
              </strong>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, opacity: 0.5 }}>OVR --</div>
      </div>
    </button>
  )
}
