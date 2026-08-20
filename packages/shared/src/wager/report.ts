import type { PersistedGameEvent } from '../types/events.js'
import type { GamerId } from '../types/ids.js'
import { type ChipLedgerEntry, type ChipTransfer, hasChipActivity, roomChipLedger, settleUp } from './ledger.js'

/**
 * The room's ledger as an operator would want to read it, plus anything wrong
 * with it.
 *
 * This exists because the health check used to reimplement `roomChipLedger` in
 * SQL, and a second copy of a fold is a second thing to forget. It drifted
 * twice in one day — once when game nights stopped granting chips, once when
 * settlement landed — and each time it reported something untrue about
 * production while looking perfectly healthy. Nothing made it fail when the
 * model moved, because it did not share any code with the model.
 *
 * So the check now folds with the same function the app folds with. Whatever
 * the ledger means, this means too, for free.
 */

export interface LedgerReportRow extends ChipLedgerEntry {
  /** Blank when no gamer row matches, which is itself a problem. */
  name: string
}

export interface LedgerReport {
  /** Richest first, and only gamers who took part. */
  rows: LedgerReportRow[]
  /** What would close the room out right now. */
  transfers: ChipTransfer[]
  /**
   * One sentence per thing wrong. Empty means the ledger is sound.
   *
   * Reported rather than thrown so a caller can print every problem at once:
   * being told about one fault, fixing it, and being told about the next is a
   * worse morning than being told about both.
   */
  problems: string[]
}

/**
 * Turns rows as D1 hands them back into events.
 *
 * `payload` arrives as a JSON string. Getting this wrong does not throw — it
 * quietly yields a ledger where nobody has ever done anything, which reads
 * exactly like a healthy empty room, so it is worth its own test.
 */
export function parseEventRows(
  rows: ReadonlyArray<{ id: string; room_id: string; event_type: string; payload: string; occurred_at?: number }>,
): PersistedGameEvent[] {
  return rows.map((row) => {
    const payload = JSON.parse(row.payload) as PersistedGameEvent['payload']
    return {
      id: row.id,
      roomId: row.room_id,
      eventType: row.event_type,
      payload,
      schemaVersion: 1,
      correlationId: null,
      occurredAt: row.occurred_at ?? 0,
      recordedAt: row.occurred_at ?? 0,
    } as PersistedGameEvent
  })
}

export function ledgerReport(input: {
  events: ReadonlyArray<PersistedGameEvent>
  names: ReadonlyMap<GamerId, string>
  openBets?: ReadonlyArray<{ gamerId: GamerId; stake: number }>
}): LedgerReport {
  const ledger = roomChipLedger(input.events, input.openBets ?? [])
  const all = [...ledger.values()]

  const rows: LedgerReportRow[] = all
    .filter(hasChipActivity)
    .map((entry) => ({ ...entry, name: input.names.get(entry.gamerId) ?? '' }))
    .sort((a, b) => b.balance - a.balance || (a.gamerId < b.gamerId ? -1 : 1))

  const problems: string[] = []
  const sum = (pick: (entry: ChipLedgerEntry) => number): number =>
    all.reduce((total, entry) => total + pick(entry), 0)

  // Wagering only moves chips between gamers, so lifetime results cancel. A
  // non-zero total means settlement created or destroyed them.
  const wageredTotal = sum((entry) => entry.wagered)
  if (wageredTotal !== 0) {
    problems.push(`Wagering does not cancel: lifetime results sum to ${wageredTotal}, not 0.`)
  }

  // A settle-up clears equal credits and debits, so these cancel too. This is
  // the same arithmetic one step later, and only became possible to break when
  // settlement was added.
  const settledTotal = sum((entry) => entry.settled)
  if (settledTotal !== 0) {
    problems.push(`Settlements do not cancel: they sum to ${settledTotal}, not 0.`)
  }

  // Nights have granted nothing since migration 0012. Anything here means one
  // is handing out chips nobody asked for.
  const granted = all.filter((entry) => entry.granted !== 0)
  if (granted.length > 0) {
    problems.push(
      `${granted.length} gamer(s) still hold granted chips: ${granted
        .map((entry) => `${input.names.get(entry.gamerId) ?? entry.gamerId} ${entry.granted}`)
        .join(', ')}.`,
    )
  }

  // A ledger row for somebody the roster does not know is a dangling
  // reference: the chips are real and there is nobody to hand them to.
  const orphans = rows.filter((row) => row.name === '')
  if (orphans.length > 0) {
    problems.push(
      `${orphans.length} ledger row(s) name no gamer: ${orphans.map((row) => row.gamerId).join(', ')}.`,
    )
  }

  return { rows, transfers: settleUp(ledger.values()), problems }
}
