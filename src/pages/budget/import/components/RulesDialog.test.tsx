import { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { containsRule } from '../../../../test/importHelpers'
import type { CategoryGroup } from '../../types'
import type { RulesLoad, RulesSaveResult } from '../importStorage'
import { MAX_RULES, type CategoryRule } from '../rules'
import RulesDialog from './RulesDialog'

const groups: CategoryGroup[] = [
  { id: 'food', name: 'Food', categories: ['Dining', 'Groceries'] },
  { id: 'others', name: 'Others', categories: ['Gas', 'Uncategorized'] },
]

interface HarnessProps {
  initial?: CategoryRule[]
  load?: RulesLoad
  save?: (rules: CategoryRule[]) => Promise<RulesSaveResult>
  onClose?: () => void
}

const Harness = ({ initial = [], load, save, onClose = () => {} }: HarnessProps) => {
  const [rules, setRules] = useState<RulesLoad>(load ?? { state: 'ready', file: { schemaVersion: 1, rules: initial } })
  return (
    <RulesDialog
      rules={rules}
      categoryGroups={groups}
      onClose={onClose}
      onChange={async next => {
        const outcome = (await save?.(next)) ?? { ok: true as const }
        if (outcome.ok) setRules({ state: 'ready', file: { schemaVersion: 1, rules: next } })
        return outcome
      }}
    />
  )
}

const setup = (props: HarnessProps = {}) => {
  const user = userEvent.setup()
  return { user, ...render(<Harness {...props} />) }
}

const values = () =>
  screen
    .queryAllByRole('listitem')
    .map(item => within(item).queryByText(/./, { selector: '.iw-rule-value' })?.textContent)

const three = [
  containsRule('r_01', 'STARBUCKS', 'Dining'),
  containsRule('r_02', 'SHELL', 'Gas'),
  containsRule('r_03', 'KROGER', 'Groceries'),
]

const addRule = async (user: ReturnType<typeof userEvent.setup>, value: string, category: string) => {
  await user.type(screen.getByLabelText('Description contains'), value)
  if (category) await user.selectOptions(screen.getByLabelText('Category'), category)
  await user.click(screen.getByRole('button', { name: 'Add rule' }))
}

describe('RulesDialog', () => {
  it('is a modal dialog titled "Categorization rules" with focus on its heading', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: 'Categorization rules' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('heading', { level: 2, name: 'Categorization rules' })).toHaveFocus()
    expect(
      screen.getByText('Rules sort new transactions by what the description contains. The first matching rule wins.'),
    ).toBeInTheDocument()
  })

  it('explains an empty list', () => {
    setup()
    expect(screen.getByText('No rules yet. Add one to sort a merchant automatically.')).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('offers every category except the fallbacks', () => {
    setup()
    const options = within(screen.getByLabelText('Category'))
      .getAllByRole('option')
      .map(option => option.textContent)
    expect(options).toEqual(['Choose a category', 'Dining', 'Groceries', 'Gas'])
  })

  it('adds a rule with Enter, announces it and clears the form', async () => {
    const save = vi.fn(async (_rules: CategoryRule[]) => ({ ok: true as const }))
    const { user } = setup({ save })
    await user.selectOptions(screen.getByLabelText('Category'), 'Dining')
    await user.type(screen.getByLabelText('Description contains'), '  Star  bucks {Enter}')
    expect(save).toHaveBeenCalledWith([expect.objectContaining({ category: 'Dining', enabled: true })])
    expect(save.mock.calls[0][0][0].match.value).toBe('Star bucks')
    await screen.findByText('Star bucks')
    expect(screen.getByRole('status')).toHaveTextContent('Rule saved: Star bucks.')
    expect(screen.getByLabelText('Description contains')).toHaveValue('')
    expect(screen.getByLabelText('Category')).toHaveValue('')
    await waitFor(() => expect(screen.getByLabelText('Description contains')).toHaveFocus())
  })

  it('changes the live-region text on every add and delete so repeated actions are announced', async () => {
    const { user } = setup()
    const status = () => screen.getByRole('status').textContent
    const seen: (string | null)[] = []

    await addRule(user, 'STARBUCKS', 'Dining')
    await waitFor(() => expect(status()).toBe('Rule saved: STARBUCKS.'))
    seen.push(status())
    await addRule(user, 'SHELL', 'Gas')
    await waitFor(() => expect(status()).toBe('Rule saved: SHELL.'))
    seen.push(status())
    await user.click(screen.getByRole('button', { name: 'Delete rule: SHELL' }))
    await waitFor(() => expect(status()).toBe('Rule deleted: SHELL.'))
    seen.push(status())
    await user.click(screen.getByRole('button', { name: 'Delete rule: STARBUCKS' }))
    await waitFor(() => expect(status()).toBe('Rule deleted: STARBUCKS.'))
    seen.push(status())

    expect(new Set(seen).size).toBe(seen.length)
  })

  it('changes the live-region DOM text even when two deletes produce identical announcements', async () => {
    const future = (id: string): CategoryRule => ({
      id,
      match: { field: 'amount', type: 'between', value: [1, 2] },
      category: 'Gas',
      enabled: true,
    })
    const { user } = setup({ initial: [future('r_08'), future('r_09')] })
    const status = () => screen.getByRole('status').textContent

    await user.click(screen.getAllByRole('button', { name: 'Delete rule: amount between' })[0])
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1))
    const first = status()
    await user.click(screen.getByRole('button', { name: 'Delete rule: amount between' }))
    await screen.findByText('No rules yet. Add one to sort a merchant automatically.')

    expect(first?.trim()).toBe('Rule deleted: amount between.')
    expect(status()).not.toBe(first)
    expect(status()?.trim()).toBe(first?.trim())
  })

  it.each([
    ['a', 'Dining', 'Error: Enter at least 2 characters.', 'Description contains'],
    ['x'.repeat(101), 'Dining', 'Error: Use 100 characters or fewer.', 'Description contains'],
    ['Shell', '', 'Error: Choose a category.', 'Category'],
  ])('rejects %#: shows the message tied to its field', async (value, category, message, field) => {
    const save = vi.fn(async () => ({ ok: true as const }))
    const { user } = setup({ save })
    await addRule(user, value, category)
    expect(screen.getByText(message)).toBeInTheDocument()
    const control = screen.getByLabelText(field)
    expect(control).toHaveAttribute('aria-invalid', 'true')
    expect(control).toHaveAccessibleDescription(message)
    expect(save).not.toHaveBeenCalled()
  })

  it('rejects a duplicate value however it is written', async () => {
    const { user } = setup({ initial: three })
    await addRule(user, ' starbucks ', 'Gas')
    expect(screen.getByText('Error: A rule for "starbucks" already exists.')).toBeInTheDocument()
    expect(values()).toEqual(['STARBUCKS', 'SHELL', 'KROGER'])
  })

  it('clears an error as soon as the field changes', async () => {
    const { user } = setup()
    await addRule(user, 'a', 'Dining')
    await user.type(screen.getByLabelText('Description contains'), 'b')
    expect(screen.queryByText(/Enter at least/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Description contains')).toHaveAttribute('aria-invalid', 'false')
  })

  it('refuses a new rule at the 500 rule limit', async () => {
    const full = Array.from({ length: MAX_RULES }, (_, i) => containsRule(`r_${i}`, `merchant ${i}`, 'Gas'))
    setup({ initial: full })
    // Label queries scan every aria-label in a 500-row list and take tens of seconds, so role queries are used here.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'one more' } })
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Dining' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(
      screen.getByText('Error: You have reached the limit of 500 rules. Delete one to add another.'),
    ).toBeInTheDocument()
  }, 30_000)

  it('shows rules in order with accessible names that include the value', () => {
    setup({ initial: three })
    expect(values()).toEqual(['STARBUCKS', 'SHELL', 'KROGER'])
    expect(screen.getByRole('switch', { name: 'Active: STARBUCKS' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Delete rule: SHELL' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move up: STARBUCKS' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move down: KROGER' })).toBeDisabled()
  })

  it('moves a rule up and down, keeps focus on the button and announces the new position', async () => {
    const save = vi.fn(async () => ({ ok: true as const }))
    const { user } = setup({ initial: three, save })
    await user.click(screen.getByRole('button', { name: 'Move up: KROGER' }))
    await waitFor(() => expect(values()).toEqual(['STARBUCKS', 'KROGER', 'SHELL']))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Moved rule KROGER to position 2 of 3.'))
    expect(screen.getByRole('button', { name: 'Move up: KROGER' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Move up: KROGER' }))
    await waitFor(() => expect(values()).toEqual(['KROGER', 'STARBUCKS', 'SHELL']))
    expect(screen.getByRole('button', { name: 'Move down: KROGER' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Move down: KROGER' }))
    await waitFor(() => expect(values()).toEqual(['STARBUCKS', 'KROGER', 'SHELL']))
    expect(screen.getByRole('button', { name: 'Move down: KROGER' })).toHaveFocus()
    expect(save).toHaveBeenCalledTimes(3)
  })

  it('turns a rule off and on without moving focus', async () => {
    const { user } = setup({ initial: three })
    const toggle = screen.getByRole('switch', { name: 'Active: SHELL' })
    await user.click(toggle)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Active: SHELL' })).not.toBeChecked())
    expect(screen.getByRole('status')).toHaveTextContent('Rule SHELL turned off.')
    expect(screen.getByRole('switch', { name: 'Active: SHELL' })).toHaveFocus()
    await user.click(screen.getByRole('switch', { name: 'Active: SHELL' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Active: SHELL' })).toBeChecked())
    expect(screen.getByRole('status')).toHaveTextContent('Rule SHELL turned on.')
  })

  it('deletes a rule and moves focus to the next rule, then the previous one, then the form', async () => {
    const { user } = setup({ initial: three })
    await user.click(screen.getByRole('button', { name: 'Delete rule: SHELL' }))
    await waitFor(() => expect(values()).toEqual(['STARBUCKS', 'KROGER']))
    expect(screen.getByRole('status')).toHaveTextContent('Rule deleted: SHELL.')
    expect(screen.getByRole('button', { name: 'Delete rule: KROGER' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Delete rule: KROGER' }))
    await waitFor(() => expect(values()).toEqual(['STARBUCKS']))
    expect(screen.getByRole('button', { name: 'Delete rule: STARBUCKS' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Delete rule: STARBUCKS' }))
    await screen.findByText('No rules yet. Add one to sort a merchant automatically.')
    expect(screen.getByLabelText('Description contains')).toHaveFocus()
  })

  it('keeps a rule of an unknown type, labels it and offers no switch', () => {
    const future: CategoryRule = {
      id: 'r_09',
      match: { field: 'amount', type: 'between', value: [1, 2] },
      category: 'Gas',
      enabled: true,
    }
    setup({ initial: [future] })
    expect(screen.getByText('amount between')).toBeInTheDocument()
    expect(
      screen.getByText('This rule needs a newer version of Worth. It is kept as it is and not applied.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete rule: amount between' })).toBeInTheDocument()
  })

  it('flags a rule whose category no longer exists', () => {
    setup({ initial: [containsRule('r_01', 'OLD', 'Vanished'), containsRule('r_02', 'NEW', 'Dining')] })
    expect(screen.getAllByText('This category no longer exists, so the rule is skipped.')).toHaveLength(1)
  })

  it.each([
    ['write', 'Error: Your rules could not be saved. Check that the worth folder is still available, then try again.'],
    ['unreadable', 'Error: Your rules file could not be read, so nothing was saved. The file has not been changed.'],
  ] as const)('shows a %s failure and keeps the list as it was', async (reason, message) => {
    const { user } = setup({ initial: three, save: async () => ({ ok: false, reason }) })
    await user.click(screen.getByRole('button', { name: 'Delete rule: SHELL' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(values()).toEqual(['STARBUCKS', 'SHELL', 'KROGER'])
  })

  it('ignores a second change while one is being saved', async () => {
    let release: () => void = () => {}
    const save = vi.fn(() => new Promise<RulesSaveResult>(resolve => (release = () => resolve({ ok: true }))))
    const { user } = setup({ initial: three, save })
    await user.click(screen.getByRole('button', { name: 'Delete rule: SHELL' }))
    await user.click(screen.getByRole('button', { name: 'Delete rule: KROGER' }))
    expect(save).toHaveBeenCalledTimes(1)
    release()
    await waitFor(() => expect(values()).toEqual(['STARBUCKS', 'KROGER']))
  })

  it.each([
    ['corrupt', 'Your rules file could not be read, so rules are off for this import. The file has not been changed.'],
    [
      'newer',
      'Your rules file was saved by a newer version of Worth, so rules are off for this import. The file is left as it is.',
    ],
  ] as const)('shows only a warning, and no editor, for a %s file', (reason, message) => {
    setup({ load: { state: 'unreadable', reason } })
    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('button', { name: 'Add rule' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
  })

  it('closes with Done and with Escape', async () => {
    const onClose = vi.fn()
    const { user } = setup({ onClose })
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('does not close when the backdrop is clicked', async () => {
    const onClose = vi.fn()
    const { user, container } = setup({ onClose })
    await user.click(container.querySelector('.iw-overlay') as HTMLElement)
    expect(onClose).not.toHaveBeenCalled()
  })
})
