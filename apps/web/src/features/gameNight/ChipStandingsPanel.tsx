import type { ChipPosition, Gamer, GamerId } from '@fc26/shared'

function formatNet(net: number): string {
  return net > 0 ? `+${net}` : String(net)
}

/**
 * Net chips per gamer for the night.
 *
 * Lives outside `CurrentGameCard` on purpose: recording a result sets
 * `currentGame` to null and unmounts that card, so a settlement summary inside
 * it would flash and vanish before anyone read it.
 */
export function ChipStandingsPanel({
  gamers,
  positions,
  lastGameDeltas,
}: {
  gamers: ReadonlyArray<Gamer>
  positions: ReadonlyArray<ChipPosition>
  lastGameDeltas: ReadonlyArray<ChipPosition>
}) {
  if (positions.length === 0) return null

  const deltaByGamer = new Map<GamerId, number>(
    lastGameDeltas.map((entry) => [entry.gamerId, entry.net]),
  )

  return (
    <section
      style={{
        marginTop: 18,
        padding: 12,
        borderRadius: 18,
        background: '#ffffff',
        border: '1px solid #c7d2fe',
        display: 'grid',
        gap: 8,
      }}
    >
      <strong style={{ fontSize: 16 }}>Chips tonight</strong>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
        {positions.map((entry) => {
          const delta = deltaByGamer.get(entry.gamerId)
          const name = gamers.find((gamer) => gamer.id === entry.gamerId)?.name ?? 'Unknown'
          return (
            <li
              key={entry.gamerId}
              style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 14 }}
            >
              <span style={{ flex: 1 }}>{name}</span>
              {delta !== undefined && delta !== 0 ? (
                <span style={{ fontSize: 12, opacity: 0.7 }}>{formatNet(delta)} last game</span>
              ) : null}
              <strong style={{ color: entry.net >= 0 ? '#15803d' : '#b91c1c' }}>
                {formatNet(entry.net)}
              </strong>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
