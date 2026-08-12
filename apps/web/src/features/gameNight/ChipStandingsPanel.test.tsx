import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GamerId, RoomId, type Gamer } from '@fc26/shared'
import { ChipStandingsPanel } from './ChipStandingsPanel.jsx'

const ann = GamerId('ann')
const bob = GamerId('bob')

function gamer(id: ReturnType<typeof GamerId>, name: string): Gamer {
  return {
    id,
    roomId: RoomId('room-1'),
    name,
    rating: 3,
    active: true,
    hasPin: false,
    avatarUrl: null,
    createdAt: 1,
    updatedAt: 1,
  }
}

describe('ChipStandingsPanel', () => {
  afterEach(cleanup)

  it('renders each gamer net position', () => {
    render(
      <ChipStandingsPanel
        gamers={[gamer(ann, 'Ann'), gamer(bob, 'Bob')]}
        positions={[
          { gamerId: ann, net: 50 },
          { gamerId: bob, net: -50 },
        ]}
        lastGameDeltas={[]}
      />,
    )

    expect(screen.getByText('Ann')).toBeInTheDocument()
    expect(screen.getByText('+50')).toBeInTheDocument()
    expect(screen.getByText('-50')).toBeInTheDocument()
  })

  it('shows the delta from the game just settled', () => {
    render(
      <ChipStandingsPanel
        gamers={[gamer(ann, 'Ann')]}
        positions={[{ gamerId: ann, net: 50 }]}
        lastGameDeltas={[{ gamerId: ann, net: 20 }]}
      />,
    )

    expect(screen.getByText(/\+20 last game/i)).toBeInTheDocument()
  })

  it('renders nothing when no chips have moved', () => {
    const { container } = render(
      <ChipStandingsPanel gamers={[gamer(ann, 'Ann')]} positions={[]} lastGameDeltas={[]} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
