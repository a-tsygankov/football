import { useEffect, useState } from 'react'
import {
  type MatchHistoryEntry,
  type MatchHistoryResponse,
  type MatchHistoryScope,
  type MatchHistorySide,
  formatLocal,
} from '@fc26/shared'
import { resolveAssetUrl } from '../../lib/api.js'
import { InlineNotice } from '../../components/InlineNotice.jsx'

const RESULT_LABEL: Record<MatchHistoryEntry['result'], string> = {
  home: 'Home win',
  away: 'Away win',
  draw: 'Draw',
}

function clubLogoSrc(clubId: number): string | undefined {
  return resolveAssetUrl(`pending:club:${clubId}`) ?? undefined
}

function SideBlock({ side, align }: { side: MatchHistorySide; align: 'left' | 'right' }) {
  const names = side.gamers.length > 0
    ? side.gamers.map((gamer) => gamer.name).join(' + ')
    : side.gamerIds.join(' + ')
  // A real selected club has a positive id (and thus a logo). clubId 0 means no
  // club was picked before the game; show the recognised name if we have one,
  // otherwise render no club line at all (never "Club #0").
  const hasSelectedClub = side.clubId > 0
  const clubLabel = side.clubName ?? (hasSelectedClub ? `Club #${side.clubId}` : null)
  return (
    <div
      style={{
        display: 'grid',
        gap: 4,
        justifyItems: align === 'left' ? 'start' : 'end',
        textAlign: align,
        minWidth: 0,
      }}
    >
      <strong
        style={{
          fontSize: 14,
          color: side.won ? '#15803d' : '#0f172a',
          overflowWrap: 'anywhere',
        }}
      >
        {names}
      </strong>
      {clubLabel ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexDirection: align === 'left' ? 'row' : 'row-reverse',
          }}
        >
          {hasSelectedClub ? (
            <img
              src={clubLogoSrc(side.clubId)}
              alt=""
              width={20}
              height={20}
              style={{ borderRadius: 4, objectFit: 'contain', background: '#f1f5f9' }}
            />
          ) : null}
          <span style={{ fontSize: 12, opacity: 0.74, overflowWrap: 'anywhere' }}>
            {clubLabel}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function MatchCard({ match }: { match: MatchHistoryEntry }) {
  const homeScore = match.home.score
  const awayScore = match.away.score
  const hasScore = homeScore !== null && awayScore !== null

  return (
    <article
      style={{
        borderRadius: 14,
        padding: 12,
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        display: 'grid',
        gap: 8,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          fontSize: 11,
          opacity: 0.62,
        }}
      >
        <span>{formatLocal(match.occurredAt)}</span>
        <span>
          {match.format} • {RESULT_LABEL[match.result]}
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <SideBlock side={match.home} align="left" />
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            color: '#0f172a',
          }}
        >
          {hasScore ? `${homeScore} – ${awayScore}` : 'vs'}
        </div>
        <SideBlock side={match.away} align="right" />
      </div>
    </article>
  )
}

export function MatchHistoryList({
  scope,
  onLoad,
}: {
  scope: MatchHistoryScope
  onLoad: (scope: MatchHistoryScope) => Promise<MatchHistoryResponse>
}) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; matches: ReadonlyArray<MatchHistoryEntry> }
  >({ status: 'loading' })

  const scopeKey =
    scope.type === 'gamer'
      ? `gamer:${scope.gamerId}`
      : scope.type === 'gamerTeam'
        ? `team:${scope.gamerTeamKey}`
        : 'all'

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    onLoad(scope)
      .then((response) => {
        if (!cancelled) setState({ status: 'ready', matches: response.matches })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            message: err instanceof Error ? err.message : String(err),
          })
        }
      })
    return () => {
      cancelled = true
    }
    // scopeKey captures the meaningful identity of `scope`; onLoad is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey])

  if (state.status === 'loading') {
    return <InlineNotice tone="info" message="Loading recent matches..." />
  }
  if (state.status === 'error') {
    return <InlineNotice tone="warn" message={`Could not load matches: ${state.message}`} />
  }
  if (state.matches.length === 0) {
    return <InlineNotice tone="info" message="No recorded matches yet." />
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {state.matches.map((match) => (
        <MatchCard key={match.eventId} match={match} />
      ))}
    </div>
  )
}
