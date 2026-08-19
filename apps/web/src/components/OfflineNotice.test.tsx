import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { OfflineNotice } from './OfflineNotice.jsx'

afterEach(cleanup)

describe('OfflineNotice', () => {
  it('says the app is offline', () => {
    render(<OfflineNotice />)

    expect(screen.getByRole('status')).toHaveTextContent(/offline/i)
  })

  it('explains that the room cannot be reached, so a white screen is never the answer', () => {
    // The whole point of the precached shell: something legible renders,
    // and it says why nothing is loading.
    render(<OfflineNotice />)

    expect(screen.getByRole('status')).toHaveTextContent(/reconnect/i)
  })
})
