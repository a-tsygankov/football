import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { Club, FcPlayer, Gamer } from '@fc26/shared'
import { defaultAvatar } from '../lib/avatars.js'

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

function IdentityLayout({
  avatar,
  title,
  subtitle,
  trailing,
  nameStyle,
}: {
  avatar: ReactNode
  title: string
  subtitle?: string
  trailing?: ReactNode
  nameStyle?: CSSProperties
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        minWidth: 0,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
        {avatar}
        <div style={{ minWidth: 0 }}>
          <strong
            style={{
              display: 'block',
              fontSize: 16,
              lineHeight: 1.2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              ...nameStyle,
            }}
          >
            {title}
          </strong>
          {subtitle ? (
            <span
              style={{
                display: 'block',
                marginTop: 2,
                fontSize: 13,
                opacity: 0.72,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {subtitle}
            </span>
          ) : null}
        </div>
      </div>
      {trailing ? <div style={{ flexShrink: 0 }}>{trailing}</div> : null}
    </div>
  )
}

function AvatarImage({
  src,
  fallbackSrc,
  alt,
  size,
  shape,
}: {
  src: string | null | undefined
  fallbackSrc: string
  alt: string
  size: number
  shape: 'circle' | 'rounded'
}) {
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    setBroken(false)
  }, [src])

  const resolvedSrc = !broken && src ? src : fallbackSrc

  return (
    <img
      src={resolvedSrc}
      alt={alt}
      width={size}
      height={size}
      onError={() => setBroken(true)}
      style={{
        width: size,
        height: size,
        objectFit: 'cover',
        flexShrink: 0,
        borderRadius: shape === 'circle' ? '50%' : Math.max(12, Math.round(size * 0.28)),
        border: '1px solid #bbf7d0',
        background: '#ffffff',
        boxShadow: '0 6px 16px rgba(5,46,22,0.08)',
      }}
    />
  )
}
