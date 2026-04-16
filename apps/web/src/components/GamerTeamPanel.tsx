import type { CSSProperties, ReactNode } from 'react'
import type { Gamer } from '@fc26/shared'
import { defaultAvatar } from '../lib/avatars.js'
import { GamerAvatar } from './GamerPanel.jsx'
import { AvatarImage, IdentityLayout } from './entity-shared.jsx'

export function GamerTeamAvatar({
  members,
  size = 44,
}: {
  members: ReadonlyArray<Pick<Gamer, 'id' | 'name' | 'avatarUrl'>>
  size?: number
}) {
  const visibleMembers = members.slice(0, 2)
  const childSize = visibleMembers.length > 1 ? Math.max(24, Math.round(size * 0.78)) : size
  const offset = visibleMembers.length > 1 ? Math.max(6, Math.round(size * 0.22)) : 0
  const frameSize = childSize + offset

  return (
    <div
      aria-label={`${members.map((member) => member.name).join(' + ') || 'Gamer team'} avatar`}
      style={{
        position: 'relative',
        width: frameSize,
        height: frameSize,
        flexShrink: 0,
      }}
    >
      {visibleMembers.length === 0 ? (
        <div style={{ position: 'absolute', inset: 0 }}>
          <AvatarImage
            src={null}
            fallbackSrc={defaultAvatar('gamer')}
            alt="Gamer team avatar"
            size={childSize}
            shape="circle"
          />
        </div>
      ) : (
        visibleMembers.map((member, index) => (
          <div
            key={member.id}
            style={{
              position: 'absolute',
              top: index === 0 ? 0 : offset,
              left: index === 0 ? 0 : offset,
              zIndex: index + 1,
            }}
          >
            <GamerAvatar gamer={member} size={childSize} />
          </div>
        ))
      )}
    </div>
  )
}

export function GamerTeamIdentity({
  members,
  subtitle,
  trailing,
  size = 44,
  nameStyle,
}: {
  members: ReadonlyArray<Pick<Gamer, 'id' | 'name' | 'avatarUrl'>>
  subtitle?: string
  trailing?: ReactNode
  size?: number
  nameStyle?: CSSProperties
}) {
  return (
    <IdentityLayout
      avatar={<GamerTeamAvatar members={members} size={size} />}
      title={members.map((member) => member.name).join(' + ') || 'Gamer team'}
      subtitle={subtitle}
      trailing={trailing}
      nameStyle={nameStyle}
    />
  )
}
