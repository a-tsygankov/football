import { useId } from 'react'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { motion } from 'motion/react'

export interface SegmentedOption<Value extends string> {
  value: Value
  label: string
  disabled?: boolean
  /** Colours the selected thumb: `home` green, `away` blue, `draw`/`bench` grey. */
  tone?: string
}

/**
 * The one either/or switch: a track with a thumb that slides to the choice.
 *
 * Radix ToggleGroup supplies what hand-rolled button rows lacked: one tab stop
 * for the whole control, arrow keys between options, and radio semantics a
 * screen reader announces as a single choice.
 */
export function Segmented<Value extends string>({ label, value, options, onChange, disabled = false, className = '' }: {
  label: string
  value: Value
  options: ReadonlyArray<SegmentedOption<Value>>
  onChange: (next: Value) => void
  disabled?: boolean
  className?: string
}) {
  const thumb = useId()
  return (
    <ToggleGroup.Root
      type="single"
      className={('seg ' + className).trim()}
      aria-label={label}
      value={value}
      disabled={disabled}
      // Radix clears the value when the active item is pressed again; a
      // segmented control always keeps one option chosen.
      onValueChange={next => { if (next) onChange(next as Value) }}
    >
      {options.map(option => (
        <ToggleGroup.Item key={option.value} value={option.value} disabled={option.disabled} data-tone={option.tone ?? option.value}>
          {option.value === value ? <motion.span layoutId={thumb} className="seg-thumb" transition={{ type: 'spring', stiffness: 520, damping: 40 }} /> : null}
          <span className="seg-label">{option.label}</span>
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}
