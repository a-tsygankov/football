import { useMemo, useState } from 'react'
import { LazyMotion, domAnimation, m, useReducedMotion } from 'motion/react'
import {
  type ChipLedgerResponse,
  type Gamer,
  type GamerId,
  roomSettlement,
  settlementText,
} from '@fc26/shared'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InlineNotice } from '../../components/InlineNotice.jsx'

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

function toneOf(value: number): string {
  return value > 0 ? 'text-[#15803d]' : value < 0 ? 'text-destructive' : 'text-[#475569]'
}

/**
 * What it would take to close the room out in real money.
 *
 * Read-only by design: it writes nothing, and the room's chips are unchanged
 * by anyone looking at this. Settling up happens at the table with cash or a
 * bank transfer — the app's job is only to say who hands what to whom, and to
 * say it the same way on every phone reading it.
 *
 * The settlement is computed here from `ledger.entries` rather than taken from
 * `ledger.transfers`, even though the server sends one. Same pure function
 * either way, but deriving it client-side means the list on screen always
 * matches the balances printed directly above it, instead of trailing them by
 * however long ago the ledger was fetched.
 *
 * It stays collapsed until asked for. This is an end-of-night action, and the
 * running balances are what people open the Wager page to read.
 */
export function SettleUpPanel({
  gamers,
  ledger,
  liveGame,
}: {
  gamers: ReadonlyArray<Gamer>
  ledger: ChipLedgerResponse | null
  /** A game is on. Whatever it settles to is not in these numbers yet. */
  liveGame: boolean
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const reduced = useReducedMotion()

  function nameOf(gamerId: GamerId): string {
    return gamers.find((gamer) => gamer.id === gamerId)?.name ?? 'Unknown'
  }

  const settlement = useMemo(() => roomSettlement(ledger?.entries ?? []), [ledger])
  const rise = reduced ? 0 : 8

  async function share(): Promise<void> {
    const text = settlementText(settlement, nameOf)
    // `navigator.share` is the native sheet on a phone, which is where this
    // gets used; the clipboard is the desktop fallback. A cancelled share
    // rejects, and cancelling is not an error worth reporting.
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Settle up', text })
      } catch {
        /* dismissed */
      }
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      /* no clipboard permission — nothing useful to say about it */
    }
  }

  if (settlement.standings.length === 0) {
    return (
      <Card className="mt-[18px]">
        <CardHeader>
          <CardTitle>Settle up</CardTitle>
          <CardDescription>Who pays whom when the room closes out.</CardDescription>
        </CardHeader>
        <CardContent>
          <InlineNotice
            tone="info"
            message="Nothing to settle yet — nobody has bought chips or placed a bet."
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <LazyMotion features={domAnimation} strict>
      <Card className="mt-[18px]">
        <CardHeader>
          <CardTitle>Settle up</CardTitle>
          <CardDescription>Who pays whom when the room closes out.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Button
            type="button"
            variant={open ? 'outline' : 'default'}
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
          >
            Close out the room
          </Button>

          {open ? (
            <div className="grid gap-4">
              {/* Named the omission rather than quietly under-reporting it: an
                  unresolved bet is neither won nor lost, so it cannot move real
                  money, but anyone who knows there is money on the table will
                  otherwise read these numbers as wrong. */}
              {settlement.openStakes > 0 ? (
                <InlineNotice
                  tone="warn"
                  message={`Settling now excludes ${settlement.openStakes} still riding on unresolved games.`}
                />
              ) : null}
              {liveGame ? (
                <InlineNotice
                  tone="warn"
                  message="A game is in progress. Whatever it settles to is not counted here yet."
                />
              ) : null}

              <div className="grid gap-1.5">
                <strong className="text-sm">Where everyone stands</strong>
                <ul
                  aria-label="Settle-up standings"
                  className="m-0 grid list-none gap-1.5 p-0"
                >
                  {settlement.standings.map((standing, index) => (
                    <m.li
                      key={standing.gamerId}
                      initial={{ opacity: 0, y: rise }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.26, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
                      className="flex items-baseline gap-2 text-sm"
                    >
                      <span className="grow">{nameOf(standing.gamerId)}</span>
                      <strong className={`min-w-12 text-right ${toneOf(standing.net)}`}>
                        {signed(standing.net)}
                      </strong>
                    </m.li>
                  ))}
                </ul>
                <p className="m-0 text-[11px] text-muted-foreground">
                  Won or lost beyond what they bought. Chips bought are their own money, so
                  they are nobody's debt.
                </p>
              </div>

              <div className="grid gap-1.5 border-t border-[#ecfdf5] pt-2.5">
                <strong className="text-sm">Payments</strong>
                {settlement.transfers.length === 0 ? (
                  <p className="m-0 text-[13px] text-muted-foreground">
                    Nobody owes anybody — everyone is level on what they bought.
                  </p>
                ) : (
                  <ul
                    aria-label="Settle-up transfers"
                    className="m-0 grid list-none gap-1 p-0"
                  >
                    {settlement.transfers.map((transfer, index) => (
                      <m.li
                        key={`${transfer.from}-${transfer.to}`}
                        initial={{ opacity: 0, y: rise }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{
                          duration: 0.26,
                          delay: index * 0.05,
                          ease: [0.22, 1, 0.36, 1],
                        }}
                        className="text-[13px]"
                      >
                        {nameOf(transfer.from)} pays {nameOf(transfer.to)}{' '}
                        <strong>{transfer.amount}</strong>
                      </m.li>
                    ))}
                  </ul>
                )}
              </div>

              <Button type="button" variant="secondary" onClick={() => void share()}>
                {copied ? 'Copied' : 'Share summary'}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </LazyMotion>
  )
}
