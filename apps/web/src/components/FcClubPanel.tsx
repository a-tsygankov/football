import type { CSSProperties, ReactNode } from 'react'
import type { Club } from '@fc26/shared'
import { defaultAvatar } from '../lib/avatars.js'
import { AvatarImage, IdentityLayout } from './entity-shared.jsx'

export function ClubAvatar({
  club,
  size = 44,
}: {
  club: Pick<Club, 'name' | 'logoUrl' | 'avatarUrl'>
  size?: number
}) {
  return (
    <AvatarImage
      src={club.logoUrl || club.avatarUrl}
      fallbackSrc={defaultAvatar('club')}
      alt={`${club.name} club logo`}
      size={size}
      shape="rounded"
    />
  )
}

export function ClubIdentity({
  club,
  subtitle,
  trailing,
  size = 44,
  nameStyle,
}: {
  club: Pick<Club, 'name' | 'logoUrl' | 'avatarUrl'>
  subtitle?: string
  trailing?: ReactNode
  size?: number
  nameStyle?: CSSProperties
}) {
  return (
    <IdentityLayout
      avatar={<ClubAvatar club={club} size={size} />}
      title={club.name}
      subtitle={subtitle}
      trailing={trailing}
      nameStyle={nameStyle}
    />
  )
}
