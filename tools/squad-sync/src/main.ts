const DEFAULT_BASE_URL = 'http://localhost:8787'
const SECRET_HEADER = 'x-squad-sync-secret'

async function main(): Promise<void> {
  const baseUrl = process.env.FC26_SYNC_BASE_URL?.trim() || DEFAULT_BASE_URL
  const secret = process.env.FC26_SYNC_SECRET?.trim()
  if (!secret) {
    throw new Error('FC26_SYNC_SECRET is required')
  }

  const response = await fetch(`${baseUrl}/api/internal/squads/sync`, {
    method: 'POST',
    headers: {
      [SECRET_HEADER]: secret,
    },
  })

  const body = await response.text()
  if (!response.ok) {
    throw new Error(`sync failed (${response.status}): ${body}`)
  }

  // eslint-disable-next-line no-console
  console.log(body)
}

void main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
