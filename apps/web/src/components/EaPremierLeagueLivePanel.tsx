import { startTransition, useEffect, useMemo, useState } from 'react'
import {
  SQUAD_PLATFORMS,
  type EaSquadPreviewResponse,
  type SquadPlatform,
} from '@fc26/shared'
import { ClubAvatar } from './FcClubPanel.jsx'

const LOCAL_TOOL_URL_KEY = 'fc26:ea-preview-base-url'

export function EaPremierLeagueLivePanel({
  platform,
}: {
  platform: SquadPlatform
}) {
  const [toolBaseUrl, setToolBaseUrl] = useState(() => readStoredToolBaseUrl())
  const [preview, setPreview] = useState<EaSquadPreviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(LOCAL_TOOL_URL_KEY, toolBaseUrl)
  }, [toolBaseUrl])

  const missingClubNames = useMemo(
    () => preview?.missingClubNames ?? [],
    [preview],
  )

  const platformLabel = SQUAD_PLATFORMS[platform]?.label ?? platform

  async function loadPreview(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const baseUrl = normalizeToolBaseUrl(toolBaseUrl)
      const endpoint = new URL('/api/ea/premier-league', `${baseUrl}/`)
      endpoint.searchParams.set('platform', platform)
      const response = await fetch(endpoint, {
        headers: { accept: 'application/json' },
      })
      const payload = (await response.json()) as unknown
      if (!response.ok) {
        const failure =
          typeof payload === 'object' && payload !== null
            ? (payload as { message?: string; error?: string })
            : null
        throw new Error(
          failure?.message ?? failure?.error ?? `Local preview failed with ${response.status}`,
        )
      }
      startTransition(() => setPreview(payload as EaSquadPreviewResponse))
    } catch (fetchError) {
      setPreview(null)
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        borderRadius: 20,
        padding: 16,
        background: 'linear-gradient(145deg, #03140c 0%, #0f2f22 48%, #14532d 100%)',
        color: '#ecfdf5',
        border: '1px solid rgba(167,243,208,0.22)',
        boxShadow: '0 16px 40px rgba(2,6,23,0.24)',
        display: 'grid',
        gap: 14,
      }}
    >
      <div style={{ display: 'grid', gap: 8 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.7 }}>
              Local EA Preview
            </div>
            <strong style={{ display: 'block', marginTop: 6, fontSize: 20 }}>
              English Premier League clubs from the live EA roster
            </strong>
          </div>
          <button
            type="button"
            onClick={() => void loadPreview()}
            disabled={loading}
            style={{
              borderRadius: 16,
              border: '1px solid rgba(187,247,208,0.46)',
              background: loading ? 'rgba(22,101,52,0.55)' : '#22c55e',
              color: '#052e16',
              padding: '12px 16px',
              fontSize: 14,
              fontWeight: 700,
              cursor: loading ? 'progress' : 'pointer',
            }}
          >
            {loading ? 'Fetching live roster...' : `Load ${platformLabel} preview`}
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, opacity: 0.82 }}>
          This preview uses the local no-storage EA tool, downloads the live squad binary directly,
          unpacks it in memory, and now reads the FC 26 team tables directly so the cards show exact
          EA OVR, ATT, MID, and DEF values plus their latest movement.
        </p>
      </div>

      <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
        <span style={{ opacity: 0.78 }}>Local tool URL</span>
        <input
          value={toolBaseUrl}
          onChange={(event) => setToolBaseUrl(event.target.value)}
          placeholder="http://localhost:8790"
          style={{
            width: '100%',
            borderRadius: 14,
            border: '1px solid rgba(187,247,208,0.34)',
            background: 'rgba(255,255,255,0.96)',
            color: '#052e16',
            padding: '12px 14px',
            fontSize: 14,
            boxSizing: 'border-box',
          }}
        />
      </label>

      {error ? (
        <div
          style={{
            borderRadius: 14,
            padding: '10px 12px',
            background: 'rgba(127,29,29,0.28)',
            border: '1px solid rgba(254,202,202,0.42)',
            fontSize: 13,
          }}
        >
          {error}. Start the local tool with <code>pnpm --filter @fc26/squad-sync preview</code> and
          make sure the URL above points to the same machine.
        </div>
      ) : null}

      {preview ? (
        <>
          <div
            style={{
              display: 'grid',
              gap: 10,
              gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
            }}
          >
            <PreviewStat label="Squad version" value={preview.squadVersion} />
            <PreviewStat label="Matched clubs" value={`${preview.matchedClubCount}/${preview.clubs.length}`} />
            <PreviewStat label="Raw bytes" value={preview.rawBytes.toLocaleString()} />
            <PreviewStat label="Unpacked bytes" value={preview.unpackedBytes.toLocaleString()} />
          </div>

          <div
            style={{
              borderRadius: 14,
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.08)',
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            Stars are intentionally hidden here until we can read an exact FC 26 star source from the
            EA roster. The values below are direct EA numeric ratings, not inferred approximations.
          </div>

          {missingClubNames.length > 0 ? (
            <div
              style={{
                borderRadius: 14,
                padding: '10px 12px',
                background: 'rgba(234,179,8,0.18)',
                border: '1px solid rgba(253,224,71,0.34)',
                fontSize: 13,
              }}
            >
              Alias tuning still needed for: {missingClubNames.join(', ')}.
            </div>
          ) : null}

          <div
            style={{
              display: 'grid',
              gap: 14,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            }}
          >
            {preview.clubs.map((club) => (
              <article
                key={club.id}
                style={{
                  borderRadius: 22,
                  padding: 18,
                  minHeight: 220,
                  display: 'grid',
                  alignContent: 'space-between',
                  gap: 16,
                  background: 'linear-gradient(180deg, rgba(3,7,18,0.18) 0%, rgba(255,255,255,0.08) 100%)',
                  border: '1px solid rgba(34,197,94,0.42)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                  }}
                >
                  <span />
                  <span style={{ fontSize: 12, opacity: 0.7 }}>{club.country ?? preview.leagueName}</span>
                </div>

                <div style={{ display: 'grid', justifyItems: 'center', gap: 14 }}>
                  <ClubAvatar club={club} size={92} />
                  <div style={{ textAlign: 'center' }}>
                    <strong style={{ display: 'block', fontSize: 26, lineHeight: 1.05 }}>{club.name}</strong>
                  </div>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gap: 12,
                    borderRadius: 18,
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    padding: 12,
                  }}
                >
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                      gap: 8,
                    }}
                  >
                    <RatingBox
                      label="ATT"
                      value={club.attackRating}
                      delta={club.ratingDelta.attack}
                    />
                    <RatingBox
                      label="MID"
                      value={club.midfieldRating}
                      delta={club.ratingDelta.midfield}
                    />
                    <RatingBox
                      label="DEF"
                      value={club.defenseRating}
                      delta={club.ratingDelta.defense}
                    />
                  </div>

                  <div
                    style={{
                      fontSize: 11,
                      color: 'rgba(226,232,240,0.58)',
                      textAlign: 'right',
                    }}
                  >
                    Updated: {new Date(preview.fetchedAt).toLocaleString()}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

function RatingBox({
  label,
  value,
  delta,
}: {
  label: string
  value: number | null
  delta: number | null
}) {
  return (
    <div
      style={{
        borderRadius: 16,
        padding: '10px 8px',
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.08)',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 11, opacity: 0.68, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div
        style={{
          marginTop: 8,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <strong style={{ fontSize: 24, lineHeight: 1 }}>
          {formatNullableValue(value)}
        </strong>
        <DeltaTriangle delta={delta} />
      </div>
    </div>
  )
}

function DeltaTriangle({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return null
  const isUp = delta > 0

  return (
    <span
      aria-label={isUp ? 'increased' : 'decreased'}
      title={isUp ? `Increased by ${delta}` : `Decreased by ${Math.abs(delta)}`}
      style={{
        width: 0,
        height: 0,
        borderLeft: '5px solid transparent',
        borderRight: '5px solid transparent',
        borderBottom: isUp ? '8px solid #22c55e' : undefined,
        borderTop: isUp ? undefined : '8px solid #ef4444',
        display: 'inline-block',
      }}
    />
  )
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        borderRadius: 16,
        padding: 12,
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.08)',
      }}
    >
      <div style={{ fontSize: 11, opacity: 0.68, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <strong style={{ display: 'block', marginTop: 8, fontSize: 18 }}>{value}</strong>
    </div>
  )
}

function formatNullableValue(value: number | null): string {
  return value === null ? '—' : String(value)
}

function readStoredToolBaseUrl(): string {
  if (typeof localStorage === 'undefined') {
    return defaultToolBaseUrl()
  }
  return localStorage.getItem(LOCAL_TOOL_URL_KEY) ?? defaultToolBaseUrl()
}

function defaultToolBaseUrl(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:8790'
  }
  const host = window.location.hostname.endsWith('github.io')
    ? 'localhost'
    : window.location.hostname || 'localhost'
  return `http://${host}:8790`
}

function normalizeToolBaseUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return defaultToolBaseUrl()
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed
}
