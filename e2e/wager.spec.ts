import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/**
 * The wager journey, end to end: buy chips, back opposite sides, record the
 * result, read the ledger, settle the debt, find it in the history.
 *
 * Everything the room needs to *exist* is seeded through the API rather than
 * clicked, and everything about wagering is clicked rather than seeded. That
 * split is deliberate: game creation is covered thoroughly by the worker and
 * component suites, and driving it here would add a dozen fragile selectors to
 * a test whose subject is money. What no other suite can cover is the wiring —
 * whether the button calls the endpoint it claims to, whether the response
 * reaches the screen, whether the session cookie survives the round trip.
 *
 * Seeding runs on `page.request`, which shares a cookie jar with the page, so
 * the browser is genuinely authenticated as the session that created the room.
 */

interface Seed {
  roomId: string
  ann: string
  bob: string
  cy: string
  annName: string
  cyName: string
  nightId: string
  gameId: string
}

async function post(api: APIRequestContext, url: string, body?: unknown): Promise<unknown> {
  const res = await api.post(url, body === undefined ? {} : { data: body })
  if (!res.ok()) {
    throw new Error(`POST ${url} → ${res.status()} ${await res.text()}`)
  }
  return res.json()
}

/**
 * A room with three gamers, a night with no buy-in, and a live 1v1.
 *
 * The caller supplies the name because the worker rejects a duplicate with
 * 409, and a shared name means the second test never gets off the ground.
 */
async function seedRoom(api: APIRequestContext, name: string): Promise<Seed> {
  const room = (await post(api, '/api/rooms', { name })) as {
    room: { id: string }
  }
  const roomId = room.room.id

  // Plain names, deliberately: gamer names are unique per room since migration
  // 0014, so both tests seeding an "Ann" into their own room is the fix
  // working. Before it, the second room here could not have been built.
  const names = ['Ann', 'Bob', 'Cyd']
  const gamerIds: string[] = []
  for (const gamerName of names) {
    const created = (await post(api, `/api/rooms/${roomId}/gamers`, { name: gamerName })) as {
      gamer: { id: string }
    }
    gamerIds.push(created.gamer.id)
  }
  const [ann, bob, cy] = gamerIds as [string, string, string]
  const [annName, , cyName] = names as [string, string, string]

  // buyIn 0: chips must be bought in the UI, which is half of what this tests.
  const night = (await post(api, `/api/rooms/${roomId}/game-nights`, {
    activeGamerIds: [ann, bob, cy],
    buyIn: 0,
  })) as { gameNight: { id: string } }
  const nightId = night.gameNight.id

  // ann plays home, bob away, cy sits out — so cy may back either side.
  const game = (await post(api, `/api/rooms/${roomId}/game-nights/${nightId}/games`, {
    allocationMode: 'manual',
    homeGamerIds: [ann],
    awayGamerIds: [bob],
  })) as { currentGame: { id: string } }

  return { roomId, ann, bob, cy, annName, cyName, nightId, gameId: game.currentGame.id }
}

/** Opens the app already holding the seeded room, as a returning visit would. */
async function openRoom(page: Page, roomId: string): Promise<void> {
  await page.goto('./')
  await page.evaluate((id) => localStorage.setItem('fc26:last-room-id', id), roomId)
  await page.reload()
  await expect(page.getByRole('navigation', { name: /main navigation/i })).toBeVisible()
}

/**
 * Widens the Wager filter, which otherwise remembers a single gamer.
 *
 * The assertion is the point, not the selection. "Everyone" is `null`, and a
 * defaulting effect used to fire on exactly that and put a gamer straight
 * back — so the option looked selectable and silently was not. Checking the
 * value sticks is what catches that; checking the list below it does not,
 * because whichever gamer it snapped back to still has rows of their own.
 */
async function showEveryone(page: Page): Promise<void> {
  const filter = page.getByLabel(/show history for/i)
  await filter.selectOption('')
  await expect(filter).toHaveValue('')
}

async function gotoTab(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('navigation', { name: /main navigation/i }).getByRole('button', { name }).click()
}

async function buyChips(page: Page, gamerName: string, amount: number): Promise<void> {
  await page.getByLabel(/who's buying/i).selectOption({ label: gamerName })
  await page.getByLabel(/chips to buy/i).fill(String(amount))
  await page.getByRole('button', { name: /^buy chips$/i }).click()
  // The response repaints the balances; waiting on the name appearing in the
  // list is what proves the round trip landed rather than the click firing.
  await expect(
    page.getByRole('list', { name: /chip balances/i }).getByText(gamerName),
  ).toBeVisible()
}

async function placeBet(page: Page, gamerName: string, outcome: string, stake: number): Promise<void> {
  await page.getByLabel(/who's betting/i).selectOption({ label: gamerName })
  await page.getByRole('button', { name: new RegExp(`^${outcome}$`, 'i') }).click()
  await page.getByLabel(/^stake$/i).fill(String(stake))
  await page.getByRole('button', { name: /^place bet$/i }).click()
}

test.describe('wagering', () => {
  test('a debt is created by play, shown in the ledger, and cleared by settling', async ({
    page,
  }) => {
    const seed = await seedRoom(page.request, test.info().testId)
    await openRoom(page, seed.roomId)

    // --- chips have to be bought; nights hand out nothing ---
    await gotoTab(page, /^wager$/i)
    await buyChips(page, seed.annName, 100)
    await buyChips(page, seed.cyName, 100)

    const balances = page.getByRole('list', { name: /chip balances/i })
    await expect(balances).toContainText(seed.annName)
    await expect(balances).toContainText(seed.cyName)

    // --- back opposite sides, so somebody actually wins ---
    await gotoTab(page, /^game$/i)
    await placeBet(page, seed.annName, 'Home', 30)
    await placeBet(page, seed.cyName, 'Away', 40)

    // --- home wins: Ann takes the pot, Cyd is down her stake ---
    await page.getByRole('button', { name: /^home win$/i }).click()

    await gotoTab(page, /^wager$/i)
    await expect(page.getByText(new RegExp(`${seed.cyName} pays ${seed.annName} 40`, 'i'))).toBeVisible()

    // --- settle that one payment ---
    await page.getByRole('button', { name: /^paid$/i }).click()
    await expect(page.getByText(/nobody owes anybody/i)).toBeVisible()

    // --- and it is on the record, which is the point of the history ---
    await showEveryone(page)
    await page.getByRole('button', { name: /chip movements?/i }).click()
    const history = page.getByRole('list', { name: /chip movements/i })
    await expect(history).toContainText(`${seed.cyName} paid ${seed.annName} 40`)
    // Both purchases, which only "Everyone" shows: any single-gamer viewer
    // hides the other one, so this is what pins the filter actually widening.
    await expect(history).toContainText(`${seed.annName} bought 100 chips`)
    await expect(history).toContainText(`${seed.cyName} bought 100 chips`)
  })

  test('a gamer with no chips is told to buy some rather than shown a negative', async ({
    page,
  }) => {
    const seed = await seedRoom(page.request, test.info().testId)
    await openRoom(page, seed.roomId)

    // Nobody has bought anything, so every stake is unaffordable.
    await gotoTab(page, /^game$/i)
    await placeBet(page, seed.cyName, 'Away', 10)

    await expect(page.getByText(/is out of chips/i)).toBeVisible()
  })
})
