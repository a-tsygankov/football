import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QuickResult } from './QuickResult.jsx'

const apiJson = vi.hoisted(() => vi.fn())
vi.mock('../lib/api', () => ({ apiJson }))
vi.mock('../lib/image.js', () => ({ scaleImageForAnalysis: vi.fn(async () => 'data:image/jpeg;base64,AAAA') }))

const room = {
  room: { id: 'room-1' },
  gamers: [
    { id: 'ann', name: 'Ann', active: true },
    { id: 'bob', name: 'Bob', active: true },
  ],
  activeGameNight: { id: 'night-1' },
  activeGameNightGamers: [{ gamerId: 'ann' }, { gamerId: 'bob' }],
  currentGame: null,
}
const game = { id: 'game-1', homeGamerIds: ['ann'], awayGamerIds: ['bob'] }

/** Answers each endpoint the dialog calls; `analysis` is the picture reader's reply. */
function serve(analysis: () => unknown) {
  apiJson.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (url.endsWith('/bootstrap')) return room
    if (url.includes('/match-history')) return { matches: [] }
    if (url.endsWith('/analyse-photo')) return analysis()
    if (url.endsWith('/result')) return {}
    if (url.endsWith('/games') && init?.method === 'POST') return { currentGame: game }
    throw new Error('Unexpected request ' + url)
  })
}

function calls(suffix: string) {
  return apiJson.mock.calls.filter(([url]) => String(url).endsWith(suffix))
}

async function openWithPicture(label: 'Take photo' | 'Choose picture') {
  render(<QuickResult roomId="room-1" reload={vi.fn(async () => {})} />)
  fireEvent.click(screen.getByRole('button', { name: /log result/i }))
  await screen.findByLabelText('Home final score')
  const picture = new File(['tv'], 'tv.jpg', { type: 'image/jpeg' })
  fireEvent.change(screen.getByLabelText(label), { target: { files: [picture] } })
}

describe('QuickResult picture reading', () => {
  // Braces matter: a function returned from beforeEach is run as its cleanup.
  beforeEach(() => { apiJson.mockReset() })
  afterEach(cleanup)

  it('offers both the camera and an existing picture', async () => {
    serve(() => ({}))
    render(<QuickResult roomId="room-1" reload={vi.fn(async () => {})} />)
    fireEvent.click(screen.getByRole('button', { name: /log result/i }))
    await screen.findByLabelText('Home final score')

    expect(screen.getByLabelText('Take photo')).toHaveAttribute('capture', 'environment')
    expect(screen.getByLabelText('Choose picture')).not.toHaveAttribute('capture')
  })

  it('starts the match, fills in the score it read, and saves it as read from a picture', async () => {
    serve(() => ({ homeScore: 3, awayScore: 1, model: 'gemini-test', error: null }))
    await openWithPicture('Choose picture')

    await waitFor(() => expect(screen.getByLabelText('Home final score')).toHaveValue('3'))
    expect(screen.getByLabelText('Away final score')).toHaveValue('1')
    expect(calls('/games')).toHaveLength(1)
    expect(screen.getByText(/Read 3–1 from the picture/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save result' }))
    await waitFor(() => expect(calls('/result')).toHaveLength(1))
    expect(JSON.parse(calls('/result')[0]![1].body)).toEqual({
      homeScore: 3, awayScore: 1, result: 'home', entryMethod: 'ocr', ocrModel: 'gemini-test',
    })
    // The match the picture was read against is the one that gets the result.
    expect(calls('/games')).toHaveLength(1)
  })

  it('drops the picture credit once the score is corrected by hand', async () => {
    serve(() => ({ homeScore: 3, awayScore: 1, model: 'gemini-test', error: null }))
    await openWithPicture('Take photo')
    await waitFor(() => expect(screen.getByLabelText('Home final score')).toHaveValue('3'))

    fireEvent.change(screen.getByLabelText('Home final score'), { target: { value: '4' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save result' }))

    await waitFor(() => expect(calls('/result')).toHaveLength(1))
    expect(JSON.parse(calls('/result')[0]![1].body)).toEqual({ homeScore: 4, awayScore: 1, result: 'home' })
  })

  it('says so and leaves the score to be typed when the picture cannot be read', async () => {
    serve(() => { throw new Error('gemini_not_configured') })
    await openWithPicture('Choose picture')

    expect(await screen.findByText(/Picture reading is not set up on this server.*The match is live now\./)).toBeInTheDocument()
    expect(screen.getByLabelText('Home final score')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Save result' })).toBeDisabled()
  })
})
