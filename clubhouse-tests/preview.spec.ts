import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { mkdir } from 'node:fs/promises'

test('opens legacy design links in Pro and joins a shared room from two devices', async ({ page, browser, baseURL }) => {
  const name = 'Preview ' + Date.now().toString(36)
  const pin = String(randomInt(10000)).padStart(4, '0')
  await page.goto('./?design=social')
  await expect(page.getByRole('heading', { name: 'Clubhouse Pro' })).toBeVisible()
  await expect(page.getByLabel('Preview design')).toHaveCount(0)
  const input = page.getByPlaceholder('Friday FC')
  await input.fill(name)
  await page.getByPlaceholder('4 digits', { exact: true }).fill(pin)
  await page.getByRole('button', { name: 'Create room' }).click()
  await expect(page.getByRole('heading', { name })).toBeVisible()
  const desktop = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })
  try {
    const guest = await desktop.newPage()
    await guest.goto('./?design=pro')
    await guest.getByPlaceholder('Paste room id or type room name').fill(name)
    await guest.getByPlaceholder('4 digits if needed').fill(pin)
    await guest.getByRole('button', { name: 'Join room' }).click()
    await expect(guest.getByRole('heading', { name })).toBeVisible()
    const roomId = await page.evaluate(() => localStorage.getItem('fc26:last-room-id'))
    const result = await page.request.post('/api/rooms/' + roomId + '/gamers', { data: { name: 'Riley' } })
    expect(result.ok()).toBeTruthy()
    await guest.reload()
    await guest.getByRole('button', { name: 'Roster', exact: true }).click()
    await expect(guest.getByText('Riley', { exact: true }).first()).toBeVisible()
    await mkdir('docs/clubhouse-images', { recursive: true })
    for (const [size, device] of [['desktop', guest], ['mobile', page]] as const) {
      await device.goto('./')
      await expect(device.getByRole('heading', { name })).toBeVisible()
      await device.screenshot({ path: 'docs/clubhouse-images/pro-' + size + '.png' })
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  } finally {
    await desktop.close()
  }
})
