/**
 * Prints the chip ledger of a production room, and fails if it does not add up.
 *
 * Reads the JSON that `wrangler d1 execute --json` writes: one result set per
 * statement, in the order the workflow asks for them — rooms, events, gamers,
 * open bets. Everything after that is `roomChipLedger`, the same fold the app
 * uses.
 *
 * That sharing is the whole point. The check used to reimplement the fold in
 * SQL and drifted twice in a single day, each time reporting something untrue
 * about production while looking perfectly healthy, because nothing made a
 * second copy fail when the first one moved.
 *
 * Reported per room, because that is what a ledger is. Folding every room into
 * one total keeps the sums-to-zero check honest but makes "settle up"
 * nonsense: it would tell somebody to pay a stranger they have never played.
 * The old SQL had the same flaw and nobody noticed, because production has one
 * room — which is exactly the kind of thing that stops being true quietly.
 *
 * Exits non-zero when the ledger is unsound. The old version only printed, so
 * a broken invariant scrolled past in a log nobody was reading — a check that
 * cannot fail is a check in name only.
 *
 *   wrangler d1 execute fc26 --remote --json --command "..." | tsx scripts/ledger-report.ts
 */
import { type GamerId, ledgerReport, parseEventRows } from '@fc26/shared'

interface ResultSet<Row> {
  results: Row[]
}

type RoomRow = { id: string; name: string }
type EventRow = {
  id: string
  room_id: string
  event_type: string
  payload: string
  occurred_at: number
}
type GamerRow = { id: string; room_id: string; name: string }
type BetRow = { room_id: string; gamer_id: string; stake: number }

function groupBy<T>(rows: ReadonlyArray<T>, key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const row of rows) {
    const bucket = out.get(key(row))
    if (bucket) bucket.push(row)
    else out.set(key(row), [row])
  }
  return out
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function pad(value: string | number, width: number): string {
  return String(value).padStart(width)
}

async function main(): Promise<void> {
  const raw = await readStdin()
  // wrangler prints a proxy notice on some machines before the JSON, so the
  // array is found rather than assumed to start at byte zero.
  const start = raw.indexOf('[')
  if (start === -1) throw new Error(`no JSON found in wrangler output:\n${raw.slice(0, 400)}`)

  const sets = JSON.parse(raw.slice(start)) as [
    ResultSet<RoomRow>,
    ResultSet<EventRow>,
    ResultSet<GamerRow>,
    ResultSet<BetRow>,
  ]
  const [rooms, events, gamers, bets] = sets

  const eventsByRoom = groupBy(events?.results ?? [], (row) => row.room_id)
  const gamersByRoom = groupBy(gamers?.results ?? [], (row) => row.room_id)
  const betsByRoom = groupBy(bets?.results ?? [], (row) => row.room_id)

  let unsound = 0
  for (const room of rooms?.results ?? []) {
    const report = ledgerReport({
      events: parseEventRows(eventsByRoom.get(room.id) ?? []),
      names: new Map(
        (gamersByRoom.get(room.id) ?? []).map((row) => [row.id as GamerId, row.name]),
      ),
      openBets: (betsByRoom.get(room.id) ?? []).map((row) => ({
        gamerId: row.gamer_id as GamerId,
        stake: row.stake,
      })),
    })

    console.log(`\n══ ${room.name} (${room.id})`)
    if (report.rows.length === 0) {
      console.log('  nobody has bought, won or lost a chip')
    } else {
      console.log(
        `  ${'name'.padEnd(16)}${pad('bought', 8)}${pad('wagered', 9)}${pad('settled', 9)}${pad('net', 7)}${pad('balance', 9)}`,
      )
      console.log(`  ${'-'.repeat(58)}`)
      for (const row of report.rows) {
        console.log(
          `  ${(row.name || `(${row.gamerId})`).padEnd(16)}${pad(row.bought, 8)}${pad(row.wagered, 9)}${pad(row.settled, 9)}${pad(row.net, 7)}${pad(row.balance, 9)}`,
        )
      }
    }

    if (report.transfers.length === 0) {
      console.log('  settle up: nobody owes anybody')
    } else {
      const nameOf = (id: GamerId): string =>
        report.rows.find((row) => row.gamerId === id)?.name || id
      for (const t of report.transfers) {
        console.log(`  settle up: ${nameOf(t.from)} pays ${nameOf(t.to)} ${t.amount}`)
      }
    }

    if (report.problems.length > 0) {
      unsound += 1
      console.error('  PROBLEMS')
      for (const problem of report.problems) console.error(`  - ${problem}`)
    }
  }

  if (unsound === 0) {
    console.log('\n  Every ledger adds up.\n')
    return
  }
  console.error(`\n  ${unsound} room(s) do not add up.\n`)
  process.exitCode = 1
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error))
  process.exitCode = 1
})
