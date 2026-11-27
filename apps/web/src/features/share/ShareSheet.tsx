import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import {
  buildAppUrl,
  buildRoomInviteUrl,
  isValidRoomPin,
  readRoomPin,
  rememberRoomPin,
  shareLink,
  type ShareOutcome,
} from '../../lib/share.js'

export function ShareIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
    </svg>
  )
}

const OUTCOME_MESSAGE: Record<Exclude<ShareOutcome, 'shared' | 'cancelled'>, string> = {
  copied: 'Link copied',
  failed: 'Could not share or copy — long-press the link below to copy it.',
}

/**
 * The header's share button: invite someone into this room, or share the
 * app itself.
 *
 * A room invite carries the room ID and, for a locked room, the PIN, so the
 * recipient lands straight in the room. The PIN comes from this device's
 * memory of joining; a device that never typed it (a session restored from
 * an older build, say) is asked once and remembers it from then on.
 */
export function ShareSheet({ room }: { room: { id: string; name: string; hasPin: boolean } }) {
  const appUrl = buildAppUrl()
  const [pin, setPin] = useState('')
  const [pinKnown, setPinKnown] = useState(false)
  const [result, setResult] = useState<{ outcome: ShareOutcome; url: string } | null>(null)

  function onOpenChange(open: boolean): void {
    setResult(null)
    if (!open || !room.hasPin) return
    const remembered = readRoomPin(room.id)
    setPin(remembered ?? '')
    setPinKnown(remembered !== null)
  }

  const inviteReady = !room.hasPin || isValidRoomPin(pin)

  async function share(data: { title: string; text: string; url: string }): Promise<void> {
    setResult({ outcome: await shareLink(data), url: data.url })
  }

  function shareInvite(): void {
    if (!inviteReady) return
    if (room.hasPin && !pinKnown) {
      rememberRoomPin(room.id, pin)
      setPinKnown(true)
    }
    void share({
      title: `Join ${room.name}`,
      text: `Join ${room.name} on FC 26 Companion`,
      url: buildRoomInviteUrl(appUrl, room.id, room.hasPin ? pin : null),
    })
  }

  return (
    <Sheet onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label="Share"
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-transparent text-foreground/80 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ShareIcon />
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="pb-6">
        <SheetHeader>
          <SheetTitle>Share</SheetTitle>
          <SheetDescription>Send friends straight into {room.name}, or just the app.</SheetDescription>
        </SheetHeader>

        <div className="grid gap-3 px-5 py-2">
          {room.hasPin && !pinKnown ? (
            <label className="grid gap-1.5 text-sm">
              <span>Room PIN to include in the link</span>
              <input
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                placeholder="4 digits"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
          ) : null}

          <div className="grid gap-1.5">
            <Button disabled={!inviteReady} onClick={shareInvite}>
              Invite to this room
            </Button>
            <p className="m-0 text-xs text-muted-foreground">
              {room.hasPin
                ? 'The link includes the room PIN — anyone you send it to can join.'
                : 'Opens the room straight away — it has no PIN.'}
            </p>
          </div>

          <div className="grid gap-1.5">
            <Button
              variant="outline"
              onClick={() =>
                void share({
                  title: 'FC 26 Companion',
                  text: "Room control for tonight's football session",
                  url: appUrl,
                })
              }
            >
              Share app link
            </Button>
            <p className="m-0 text-xs text-muted-foreground">
              The app itself — they create or join a room from there.
            </p>
          </div>

          {result && (result.outcome === 'copied' || result.outcome === 'failed') ? (
            <div role="status" className="grid gap-1.5 rounded-md border border-border bg-secondary/60 p-3 text-sm">
              <span>{OUTCOME_MESSAGE[result.outcome]}</span>
              {result.outcome === 'failed' ? (
                <input
                  readOnly
                  value={result.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full rounded-sm border border-border bg-background px-2 py-1.5 text-xs"
                />
              ) : null}
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
