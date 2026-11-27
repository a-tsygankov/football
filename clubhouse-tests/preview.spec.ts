import { expect, test } from '@playwright/test'
import { randomInt } from 'node:crypto'
import { mkdir } from 'node:fs/promises'

test('switches designs with a draft and joins a shared room from two devices', async ({ page, browser, baseURL }) => {
  const name = 'Preview ' + Date.now().toString(36)
  const pin = String(randomInt(10000)).padStart(4, '0')
  await page.goto('./?design=pro')
  const input = page.getByPlaceholder('Friday FC')
  await input.fill(name)
  await page.getByRole('tab', { name: 'Social Club' }).click()
  await expect(input).toHaveValue(name)
  await page.getByText('Matchday', { exact: true }).last().click()
  await expect(page).toHaveURL(/design=matchday/)
  await expect(input).toHaveValue(name)
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
    for (const [design, device] of [['pro', guest], ['social', page], ['matchday', page]] as const) {
      await device.goto('./?design=' + design)
      await expect(device.getByRole('heading', { name })).toBeVisible()
      await device.screenshot({ path: 'docs/clubhouse-images/' + design + '.png' })
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  } finally {
    await desktop.close()
  }
})
