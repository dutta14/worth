import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { RulesLoad } from '../importStorage'
import type { RecategorizeResult } from '../recategorize'
import ApplyRulesDialog from './ApplyRulesDialog'

const ready: RulesLoad = { state: 'ready', file: { schemaVersion: 1, rules: [] } }
const undo = { months: {}, addedCategories: [], addedYears: [] }
const okResult: Extract<RecategorizeResult, { ok: true }> = { ok: true, changed: 3, months: ['2026-10'], undo }

const setup = (props: Partial<React.ComponentProps<typeof ApplyRulesDialog>> = {}) => {
  const onApply = vi.fn().mockResolvedValue(okResult)
  const onUndo = vi.fn().mockResolvedValue(true)
  const canUndo = vi.fn().mockReturnValue(true)
  const onClose = vi.fn()
  render(
    <ApplyRulesDialog
      rules={ready}
      count={3}
      skippedRules={0}
      onApply={onApply}
      onUndo={onUndo}
      canUndo={canUndo}
      onClose={onClose}
      {...props}
    />,
  )
  return { user: userEvent.setup(), onApply, onUndo, canUndo, onClose }
}

describe('ApplyRulesDialog', () => {
  it('asks for confirmation with the count and what stays unchanged', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Apply rules to 3 uncategorized transactions?' })).toBeInTheDocument()
    expect(screen.getByText(/Only uncategorized transactions change/)).toBeInTheDocument()
  })

  it('uses the singular for one transaction', () => {
    setup({ count: 1 })
    expect(screen.getByRole('heading', { name: 'Apply rules to 1 uncategorized transaction?' })).toBeInTheDocument()
  })

  it('mentions rules that were skipped', () => {
    setup({ skippedRules: 2 })
    expect(screen.getByText(/2 rules skipped/)).toBeInTheDocument()
  })

  it('applies, reports the result and offers Undo', async () => {
    const { user, onApply } = setup()
    await user.click(screen.getByRole('button', { name: 'Apply rules' }))
    expect(onApply).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('heading', { name: 'Rules applied' })).toHaveFocus()
    expect(screen.getAllByText('Recategorized 3 transactions.').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('undoes the change and removes the Undo button', async () => {
    const { user, onUndo } = setup()
    await user.click(screen.getByRole('button', { name: 'Apply rules' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledWith(okResult)
    expect(await screen.findByRole('heading', { name: 'Undone' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('keeps Undo and shows an error when the undo fails', async () => {
    const { user, onUndo } = setup()
    onUndo.mockResolvedValue(false)
    await user.click(screen.getByRole('button', { name: 'Apply rules' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByText(/could not be undone/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('hides Undo when the months no longer hold what the apply wrote', async () => {
    const { user } = setup({ canUndo: () => false })
    await user.click(screen.getByRole('button', { name: 'Apply rules' }))
    await screen.findByRole('heading', { name: 'Rules applied' })
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('explains a stale refusal', async () => {
    const { user, onApply } = setup()
    onApply.mockResolvedValue({ ok: false, reason: 'stale', failedMonths: ['2026-10'], restored: true })
    await user.click(screen.getByRole('button', { name: 'Apply rules' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/changed while this window was open/)
    expect(screen.getByRole('heading', { name: 'Rules were not applied' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('explains a failed write', async () => {
    const { user, onApply } = setup()
    onApply.mockResolvedValue({ ok: false, reason: 'write', failedMonths: ['2026-10'], restored: false })
    await user.click(screen.getByRole('button', { name: 'Apply rules' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Nothing was applied.*partly changed/)
  })

  it('says so when no uncategorized transaction matches', () => {
    setup({ count: 0 })
    expect(screen.getByText('No uncategorized transactions match your rules.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Apply rules' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('shows the warning instead of the confirmation when rules are unreadable', () => {
    setup({ rules: { state: 'unreadable', reason: 'corrupt' } })
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be read/)
    expect(screen.queryByRole('button', { name: 'Apply rules' })).not.toBeInTheDocument()
  })

  it('closes on Cancel and on Escape', async () => {
    const { user, onClose } = setup()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('ignores Escape while applying', async () => {
    let finish: (r: RecategorizeResult) => void = () => {}
    const onApply = vi.fn(() => new Promise<RecategorizeResult>(r => (finish = r)))
    const { user, onClose } = setup({ onApply })
    await user.click(screen.getByRole('button', { name: 'Apply rules' }))
    expect(screen.getByRole('button', { name: 'Applying...' })).toBeDisabled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    finish(okResult)
    await screen.findByRole('heading', { name: 'Rules applied' })
  })

  it('announces every failed undo again, not only the first', async () => {
    const { user, onUndo } = setup()
    onUndo.mockResolvedValue(false)
    await user.click(screen.getByRole('button', { name: 'Apply rules' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    const first = await screen.findByText(/could not be undone/)

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByText(/could not be undone/)).not.toBe(first))
    expect(onUndo).toHaveBeenCalledTimes(2)
  })

  it('moves focus into the dialog when a successful undo removes the Undo button', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Apply rules' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByRole('heading', { name: 'Undone' })).toHaveFocus()
  })
})
