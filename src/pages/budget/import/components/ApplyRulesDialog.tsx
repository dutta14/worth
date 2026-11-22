import { FC, useEffect, useId, useRef, useState } from 'react'
import { useFocusTrap } from '../../../../hooks/useFocusTrap'
import type { RulesLoad } from '../importStorage'
import type { RecategorizeResult } from '../recategorize'
import {
  APPLY_BUTTON_LABEL,
  APPLY_CONFIRM_BODY,
  APPLY_NONE,
  APPLY_UNDO_FAILURE,
  APPLY_UNDONE,
  applyConfirmTitle,
  applyDoneMessage,
  applyFailureMessage,
  rulesSkippedMessage,
  rulesWarning,
} from '../ruleMessages'
import '../../../../styles/ImportWizard.css'

interface ApplyRulesDialogProps {
  rules: RulesLoad
  /** Uncategorized transactions the rules would move, worked out before the dialog opened. */
  count: number
  skippedRules: number
  onApply: () => Promise<RecategorizeResult>
  /** Resolves true when the change was reversed. */
  onUndo: (result: Extract<RecategorizeResult, { ok: true }>) => Promise<boolean>
  /** True while the months still hold what the apply wrote. */
  canUndo: (result: Extract<RecategorizeResult, { ok: true }>) => boolean
  onClose: () => void
}

type Phase =
  | { kind: 'confirm' }
  | { kind: 'applying' }
  | { kind: 'done'; result: Extract<RecategorizeResult, { ok: true }>; undone: boolean }
  | { kind: 'failed'; result: Extract<RecategorizeResult, { ok: false }> }

const ApplyRulesDialog: FC<ApplyRulesDialogProps> = ({
  rules,
  count,
  skippedRules,
  onApply,
  onUndo,
  canUndo,
  onClose,
}) => {
  const id = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const busy = useRef(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'confirm' })
  const [undoFailed, setUndoFailed] = useState(false)

  useFocusTrap(dialogRef, true)

  // Declared after the focus trap so the step heading wins over the trap's "first focusable" default.
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('[data-iw-step-heading]')?.focus()
  }, [phase.kind])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy.current) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const apply = async () => {
    if (busy.current) return
    busy.current = true
    setPhase({ kind: 'applying' })
    const result = await onApply()
    busy.current = false
    setPhase(result.ok ? { kind: 'done', result, undone: false } : { kind: 'failed', result })
  }

  const undo = async () => {
    if (busy.current || phase.kind !== 'done') return
    busy.current = true
    const ok = await onUndo(phase.result)
    busy.current = false
    setUndoFailed(!ok)
    if (ok) setPhase({ kind: 'done', result: phase.result, undone: true })
  }

  const unreadable = rules.state === 'unreadable'
  const nothing = !unreadable && count === 0
  const title = (() => {
    if (unreadable || nothing) return APPLY_BUTTON_LABEL
    if (phase.kind === 'done') return phase.undone ? 'Undone' : 'Rules applied'
    if (phase.kind === 'failed') return 'Rules were not applied'
    return applyConfirmTitle(count)
  })()
  const status = phase.kind === 'done' ? (phase.undone ? APPLY_UNDONE : applyDoneMessage(phase.result.changed)) : ''
  const confirming = phase.kind === 'confirm' || phase.kind === 'applying'

  return (
    <div className="iw-overlay">
      <div ref={dialogRef} className="iw-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`}>
        <header className="iw-header">
          <h2 id={`${id}-title`} className="iw-title iw-title--focusable" tabIndex={-1} data-iw-step-heading>
            {title}
          </h2>
        </header>
        <div className="iw-live sr-only" role="status" aria-live="polite">
          {status}
        </div>
        <div className="iw-body" aria-busy={phase.kind === 'applying'}>
          {rules.state === 'unreadable' && (
            <p className="iw-warning" role="alert">
              {rulesWarning(rules.reason)}
            </p>
          )}
          {nothing && <p>{APPLY_NONE}</p>}
          {!unreadable && !nothing && confirming && <p>{APPLY_CONFIRM_BODY}</p>}
          {!unreadable && skippedRules > 0 && confirming && (
            <p className="iw-warning">{rulesSkippedMessage(skippedRules)}</p>
          )}
          {phase.kind === 'done' && (
            <>
              <p>{status}</p>
              {undoFailed && (
                <p className="iw-error" role="alert">
                  Error: {APPLY_UNDO_FAILURE}
                </p>
              )}
            </>
          )}
          {phase.kind === 'failed' && (
            <p className="iw-error" role="alert">
              {applyFailureMessage(phase.result.reason, phase.result.failedMonths, phase.result.restored)}
            </p>
          )}
        </div>
        <footer className="iw-footer">
          <div className="iw-actions">
            {confirming && !unreadable && !nothing ? (
              <>
                <button type="button" className="iw-btn" disabled={phase.kind === 'applying'} onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="iw-btn iw-btn--primary"
                  disabled={phase.kind === 'applying'}
                  onClick={() => void apply()}
                >
                  {phase.kind === 'applying' ? 'Applying...' : 'Apply rules'}
                </button>
              </>
            ) : (
              <>
                {phase.kind === 'done' && !phase.undone && canUndo(phase.result) && (
                  <button type="button" className="iw-btn" onClick={() => void undo()}>
                    Undo
                  </button>
                )}
                <button type="button" className="iw-btn iw-btn--primary" onClick={onClose}>
                  {phase.kind === 'done' ? 'Done' : 'Close'}
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}

export default ApplyRulesDialog
