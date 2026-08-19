import { useEffect, useRef, useState } from 'react'
import {
  type Gamer,
  NAME_STEM_MIN_LENGTH,
  type RoomBootstrapResponse,
  type UpdateGamerRequest,
  isValidNameStem,
  normalizeNameStem,
} from '@fc26/shared'
import { LazyMotion, domAnimation, m, useReducedMotion } from 'motion/react'
import { useDebugConsole } from '../../debug/console-store.js'
import { AvatarPicker } from '../../components/AvatarPicker.jsx'
import { GamerIdentity } from '../../components/GamerPanel.jsx'
import { Field } from '../../components/Field.jsx'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { inputStyle } from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'
import { getRosterStatusDot } from '../../utils/roster.js'
import { AddGamerPanel } from './AddGamerPanel.jsx'

export function RosterPanel({
  bootstrap,
  busy,
  activeGameNightGamerIds,
  currentGameGamerIds,
  onToggleGamer,
  onUpdateGamerDetails,
  gamerName,
  gamerRating,
  gamerPin,
  gamerAvatarUrl,
  onChangeGamerName,
  onChangeGamerPin,
  onChangeGamerRating,
  onChangeGamerAvatar,
  onCreateGamer,
}: {
  bootstrap: RoomBootstrapResponse
  busy: BusyState
  activeGameNightGamerIds: ReadonlySet<string>
  currentGameGamerIds: ReadonlySet<string>
  onToggleGamer: (gamer: Gamer) => Promise<void>
  onUpdateGamerDetails: (gamerId: string, request: UpdateGamerRequest) => Promise<void>
  gamerName: string
  gamerRating: string
  gamerPin: string
  gamerAvatarUrl: string | null
  onChangeGamerName: (value: string) => void
  onChangeGamerPin: (value: string) => void
  onChangeGamerRating: (value: string) => void
  onChangeGamerAvatar: (value: string | null) => void
  onCreateGamer: () => Promise<void>
}) {
  // Add-gamer UI is collapsed by default; the trigger button at the top of
  // the panel expands it on demand and auto-collapses after a successful
  // create so casual gamers don't see the form unless they want it.
  const [addingGamer, setAddingGamer] = useState(false)
  const [editingGamerId, setEditingGamerId] = useState<string | null>(null)
  const reduced = useReducedMotion()
  const [editingName, setEditingName] = useState('')
  const [editingRating, setEditingRating] = useState('3')
  const [editingAvatarUrl, setEditingAvatarUrl] = useState<string | null>(null)
  const [editingCurrentPin, setEditingCurrentPin] = useState('')
  const [editingNextPin, setEditingNextPin] = useState('')
  // Room admins (anyone who has unlocked the hidden Settings panel via the
  // triple-tap console) can edit PIN-protected gamers without entering the
  // current PIN. The same flag flips the corresponding server-side check
  // in `updateGamer` (see worker/src/routes/rooms.ts).
  const settingsUnlocked = useDebugConsole((s) => s.everOpened)

  function startEditingGamer(gamer: Gamer): void {
    setEditingGamerId(gamer.id)
    setEditingName(gamer.name)
    setEditingRating(String(gamer.rating))
    setEditingAvatarUrl(gamer.avatarUrl)
    setEditingCurrentPin('')
    setEditingNextPin('')
  }

  async function saveGamerDetails(): Promise<void> {
    if (!editingGamerId) return
    const normalized = normalizeNameStem(editingName)
    if (!isValidNameStem(editingName)) return
    if (
      bootstrap.gamers.some(
        (gamer) => gamer.id !== editingGamerId && normalizeNameStem(gamer.name) === normalized,
      )
    ) {
      return
    }
    if (editingCurrentPin.trim().length > 0 && !/^\d{4}$/.test(editingCurrentPin.trim())) {
      return
    }
    if (editingNextPin.trim().length > 0 && !/^\d{4}$/.test(editingNextPin.trim())) {
      return
    }

    await onUpdateGamerDetails(editingGamerId, {
      name: editingName.trim(),
      rating: Number.parseInt(editingRating, 10),
      avatarUrl: editingAvatarUrl,
      currentPin: editingCurrentPin.trim() || null,
      pin: editingNextPin.trim() || null,
      // When Settings is unlocked the admin doesn't need to know the PIN —
      // the server honors `bypassPin` for any room-session caller.
      ...(settingsUnlocked ? { bypassPin: true } : {}),
    })
    setEditingGamerId(null)
    setEditingCurrentPin('')
    setEditingNextPin('')
  }

  // Close the add sheet when the roster actually grows. The previous
  // heuristic compared `bootstrap.gamers.length` and `gamerName` from inside
  // the submit handler, but both are props captured at render, so neither had
  // updated by the time it read them — the form simply never closed itself.
  // Inline that was invisible; as a modal sheet it traps you behind it.
  const gamerCount = bootstrap.gamers.length
  const countAtSubmit = useRef<number | null>(null)
  useEffect(() => {
    if (countAtSubmit.current !== null && gamerCount > countAtSubmit.current) {
      countAtSubmit.current = null
      setAddingGamer(false)
    }
  }, [gamerCount])

  async function handleCreateGamer(): Promise<void> {
    countAtSubmit.current = bootstrap.gamers.length
    await onCreateGamer()
  }

  const editingGamer = bootstrap.gamers.find((gamer) => gamer.id === editingGamerId) ?? null
  const nameTaken =
    editingGamer !== null &&
    bootstrap.gamers.some(
      (item) =>
        item.id !== editingGamer.id &&
        normalizeNameStem(item.name) === normalizeNameStem(editingName),
    )

  return (
    <LazyMotion features={domAnimation} strict>
      <section style={{ marginTop: 18 }}>
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div className="grid gap-2">
              <CardTitle>Roster</CardTitle>
              <CardDescription>
                {bootstrap.gamers.length} gamer{bootstrap.gamers.length === 1 ? '' : 's'} · dots
                show who is playing now, who is sitting out, and who is inactive.
              </CardDescription>
            </div>
            {/* The add form used to expand inline and shove the whole list
                down. In a sheet it covers the list instead of moving it. */}
            <Sheet open={addingGamer} onOpenChange={setAddingGamer}>
              <SheetTrigger asChild>
                <Button size="sm" disabled={busy !== null}>
                  + Add gamer
                </Button>
              </SheetTrigger>
              <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto pb-6">
                <SheetHeader>
                  <SheetTitle>Add gamer</SheetTitle>
                  <SheetDescription>
                    Ratings feed the balanced draw. A PIN is optional and protects edits.
                  </SheetDescription>
                </SheetHeader>
                <div className="px-5 pb-2">
                  <AddGamerPanel
                    bootstrap={bootstrap}
                    busy={busy}
                    gamerName={gamerName}
                    gamerRating={gamerRating}
                    gamerPin={gamerPin}
                    gamerAvatarUrl={gamerAvatarUrl}
                    onChangeGamerName={onChangeGamerName}
                    onChangeGamerPin={onChangeGamerPin}
                    onChangeGamerRating={onChangeGamerRating}
                    onChangeGamerAvatar={onChangeGamerAvatar}
                    onCreateGamer={handleCreateGamer}
                  />
                </div>
              </SheetContent>
            </Sheet>
          </CardHeader>

          <CardContent>
            {bootstrap.gamers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[#86efac] bg-secondary p-4 text-sm">
                No gamers yet. Add the first one with the button above.
              </div>
            ) : (
              <ul className="m-0 grid list-none gap-1.5 p-0">
                {bootstrap.gamers.map((gamer, index) => {
                  const statusDot = getRosterStatusDot({
                    gamer,
                    activeGameNightGamerIds,
                    currentGameGamerIds,
                    hasCurrentGame: bootstrap.currentGame !== null,
                  })
                  return (
                    <m.li
                      key={gamer.id}
                      initial={{ opacity: 0, y: reduced ? 0 : 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.24,
                        delay: Math.min(index, 8) * 0.04,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      // min-w-0 matters: these are grid items, and a grid
                      // item's default min-width:auto refuses to shrink below
                      // its content, so a long name widens the whole page.
                      className={`flex min-w-0 items-center gap-3 overflow-hidden rounded-lg border p-2.5 ${
                        gamer.active ? 'border-input bg-white' : 'border-[#cbd5e1] bg-[#f8fafc]'
                      }`}
                    >
                      <div className="min-w-0 grow overflow-hidden">
                        <GamerIdentity
                          gamer={gamer}
                          size={38}
                          subtitle={`Rating ${gamer.rating}${gamer.hasPin ? ' · PIN' : ''}`}
                          // A long name must clip, not shove the row's actions
                          // out past the card edge.
                          nameStyle={{
                            fontSize: 16,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        />
                      </div>
                      <span
                        aria-label={statusDot.ariaLabel}
                        className="size-2.5 shrink-0 rounded-full"
                        style={{
                          background: statusDot.background,
                          border: statusDot.border,
                          boxShadow: statusDot.boxShadow,
                        }}
                      />
                      {/* Two actions, so they stay visible. An overflow menu
                          would trade a tap for nothing. */}
                      <Button
                        size="sm"
                        variant={gamer.active ? 'outline' : 'default'}
                        disabled={busy !== null}
                        onClick={() => void onToggleGamer(gamer)}
                      >
                        {busy === 'updating-gamer'
                          ? 'Saving...'
                          : gamer.active
                            ? 'Inactive'
                            : 'Reactivate'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy !== null}
                        onClick={() => startEditingGamer(gamer)}
                      >
                        Edit
                      </Button>
                    </m.li>
                  )
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* One sheet for whichever gamer is being edited, rather than a form
            unfolding inside a row and pushing everything below it around. */}
        <Sheet
          open={editingGamer !== null}
          onOpenChange={(open) => {
            if (!open) setEditingGamerId(null)
          }}
        >
          <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto pb-6">
            {editingGamer ? (
              <>
                <SheetHeader>
                  <SheetTitle>Edit {editingGamer.name}</SheetTitle>
                  <SheetDescription>
                    Changes apply to the whole room, including past results.
                  </SheetDescription>
                </SheetHeader>
                <div className="grid gap-2.5 px-5 pb-2">
                  <Field label="Avatar">
                    <AvatarPicker
                      kind="gamer"
                      value={editingAvatarUrl}
                      onChange={setEditingAvatarUrl}
                      disabled={busy !== null}
                    />
                  </Field>
                  <Field label="Name">
                    <input
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      style={inputStyle}
                    />
                  </Field>
                  <Field label="Rating">
                    <select
                      value={editingRating}
                      onChange={(event) => setEditingRating(event.target.value)}
                      style={inputStyle}
                    >
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {editingGamer.hasPin && !settingsUnlocked ? (
                    <Field label="Current PIN">
                      <input
                        value={editingCurrentPin}
                        onChange={(event) => setEditingCurrentPin(event.target.value)}
                        inputMode="numeric"
                        maxLength={4}
                        placeholder="Current 4-digit PIN"
                        style={inputStyle}
                      />
                    </Field>
                  ) : null}
                  {editingGamer.hasPin && settingsUnlocked ? (
                    <InlineNotice
                      tone="info"
                      message="Settings unlocked: this PIN-protected gamer can be edited without entering the current PIN."
                    />
                  ) : null}
                  <Field label={editingGamer.hasPin ? 'New PIN (leave blank to clear)' : 'Set PIN'}>
                    <input
                      value={editingNextPin}
                      onChange={(event) => setEditingNextPin(event.target.value)}
                      inputMode="numeric"
                      maxLength={4}
                      placeholder={
                        editingGamer.hasPin ? 'Blank clears PIN' : 'Optional 4-digit PIN'
                      }
                      style={inputStyle}
                    />
                  </Field>
                  {!isValidNameStem(editingName) && editingName.trim().length > 0 ? (
                    <InlineNotice
                      tone="warn"
                      message={`Gamer name must contain at least ${NAME_STEM_MIN_LENGTH} letters or digits.`}
                    />
                  ) : null}
                  {nameTaken ? (
                    <InlineNotice tone="warn" message="That gamer name stem is already taken." />
                  ) : null}
                  {editingCurrentPin.trim().length > 0 &&
                  !/^\d{4}$/.test(editingCurrentPin.trim()) ? (
                    <InlineNotice tone="warn" message="Current PIN must be exactly 4 digits." />
                  ) : null}
                  {editingNextPin.trim().length > 0 && !/^\d{4}$/.test(editingNextPin.trim()) ? (
                    <InlineNotice tone="warn" message="New PIN must be exactly 4 digits." />
                  ) : null}
                  <div className="mt-1 flex gap-2">
                    <Button
                      disabled={busy !== null}
                      onClick={() => void saveGamerDetails()}
                      className="grow"
                    >
                      {busy === 'updating-gamer' ? 'Saving...' : 'Save gamer'}
                    </Button>
                    <SheetClose asChild>
                      <Button variant="secondary" disabled={busy !== null}>
                        Cancel
                      </Button>
                    </SheetClose>
                  </div>
                </div>
              </>
            ) : null}
          </SheetContent>
        </Sheet>
      </section>
    </LazyMotion>
  )
}
