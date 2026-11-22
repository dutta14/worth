import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { containsRule } from '../../../../test/importHelpers'
import type { CategoryGroup } from '../../types'
import type { RulesLoad } from '../importStorage'
import { toImpactRows } from '../recategorize'
import CreateRuleDialog from './CreateRuleDialog'

const groups: CategoryGroup[] = [
  { id: 'food', name: 'Food', categories: ['Dining', 'Groceries'] },
  { id: 'others', name: 'Others', categories: ['Uncategorized'] },
]
const ready = (...rules: ReturnType<typeof containsRule>[]): RulesLoad => ({
  state: 'ready',
  file: { schemaVersion: 1, rules },
})
const rows = toImpactRows([
  { description: 'STARBUCKS #1', category: 'Uncategorized' },
  { description: 'STARBUCKS #2', category: 'Uncategorized' },
  { description: 'STARBUCKS #3', category: 'Dining' },
  { description: 'Kroger', category: 'Groceries' },
])

const setup = (props: Partial<React.ComponentProps<typeof CreateRuleDialog>> = {}) => {
  const onCreate = vi.fn().mockResolvedValue({ ok: true, applied: null, canUndo: false })
  const onUndo = vi.fn().mockResolvedValue(true)
  const onClose = vi.fn()
  const user = userEvent.setup()
  render(
    <CreateRuleDialog
      description="SQ *STARBUCKS #1234"
      currentCategory="Uncategorized"
      rules={ready()}
      categoryGroups={groups}
      rows={rows}
      onCreate={onCreate}
      onUndo={onUndo}
      onClose={onClose}
      {...props}
    />,
  )
  return { user, onCreate, onUndo, onClose }
}

describe('CreateRuleDialog', () => {
  it('prefills the value from the description and leaves the category empty for an uncategorized row', () => {
    setup()
    expect(screen.getByRole('dialog', { name: 'Create a rule' })).toBeInTheDocument()
    expect(screen.getByLabelText('Description contains')).toHaveValue('STARBUCKS')
    expect(screen.getByLabelText('Category')).toHaveValue('')
  })

  it('preselects the category of a row that already has one', () => {
    setup({ currentCategory: 'Dining' })
    expect(screen.getByLabelText('Category')).toHaveValue('Dining')
  })

  it('shows how many transactions match as the value changes', async () => {
    const { user } = setup()
    expect(await screen.findByText('3 transactions match "STARBUCKS".')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Description contains'))
    await user.type(screen.getByLabelText('Description contains'), 'kroger')
    expect(await screen.findByText('1 transaction match "kroger".')).toBeInTheDocument()
  })

  it('offers to apply only when uncategorized transactions would move', async () => {
    const { user } = setup()
    await user.selectOptions(screen.getByLabelText('Category'), 'Dining')
    expect(await screen.findByRole('button', { name: 'Create rule and apply to 2' })).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Description contains'))
    await user.type(screen.getByLabelText('Description contains'), 'kroger')
    await waitFor(() => expect(screen.queryByRole('button', { name: /and apply/ })).not.toBeInTheDocument())
  })

  it('saves the rule without applying it and confirms', async () => {
    const { user, onCreate } = setup()
    await user.selectOptions(screen.getByLabelText('Category'), 'Dining')
    await user.click(screen.getByRole('button', { name: 'Create rule' }))

    expect(onCreate).toHaveBeenCalledWith({ value: 'STARBUCKS', category: 'Dining' }, false)
    expect(await screen.findAllByText('Rule saved.')).not.toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('saves and applies, then undoes the application', async () => {
    const { user, onCreate, onUndo } = setup()
    onCreate.mockResolvedValue({ ok: true, applied: 2, canUndo: true })
    await user.selectOptions(screen.getByLabelText('Category'), 'Dining')
    await user.click(await screen.findByRole('button', { name: 'Create rule and apply to 2' }))

    expect(onCreate).toHaveBeenCalledWith({ value: 'STARBUCKS', category: 'Dining' }, true)
    expect((await screen.findAllByText('Rule saved. Recategorized 2 transactions.')).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalled()
    expect((await screen.findAllByText(/^Undone\./)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('hides Undo when the months changed after the apply', async () => {
    const { user, onCreate } = setup()
    onCreate.mockResolvedValue({ ok: true, applied: 2, canUndo: false })
    await user.selectOptions(screen.getByLabelText('Category'), 'Dining')
    await user.click(await screen.findByRole('button', { name: 'Create rule and apply to 2' }))
    await screen.findAllByText(/Recategorized 2/)
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('reports an Undo that fails and keeps the button', async () => {
    const { user, onCreate, onUndo } = setup()
    onCreate.mockResolvedValue({ ok: true, applied: 2, canUndo: true })
    onUndo.mockResolvedValue(false)
    await user.selectOptions(screen.getByLabelText('Category'), 'Dining')
    await user.click(await screen.findByRole('button', { name: 'Create rule and apply to 2' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByText(/could not be undone/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
  })

  it('shows a warning returned with a saved rule', async () => {
    const { user, onCreate } = setup()
    onCreate.mockResolvedValue({ ok: true, applied: 0, canUndo: false, warning: 'Apply failed.' })
    await user.selectOptions(screen.getByLabelText('Category'), 'Dining')
    await user.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(await screen.findByText('Error: Apply failed.')).toBeInTheDocument()
  })

  it('shows a save failure and stays open for another try', async () => {
    const { user, onCreate } = setup()
    onCreate.mockResolvedValue({ ok: false, message: 'Disk full.' })
    await user.selectOptions(screen.getByLabelText('Category'), 'Dining')
    await user.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(await screen.findByText('Error: Disk full.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create rule' })).toBeEnabled()
  })

  it('requires a category before saving', async () => {
    const { user, onCreate } = setup()
    await user.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Category')).toHaveAttribute('aria-invalid', 'true')
  })

  it('rejects a value that is too short and clears the error on edit', async () => {
    const { user, onCreate } = setup()
    await user.selectOptions(screen.getByLabelText('Category'), 'Dining')
    await user.clear(screen.getByLabelText('Description contains'))
    await user.type(screen.getByLabelText('Description contains'), 'a')
    await user.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Description contains')).toHaveAttribute('aria-invalid', 'true')
    await user.type(screen.getByLabelText('Description contains'), 'b')
    expect(screen.getByLabelText('Description contains')).toHaveAttribute('aria-invalid', 'false')
  })

  it('rejects a duplicate of an existing rule', async () => {
    const { user, onCreate } = setup({ rules: ready(containsRule('r_01', 'starbucks', 'Dining')) })
    await user.selectOptions(screen.getByLabelText('Category'), 'Dining')
    await user.click(screen.getByRole('button', { name: 'Create rule' }))
    expect(onCreate).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Description contains')).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows the unreadable-rules warning and no form', () => {
    setup({ rules: { state: 'unreadable', reason: 'newer' } })
    expect(screen.getByRole('alert')).toHaveTextContent(/newer version/)
    expect(screen.queryByLabelText('Description contains')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('closes on Cancel and on Escape', async () => {
    const { user, onClose } = setup()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('moves focus to the heading once the rule is saved', async () => {
    const { user } = setup()
    await user.selectOptions(screen.getByLabelText('Category'), 'Dining')
    await user.click(screen.getByRole('button', { name: 'Create rule' }))
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Create a rule' })).toHaveFocus())
  })

  it('ignores a second submit while saving', async () => {
    let finish: (v: { ok: true; applied: null; canUndo: false }) => void = () => {}
    const onCreate = vi.fn(() => new Promise<{ ok: true; applied: null; canUndo: false }>(r => (finish = r)))
    const { user } = setup({ onCreate })
    await user.selectOptions(screen.getByLabelText('Category'), 'Dining')
    fireEvent.submit(screen.getByLabelText('Description contains').closest('form') as HTMLFormElement)
    fireEvent.submit(screen.getByLabelText('Description contains').closest('form') as HTMLFormElement)
    expect(onCreate).toHaveBeenCalledTimes(1)
    finish({ ok: true, applied: null, canUndo: false })
    await screen.findAllByText('Rule saved.')
  })

  it('announces every failed undo again, not only the first', async () => {
    const { user, onCreate, onUndo } = setup()
    onCreate.mockResolvedValue({ ok: true, applied: 2, canUndo: true })
    onUndo.mockResolvedValue(false)
    await user.selectOptions(screen.getByLabelText('Category'), 'Dining')
    await user.click(await screen.findByRole('button', { name: 'Create rule and apply to 2' }))
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    const first = await screen.findByText(/could not be undone/)

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByText(/could not be undone/)).not.toBe(first))
    expect(onUndo).toHaveBeenCalledTimes(2)
  })

  it('moves focus into the dialog when a successful undo removes the Undo button', async () => {
    const { user, onCreate } = setup()
    onCreate.mockResolvedValue({ ok: true, applied: 2, canUndo: true })
    await user.selectOptions(screen.getByLabelText('Category'), 'Dining')
    await user.click(await screen.findByRole('button', { name: 'Create rule and apply to 2' }))
    const undo = await screen.findByRole('button', { name: 'Undo' })
    await user.click(undo)
    await waitFor(() => expect(undo).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Create a rule' })).toHaveFocus()
  })
})
