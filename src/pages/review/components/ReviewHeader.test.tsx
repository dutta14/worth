import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ReviewHeader from './ReviewHeader'

const base = {
  year: 2025,
  years: [2026, 2025, 2024],
  disabled: false,
  actionsDisabled: false,
}
const noop = { onYearChange: () => {}, onPrint: () => {}, onDownload: () => {} }

const previous = () => screen.getByRole('button', { name: 'Previous year' })
const next = () => screen.getByRole('button', { name: 'Next year' })
const trigger = () => screen.getByRole('button', { name: 'More actions' })

describe('ReviewHeader', () => {
  it('shows the routed year between the previous and next buttons, with no title or period', () => {
    render(<ReviewHeader {...base} {...noop} />)

    expect(screen.getByText('2025')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  describe('year navigation', () => {
    it('steps to the adjacent available years as numbers', async () => {
      const onYearChange = vi.fn()
      render(<ReviewHeader {...base} {...noop} onYearChange={onYearChange} />)

      await userEvent.click(previous())
      await userEvent.click(next())

      expect(onYearChange).toHaveBeenNthCalledWith(1, 2024)
      expect(onYearChange).toHaveBeenNthCalledWith(2, 2026)
    })

    it('skips the gaps between available years', async () => {
      const onYearChange = vi.fn()
      render(<ReviewHeader {...base} years={[2026, 2022]} year={2026} {...noop} onYearChange={onYearChange} />)

      await userEvent.click(previous())

      expect(onYearChange).toHaveBeenCalledWith(2022)
    })

    it('disables previous at the oldest year and next at the newest year', () => {
      const { rerender } = render(<ReviewHeader {...base} year={2024} {...noop} />)
      expect(previous()).toBeDisabled()
      expect(next()).toBeEnabled()

      rerender(<ReviewHeader {...base} year={2026} {...noop} />)
      expect(previous()).toBeEnabled()
      expect(next()).toBeDisabled()
    })

    it('treats a routed year outside the list as the newest, stepping back to the newest available year', async () => {
      const onYearChange = vi.fn()
      render(<ReviewHeader {...base} year={2030} {...noop} onYearChange={onYearChange} />)

      expect(screen.getByText('2030')).toBeInTheDocument()
      expect(next()).toBeDisabled()
      await userEvent.click(previous())

      expect(onYearChange).toHaveBeenCalledWith(2026)
    })

    it('steps from a routed year older than the list to the oldest available year', async () => {
      const onYearChange = vi.fn()
      render(<ReviewHeader {...base} year={2020} {...noop} onYearChange={onYearChange} />)

      expect(previous()).toBeDisabled()
      await userEvent.click(next())

      expect(onYearChange).toHaveBeenCalledWith(2024)
    })

    it('steps to the nearest available year from a routed year inside a gap', async () => {
      const onYearChange = vi.fn()
      render(<ReviewHeader {...base} years={[2026, 2022]} year={2024} {...noop} onYearChange={onYearChange} />)

      await userEvent.click(next())
      await userEvent.click(previous())

      expect(onYearChange).toHaveBeenNthCalledWith(1, 2026)
      expect(onYearChange).toHaveBeenNthCalledWith(2, 2022)
    })

    it('has nowhere to go when the routed year is the only year', () => {
      render(<ReviewHeader {...base} years={[2025]} {...noop} />)

      expect(previous()).toBeDisabled()
      expect(next()).toBeDisabled()
    })

    it('disables both buttons while loading', () => {
      render(<ReviewHeader {...base} disabled {...noop} />)

      expect(previous()).toBeDisabled()
      expect(next()).toBeDisabled()
    })

    it('shows no year navigation before a year is chosen', () => {
      render(<ReviewHeader {...base} year={null} {...noop} />)

      expect(screen.queryByRole('button', { name: 'Previous year' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Next year' })).not.toBeInTheDocument()
    })
  })

  describe('More actions disclosure', () => {
    it('starts collapsed with the actions hidden, and the trigger points at them', () => {
      render(<ReviewHeader {...base} {...noop} />)

      expect(trigger()).toHaveAttribute('aria-expanded', 'false')
      expect(trigger()).toHaveAttribute('aria-controls')
      expect(screen.queryByRole('button', { name: 'Print or save as PDF' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Download CSV' })).not.toBeInTheDocument()
    })

    it('opens on click and reveals Print before Download CSV in the tab order', async () => {
      render(<ReviewHeader {...base} {...noop} />)

      await userEvent.click(trigger())

      expect(trigger()).toHaveAttribute('aria-expanded', 'true')
      const panel = document.getElementById(trigger().getAttribute('aria-controls')!)
      expect(panel).toBeVisible()
      await userEvent.tab()
      expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toHaveFocus()
      await userEvent.tab()
      expect(screen.getByRole('button', { name: 'Download CSV' })).toHaveFocus()
    })

    it.each([
      ['Enter', '{Enter}'],
      ['Space', ' '],
    ])('toggles open and closed with %s', async (_name, key) => {
      render(<ReviewHeader {...base} {...noop} />)

      trigger().focus()
      await userEvent.keyboard(key)
      expect(trigger()).toHaveAttribute('aria-expanded', 'true')
      await userEvent.keyboard(key)
      expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    })

    it('closes on Escape from the trigger and keeps focus on it', async () => {
      render(<ReviewHeader {...base} {...noop} />)

      await userEvent.click(trigger())
      await userEvent.keyboard('{Escape}')

      expect(trigger()).toHaveAttribute('aria-expanded', 'false')
      expect(trigger()).toHaveFocus()
    })

    it('closes on Escape from an action and returns focus to the trigger', async () => {
      render(<ReviewHeader {...base} {...noop} />)

      await userEvent.click(trigger())
      await userEvent.tab()
      expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toHaveFocus()
      await userEvent.keyboard('{Escape}')

      expect(trigger()).toHaveAttribute('aria-expanded', 'false')
      expect(trigger()).toHaveFocus()
    })

    it('lets Escape through to the page while it is closed', async () => {
      const onKeyDown = vi.fn()
      render(
        <div onKeyDown={onKeyDown}>
          <ReviewHeader {...base} {...noop} />
        </div>,
      )

      trigger().focus()
      await userEvent.keyboard('{Escape}')

      expect(onKeyDown).toHaveBeenCalledTimes(1)
    })

    it('closes on an outside click', async () => {
      render(
        <>
          <ReviewHeader {...base} {...noop} />
          <p>Elsewhere</p>
        </>,
      )

      await userEvent.click(trigger())
      await userEvent.click(screen.getByText('Elsewhere'))

      expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    })

    it('closes when focus tabs out of the disclosure', async () => {
      render(
        <>
          <ReviewHeader {...base} {...noop} />
          <button type="button">After</button>
        </>,
      )

      await userEvent.click(trigger())
      await userEvent.tab()
      await userEvent.tab()
      await userEvent.tab()

      expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
      expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    })

    it('calls the handler, closes, and returns focus to the trigger when an action is chosen', async () => {
      const onPrint = vi.fn()
      const onDownload = vi.fn()
      render(<ReviewHeader {...base} {...noop} onPrint={onPrint} onDownload={onDownload} />)

      await userEvent.click(trigger())
      await userEvent.click(screen.getByRole('button', { name: 'Print or save as PDF' }))
      expect(onPrint).toHaveBeenCalledTimes(1)
      expect(trigger()).toHaveAttribute('aria-expanded', 'false')
      expect(trigger()).toHaveFocus()

      await userEvent.click(trigger())
      await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }))
      expect(onDownload).toHaveBeenCalledTimes(1)
    })

    it('disables both actions but not the trigger or year navigation when there is nothing to export', async () => {
      render(<ReviewHeader {...base} {...noop} actionsDisabled />)

      await userEvent.click(trigger())

      expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled()
      expect(previous()).toBeEnabled()
    })

    it('disables both actions while loading', async () => {
      render(<ReviewHeader {...base} disabled {...noop} />)

      await userEvent.click(trigger())

      expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled()
    })
  })
})
