import type {
  GameRecordedEvent,
  GameVoidedEvent,
  PersistedGameEvent,
} from '../types/events.js'
import type { GamerId } from '../types/ids.js'

/**
 * Chips a game night hands each participant when it starts.
 *
 * A round number that survives a bad run: at 100, a string of losing 10-chip
 * bets is a real dent rather than an instant bust, and the arithmetic stays
 * easy to do in your head at the table. Only a default — a night may buy in
 * for any amount, or for nothing at all when the room carries balances over.
 */
export const DEFAULT_BUY_IN = 100

/**
 * One gamer's standing in a room's chip ledger.
 *
 * Nothing here is stored. Every field is folded out of the event log and the
 * live bet rows, so a balance cannot drift away from the history that produced
 * it — and voiding a game corrects the ledger with no rollback of its own.
 *
 * Balances are room-scoped, not night-scoped: chips bought on one night are
 * still yours on the next, and so are the winnings.
 */
export interface ChipLedgerEntry {
  gamerId: GamerId
  /** Chips bought into the room, all time. */
  purchased: number
  /** Winnings minus stakes across every settled game. Profit, in other words. */
  net: number
  /** Stakes riding on games that have not resolved. */
  committed: number
  /** purchased + net — what they hold, counting nothing still in play. */
  balance: number
  /** balance − committed — what may still be put at risk. */
  available: number
}

function entry(gamerId: GamerId): ChipLedgerEntry {
  return { gamerId, purchased: 0, net: 0, committed: 0, balance: 0, available: 0 }
}

/**
 * The whole room's ledger, folded from its event log.
 *
 * `openBets` are the live rows — bets whose game has not settled. Settlement
 * deletes those rows and writes the outcome into `game_recorded`, so a stake
 * is counted as committed right up to the moment it becomes part of `net`,
 * and never as both.
 */
export function roomChipLedger(
  events: ReadonlyArray<PersistedGameEvent>,
  openBets: ReadonlyArray<{ gamerId: GamerId; stake: number }> = [],
): Map<GamerId, ChipLedgerEntry> {
  const voidedGameIds = new Set(
    events
      .map((event) => event.payload)
      .filter((payload): payload is GameVoidedEvent => payload.type === 'game_voided')
      .map((payload) => payload.gameId),
  )

  const ledger = new Map<GamerId, ChipLedgerEntry>()
  const get = (gamerId: GamerId): ChipLedgerEntry => {
    let found = ledger.get(gamerId)
    if (!found) {
      found = entry(gamerId)
      ledger.set(gamerId, found)
    }
    return found
  }

  for (const event of events) {
    const payload = event.payload
    if (payload.type === 'chips_purchased') {
      get(payload.gamerId).purchased += payload.amount
      continue
    }
    if (payload.type !== 'game_recorded') continue
    if (voidedGameIds.has(payload.gameId)) continue
    for (const wager of (payload as GameRecordedEvent).wagers ?? []) {
      get(wager.gamerId).net += wager.payout - wager.stake
    }
  }

  for (const bet of openBets) {
    get(bet.gamerId).committed += bet.stake
  }

  for (const item of ledger.values()) {
    item.balance = item.purchased + item.net
    item.available = item.balance - item.committed
  }

  return ledger
}

/** A gamer with no history at all still has a well-defined (empty) standing. */
export function ledgerEntryFor(
  ledger: ReadonlyMap<GamerId, ChipLedgerEntry>,
  gamerId: GamerId,
): ChipLedgerEntry {
  return ledger.get(gamerId) ?? entry(gamerId)
}

/**
 * The largest total position a gamer may hold on one game.
 *
 * `available` already subtracts every open stake, this game's included. Adding
 * that back is what lets a position be moved or topped up: those chips are
 * being re-committed, not committed twice.
 */
export function maxStakeOnGame(entryFor: ChipLedgerEntry, currentStakeOnGame: number): number {
  return entryFor.available + currentStakeOnGame
}

/** One payment that settles part of the room up. */
export interface ChipTransfer {
  from: GamerId
  to: GamerId
  amount: number
}

/**
 * Who pays whom to close the room out.
 *
 * A gamer's profit is their `net`: chips only enter by purchase and wagering
 * only moves them between gamers, so the nets sum to zero and every winner can
 * be paid out of the losers. Greedily matching the biggest debt against the
 * biggest credit settles everyone in at most one transfer fewer than there are
 * people — the same simplification a shared-expenses app does, rather than
 * having each loser pay each winner separately.
 *
 * Open stakes are deliberately ignored: a bet that has not resolved is neither
 * won nor lost, and settling mid-game would be guessing.
 */
export function settleUp(
  entries: Iterable<ChipLedgerEntry>,
  /** Ordering tiebreak, so the same ledger always yields the same transfers. */
  compare: (a: ChipLedgerEntry, b: ChipLedgerEntry) => number = (a, b) =>
    a.gamerId < b.gamerId ? -1 : a.gamerId > b.gamerId ? 1 : 0,
): ChipTransfer[] {
  const all = [...entries].sort(compare)
  const debtors = all.filter((item) => item.net < 0).map((item) => ({ id: item.gamerId, owed: -item.net }))
  const creditors = all.filter((item) => item.net > 0).map((item) => ({ id: item.gamerId, owed: item.net }))

  // Biggest first, so the largest obligations are cleared by the fewest
  // payments; ties keep the caller's ordering because sort is stable.
  debtors.sort((a, b) => b.owed - a.owed)
  creditors.sort((a, b) => b.owed - a.owed)

  const transfers: ChipTransfer[] = []
  if (debtors.length === 0 || creditors.length === 0) return transfers
  let d = 0
  let c = 0
  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d]!
    const creditor = creditors[c]!
    // Both sides are non-zero by construction, so `amount` is positive and at
    // least one of them is cleared every pass — which is what makes this
    // terminate. A "skip if zero" guard here would look defensive and instead
    // spin forever, since neither index would advance.
    const amount = Math.min(debtor.owed, creditor.owed)
    transfers.push({ from: debtor.id, to: creditor.id, amount })
    debtor.owed -= amount
    creditor.owed -= amount
    if (debtor.owed === 0) d += 1
    if (creditor.owed === 0) c += 1
  }

  return transfers
}
