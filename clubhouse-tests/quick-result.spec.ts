import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'

test('logs a finished match from a fresh room and remembers both sides', async ({ page }) => {
  const response = await page.request.post('/api/rooms', { data: {
    name: 'Quick ' + Date.now().toString(36), pin: String(randomInt(10000)).padStart(4, '0'),
  } })
  expect(response.ok()).toBeTruthy()
  const { room } = await response.json()
  for (const name of ['River', 'Robin']) {
    expect((await page.request.post('/api/rooms/' + room.id + '/gamers', { data: { name } })).ok()).toBeTruthy()
  }
  await page.goto('./?design=pro')
  await page.evaluate(id => localStorage.setItem('fc26:last-room-id', id), room.id)
  await page.reload()
  await page.getByRole('button', { name: 'Log result' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Swap sides' }).click()
  const home = await dialog.getByLabel('Home player 1').inputValue()
  const away = await dialog.getByLabel('Away player 1').inputValue()
  await dialog.getByLabel('Home final score').fill('3')
  await dialog.getByLabel('Away final score').fill('2')
  await dialog.getByRole('button', { name: 'Save result' }).click()
  await expect(page.getByText('Saved · 3–2')).toBeVisible()
  const history = await (await page.request.get('/api/rooms/' + room.id + '/match-history?scope=all')).json()
  expect(history.matches).toHaveLength(1)
  expect(history.matches[0]).toMatchObject({ result: 'home', home: { score: 3, gamerIds: [home] }, away: { score: 2, gamerIds: [away] } })
  await page.getByRole('button', { name: 'Log result' }).click()
  await expect(dialog.getByLabel('Home player 1')).toHaveValue(home)
  await expect(dialog.getByLabel('Away player 1')).toHaveValue(away)
})
