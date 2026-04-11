/**
 * Branded ID types. Branding is purely a compile-time hint — at runtime these
 * are plain strings — but it stops the obvious bug of passing a GamerId where
 * a RoomId is expected.
 */
export type Brand<T, B> = T & { readonly __brand: B }

export type RoomId = Brand<string, 'RoomId'>
export type GamerId = Brand<string, 'GamerId'>
export type GameId = Brand<string, 'GameId'>
export type GameNightId = Brand<string, 'GameNightId'>
export type EventId = Brand<string, 'EventId'>
export type GamerTeamKey = Brand<string, 'GamerTeamKey'>

export const RoomId = (s: string): RoomId => s as RoomId
export const GamerId = (s: string): GamerId => s as GamerId
export const GameId = (s: string): GameId => s as GameId
export const GameNightId = (s: string): GameNightId => s as GameNightId
export const EventId = (s: string): EventId => s as EventId
export const GamerTeamKey = (s: string): GamerTeamKey => s as GamerTeamKey
