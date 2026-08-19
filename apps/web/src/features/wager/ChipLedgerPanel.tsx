import { useState } from 'react'
import { LazyMotion, domAnimation, m, useReducedMotion } from 'motion/react'
import {
  type ChipLedgerResponse,
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
 * The room's chip ledger.
 *
 * Balances are room-wide and carry across nights, so this is the running
 * account rather than a scoreboard for tonight — `ChipStandingsPanel` still
 * covers the evening's swing, and `SettleUpPanel` turns these balances into
 * who hands cash to whom.
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
}: {
  busy: BusyState
  gamers: ReadonlyArray<Gamer>
  ledger: ChipLedgerResponse | null
  onBuyChips: (gamerId: GamerId, amount: number) => Promise<void>
}) {
  const [buyerId, setBuyerId] = useState<GamerId | ''>('')
  const [amount, setAmount] = useState(String(DEFAULT_BUY_IN))
  const [error, setError] = useState<string | null>(null)
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
  const entries = (ledger?.entries ?? []).filter(hasChipActivity)
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
