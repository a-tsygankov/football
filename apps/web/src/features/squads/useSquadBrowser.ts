import { useEffect, useMemo, useState } from 'react'
import {
  Club,
  compareLeagueNames,
  type FcPlayer,
  type SquadClubsResponse,
  type SquadDiff,
  type SquadLeague,
  type SquadLeaguesResponse,
  type SquadPlayersResponse,
  type SquadVersion,
  type SquadVersionsResponse,
} from '@fc26/shared'
import { apiJson } from '../../lib/api.js'

export interface SquadBrowserState {
  squadVersions: ReadonlyArray<SquadVersion>
  squadPanelError: string | null
  teams: {
    version: string | null
    setVersion: (value: string | null) => void
    leagues: ReadonlyArray<SquadLeague>
    /** Leagues filtered by gender + country. */
    filteredLeagues: ReadonlyArray<SquadLeague>
    clubs: ReadonlyArray<Club>
    filteredClubs: ReadonlyArray<Club>
    selectedLeagueId: number | null
    setSelectedLeagueId: (value: number | null) => void
    selectedClubId: number | null
    setSelectedClubId: (value: number | null) => void
    selectedClub: Club | null
    selectedClubPlayers: ReadonlyArray<FcPlayer>
    loading: boolean
    playersLoading: boolean
    gender: 'men' | 'women'
    setGender: (v: 'men' | 'women') => void
    countryNationId: number | null
    setCountryNationId: (v: number | null) => void
    teamIndex: number
    setTeamIndex: (v: number) => void
  }
  changes: {
    toVersion: string | null
    setToVersion: (value: string | null) => void
    fromVersion: string | null
    setFromVersion: (value: string | null) => void
    diff: SquadDiff | null
    clubs: ReadonlyArray<Club>
    clubById: ReadonlyMap<number, Club>
    versions: ReadonlyArray<string>
    loading: boolean
    historyLoading: boolean
    historyLeagues: ReadonlyArray<SquadLeague>
    selectedHistoryLeagueId: number | 'all'
    setSelectedHistoryLeagueId: (value: number | 'all') => void
    selectedHistoryClubId: number | null
    setSelectedHistoryClubId: (value: number | null) => void
    historyClubOptions: ReadonlyArray<Club>
    historySeries: ReadonlyArray<{
      version: string
      label: string
      releasedAt: number | null
      overallRating: number
      attackRating: number
      midfieldRating: number
      defenseRating: number
    }>
  }
}

export function useSquadBrowser(latestSquadVersion: string | null): SquadBrowserState {
  const [squadVersions, setSquadVersions] = useState<ReadonlyArray<SquadVersion>>([])
  const [squadPanelError, setSquadPanelError] = useState<string | null>(null)

  // Teams
  const [teamsVersion, setTeamsVersion] = useState<string | null>(latestSquadVersion)
  const [teamsLeagues, setTeamsLeagues] = useState<ReadonlyArray<SquadLeague>>([])
  const [teamsClubs, setTeamsClubs] = useState<ReadonlyArray<Club>>([])
  // `null` means "no league selected yet" — by design we render no clubs in
  // that state to avoid drowning the user in the full team list on first paint.
  const [selectedLeagueId, setSelectedLeagueId] = useState<number | null>(null)
  const [selectedClubId, setSelectedClubId] = useState<number | null>(null)
  const [selectedClubPlayers, setSelectedClubPlayers] = useState<ReadonlyArray<FcPlayer>>([])
  // Tracks club ids whose latest fetch returned zero players so the auto-clear
  // in the player effect only fires once per club (not on every re-render).
  const [emptyClubIds, setEmptyClubIds] = useState<ReadonlySet<number>>(new Set())
  const [teamsLoading, setTeamsLoading] = useState(false)
  const [playersLoading, setPlayersLoading] = useState(false)
  const [gender, setGender] = useState<'men' | 'women'>('men')
  const [countryNationId, setCountryNationId] = useState<number | null>(null)
  const [teamIndex, setTeamIndex] = useState(0)

  // Changes
  const [changesToVersion, setChangesToVersion] = useState<string | null>(latestSquadVersion)
  const [changesFromVersion, setChangesFromVersion] = useState<string | null>(null)
  const [squadDiff, setSquadDiff] = useState<SquadDiff | null>(null)
  const [changesClubs, setChangesClubs] = useState<ReadonlyArray<Club>>([])
  const [changesLoading, setChangesLoading] = useState(false)
  const [historyVersionClubs, setHistoryVersionClubs] = useState<ReadonlyMap<string, ReadonlyArray<Club>>>(
    new Map(),
  )
  const [historyLoading, setHistoryLoading] = useState(false)
  const [selectedHistoryLeagueId, setSelectedHistoryLeagueId] = useState<number | 'all'>('all')
  const [selectedHistoryClubId, setSelectedHistoryClubId] = useState<number | null>(null)

  useEffect(() => {
    setTeamsVersion((current) =>
      current && current.length > 0 ? current : latestSquadVersion,
    )
    setChangesToVersion((current) =>
      current && current.length > 0 ? current : latestSquadVersion,
    )
  }, [latestSquadVersion])

  useEffect(() => {
    if (!latestSquadVersion) {
      setSquadVersions([])
      setTeamsVersion(null)
      setChangesToVersion(null)
      setChangesFromVersion(null)
      setTeamsClubs([])
      setTeamsLeagues([])
      setSelectedClubPlayers([])
      setSelectedClubId(null)
      setEmptyClubIds(new Set())
      setChangesClubs([])
      setSquadDiff(null)
      setHistoryVersionClubs(new Map())
      setSelectedHistoryLeagueId('all')
      setSelectedHistoryClubId(null)
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const response = await apiJson<SquadVersionsResponse>('/api/squads/versions')
        if (cancelled) return
        setSquadVersions(response.versions)
      } catch (err) {
        if (cancelled) return
        setSquadPanelError(err instanceof Error ? err.message : String(err))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [latestSquadVersion])

  useEffect(() => {
    if (squadVersions.length === 0) {
      setHistoryVersionClubs(new Map())
      setSelectedHistoryLeagueId('all')
      setSelectedHistoryClubId(null)
      return
    }

    let cancelled = false
    setHistoryLoading(true)
    setSquadPanelError(null)
    void (async () => {
      try {
        const entries = await Promise.all(
          squadVersions.map(async (version) => {
            const response = await apiJson<SquadClubsResponse>(`/api/squads/${version.version}/clubs`)
            return [version.version, response.clubs] as const
          }),
        )
        if (cancelled) return
        setHistoryVersionClubs(new Map(entries))
      } catch (err) {
        if (cancelled) return
        setSquadPanelError(err instanceof Error ? err.message : String(err))
        setHistoryVersionClubs(new Map())
      } finally {
        if (!cancelled) setHistoryLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [squadVersions])

  useEffect(() => {
    if (!teamsVersion) {
      setTeamsClubs([])
      setTeamsLeagues([])
      setSelectedClubId(null)
      setSelectedClubPlayers([])
      return
    }

    let cancelled = false
    setTeamsLoading(true)
    setSquadPanelError(null)
    void (async () => {
      try {
        const [clubsResponse, leaguesResponse] = await Promise.all([
          apiJson<SquadClubsResponse>(`/api/squads/${teamsVersion}/clubs`),
          apiJson<SquadLeaguesResponse>(`/api/squads/${teamsVersion}/leagues`),
        ])
        if (cancelled) return
        setTeamsClubs(clubsResponse.clubs)
        setTeamsLeagues(
          [...leaguesResponse.leagues].sort((left, right) =>
            compareLeagueNames(left.name, right.name),
          ),
        )
        setEmptyClubIds(new Set())
      } catch (err) {
        if (cancelled) return
        setSquadPanelError(err instanceof Error ? err.message : String(err))
        setTeamsClubs([])
        setTeamsLeagues([])
      } finally {
        if (!cancelled) setTeamsLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [teamsVersion])

  const filteredLeagues = useMemo(() => {
    let result = teamsLeagues.filter((league) => {
      const leagueGender = league.gender ?? 'men'
      return leagueGender === gender
    })
    if (countryNationId !== null) {
      result = result.filter((league) => league.nationId === countryNationId)
    }
    return result
  }, [teamsLeagues, gender, countryNationId])

  useEffect(() => {
    if (selectedLeagueId !== null) {
      // Clear the selection if the version was switched and the previous
      // league isn't in the filtered set. Replacement is handled by the
      // auto-select branch below on the next render.
      if (filteredLeagues.some((league) => league.id === selectedLeagueId)) return
      setSelectedLeagueId(null)
      return
    }
    // Nothing selected and leagues are now available -- jump straight to
    // the first entry in the filtered set.
    if (filteredLeagues.length === 0) return
    const firstLeague = filteredLeagues[0]!
    setSelectedLeagueId(firstLeague.id)
  }, [selectedLeagueId, filteredLeagues])

  const filteredTeamsClubs = useMemo(() => {
    if (selectedLeagueId === null) return []
    return [...teamsClubs]
      .filter((club) => club.leagueId === selectedLeagueId)
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [selectedLeagueId, teamsClubs])

  useEffect(() => {
    setTeamIndex(0)
    if (filteredTeamsClubs.length === 0) {
      setSelectedClubId(null)
      setSelectedClubPlayers([])
      return
    }
    if (selectedClubId && filteredTeamsClubs.some((club) => club.id === selectedClubId)) return
    // No auto-select on first paint -- let the user pick. This avoids loading
    // a club they didn't ask for.
    setSelectedClubId(null)
  }, [filteredTeamsClubs, selectedClubId])

  useEffect(() => {
    if (!teamsVersion || !selectedClubId) {
      setSelectedClubPlayers([])
      return
    }
    // Skip clubs we already learned have no players — the previous run set
    // selectedClubId back to null, but a parent re-render could resurrect it
    // for one frame and we don't want to refetch a known-empty club.
    if (emptyClubIds.has(selectedClubId)) {
      setSelectedClubPlayers([])
      return
    }

    let cancelled = false
    setPlayersLoading(true)
    setSquadPanelError(null)
    const requestedClubId = selectedClubId
    void (async () => {
      try {
        const response = await apiJson<SquadPlayersResponse>(
          `/api/squads/${teamsVersion}/players/${requestedClubId}`,
        )
        if (cancelled) return
        const sorted = [...response.players].sort((left, right) => right.overall - left.overall)
        setSelectedClubPlayers(sorted)
        if (sorted.length === 0) {
          // "Ignore" the selection per spec — clear it silently and remember
          // the club is empty so we don't bounce back if it's reselected.
          setEmptyClubIds((current) => {
            if (current.has(requestedClubId)) return current
            const next = new Set(current)
            next.add(requestedClubId)
            return next
          })
          setSelectedClubId(null)
        }
      } catch (err) {
        if (cancelled) return
        setSquadPanelError(err instanceof Error ? err.message : String(err))
        setSelectedClubPlayers([])
      } finally {
        if (!cancelled) setPlayersLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [emptyClubIds, selectedClubId, teamsVersion])

  useEffect(() => {
    if (!changesToVersion) {
      setChangesFromVersion(null)
      setSquadDiff(null)
      setChangesClubs([])
      return
    }

    const availablePreviousVersions = squadVersions
      .filter((version) => version.version !== changesToVersion)
      .map((version) => version.version)
    if (
      changesFromVersion &&
      availablePreviousVersions.includes(changesFromVersion)
    ) {
      return
    }
    setChangesFromVersion(availablePreviousVersions[0] ?? null)
  }, [changesFromVersion, changesToVersion, squadVersions])

  useEffect(() => {
    if (!changesToVersion || !changesFromVersion) {
      setSquadDiff(null)
      setChangesClubs([])
      return
    }

    let cancelled = false
    setChangesLoading(true)
    setSquadPanelError(null)
    void (async () => {
      try {
        const [diffResponse, clubsResponse] = await Promise.all([
          apiJson<SquadDiff>(
            `/api/squads/${changesToVersion}/diff?from=${encodeURIComponent(changesFromVersion)}`,
          ),
          apiJson<SquadClubsResponse>(`/api/squads/${changesToVersion}/clubs`),
        ])
        if (cancelled) return
        setSquadDiff(diffResponse)
        setChangesClubs(clubsResponse.clubs)
      } catch (err) {
        if (cancelled) return
        setSquadPanelError(err instanceof Error ? err.message : String(err))
        setSquadDiff(null)
        setChangesClubs([])
      } finally {
        if (!cancelled) setChangesLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [changesFromVersion, changesToVersion])

  const selectedClub =
    filteredTeamsClubs.find((club) => club.id === selectedClubId) ?? null
  const changesClubById = useMemo(
    () => new Map<number, Club>(changesClubs.map((club) => [club.id, club])),
    [changesClubs],
  )
  const versionsForChanges = squadVersions.map((version) => version.version)
  const historyTimeline = useMemo(
    () =>
      [...squadVersions].sort(
        (left, right) =>
          (left.releasedAt ?? left.ingestedAt) - (right.releasedAt ?? right.ingestedAt),
      ),
    [squadVersions],
  )
  const historyReferenceVersion = changesToVersion ?? latestSquadVersion ?? squadVersions[0]?.version ?? null
  const historyReferenceClubs = historyReferenceVersion
    ? historyVersionClubs.get(historyReferenceVersion) ?? []
    : []
  const historyLeagues = useMemo(() => {
    const grouped = new Map<number, SquadLeague>()
    for (const clubs of historyVersionClubs.values()) {
      for (const club of clubs) {
        const existing = grouped.get(club.leagueId)
        if (existing) {
          grouped.set(club.leagueId, {
            ...existing,
            clubCount: Math.max(existing.clubCount, 1),
            logoUrl: existing.logoUrl ?? club.leagueLogoUrl ?? null,
          })
          continue
        }
        grouped.set(club.leagueId, {
          id: club.leagueId,
          name: club.leagueName,
          logoUrl: club.leagueLogoUrl ?? null,
          clubCount: 1,
        })
      }
    }

    return [...grouped.values()].sort((left, right) => compareLeagueNames(left.name, right.name))
  }, [historyVersionClubs])
  const historyClubOptions = useMemo(
    () =>
      [...historyReferenceClubs]
        .filter((club) =>
          selectedHistoryLeagueId === 'all' ? true : club.leagueId === selectedHistoryLeagueId,
        )
        .sort((left, right) => left.name.localeCompare(right.name)),
    [historyReferenceClubs, selectedHistoryLeagueId],
  )

  useEffect(() => {
    if (selectedHistoryLeagueId === 'all') return
    if (historyLeagues.some((league) => league.id === selectedHistoryLeagueId)) return
    setSelectedHistoryLeagueId('all')
  }, [historyLeagues, selectedHistoryLeagueId])

  useEffect(() => {
    if (historyClubOptions.length === 0) {
      setSelectedHistoryClubId(null)
      return
    }
    if (
      selectedHistoryClubId &&
      historyClubOptions.some((club) => club.id === selectedHistoryClubId)
    ) {
      return
    }
    setSelectedHistoryClubId(historyClubOptions[0]!.id)
  }, [historyClubOptions, selectedHistoryClubId])

  const historySeries = useMemo(() => {
    if (!selectedHistoryClubId) return []

    return historyTimeline
      .map((version) => {
        const club = historyVersionClubs
          .get(version.version)
          ?.find((candidate) => candidate.id === selectedHistoryClubId)
        if (!club) return null
        return {
          version: version.version,
          label: version.version,
          releasedAt: version.releasedAt,
          overallRating: club.overallRating,
          attackRating: club.attackRating,
          midfieldRating: club.midfieldRating,
          defenseRating: club.defenseRating,
        }
      })
      .filter((point): point is NonNullable<typeof point> => point !== null)
  }, [historyTimeline, historyVersionClubs, selectedHistoryClubId])

  return {
    squadVersions,
    squadPanelError,
    teams: {
      version: teamsVersion,
      setVersion: setTeamsVersion,
      leagues: teamsLeagues,
      filteredLeagues,
      clubs: teamsClubs,
      filteredClubs: filteredTeamsClubs,
      selectedLeagueId,
      setSelectedLeagueId,
      selectedClubId,
      setSelectedClubId,
      selectedClub,
      selectedClubPlayers,
      loading: teamsLoading,
      playersLoading,
      gender,
      setGender,
      countryNationId,
      setCountryNationId,
      teamIndex,
      setTeamIndex,
    },
    changes: {
      toVersion: changesToVersion,
      setToVersion: setChangesToVersion,
      fromVersion: changesFromVersion,
      setFromVersion: setChangesFromVersion,
      diff: squadDiff,
      clubs: changesClubs,
      clubById: changesClubById,
      versions: versionsForChanges,
      loading: changesLoading,
      historyLoading,
      historyLeagues,
      selectedHistoryLeagueId,
      setSelectedHistoryLeagueId,
      selectedHistoryClubId,
      setSelectedHistoryClubId,
      historyClubOptions,
      historySeries,
    },
  }
}
