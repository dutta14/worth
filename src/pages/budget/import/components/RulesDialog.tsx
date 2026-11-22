import { FC, FormEvent, memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useFocusTrap } from '../../../../hooks/useFocusTrap'
import type { CategoryGroup } from '../../types'
import type { RulesLoad, RulesSaveResult } from '../importStorage'
import {
  RULE_CATEGORY_LABEL,
  RULE_CATEGORY_MISSING,
  RULE_CATEGORY_PLACEHOLDER,
  RULE_DELETED,
  RULE_SAVED,
  RULE_UNSUPPORTED,
  RULE_VALUE_LABEL,
  RULES_EMPTY,
  RULES_INTRO,
  RULES_TITLE,
  ruleErrorMessage,
  ruleMoved,
  rulesSaveFailure,
  ruleToggled,
  rulesWarning,
} from '../ruleMessages'
import {
  addRule,
  categoryResolver,
  cleanRuleValue,
  isContainsRule,
  moveRule,
  removeRule,
  ruleCategoryOptions,
  setRuleEnabled,
  validateRule,
  type CategoryRule,
  type RuleError,
} from '../rules'
import '../../../../styles/ImportWizard.css'
import '../../../../styles/ImportRules.css'

interface RulesDialogProps {
  rules: RulesLoad
  categoryGroups: CategoryGroup[]
  /** Saves the whole ordered list. The dialog shows the new list only once this resolves `ok`. */
  onChange: (rules: CategoryRule[]) => Promise<RulesSaveResult>
  onClose: () => void
}

type FocusTarget =
  { kind: 'move'; index: number; direction: -1 | 1 } | { kind: 'delete'; index: number } | { kind: 'form' }

const ruleLabel = (rule: CategoryRule): string =>
  isContainsRule(rule) ? rule.match.value : `${rule.match.field} ${rule.match.type}`

interface RuleRowProps {
  rule: CategoryRule
  index: number
  last: boolean
  categoryMissing: boolean
  onToggle: (index: number) => void
  onMove: (index: number, direction: -1 | 1) => void
  onDelete: (index: number) => void
}

/** Memoized so typing in the add form does not re-render up to 500 rows. */
const RuleRow = memo(function RuleRow({
  rule,
  index,
  last,
  categoryMissing,
  onToggle,
  onMove,
  onDelete,
}: RuleRowProps) {
  const label = ruleLabel(rule)
  const supported = isContainsRule(rule)
  const dim = rule.enabled && supported ? '' : ' iw-muted'
  return (
    <li className="iw-rule">
      <div className="iw-rule-text">
        <span className={`iw-rule-value${dim}`}>{label}</span>
        <span className="iw-muted"> goes to </span>
        <span className={dim.trim()}>{rule.category}</span>
        {!supported && <p className="iw-muted iw-rule-note">{RULE_UNSUPPORTED}</p>}
        {supported && categoryMissing && <p className="iw-warning iw-rule-note">{RULE_CATEGORY_MISSING}</p>}
      </div>
      <div className="iw-rule-actions">
        {supported && (
          <button
            type="button"
            role="switch"
            aria-checked={rule.enabled}
            aria-label={`Active: ${label}`}
            className="iw-switch"
            onClick={() => onToggle(index)}
          >
            <span className="iw-switch-track" aria-hidden="true" />
            <span>Active</span>
          </button>
        )}
        <button
          type="button"
          className="iw-btn"
          data-action="up"
          aria-label={`Move up: ${label}`}
          disabled={index === 0}
          onClick={() => onMove(index, -1)}
        >
          Move up
        </button>
        <button
          type="button"
          className="iw-btn"
          data-action="down"
          aria-label={`Move down: ${label}`}
          disabled={last}
          onClick={() => onMove(index, 1)}
        >
          Move down
        </button>
        <button
          type="button"
          className="iw-btn"
          data-action="delete"
          aria-label={`Delete rule: ${label}`}
          onClick={() => onDelete(index)}
        >
          Delete rule
        </button>
      </div>
    </li>
  )
})

const RulesDialog: FC<RulesDialogProps> = ({ rules, categoryGroups, onChange, onClose }) => {
  const id = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const valueRef = useRef<HTMLInputElement>(null)
  const saving = useRef(false)
  const pendingFocus = useRef<FocusTarget | null>(null)
  const [value, setValue] = useState('')
  const [category, setCategory] = useState('')
  const [error, setError] = useState<RuleError | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  const list = useMemo(() => (rules.state === 'ready' ? rules.file.rules : []), [rules])
  const options = useMemo(() => ruleCategoryOptions(categoryGroups), [categoryGroups])
  const resolve = useMemo(() => categoryResolver(categoryGroups), [categoryGroups])

  useFocusTrap(dialogRef, true)

  // Declared after the focus trap so the heading wins over the trap's "first focusable" default.
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('[data-iw-step-heading]')?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Buttons that move or disappear would drop focus, so it is put back once the new list is on screen.
  useEffect(() => {
    const target = pendingFocus.current
    pendingFocus.current = null
    if (!target) return
    const items = listRef.current?.querySelectorAll<HTMLElement>('li') ?? []
    const button = (index: number, action: string) =>
      items[index]?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`) ?? null
    if (target.kind === 'move') {
      const same = button(target.index, target.direction === -1 ? 'up' : 'down')
      const other = button(target.index, target.direction === -1 ? 'down' : 'up')
      ;(same && !same.disabled ? same : other)?.focus()
    } else if (target.kind === 'delete') {
      const next = button(target.index, 'delete') ?? button(target.index - 1, 'delete')
      if (next) next.focus()
      else valueRef.current?.focus()
    } else valueRef.current?.focus()
  }, [list])

  const commit = useCallback(
    async (next: CategoryRule[], announcement: string, focus: FocusTarget | null): Promise<boolean> => {
      if (saving.current) return false
      saving.current = true
      pendingFocus.current = focus
      const result = await onChange(next)
      saving.current = false
      if (!result.ok) {
        pendingFocus.current = null
        setSaveError(rulesSaveFailure(result.reason))
        return false
      }
      setSaveError(null)
      setStatus(announcement)
      return true
    },
    [onChange],
  )

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const found = validateRule({ value, category }, list)
    setError(found)
    if (found) return
    if (await commit(addRule(list, { value, category }), RULE_SAVED, { kind: 'form' })) {
      setValue('')
      setCategory('')
    }
  }

  const move = useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction
      void commit(moveRule(list, index, direction), ruleMoved(ruleLabel(list[index]), target + 1, list.length), {
        kind: 'move',
        index: target,
        direction,
      })
    },
    [commit, list],
  )

  const toggle = useCallback(
    (index: number) => {
      const enabled = !list[index].enabled
      void commit(setRuleEnabled(list, index, enabled), ruleToggled(ruleLabel(list[index]), enabled), null)
    },
    [commit, list],
  )

  const remove = useCallback(
    (index: number) => void commit(removeRule(list, index), RULE_DELETED, { kind: 'delete', index }),
    [commit, list],
  )

  const valueError = error === 'short' || error === 'long' || error === 'duplicate' ? error : null
  const valueErrorId = `${id}-value-error`
  const categoryErrorId = `${id}-category-error`

  return (
    <div className="iw-overlay">
      <div ref={dialogRef} className="iw-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <header className="iw-header">
          <h2 id={`${id}-title`} className="iw-title iw-title--focusable" tabIndex={-1} data-iw-step-heading>
            {RULES_TITLE}
          </h2>
        </header>
        <div className="iw-live sr-only" role="status" aria-live="polite">
          {status}
        </div>
        <div className="iw-body">
          {rules.state === 'unreadable' ? (
            <p className="iw-warning" role="alert">
              {rulesWarning(rules.reason)}
            </p>
          ) : (
            <>
              <p>{RULES_INTRO}</p>
              {list.length === 0 ? (
                <p className="iw-muted">{RULES_EMPTY}</p>
              ) : (
                <ol ref={listRef} className="iw-rules" aria-label={RULES_TITLE}>
                  {list.map((rule, index) => (
                    <RuleRow
                      key={`${rule.id}:${index}`}
                      rule={rule}
                      index={index}
                      last={index === list.length - 1}
                      categoryMissing={resolve(rule.category) === null}
                      onToggle={toggle}
                      onMove={move}
                      onDelete={remove}
                    />
                  ))}
                </ol>
              )}
              {saveError && (
                <p className="iw-error" role="alert">
                  Error: {saveError}
                </p>
              )}
              <form className="iw-rule-form" aria-labelledby={`${id}-form-title`} noValidate onSubmit={submit}>
                <h3 id={`${id}-form-title`} className="iw-step-title">
                  Add a rule
                </h3>
                <div className="iw-grid">
                  <div className="iw-field">
                    <label className="iw-label" htmlFor={`${id}-value`}>
                      {RULE_VALUE_LABEL}
                    </label>
                    <input
                      ref={valueRef}
                      id={`${id}-value`}
                      className="iw-input"
                      type="text"
                      autoComplete="off"
                      value={value}
                      aria-invalid={valueError !== null}
                      aria-describedby={valueError ? valueErrorId : undefined}
                      onChange={e => {
                        setValue(e.target.value)
                        setError(null)
                      }}
                    />
                    {valueError && (
                      <p id={valueErrorId} className="iw-error iw-field-error">
                        Error: {ruleErrorMessage(valueError, cleanRuleValue(value))}
                      </p>
                    )}
                  </div>
                  <div className="iw-field">
                    <label className="iw-label" htmlFor={`${id}-category`}>
                      {RULE_CATEGORY_LABEL}
                    </label>
                    <select
                      id={`${id}-category`}
                      className="iw-select"
                      value={category}
                      aria-invalid={error === 'category'}
                      aria-describedby={error === 'category' ? categoryErrorId : undefined}
                      onChange={e => {
                        setCategory(e.target.value)
                        setError(null)
                      }}
                    >
                      <option value="">{RULE_CATEGORY_PLACEHOLDER}</option>
                      {options.map(name => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                    {error === 'category' && (
                      <p id={categoryErrorId} className="iw-error iw-field-error">
                        Error: {ruleErrorMessage('category', '')}
                      </p>
                    )}
                  </div>
                </div>
                {error === 'limit' && (
                  <p className="iw-error" role="alert">
                    Error: {ruleErrorMessage('limit', '')}
                  </p>
                )}
                <button type="submit" className="iw-btn iw-btn--primary">
                  Add rule
                </button>
              </form>
            </>
          )}
        </div>
        <footer className="iw-footer">
          <div className="iw-actions">
            <button type="button" className="iw-btn iw-btn--primary" onClick={onClose}>
              Done
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}

export default RulesDialog
