import type {
  GameRecordedEvent,
  GameVoidedEvent,
  PersistedGameEvent,
} from '../types/events.js'
import type { GamerId } from '../types/ids.js'

/**
 * The stack a gamer buys when they put money in.
 *
 * A round number that survives a bad run: at 100, a string of losing 10-chip
 * bets is a real dent rather than an instant bust, and the arithmetic stays
 * easy to do in your head at the table. Only a suggestion — the buy form takes
 * any amount.
 */
export const DEFAULT_BUY_IN = 100

/**
 * What a game night hands each participant when it starts: nothing.
 *
 * Balances are room-wide and carry between nights, so a nightly grant would
 * mint chips for everyone in the pool whether they wagered or not — sit out
 * ten evenings and you are a thousand chips richer for having done nothing.
 * Chips now enter the room only when somebody deliberately buys them, which is
 * what makes a balance mean "what this person put in, plus what they won".
 *
 * A night may still set a buy-in explicitly, and the old behaviour is exactly
 * that with the amount filled in.
 */
export const DEFAULT_NIGHT_BUY_IN = 0

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
  /** Chips into the room, all time — `bought` plus `granted`. */
  purchased: number
  /** The part of `purchased` somebody chose to buy. */
  bought: number
  /**
   * The part of `purchased` a game night issued automatically.
   *
   * Only history now that nights buy in for nothing by default, but worth
   * keeping apart: a gamer holding nothing but grants never took part, and a
   * balance made of grants is not the same claim as one somebody paid for.
   */
  granted: number
  /** Winnings minus stakes across every settled game, all time. */
  wagered: number
  /** How much of `wagered` has since been squared up in cash. Signed. */
  settled: number
  /**
   * `wagered − settled` — what is still owed or owing.
   *
   * This is the number `settleUp` divides into payments, and the one that
   * matters to a player: lifetime profit is a statistic, an unsettled debt is
   * a thing you owe somebody on Friday. Both sum to zero room-wide, because
   * wagering only moves chips and a settlement clears equal credits and debits.
   */
  net: number
  /** Stakes riding on games that have not resolved. */
  committed: number
  /** purchased + net — what they hold, counting nothing still in play. */
  balance: number
  /** balance − committed — what may still be put at risk. */
  available: number
}

function entry(gamerId: GamerId): ChipLedgerEntry {
  return {
    gamerId,
    purchased: 0,
    bought: 0,
    granted: 0,
    wagered: 0,
    settled: 0,
    net: 0,
    committed: 0,
    balance: 0,
    available: 0,
  }
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
      const item = get(payload.gamerId)
      item.purchased += payload.amount
      if (payload.reason === 'game_night_buy_in') item.granted += payload.amount
      else item.bought += payload.amount
      continue
    }
    if (payload.type === 'chips_settled') {
      get(payload.gamerId).settled += payload.amount
      continue
    }
    if (payload.type !== 'game_recorded') continue
    if (voidedGameIds.has(payload.gameId)) continue
    for (const wager of (payload as GameRecordedEvent).wagers ?? []) {
      get(wager.gamerId).wagered += wager.payout - wager.stake
    }
  }

  for (const bet of openBets) {
    get(bet.gamerId).committed += bet.stake
  }

  for (const item of ledger.values()) {
    // Settling hands the winnings over in cash, so they stop being chips: a
    // fully settled room holds exactly what its players bought.
    item.net = item.wagered - item.settled
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
 * Has this gamer taken any part in the room's wagering?
 *
 * Buying chips counts even before the first bet — putting money in is taking
 * part, and somebody who just topped up wants to see it landed. A night's
 * automatic buy-in does not, which is the whole point: the old model issued
 * one to everybody in the pool, so counting grants would list people who never
 * placed a bet alongside those who did, at balances they never asked for.
 */
export function hasChipActivity(item: ChipLedgerEntry): boolean {
  return item.bought > 0 || item.net !== 0 || item.committed > 0
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

/**
 * What each gamer's `chips_settled` amount must be to close the room out.
 *
 * Exactly their outstanding position, so folding these back in leaves every
 * net at zero. Gamers who are already square are omitted — writing a zero
 * would be a row that says nothing happened.
 *
 * Derived here rather than in the route so the amounts that get written and
 * the amounts the panel promised come from one place.
 */
export function settlementAmounts(
  entries: Iterable<ChipLedgerEntry>,
): Array<{ gamerId: GamerId; amount: number }> {
  return [...entries]
    .filter((item) => item.net !== 0)
    .map((item) => ({ gamerId: item.gamerId, amount: item.net }))
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
