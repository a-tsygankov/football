import { useState } from 'react'
import { defaultAvatar, imageFileToAvatarDataUrl } from '../lib/avatars.js'
import { compactButtonStyle } from '../styles/controls.js'

export function AvatarPicker({
  kind,
  value,
  onChange,
  disabled,
  size = 72,
}: {
  kind: 'gamer' | 'room' | 'club' | 'fc_player'
  value: string | null
  onChange: (next: string | null) => void
  disabled?: boolean
  size?: number
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const preview = value ?? defaultAvatar(kind)

  async function handleFile(file: File | null): Promise<void> {
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const dataUrl = await imageFileToAvatarDataUrl(file)
      onChange(dataUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <img
        src={preview}
        alt="Avatar preview"
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          objectFit: 'cover',
          border: '1px solid #bbf7d0',
          background: '#ffffff',
        }}
      />
      <div style={{ display: 'grid', gap: 6, flex: 1, minWidth: 0 }}>
        <label
          style={{
            ...compactButtonStyle,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: disabled || busy ? 0.5 : 1,
            cursor: disabled || busy ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Processing…' : value ? 'Replace image' : 'Choose image'}
          <input
            type="file"
            accept="image/*"
            disabled={disabled || busy}
            onChange={(event) => {
              const file = event.target.files?.[0] ?? null
              void handleFile(file)
              event.target.value = ''
            }}
            style={{ display: 'none' }}
          />
        </label>
        {value ? (
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => onChange(null)}
            style={{ ...compactButtonStyle, background: '#fef2f2', color: '#991b1b' }}
          >
            Remove
          </button>
        ) : null}
        {error ? (
          <span style={{ fontSize: 12, color: '#991b1b' }}>{error}</span>
        ) : null}
      </div>
    </div>
  )
}
