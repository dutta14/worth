import { FC, FormEvent, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useFocusTrap } from '../../../../hooks/useFocusTrap'
import type { CategoryGroup } from '../../types'
import type { RulesLoad } from '../importStorage'
import { countRuleImpact, type ImpactRow } from '../recategorize'
import {
  APPLY_UNDO_FAILURE,
  APPLY_UNDONE,
  CREATE_RULE_HEADING,
  RULE_CATEGORY_LABEL,
  RULE_CATEGORY_PLACEHOLDER,
  RULE_CREATE_LABEL,
  RULE_VALUE_LABEL,
  ruleCreatedAndApplied,
  RULE_CREATED,
  ruleCreateAndApplyLabel,
  ruleErrorMessage,
  ruleMatchPreview,
  rulesWarning,
} from '../ruleMessages'
import {
  categoryResolver,
  cleanRuleValue,
  MIN_RULE_VALUE,
  ruleCategoryOptions,
  suggestRuleValue,
  validateRule,
  type RuleDraft,
  type RuleError,
} from '../rules'
import '../../../../styles/ImportWizard.css'
import '../../../../styles/ImportRules.css'

export type CreateRuleOutcome =
  { ok: true; applied: number | null; canUndo: boolean; warning?: string } | { ok: false; message: string }

interface CreateRuleDialogProps {
  /** The description of the transaction the rule is made from. */
  description: string
  /** The transaction's category now; preselected unless it is one of the two fallbacks. */
  currentCategory: string
  rules: RulesLoad
  categoryGroups: CategoryGroup[]
  /** Every transaction on the page, for the live match count. */
  rows: ImpactRow[]
  /** Saves the rule and, when `apply` is true, moves the uncategorized transactions it wins. */
  onCreate: (draft: RuleDraft, apply: boolean) => Promise<CreateRuleOutcome>
  onUndo: () => Promise<boolean>
  onClose: () => void
}

type Done = { applied: number | null; canUndo: boolean; undone: boolean; warning: string | null }

const CreateRuleDialog: FC<CreateRuleDialogProps> = ({
  description,
  currentCategory,
  rules,
  categoryGroups,
  rows,
  onCreate,
  onUndo,
  onClose,
}) => {
  const id = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const busy = useRef(false)
  const options = useMemo(() => ruleCategoryOptions(categoryGroups), [categoryGroups])
  const resolve = useMemo(() => categoryResolver(categoryGroups), [categoryGroups])
  const list = useMemo(() => (rules.state === 'ready' ? rules.file.rules : []), [rules])
  const [value, setValue] = useState(() => suggestRuleValue(description))
  const [category, setCategory] = useState(() => (options.includes(currentCategory) ? currentCategory : ''))
  const [error, setError] = useState<RuleError | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [undoFailed, setUndoFailed] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const [saving, setSaving] = useState(false)

  const deferredValue = useDeferredValue(value)
  const impact = useMemo(
    () => countRuleImpact(rows, list, resolve, { value: deferredValue, category }),
    [rows, list, resolve, deferredValue, category],
  )
  const cleaned = cleanRuleValue(value)
  const showImpact = cleaned.length >= MIN_RULE_VALUE && rules.state === 'ready'

  useFocusTrap(dialogRef, true)

  // Declared after the focus trap so the heading wins over the trap's "first focusable" default.
  const finished = done !== null
  useEffect(() => {
    if (finished) dialogRef.current?.querySelector<HTMLElement>('[data-iw-step-heading]')?.focus()
  }, [finished])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy.current) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const create = async (apply: boolean) => {
    if (busy.current) return
    const found = validateRule({ value, category }, list)
    setError(found)
    if (found) return
    busy.current = true
    setSaving(true)
    setFailure(null)
    const outcome = await onCreate({ value, category }, apply)
    busy.current = false
    setSaving(false)
    if (outcome.ok) {
      setDone({ applied: outcome.applied, canUndo: outcome.canUndo, undone: false, warning: outcome.warning ?? null })
    } else setFailure(outcome.message)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void create(false)
  }

  const undo = async () => {
    if (busy.current) return
    busy.current = true
    const ok = await onUndo()
    busy.current = false
    setUndoFailed(!ok)
    if (ok) setDone(current => (current ? { ...current, undone: true } : current))
  }

  const valueError = error === 'short' || error === 'long' || error === 'duplicate' ? error : null
  const valueErrorId = `${id}-value-error`
  const categoryErrorId = `${id}-category-error`
  const unreadable = rules.state === 'unreadable'
  const doneMessage = done
    ? done.undone
      ? APPLY_UNDONE
      : done.applied === null
        ? RULE_CREATED
        : ruleCreatedAndApplied(done.applied)
    : ''

  return (
    <div className="iw-overlay">
      <div ref={dialogRef} className="iw-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <header className="iw-header">
          <h2 id={`${id}-title`} className="iw-title iw-title--focusable" tabIndex={-1} data-iw-step-heading>
            {CREATE_RULE_HEADING}
          </h2>
        </header>
        <div className="iw-live sr-only" role="status" aria-live="polite">
          {doneMessage}
        </div>
        <div className="iw-body">
          {rules.state === 'unreadable' && (
            <p className="iw-warning" role="alert">
              {rulesWarning(rules.reason)}
            </p>
          )}
          {done ? (
            <section>
              <p>{doneMessage}</p>
              {done.warning && (
                <p className="iw-error" role="alert">
                  Error: {done.warning}
                </p>
              )}
              {undoFailed && (
                <p className="iw-error" role="alert">
                  Error: {APPLY_UNDO_FAILURE}
                </p>
              )}
            </section>
          ) : (
            !unreadable && (
              <form id={`${id}-form`} className="iw-rule-form" noValidate onSubmit={submit}>
                <div className="iw-grid">
                  <div className="iw-field">
                    <label className="iw-label" htmlFor={`${id}-value`}>
                      {RULE_VALUE_LABEL}
                    </label>
                    <input
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
                        Error: {ruleErrorMessage(valueError, cleaned)}
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
                <p className="iw-muted" aria-live="polite">
                  {showImpact ? ruleMatchPreview(impact.matches, cleaned) : ''}
                </p>
                {error === 'limit' && (
                  <p className="iw-error" role="alert">
                    Error: {ruleErrorMessage('limit', '')}
                  </p>
                )}
                {failure && (
                  <p className="iw-error" role="alert">
                    Error: {failure}
                  </p>
                )}
              </form>
            )
          )}
        </div>
        <footer className="iw-footer">
          <div className="iw-actions">
            {done ? (
              <>
                {done.applied !== null && done.canUndo && !done.undone && (
                  <button type="button" className="iw-btn" onClick={undo}>
                    Undo
                  </button>
                )}
                <button type="button" className="iw-btn iw-btn--primary" onClick={onClose}>
                  Done
                </button>
              </>
            ) : (
              <>
                <button type="button" className="iw-btn" disabled={saving} onClick={onClose}>
                  {unreadable ? 'Close' : 'Cancel'}
                </button>
                {!unreadable && (
                  <>
                    {showImpact && impact.applicable > 0 && (
                      <button type="button" className="iw-btn" disabled={saving} onClick={() => void create(true)}>
                        {ruleCreateAndApplyLabel(impact.applicable)}
                      </button>
                    )}
                    <button type="submit" form={`${id}-form`} className="iw-btn iw-btn--primary" disabled={saving}>
                      {RULE_CREATE_LABEL}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}

export default CreateRuleDialog
