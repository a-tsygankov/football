import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Segmented } from './Segmented.jsx'

const options = [
  { value: 'home', label: 'Home' },
  { value: 'bench', label: 'Reserve' },
  { value: 'away', label: 'Away', disabled: true },
] as const

describe('Segmented', () => {
  afterEach(cleanup)

  it('announces one labelled choice with the current option checked', () => {
    render(<Segmented label="Side for Ann" value="bench" options={options} onChange={vi.fn()} />)

    const group = screen.getByRole('radiogroup', { name: 'Side for Ann' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Reserve' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Home' })).not.toBeChecked()
  })

  it('reports the option that was picked', () => {
    const onChange = vi.fn()
    render(<Segmented label="Side for Ann" value="bench" options={options} onChange={onChange} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Home' }))

    expect(onChange).toHaveBeenCalledWith('home')
  })

  it('keeps a choice selected when the current option is pressed again', () => {
    const onChange = vi.fn()
    render(<Segmented label="Side for Ann" value="bench" options={options} onChange={onChange} />)

    fireEvent.click(screen.getByRole('radio', { name: 'Reserve' }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('does not offer a disabled option', () => {
    const onChange = vi.fn()
    render(<Segmented label="Side for Ann" value="bench" options={options} onChange={onChange} />)

    expect(screen.getByRole('radio', { name: 'Away' })).toBeDisabled()
  })
})
