import { FC, KeyboardEvent, useId, useLayoutEffect, useRef, useState } from 'react'
import { formatTargetAmount, parseTargetInput } from '../utils/budgetTargets'
import { SAVE_ERROR_MESSAGE } from '../hooks/useBudgetTargets'

interface BudgetTargetCellProps {
  groupName: string
  /** Monthly target in effect for the current month, or null when none. */
  current: number | null
  disabled: boolean
  onSave: (value: number | null) => Promise<{ ok: boolean }>
}

const VALIDATION_ERROR = 'Enter an amount from 0 to 9,999,999.'
const HINT = 'Enter a monthly amount. Leave blank to clear.'

const toInputText = (value: number | null): string => (value === null ? '' : String(value))

const BudgetTargetCell: FC<BudgetTargetCellProps> = ({ groupName, current, disabled, onSave }) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<'invalid' | 'save' | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const focusButtonRef = useRef(false)
  const settlingRef = useRef(false)
  const baseId = useId()
  const hintId = `${baseId}-hint`
  const errorId = `${baseId}-error`

  useLayoutEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    } else if (focusButtonRef.current) {
      focusButtonRef.current = false
      buttonRef.current?.focus()
    }
  }, [editing])

  const open = () => {
    if (disabled) return
    setDraft(toInputText(current))
    setError(null)
    setEditing(true)
  }

  const close = (restoreFocus: boolean) => {
    focusButtonRef.current = restoreFocus
    setError(null)
    setEditing(false)
  }

  const commit = async (restoreFocus: boolean, announceUnchanged: boolean) => {
    if (settlingRef.current) return
    const parsed = parseTargetInput(draft)
    if (!parsed.ok) {
      setError('invalid')
      return
    }
    if (parsed.value === current && !(announceUnchanged && current !== null)) {
      close(restoreFocus)
      return
    }
    settlingRef.current = true
    try {
      const result = await onSave(parsed.value)
      if (result.ok) close(restoreFocus)
      else setError('save')
    } finally {
      settlingRef.current = false
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commit(true, true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    }
  }

  if (!editing || disabled) {
    const label =
      current === null
        ? `Set monthly target for ${groupName}`
        : `${groupName} monthly target ${formatTargetAmount(current)}, edit`
    return (
      <button
        ref={buttonRef}
        type="button"
        className={`budget-target-btn${current === null ? ' budget-target-btn--empty' : ''}`}
        aria-label={label}
        aria-disabled={disabled || undefined}
        onClick={open}
      >
        {current === null ? 'Set target' : formatTargetAmount(current)}
      </button>
    )
  }

  const describedBy = error ? `${hintId} ${errorId}` : hintId
  return (
    <div className="budget-target-editor">
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        className="budget-target-input"
        aria-label={`Monthly target for ${groupName}`}
        aria-describedby={describedBy}
        aria-invalid={error === 'invalid' ? 'true' : undefined}
        autoComplete="off"
        value={draft}
        onChange={event => {
          setDraft(event.target.value)
          setError(null)
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => void commit(false, false)}
      />
      <span id={hintId} className="budget-target-hint">
        {HINT}
      </span>
      {error && (
        <span id={errorId} className="budget-target-error">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <circle cx="6" cy="6" r="4.75" fill="none" stroke="currentColor" strokeWidth="1.25" />
            <path d="M6 3.5v3M6 8.25v.01" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
          </svg>
          <span>{error === 'invalid' ? VALIDATION_ERROR : SAVE_ERROR_MESSAGE}</span>
        </span>
      )}
    </div>
  )
}

export default BudgetTargetCell
