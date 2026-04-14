import type { Club, Gamer } from '@fc26/shared'
import { ClubIdentity } from '../../components/FcClubPanel.jsx'
import { GamerIdentity } from '../../components/GamerPanel.jsx'
import { GamerTeamIdentity } from '../../components/GamerTeamPanel.jsx'

export function TeamColumn({
  title,
  club,
  gamerIds,
  gamers,
}: {
  title: string
  club?: Club | null
  gamerIds: readonly string[]
  gamers: ReadonlyArray<Gamer>
}) {
  const members = gamerIds
    .map((gamerId) => gamers.find((item) => item.id === gamerId))
    .filter((gamer): gamer is Gamer => gamer !== undefined)

  return (
    <div
      style={{
        borderRadius: 18,
        padding: 12,
        background: '#ffffff',
        border: '1px solid #d1fae5',
        minWidth: 0,
      }}
    >
      <strong style={{ display: 'block', marginBottom: 10 }}>{title}</strong>
      {club ? (
        <div style={{ marginBottom: 10 }}>
          <ClubIdentity
            club={club}
            subtitle={`${club.leagueName} • ATT ${club.attackRating} • MID ${club.midfieldRating} • DEF ${club.defenseRating}`}
            size={44}
          />
        </div>
      ) : null}
      {members.length > 1 ? (
        <div
          style={{
            marginBottom: 10,
            borderRadius: 16,
            padding: 10,
            background: '#f8fafc',
            border: '1px solid #d1fae5',
          }}
        >
          <GamerTeamIdentity
            members={members}
            size={42}
            subtitle={`${members.length}-player gamer team`}
          />
        </div>
      ) : null}
      <div style={{ display: 'grid', gap: 8 }}>
        {gamerIds.map((gamerId) => {
          const gamer = members.find((item) => item.id === gamerId)
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
