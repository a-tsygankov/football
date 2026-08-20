import type { ChipsPurchasedEvent, ChipsSettledEvent, PersistedGameEvent } from '../types/events.js'
import type { GamerId } from '../types/ids.js'

/**
 * Chips entering or leaving the room for reasons that are not a wager.
 *
 * The bet history answers "what did people back and how did it go". It cannot
 * answer "did Cy ever pay me that 40", because a settlement is not a bet and
 * never appears there. Both events have been written since the ledger existed
 * and neither was ever read back, so the money side of a money app was
 * invisible: a debt would simply vanish from the screen with no record that
 * anybody had handed over anything.
 */

export interface ChipPurchaseEntry {
  kind: 'purchase'
  gamerId: GamerId
  /** Always positive. */
  amount: number
  occurredAt: number
  /** `game_night_buy_in` only appears in history predating migration 0012. */
  reason: ChipsPurchasedEvent['reason']
}

export interface ChipSettlementEntry {
  kind: 'settlement'
  settlementId: string
  occurredAt: number
  /**
   * Signed, one per gamer the round touched: positive was owed and has been
   * paid, negative owed it and has paid.
   *
   * Kept as a group rather than flattened into one row per gamer because a
   * settlement is one event in the room's life — "Cy paid Ann 40" — and
   * splitting it reads as two unrelated things happening at once.
   */
  paid: ReadonlyArray<{ gamerId: GamerId; amount: number }>
}

export type MoneyEntry = ChipPurchaseEntry | ChipSettlementEntry

/**
 * The room's money history, newest first.
 *
 * Settlements are grouped by `settlementId`, which is what makes a single
 * payment render as one line naming both sides. A whole-room settle-up groups
 * the same way and simply has more gamers in it — the events record each
 * gamer's net change rather than who handed cash to whom, so a round with more
 * than one payer is reported as the round it was, not as invented pairings.
 */
export function moneyHistory(events: ReadonlyArray<PersistedGameEvent>): MoneyEntry[] {
  const entries: MoneyEntry[] = []
  const rounds = new Map<string, ChipSettlementEntry>()

  for (const event of events) {
    const payload = event.payload
    if (payload.type === 'chips_purchased') {
      entries.push({
        kind: 'purchase',
        gamerId: payload.gamerId,
        amount: payload.amount,
        occurredAt: payload.occurredAt,
        reason: payload.reason,
      })
      continue
    }
    if (payload.type !== 'chips_settled') continue

    const settled = payload as ChipsSettledEvent
    let round = rounds.get(settled.settlementId)
    if (!round) {
      round = {
        kind: 'settlement',
        settlementId: settled.settlementId,
        occurredAt: settled.occurredAt,
        paid: [],
      }
      rounds.set(settled.settlementId, round)
      entries.push(round)
    }
    ;(round.paid as Array<{ gamerId: GamerId; amount: number }>).push({
      gamerId: settled.gamerId,
      amount: settled.amount,
    })
  }

  // Newest first, and stable within a timestamp: a settle-up written in one
  // pass shares a millisecond with the purchase that may sit beside it.
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.occurredAt - a.entry.occurredAt || b.index - a.index)
    .map((item) => item.entry)
}

/** Did this entry involve the named gamer at all? */
export function involvesGamer(entry: MoneyEntry, gamerId: GamerId): boolean {
  return entry.kind === 'purchase'
    ? entry.gamerId === gamerId
    : entry.paid.some((item) => item.gamerId === gamerId)
}

/**
 * Narrows the history to one gamer. Null means everything.
 *
 * Same convenience-not-permission caveat as `filterBetHistory`: the endpoint
 * hands the whole room's history to any session that can reach it, because the
 * room session carries no per-gamer identity to filter on.
 */
export function filterMoneyHistory(
  entries: ReadonlyArray<MoneyEntry>,
  gamerId: GamerId | null,
): MoneyEntry[] {
  if (gamerId === null) return [...entries]
  return entries.filter((entry) => involvesGamer(entry, gamerId))
}
