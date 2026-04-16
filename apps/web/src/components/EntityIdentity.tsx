import type { CSSProperties, ReactNode } from 'react'
import type { FcPlayer } from '@fc26/shared'
import { defaultAvatar } from '../lib/avatars.js'
import { AvatarImage, IdentityLayout } from './entity-shared.jsx'
export { GamerAvatar, GamerIdentity } from './GamerPanel.jsx'
export { GamerTeamAvatar, GamerTeamIdentity } from './GamerTeamPanel.jsx'
export { ClubAvatar, ClubIdentity } from './FcClubPanel.jsx'

export function FcPlayerAvatar({
  player,
  size = 44,
}: {
  player: Pick<FcPlayer, 'name' | 'avatarUrl'>
  size?: number
}) {
  return (
    <AvatarImage
      src={player.avatarUrl}
      fallbackSrc={defaultAvatar('fc_player')}
      alt={`${player.name} player avatar`}
      size={size}
      shape="circle"
    />
  )
}

export function FcPlayerIdentity({
  player,
  subtitle,
  trailing,
  size = 44,
  nameStyle,
}: {
  player: Pick<FcPlayer, 'name' | 'avatarUrl'>
  subtitle?: string
  trailing?: ReactNode
  size?: number
  nameStyle?: CSSProperties
}) {
  return (
    <IdentityLayout
      avatar={<FcPlayerAvatar player={player} size={size} />}
      title={player.name}
      subtitle={subtitle}
      trailing={trailing}
      nameStyle={nameStyle}
    />
  )
}
