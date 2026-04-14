import { describe, expect, it } from 'vitest'
import { afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import {
  ClubIdentity,
  FcPlayerIdentity,
  GamerIdentity,
  GamerTeamIdentity,
} from './EntityIdentity.jsx'

afterEach(() => {
  cleanup()
})

describe('EntityIdentity', () => {
  it('renders a gamer identity with a fallback avatar', () => {
    render(
      <GamerIdentity
        gamer={{ name: 'Alice', avatarUrl: null }}
        subtitle="Rating 5"
      />,
    )

    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Rating 5')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Alice avatar' })).toHaveAttribute(
      'src',
      expect.stringContaining('data:image/svg+xml'),
    )
  })

  it('renders a gamer team identity with overlapping member avatars', () => {
    render(
      <GamerTeamIdentity
        members={[
          { id: 'g1', name: 'Alice', avatarUrl: null },
          { id: 'g2', name: 'Bob', avatarUrl: null },
        ]}
        subtitle="#1"
      />,
    )

    expect(screen.getByText('Alice + Bob')).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Alice avatar' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Bob avatar' })).toBeInTheDocument()
  })

  it('renders a club identity using the club logo', () => {
    render(
      <ClubIdentity
        club={{
          name: 'Arsenal',
          logoUrl: 'https://example.com/arsenal.png',
          avatarUrl: null,
        }}
        subtitle="Premier League"
      />,
    )

    expect(screen.getByText('Arsenal')).toBeInTheDocument()
    expect(screen.getByText('Premier League')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Arsenal club logo' })).toHaveAttribute(
      'src',
      'https://example.com/arsenal.png',
    )
  })

  it('renders an FC player identity using the player image', () => {
    render(
      <FcPlayerIdentity
        player={{
          name: 'Bukayo Saka',
          avatarUrl: 'https://example.com/saka.png',
        }}
        subtitle="RW"
      />,
    )

    expect(screen.getByText('Bukayo Saka')).toBeInTheDocument()
    expect(screen.getByText('RW')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Bukayo Saka player avatar' })).toHaveAttribute(
      'src',
      'https://example.com/saka.png',
    )
  })
})
