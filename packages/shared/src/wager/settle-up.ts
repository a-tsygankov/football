import type { GamerId } from '../types/ids.js'
import { type ChipLedgerEntry, type ChipTransfer, hasChipActivity, settleUp } from './ledger.js'

/** Where one gamer stands when the room closes out. */
export interface SettlementStanding {
  gamerId: GamerId
  /**
   * Won or lost beyond what they bought. Positive means the room owes them.
   *
   * Deliberately not `balance`: chips bought are the gamer's own money coming
   * in, not a debt to anybody at the table, so somebody who bought 500 and
   * finished level owes and is owed nothing.
   */
  net: number
}

/** The room's closing position: who stands where, and who pays whom. */
export interface RoomSettlement {
  /** Biggest winner first, biggest loser last. Ties broken by gamer id. */
  standings: ReadonlyArray<SettlementStanding>
  /** The payments that close the room out, fewest first. */
  transfers: ReadonlyArray<ChipTransfer>
  /**
   * Chips riding on games that have not resolved, counted in nobody's net.
   *
   * Zero when there is nothing on the table. Anything else means the numbers
   * here are a snapshot taken mid-evening, and the screen has to say so.
   */
  openStakes: number
}

/**
 * Sort a gamer above another when they are further ahead.
 *
 * The tiebreak is the same convention `settleWagers` uses to hand out leftover
 * chips: the larger amount first, then the lower gamer id. Determinism is the
 * whole point — the settle-up screen is read off two phones at once at the end
 * of a night, and a list that disagrees with itself is a list nobody trusts.
 */
function byNetThenId(a: SettlementStanding, b: SettlementStanding): number {
  return b.net - a.net || (a.gamerId < b.gamerId ? -1 : a.gamerId > b.gamerId ? 1 : 0)
}

/**
 * What it takes to close the room out, folded from the ledger and nothing else.
 *
 * Purely a reading of `roomChipLedger`'s output: it writes nothing, asks the
 * server for nothing, and two clients holding the same ledger produce the same
 * answer down to the ordering.
 *
 * Open stakes are excluded rather than guessed at. An unresolved bet is
 * neither won nor lost, so it cannot move real money yet; `openStakes` reports
 * how much is being left out so the screen can own the omission instead of
 * quietly under-reporting.
 */
export function roomSettlement(entries: Iterable<ChipLedgerEntry>): RoomSettlement {
  const all = [...entries]

  // Only people who actually took part. A night's automatic buy-in used to be
  // issued to everybody in the pool, so the full ledger carries gamers holding
  // chips they never asked for; listing them at zero reads as though they
  // played and came out level.
  const standings = all
    .filter(hasChipActivity)
    .map((item) => ({ gamerId: item.gamerId, net: item.net }))
    .sort(byNetThenId)

  return {
    standings,
    transfers: settleUp(all),
    openStakes: all.reduce((sum, item) => sum + item.committed, 0),
  }
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

/**
 * The settlement as a plain-text message.
 *
 * Written to be pasted into the group chat and understood there with no app
 * around it, which is why it repeats the standings above the payments: "Bob
 * pays Ann 40" on its own invites an argument about where 40 came from.
 */
export function settlementText(
  settlement: RoomSettlement,
  nameOf: (gamerId: GamerId) => string,
): string {
  const lines = ['Settle up', '']

  for (const standing of settlement.standings) {
    lines.push(`${nameOf(standing.gamerId)} ${signed(standing.net)}`)
  }
  if (settlement.standings.length > 0) lines.push('')

  if (settlement.transfers.length === 0) {
    lines.push('Nobody owes anybody.')
  } else {
    for (const transfer of settlement.transfers) {
      lines.push(`${nameOf(transfer.from)} pays ${nameOf(transfer.to)} ${transfer.amount}`)
    }
  }

  if (settlement.openStakes > 0) {
    lines.push('', `Excludes ${settlement.openStakes} still riding on unresolved games.`)
  }

  return lines.join('\n')
}
