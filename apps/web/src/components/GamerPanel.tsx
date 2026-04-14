import type { CSSProperties, ReactNode } from 'react'
import type { Gamer } from '@fc26/shared'
import { defaultAvatar } from '../lib/avatars.js'
import { AvatarImage, IdentityLayout } from './entity-shared.jsx'

export function GamerAvatar({
  gamer,
  size = 44,
}: {
  gamer: Pick<Gamer, 'name' | 'avatarUrl'>
  size?: number
}) {
  return (
    <AvatarImage
      src={gamer.avatarUrl}
      fallbackSrc={defaultAvatar('gamer')}
      alt={`${gamer.name} avatar`}
      size={size}
      shape="circle"
    />
  )
}

export function GamerIdentity({
  gamer,
  subtitle,
  trailing,
  size = 44,
  nameStyle,
}: {
  gamer: Pick<Gamer, 'name' | 'avatarUrl'>
  subtitle?: string
  trailing?: ReactNode
  size?: number
  nameStyle?: CSSProperties
}) {
  return (
    <IdentityLayout
      avatar={<GamerAvatar gamer={gamer} size={size} />}
      title={gamer.name}
      subtitle={subtitle}
      trailing={trailing}
      nameStyle={nameStyle}
    />
  )
}
