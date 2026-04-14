import type { Gamer } from '@fc26/shared'
import { GamerIdentity } from '../../components/GamerPanel.jsx'

export function TeamColumn({
  title,
  gamerIds,
  gamers,
}: {
  title: string
  gamerIds: readonly string[]
  gamers: ReadonlyArray<Gamer>
}) {
  return (
    <div
      style={{
        borderRadius: 18,
        padding: 14,
        background: '#ffffff',
        border: '1px solid #d1fae5',
      }}
    >
      <strong style={{ display: 'block', marginBottom: 10 }}>{title}</strong>
      <div style={{ display: 'grid', gap: 8 }}>
        {gamerIds.map((gamerId) => {
          const gamer = gamers.find((item) => item.id === gamerId)
          return gamer ? (
            <GamerIdentity
              key={gamerId}
              gamer={gamer}
              size={38}
              subtitle={`Rating ${gamer.rating}`}
            />
          ) : (
            <div key={gamerId} style={{ fontSize: 14 }}>
              {gamerId}
            </div>
          )
        })}
      </div>
    </div>
  )
}
