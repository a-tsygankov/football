export interface HistoricalRatingsPoint {
  readonly version: string
  readonly label: string
  readonly releasedAt: number | null
  readonly overallRating: number
  readonly attackRating: number
  readonly midfieldRating: number
  readonly defenseRating: number
}

const SERIES = [
  { key: 'overallRating', label: 'OVR', color: '#f59e0b' },
  { key: 'attackRating', label: 'ATT', color: '#22c55e' },
  { key: 'midfieldRating', label: 'MID', color: '#3b82f6' },
  { key: 'defenseRating', label: 'DEF', color: '#ef4444' },
] as const

export function HistoricalRatingsChart({
  points,
}: {
  points: ReadonlyArray<HistoricalRatingsPoint>
}) {
  if (points.length === 0) return null

  const width = 560
  const height = 220
  const padding = 28
  const minValue = Math.min(...points.flatMap((point) => [point.overallRating, point.attackRating, point.midfieldRating, point.defenseRating])) - 2
  const maxValue = Math.max(...points.flatMap((point) => [point.overallRating, point.attackRating, point.midfieldRating, point.defenseRating])) + 2
  const span = Math.max(1, maxValue - minValue)
  const plotWidth = width - padding * 2
  const plotHeight = height - padding * 2

  function x(index: number): number {
    return padding + (points.length === 1 ? plotWidth / 2 : (plotWidth * index) / (points.length - 1))
  }

  function y(value: number): number {
    return padding + plotHeight - ((value - minValue) / span) * plotHeight
  }

  return (
    <div
      style={{
        borderRadius: 18,
        padding: 14,
        background: '#ffffff',
        border: '1px solid #d1fae5',
        display: 'grid',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {SERIES.map((series) => (
          <span
            key={series.key}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: '#166534',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: series.color,
              }}
            />
            {series.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Historical club ratings chart"
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        <rect x="0" y="0" width={width} height={height} rx="18" fill="#f8fafc" />
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const value = Math.round(maxValue - span * tick)
          const tickY = padding + plotHeight * tick
          return (
            <g key={tick}>
              <line
                x1={padding}
                y1={tickY}
                x2={width - padding}
                y2={tickY}
                stroke="rgba(22,101,52,0.12)"
                strokeWidth="1"
              />
              <text x={8} y={tickY + 4} fontSize="11" fill="#166534">
                {value}
              </text>
            </g>
          )
        })}
        {SERIES.map((series) => {
          const path = points
            .map((point, index) => `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(point[series.key])}`)
            .join(' ')
          return (
            <g key={series.key}>
              <path d={path} fill="none" stroke={series.color} strokeWidth="3" strokeLinecap="round" />
              {points.map((point, index) => (
                <circle
                  key={`${series.key}-${point.version}`}
                  cx={x(index)}
                  cy={y(point[series.key])}
                  r="4"
                  fill={series.color}
                />
              ))}
            </g>
          )
        })}
        {points.map((point, index) => (
          <text
            key={point.version}
            x={x(index)}
            y={height - 8}
            textAnchor="middle"
            fontSize="11"
            fill="#166534"
          >
            {point.label}
          </text>
        ))}
      </svg>
      <div
        style={{
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        }}
      >
        {points.map((point) => (
          <div
            key={point.version}
            style={{
              borderRadius: 14,
              padding: 10,
              background: '#f8fafc',
              border: '1px solid #dcfce7',
              display: 'grid',
              gap: 4,
              color: '#166534',
            }}
          >
            <strong style={{ fontSize: 13 }}>{point.label}</strong>
            <span style={{ fontSize: 12, opacity: 0.72 }}>
              OVR {point.overallRating} • ATT {point.attackRating}
            </span>
            <span style={{ fontSize: 12, opacity: 0.72 }}>
              MID {point.midfieldRating} • DEF {point.defenseRating}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
