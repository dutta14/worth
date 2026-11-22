import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BudgetTargetCell from './BudgetTargetCell'

const setup = (props: Partial<React.ComponentProps<typeof BudgetTargetCell>> = {}) => {
  const onSave = vi.fn<(value: number | null) => Promise<{ ok: boolean }>>(async () => ({ ok: true }))
  const user = userEvent.setup()
  const utils = render(
    <BudgetTargetCell groupName="Dining" current={null} disabled={false} onSave={onSave} {...props} />,
  )
  return { onSave, user, ...utils }
}

const openButton = () => screen.getByRole('button', { name: /Dining/ })
const editor = () => screen.getByRole('textbox', { name: 'Monthly target for Dining' })

describe('BudgetTargetCell button', () => {
  it('shows "Set target" with a descriptive name when there is no target', () => {
    setup()
    expect(screen.getByRole('button', { name: 'Set monthly target for Dining' })).toHaveTextContent('Set target')
  })

  it('shows the target with an edit name when one is set', () => {
    setup({ current: 500 })
    expect(screen.getByRole('button', { name: 'Dining monthly target $500, edit' })).toHaveTextContent('$500')
  })

  it('shows $0 for a zero target', () => {
    setup({ current: 0 })
    expect(screen.getByRole('button', { name: 'Dining monthly target $0, edit' })).toHaveTextContent('$0')
  })

  it('opens the editor with the current value selected on click', async () => {
    const { user } = setup({ current: 1250.5 })
    await user.click(openButton())

    expect(editor()).toHaveFocus()
    expect(editor()).toHaveValue('1250.5')
    expect((editor() as HTMLInputElement).selectionStart).toBe(0)
    expect((editor() as HTMLInputElement).selectionEnd).toBe(6)
  })

  it.each(['{Enter}', ' '])('opens the editor from the keyboard with %j', async key => {
    const { user } = setup()
    await user.tab()
    expect(openButton()).toHaveFocus()
    await user.keyboard(key)
    expect(editor()).toHaveFocus()
  })

  it('opens an empty editor when there is no target', async () => {
    const { user } = setup()
    await user.click(openButton())
    expect(editor()).toHaveValue('')
  })

  it('uses a decimal keypad and associates the format hint', async () => {
    const { user } = setup()
    await user.click(openButton())
    expect(editor()).toHaveAttribute('inputmode', 'decimal')
    expect(editor()).toHaveAccessibleDescription('Enter a monthly amount. Leave blank to clear.')
  })
})

describe('BudgetTargetCell saving', () => {
  it('saves a typed amount on Enter and returns focus to the button', async () => {
    const { user, onSave, rerender } = setup()
    await user.click(openButton())
    await user.type(editor(), '500{Enter}')

    expect(onSave).toHaveBeenCalledWith(500)
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    rerender(<BudgetTargetCell groupName="Dining" current={500} disabled={false} onSave={onSave} />)
    expect(openButton()).toHaveFocus()
  })

  it.each([
    ['$1,250.50', 1250.5],
    ['0', 0],
    [' 12 ', 12],
  ])('accepts %j', async (text, value) => {
    const { user, onSave } = setup()
    await user.click(openButton())
    await user.type(editor(), `${text}{Enter}`)
    expect(onSave).toHaveBeenCalledWith(value)
  })

  it('saves null when a set target is blanked', async () => {
    const { user, onSave } = setup({ current: 500 })
    await user.click(openButton())
    await user.clear(editor())
    await user.keyboard('{Enter}')
    expect(onSave).toHaveBeenCalledWith(null)
  })

  it('closes without saving when blank is submitted for a group with no target', async () => {
    const { user, onSave } = setup()
    await user.click(openButton())
    await user.keyboard('{Enter}')

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(openButton()).toHaveFocus()
  })

  it('still reports an unchanged non-blank value on Enter so it can be announced', async () => {
    const { user, onSave } = setup({ current: 500 })
    await user.click(openButton())
    await user.keyboard('{Enter}')
    expect(onSave).toHaveBeenCalledWith(500)
  })

  it('saves a valid value when Tab leaves the field, without pulling focus back', async () => {
    const { user, onSave } = setup()
    await user.click(openButton())
    await user.type(editor(), '300')
    await user.tab()

    expect(onSave).toHaveBeenCalledWith(300)
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(openButton()).not.toHaveFocus()
  })

  it('closes silently on blur when nothing changed', async () => {
    const { user, onSave } = setup({ current: 500 })
    await user.click(openButton())
    await user.tab()

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('does not save twice when Enter and blur race', async () => {
    let release: (value: { ok: boolean }) => void = () => {}
    const onSave = vi.fn(() => new Promise<{ ok: boolean }>(resolve => (release = resolve)))
    const { user } = setup({ onSave })
    await user.click(openButton())
    await user.type(editor(), '300{Enter}')
    await user.tab()

    expect(onSave).toHaveBeenCalledTimes(1)
    release({ ok: true })
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
  })
})

describe('BudgetTargetCell validation', () => {
  it.each(['-5', 'abc', '1e3', '5.005', '10000000'])('rejects %j with the standard error', async text => {
    const { user, onSave } = setup()
    await user.click(openButton())
    await user.type(editor(), `${text}{Enter}`)

    expect(onSave).not.toHaveBeenCalled()
    expect(editor()).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter an amount from 0 to 9,999,999.')).toBeInTheDocument()
    expect(editor()).toHaveAccessibleDescription(/Enter an amount from 0 to 9,999,999\./)
  })

  it('keeps the invalid editor open when Tab leaves it and does not trap focus', async () => {
    const { user, onSave } = setup()
    await user.click(openButton())
    await user.type(editor(), 'abc')
    await user.tab()

    expect(onSave).not.toHaveBeenCalled()
    expect(editor()).toHaveAttribute('aria-invalid', 'true')
    expect(editor()).not.toHaveFocus()
  })

  it('clears the error once the user edits the value', async () => {
    const { user } = setup()
    await user.click(openButton())
    await user.type(editor(), 'abc{Enter}')
    await user.type(editor(), '1')

    expect(editor()).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText('Enter an amount from 0 to 9,999,999.')).not.toBeInTheDocument()
  })

  it('shows the save error, keeps the editor open and lets the user retry', async () => {
    const onSave = vi.fn<(value: number | null) => Promise<{ ok: boolean }>>().mockResolvedValueOnce({ ok: false })
    const { user } = setup({ onSave })
    await user.click(openButton())
    await user.type(editor(), '500{Enter}')

    expect(
      await screen.findByText("Couldn't save the target. Check that your data folder is still available."),
    ).toBeInTheDocument()
    expect(editor()).not.toHaveAttribute('aria-invalid')

    onSave.mockResolvedValueOnce({ ok: true })
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('textbox')).not.toBeInTheDocument())
    expect(onSave).toHaveBeenCalledTimes(2)
  })
})

describe('BudgetTargetCell cancel', () => {
  it('cancels on Escape, discards the draft and returns focus', async () => {
    const { user, onSave } = setup({ current: 500 })
    await user.click(openButton())
    await user.type(editor(), '9')
    await user.keyboard('{Escape}')

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(openButton()).toHaveFocus()
    expect(openButton()).toHaveTextContent('$500')
  })

  it('reopens with the stored value after a cancel', async () => {
    const { user } = setup({ current: 500 })
    await user.click(openButton())
    await user.type(editor(), '9')
    await user.keyboard('{Escape}')
    await user.click(openButton())
    expect(editor()).toHaveValue('500')
  })
})

describe('BudgetTargetCell disabled', () => {
  it('marks the button aria-disabled and never opens the editor', async () => {
    const { user } = setup({ disabled: true })
    await user.click(openButton())

    expect(openButton()).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('closes an open editor when it becomes disabled', async () => {
    const onSave = vi.fn(async () => ({ ok: true }))
    const { user, rerender } = setup({ onSave })
    await user.click(openButton())
    rerender(<BudgetTargetCell groupName="Dining" current={null} disabled onSave={onSave} />)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
