import { useEffect, useMemo, useState } from 'react'
import type {
  Club,
  FcPlayer,
  SquadClubsResponse,
  SquadDiff,
  SquadLeague,
  SquadLeaguesResponse,
  SquadPlayersResponse,
  SquadVersion,
  SquadVersionsResponse,
} from '@fc26/shared'
import { apiJson } from '../../lib/api.js'

export interface SquadBrowserState {
  squadVersions: ReadonlyArray<SquadVersion>
  squadPanelError: string | null
  teams: {
    version: string | null
    setVersion: (value: string | null) => void
    leagues: ReadonlyArray<SquadLeague>
    clubs: ReadonlyArray<Club>
    filteredClubs: ReadonlyArray<Club>
    selectedLeagueId: number | 'all'
    setSelectedLeagueId: (value: number | 'all') => void
    selectedClubId: number | null
    setSelectedClubId: (value: number | null) => void
    selectedClub: Club | null
    selectedClubPlayers: ReadonlyArray<FcPlayer>
    loading: boolean
    playersLoading: boolean
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
  }
}

export function useSquadBrowser(latestSquadVersion: string | null): SquadBrowserState {
  const [squadVersions, setSquadVersions] = useState<ReadonlyArray<SquadVersion>>([])
  const [squadPanelError, setSquadPanelError] = useState<string | null>(null)

  // Teams
  const [teamsVersion, setTeamsVersion] = useState<string | null>(latestSquadVersion)
  const [teamsLeagues, setTeamsLeagues] = useState<ReadonlyArray<SquadLeague>>([])
  const [teamsClubs, setTeamsClubs] = useState<ReadonlyArray<Club>>([])
  const [selectedLeagueId, setSelectedLeagueId] = useState<number | 'all'>('all')
  const [selectedClubId, setSelectedClubId] = useState<number | null>(null)
  const [selectedClubPlayers, setSelectedClubPlayers] = useState<ReadonlyArray<FcPlayer>>([])
  const [teamsLoading, setTeamsLoading] = useState(false)
  const [playersLoading, setPlayersLoading] = useState(false)

  // Changes
  const [changesToVersion, setChangesToVersion] = useState<string | null>(latestSquadVersion)
  const [changesFromVersion, setChangesFromVersion] = useState<string | null>(null)
  const [squadDiff, setSquadDiff] = useState<SquadDiff | null>(null)
  const [changesClubs, setChangesClubs] = useState<ReadonlyArray<Club>>([])
  const [changesLoading, setChangesLoading] = useState(false)

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
      setChangesClubs([])
      setSquadDiff(null)
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
        setTeamsLeagues(leaguesResponse.leagues)
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

  useEffect(() => {
    if (selectedLeagueId === 'all') return
    if (teamsLeagues.some((league) => league.id === selectedLeagueId)) return
    setSelectedLeagueId('all')
  }, [selectedLeagueId, teamsLeagues])

  const filteredTeamsClubs = useMemo(
    () =>
      teamsClubs.filter((club) =>
        selectedLeagueId === 'all' ? true : club.leagueId === selectedLeagueId,
      ),
    [selectedLeagueId, teamsClubs],
  )

  useEffect(() => {
    if (filteredTeamsClubs.length === 0) {
      setSelectedClubId(null)
      setSelectedClubPlayers([])
      return
    }
    if (selectedClubId && filteredTeamsClubs.some((club) => club.id === selectedClubId)) return
    setSelectedClubId(filteredTeamsClubs[0]!.id)
  }, [filteredTeamsClubs, selectedClubId])

  useEffect(() => {
    if (!teamsVersion || !selectedClubId) {
      setSelectedClubPlayers([])
      return
    }

    let cancelled = false
    setPlayersLoading(true)
    setSquadPanelError(null)
    void (async () => {
      try {
        const response = await apiJson<SquadPlayersResponse>(
          `/api/squads/${teamsVersion}/players/${selectedClubId}`,
        )
        if (cancelled) return
        setSelectedClubPlayers(
          [...response.players].sort((left, right) => right.overall - left.overall),
        )
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
  }, [selectedClubId, teamsVersion])

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

  return {
    squadVersions,
    squadPanelError,
    teams: {
      version: teamsVersion,
      setVersion: setTeamsVersion,
      leagues: teamsLeagues,
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
    },
  }
}
