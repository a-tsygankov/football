import { randomInt } from 'node:crypto'
import { expect, test } from '@playwright/test'

test('stages and reverses availability and uses the selected sides in a match', async ({ page }) => {
  const response = await page.request.post('/api/rooms', { data: { name: 'Cards ' + Date.now().toString(36), pin: String(randomInt(10000)).padStart(4, '0') } })
  expect(response.ok()).toBeTruthy()
  const { room } = await response.json()
  const base = '/api/rooms/' + room.id
  for (const name of ['River', 'Robin', 'Riley']) {
    expect((await page.request.post(base + '/gamers', { data: { name } })).ok()).toBeTruthy()
  }
  expect((await page.request.post(base + '/game-nights', { data: { buyIn: 0 } })).ok()).toBeTruthy()
  await page.goto('./')
  await page.evaluate(id => localStorage.setItem('fc26:last-room-id', id), room.id)
  await page.reload()
  const toggle = page.getByRole('switch', { name: 'River availability' })
  const card = page.getByRole('article', { name: 'River', exact: true })
  let writes = 0
  page.on('request', request => { if (request.method() === 'PATCH' && request.url().includes('/gamers/')) writes++ })
  await toggle.click()
  await expect(card).toHaveAttribute('data-active', 'false')
  await expect(card.getByText(/Tap again to cancel/)).toBeVisible()
  await toggle.click()
  await page.waitForTimeout(2200)
  expect(writes).toBe(0)
  await toggle.click()
  await expect(toggle).toHaveCount(0)
  expect(writes).toBe(1)
  await page.getByRole('button', { name: /Inactive \(1\)/ }).click()
  await toggle.click()
  await expect(page.locator('#pro-inactive').getByRole('switch')).toBeChecked()
  await expect(page.locator('#pro-inactive').getByRole('switch')).toHaveCount(0)
  expect(writes).toBe(2)
  const group = page.getByRole('group', { name: 'Side for River' })
  await group.getByRole('button', { name: 'Home', exact: true }).click()
  const segments = page.getByRole('group', { name: 'Side for Robin' })
  const bench = segments.getByRole('button', { name: 'Not playing' })
  await bench.dispatchEvent('pointerdown', { clientX: 70, clientY: 50 })
  await bench.dispatchEvent('pointerup', { clientX: 120, clientY: 50 })
  await expect(segments.getByRole('button', { name: 'Away', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Create manual game' }).click()
  await expect(page.getByText('Finish game', { exact: true })).toBeVisible()
})
