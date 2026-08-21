import { describe, expect, it } from 'vitest'
import type { BetsResponse, ChipLedgerEntry, ChipLedgerResponse } from '@fc26/shared'
import {
  buildTestApp,
  placeBet,
  recordResult,
  req,
  seedLiveGame,
  startNextGame,
  type LiveGameSeed,
} from './test-support.js'

/**
 * Betting on credit.
 *
 * Nothing refuses a bet for want of chips. This is a room of people who know
 * each other: what they want at the end of the night is "who pays whom", not a
 * refusal at the table, and buying in first is optional. Wagering only moves
 * chips between gamers, so a pot is always covered by the losers of that same
 * pot however little anybody bought — a gamer who never bought a chip and lost
 * 20 is at −20, which is a debt rather than a broken ledger.
 *
 * These tests seed nights with `buyIn: 0` deliberately. The shared helper
 * grants a stack by default, which would hide the very thing being checked.
 */

/** A room where nobody has bought a thing. */
async function creditRoom(app: ReturnType<typeof buildTestApp>): Promise<LiveGameSeed> {
  return seedLiveGame(app, { buyIn: 0 })
}

async function ledgerOf(
  app: ReturnType<typeof buildTestApp>,
  seed: LiveGameSeed,
): Promise<ChipLedgerResponse> {
  const res = await req(app, `/api/rooms/${seed.roomId}/chips-ledger`, {
    headers: { cookie: seed.cookie },
  })
  return (await res.json()) as ChipLedgerResponse
}

function entryFor(ledger: ChipLedgerResponse, gamerId: string): ChipLedgerEntry {
  const found = ledger.entries.find((item) => item.gamerId === gamerId)
  if (!found) throw new Error(`no ledger row for ${gamerId}`)
  return found
}

/** Ann backs herself, Cyd backs the draw, Ann's side wins. */
async function annBeatsCy(
  app: ReturnType<typeof buildTestApp>,
  seed: LiveGameSeed,
  stake: number,
): Promise<void> {
  await placeBet(app, seed, seed.ann, 'home', stake)
  await placeBet(app, seed, seed.cy, 'draw', stake)
  await recordResult(app, seed, { result: 'home', homeScore: 2, awayScore: 1 })
}

describe('betting on credit', () => {
  it('lets a gamer back a side with nothing in hand', async () => {
    const app = buildTestApp()
    const seed = await creditRoom(app)

    expect((await placeBet(app, seed, seed.cy, 'draw', 20)).status).toBe(201)
  })

  it('leaves the loser owing and the winner owed', async () => {
    const app = buildTestApp()
    const seed = await creditRoom(app)

    await annBeatsCy(app, seed, 20)
    const ledger = await ledgerOf(app, seed)

    // Cyd's 20 went to Ann: a real debt out of an empty room.
    expect(entryFor(ledger, seed.ann).balance).toBe(20)
    expect(entryFor(ledger, seed.cy).balance).toBe(-20)
  })

  it('keeps the room summing to zero however little was bought', async () => {
    const app = buildTestApp()
    const seed = await creditRoom(app)

    await annBeatsCy(app, seed, 35)
    const ledger = await ledgerOf(app, seed)

    // Somebody has to have moved, or summing to zero says nothing: an empty
    // ledger sums to zero too, and that is exactly what a room where every
    // bet was refused looks like.
    expect(ledger.entries.some((item) => item.net !== 0)).toBe(true)
    // The invariant the health check enforces in production: wagering moves
    // chips, it does not mint them, so a pot is covered by its own losers.
    expect(ledger.entries.reduce((sum, item) => sum + item.net, 0)).toBe(0)
  })

  it('names who pays whom after a night nobody bought into', async () => {
    const app = buildTestApp()
    const seed = await creditRoom(app)

    await annBeatsCy(app, seed, 20)

    expect((await ledgerOf(app, seed)).transfers).toEqual([
      { from: seed.cy, to: seed.ann, amount: 20 },
    ])
  })

  it('lets a gamer already in debt keep betting', async () => {
    const app = buildTestApp()
    const seed = await creditRoom(app)
    await annBeatsCy(app, seed, 20)

    // Down 20 and betting again is exactly the case a solvency check used to
    // refuse, and the one a night of this game actually runs on.
    const next = await startNextGame(app, seed)
    expect((await placeBet(app, next, seed.cy, 'draw', 50)).status).toBe(201)

    await recordResult(app, next, { result: 'draw', homeScore: 1, awayScore: 1 })
    // The draw was the only backed outcome, so Cyd's stake comes straight
    // back: still 20 down, no deeper.
    expect(entryFor(await ledgerOf(app, seed), seed.cy).balance).toBe(-20)
  })

  it('lets a gamer cover both sides on credit', async () => {
    const app = buildTestApp()
    const seed = await creditRoom(app)

    expect((await placeBet(app, seed, seed.cy, 'draw', 60)).status).toBe(201)
    const res = await placeBet(app, seed, seed.cy, 'home', 40)

    expect(res.status).toBe(201)
    const body = (await res.json()) as BetsResponse
    expect(body.bets).toHaveLength(2)
    // Both stakes are at risk at once — that is what hedging costs, and it is
    // no longer capped by a stack.
    expect(entryFor(await ledgerOf(app, seed), seed.cy).committed).toBe(100)
  })

  it('lets a top-up run past anything the gamer holds', async () => {
    const app = buildTestApp()
    const seed = await creditRoom(app)
    await placeBet(app, seed, seed.cy, 'draw', 60)

    const res = await placeBet(app, seed, seed.cy, 'draw', 50)

    expect(res.status).toBe(201)
    expect(((await res.json()) as BetsResponse).bets[0]!.stake).toBe(110)
  })

  it('still refuses a stake past the precision cap', async () => {
    const app = buildTestApp()
    const seed = await creditRoom(app)
    await placeBet(app, seed, seed.cy, 'draw', 1_000_000)

    // Credit is not unlimited: the cap that keeps stake × pot inside exact
    // integer range in settleWagers is the one ceiling still standing, and a
    // top-up must not walk past it.
    const res = await placeBet(app, seed, seed.cy, 'draw', 1)

    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: string }).error).toBe('stake_cap_exceeded')
  })

  it('holds a stake as committed until the game resolves', async () => {
    const app = buildTestApp()
    const seed = await creditRoom(app)
    await placeBet(app, seed, seed.cy, 'draw', 40)

    const before = entryFor(await ledgerOf(app, seed), seed.cy)
    // Nothing is won or lost yet, so it is at risk rather than gone: a bet
    // counted as both committed and settled would double a debt.
    expect(before).toMatchObject({ committed: 40, net: 0, balance: 0, available: -40 })

    await recordResult(app, seed, { result: 'draw', homeScore: 1, awayScore: 1 })

    const after = entryFor(await ledgerOf(app, seed), seed.cy)
    expect(after).toMatchObject({ committed: 0, net: 0 })
  })

  it('takes an interrupted game off the books entirely', async () => {
    const app = buildTestApp()
    const seed = await creditRoom(app)
    // Checked, because an empty book has nothing to owe either, and this test
    // is about the wash rather than about a bet that never landed.
    expect((await placeBet(app, seed, seed.cy, 'draw', 75)).status).toBe(201)

    await req(
      app,
      `/api/rooms/${seed.roomId}/game-nights/${seed.nightId}/games/${seed.gameId}/interrupt`,
      {
        method: 'POST',
        headers: { cookie: seed.cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ comment: 'power cut' }),
      },
    )

    // A wash costs nothing, so nobody owes anybody for a game that did not
    // happen.
    expect((await ledgerOf(app, seed)).transfers).toEqual([])
  })

  it('counts bought chips against what is owed', async () => {
    const app = buildTestApp()
    const seed = await creditRoom(app)
    await req(app, `/api/rooms/${seed.roomId}/chips/purchases`, {
      method: 'POST',
      headers: { cookie: seed.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ gamerId: seed.cy, amount: 100 }),
    })

    await annBeatsCy(app, seed, 20)
    const cyd = entryFor(await ledgerOf(app, seed), seed.cy)

    // Buying is still worth something: the stack absorbs the loss, so the
    // balance stays positive even though the debt is real.
    expect(cyd.balance).toBe(80)
    expect(cyd.net).toBe(-20)
  })
})
