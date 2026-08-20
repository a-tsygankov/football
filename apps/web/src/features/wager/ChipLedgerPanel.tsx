import { useState } from 'react'
import { LazyMotion, domAnimation, m, useReducedMotion } from 'motion/react'
import {
  type ChipLedgerResponse,
  type ChipTransfer,
  DEFAULT_BUY_IN,
  type Gamer,
  type GamerId,
  hasChipActivity,
} from '@fc26/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InlineNotice } from '../../components/InlineNotice.jsx'
import { Field } from '../../components/Field.jsx'
import { inputStyle } from '../../styles/controls.js'
import type { BusyState } from '../../types/busyState.js'

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value)
}

function toneOf(value: number): string {
  return value > 0 ? 'text-[#15803d]' : value < 0 ? 'text-destructive' : 'text-[#475569]'
}

/**
 * The room's chip ledger and what it would take to settle up.
 *
 * Balances are room-wide and carry across nights, so this is the running
 * account rather than a scoreboard for tonight — `ChipStandingsPanel` still
 * covers the evening's swing.
 *
 * Motion is deliberate and narrow: rows stagger in so the list reads as a
 * list, and a balance that changed animates rather than snapping, because a
 * number that jumps is a number nobody trusts. Both are off under
 * `prefers-reduced-motion` — `useReducedMotion` collapses the distance to
 * zero rather than branching the markup.
 */
export function ChipLedgerPanel({
  busy,
  gamers,
  ledger,
  onBuyChips,
  onSettleUp,
  onSettlePayment,
}: {
  busy: BusyState
  gamers: ReadonlyArray<Gamer>
  ledger: ChipLedgerResponse | null
  onBuyChips: (gamerId: GamerId, amount: number) => Promise<void>
  onSettleUp: () => Promise<void>
  onSettlePayment: (from: GamerId, to: GamerId, amount: number) => Promise<void>
}) {
  const [buyerId, setBuyerId] = useState<GamerId | ''>('')
  const [amount, setAmount] = useState(String(DEFAULT_BUY_IN))
  const [error, setError] = useState<string | null>(null)
  // Part payments, keyed by the pair. Unset means "the whole debt", so the
  // field shows what is owed until somebody types over it, and a payment
  // clears its own override — otherwise paying 15 of 40 would leave 15 in a
  // box that now owes 25.
  const [partAmounts, setPartAmounts] = useState<Record<string, string>>({})
  const [settleError, setSettleError] = useState<string | null>(null)
  const reduced = useReducedMotion()

  function nameOf(gamerId: string): string {
    return gamers.find((gamer) => gamer.id === gamerId)?.name ?? 'Unknown'
  }

  function buy(): void {
    if (buyerId === '') {
      setError('Pick who is buying.')
      return
    }
    const parsed = Number.parseInt(amount.trim(), 10)
    if (!Number.isFinite(parsed) || parsed < 1) {
      setError('Buy at least 1 chip.')
      return
    }
    setError(null)
    void onBuyChips(buyerId, parsed)
  }

  // Only people who actually took part. The room used to hand every gamer in
  // a night's pool an automatic buy-in, so the full ledger lists people who
  // never placed a bet, holding a balance nobody asked for — noise on the one
  // screen meant to say who is up and who is down.
  const transferKey = (transfer: ChipTransfer): string => `${transfer.from}-${transfer.to}`
  const amountFor = (transfer: ChipTransfer): string =>
    partAmounts[transferKey(transfer)] ?? String(transfer.amount)

  async function pay(transfer: ChipTransfer): Promise<void> {
    const parsed = Number.parseInt(amountFor(transfer).trim(), 10)
    if (!Number.isFinite(parsed) || parsed < 1) {
      setSettleError('Pay at least 1 chip.')
      return
    }
    // The worker refuses this too, but a refusal that arrives after a round
    // trip reads as a fault rather than as a correction.
    if (parsed > transfer.amount) {
      setSettleError(
        `${nameOf(transfer.from)} only owes ${nameOf(transfer.to)} ${transfer.amount}.`,
      )
      return
    }
    setSettleError(null)
    await onSettlePayment(transfer.from, transfer.to, parsed)
    setPartAmounts((prev) => {
      const next = { ...prev }
      delete next[transferKey(transfer)]
      return next
    })
  }

  const entries = (ledger?.entries ?? []).filter(hasChipActivity)
  const transfers = ledger?.transfers ?? []
  const rise = reduced ? 0 : 8

  return (
    <LazyMotion features={domAnimation} strict>
      <Card className="mt-[18px]">
        <CardHeader>
          <CardTitle>Chips</CardTitle>
          <CardDescription>
            Balances carry between nights. Buy more whenever you run dry.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {entries.length === 0 ? (
            <InlineNotice tone="info" message="Nobody has bought chips in this room yet." />
          ) : (
            <ul aria-label="Chip balances" className="m-0 grid list-none gap-1.5 p-0">
              {entries.map((entry, index) => (
                <m.li
                  key={entry.gamerId}
                  initial={{ opacity: 0, y: rise }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.26, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
                  className="flex items-baseline gap-2 text-sm"
                >
                  <span className="grow">{nameOf(entry.gamerId)}</span>
                  {entry.committed > 0 ? (
                    <Badge variant="muted" className="px-0 text-[11px]">
                      {entry.committed} in play
                    </Badge>
                  ) : null}
                  <span className={`text-xs ${toneOf(entry.net)}`}>{signed(entry.net)}</span>
                  {/* Keyed on the value so a changed balance re-enters. */}
                  <m.strong
                    key={entry.balance}
                    initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                    className="min-w-12 text-right"
                  >
                    {entry.balance}
                  </m.strong>
                </m.li>
              ))}
            </ul>
          )}

          {/* What it would take to close the room out right now. Winnings are
              paid by the losers, so the payments always cancel exactly. */}
          <div className="grid gap-1.5">
            <strong className="text-sm">Settle up</strong>
            {transfers.length === 0 ? (
              <p className="m-0 text-[13px] text-muted-foreground">
                Nobody owes anybody — everyone is level on what they bought.
              </p>
            ) : (
              <ul className="m-0 grid list-none gap-1 p-0">
                {transfers.map((transfer, index) => (
                  <m.li
                    key={`${transfer.from}-${transfer.to}`}
                    initial={{ opacity: 0, y: rise }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.26, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
                    className="text-[13px]"
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 grow truncate">
                        {nameOf(transfer.from)} pays {nameOf(transfer.to)}
                      </span>
                      {/* Pre-filled with the whole debt, because settling it
                          outright is the common case and nobody should have to
                          type a number they can already read. Editable because
                          people pay what cash they have. */}
                      <input
                        value={amountFor(transfer)}
                        onChange={(event) =>
                          setPartAmounts((prev) => ({
                            ...prev,
                            [transferKey(transfer)]: event.target.value,
                          }))
                        }
                        inputMode="numeric"
                        aria-label={`Amount ${nameOf(transfer.from)} is paying ${nameOf(
                          transfer.to,
                        )}`}
                        className="w-14 shrink-0 rounded-md border border-[#bbf7d0] bg-white px-2 py-1 text-right text-[13px] text-foreground"
                      />
                      {/* Debts get cleared one at a time far more often than
                          all at once, so each row settles on its own. */}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => void pay(transfer)}
                      >
                        Paid
                      </Button>
                    </span>
                  </m.li>
                ))}
              </ul>
            )}
            {settleError ? <InlineNotice tone="warn" message={settleError} /> : null}
            {transfers.length > 0 ? (
              <>
                {/* Records that the money changed hands. Chips are not
                    returned: the debt is paid, so everyone keeps the stack
                    they bought and the next night starts from there. */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void onSettleUp()}
                >
                  {busy === 'settling-up' ? 'Settling...' : 'Mark all as paid'}
                </Button>
                <p className="m-0 text-[11px] text-muted-foreground">
                  Clears every debt at once. Everyone keeps the chips they bought.
                </p>
              </>
            ) : null}
          </div>

          <div className="grid gap-2.5 border-t border-[#ecfdf5] pt-2.5">
            <Field label="Who's buying">
              <select
                value={buyerId}
                onChange={(event) => setBuyerId(event.target.value as GamerId)}
                style={inputStyle}
              >
                <option value="">Pick a gamer</option>
                {gamers.map((gamer) => (
                  <option key={gamer.id} value={gamer.id}>
                    {gamer.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Chips to buy">
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="numeric"
                placeholder="Chips"
                style={inputStyle}
              />
            </Field>

            {error ? <InlineNotice tone="warn" message={error} /> : null}

            <Button type="button" disabled={busy !== null} onClick={buy}>
              {busy === 'buying-chips' ? 'Buying...' : 'Buy chips'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </LazyMotion>
  )
}
