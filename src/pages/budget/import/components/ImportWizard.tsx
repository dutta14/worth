import { Dispatch, FC, useEffect, useMemo, useRef } from 'react'
import { useFocusTrap } from '../../../../hooks/useFocusTrap'
import { resolveMapping } from '../mapping'
import { columnsBlockReason, failureMessage } from '../messages'
import { countLabel } from '../reviewRows'
import type { ImportPlan } from '../types'
import { canGoBack, hasColumnsStep, type WizardAction, type WizardState } from '../wizardState'
import ColumnsStep from './ColumnsStep'
import ResultStep from './ResultStep'
import ReviewStep from './ReviewStep'
import '../../../../styles/ImportWizard.css'

interface ImportWizardProps {
  state: WizardState
  plan: ImportPlan | null
  canUndo: boolean
  dispatch: Dispatch<WizardAction>
  onConfirm: () => void
  onCancel: () => void
  onUndo: () => void
  onPickAgain: () => void
  onViewTransactions?: () => void
}

const stepLabel = (state: WizardState): string | null => {
  const total = hasColumnsStep(state.files) ? 2 : 1
  if (state.phase === 'columns') return `Step 1 of ${total}: Columns`
  if (state.phase === 'review' || state.phase === 'committing') return `Step ${total} of ${total}: Review`
  return null
}

const ImportWizard: FC<ImportWizardProps> = ({
  state,
  plan,
  canUndo,
  dispatch,
  onConfirm,
  onCancel,
  onUndo,
  onPickAgain,
  onViewTransactions,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null)
  const { phase, files, fileIndex, commit } = state
  const committing = phase === 'committing'
  const file = files[fileIndex]

  useFocusTrap(dialogRef, true)

  // Declared after the focus trap so the step heading wins over the trap's "first focusable" default.
  const stepKey = `${committing ? 'review' : phase}:${fileIndex}`
  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('[data-iw-step-heading]')?.focus()
  }, [stepKey])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !committing) onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [committing, onCancel])

  const resolved = useMemo(
    () => (phase === 'columns' && file ? resolveMapping(file.parsed.detection.dataRecords, file.draft) : null),
    [phase, file],
  )
  const hasLaterPending = files.some((f, i) => i > fileIndex && f.mapping === null)
  const stepper = stepLabel(state)

  const announcement = (() => {
    if (phase === 'loading') return `Reading ${state.loadingNames.join(', ')}...`
    if (phase === 'error') return state.failure?.message ?? ''
    if (phase === 'columns') return stepper ?? ''
    if ((phase === 'review' || committing) && plan) {
      const summary =
        plan.totals.newRows === 0
          ? 'Nothing new to import.'
          : `${countLabel(plan.totals.newRows, 'new transaction', 'new transactions')}.`
      return committing ? 'Importing...' : `${stepper}. ${summary}`
    }
    if (phase === 'result' && commit) {
      if (!commit.ok) return failureMessage(commit)
      return state.undone
        ? 'Import undone. Your budget is back to how it was.'
        : `Imported ${countLabel(commit.imported, 'transaction', 'transactions')}.`
    }
    return ''
  })()

  const canImport = plan !== null && plan.totals.newRows > 0
  const columnsReason = resolved?.problems[0] ? columnsBlockReason(resolved.problems[0]) : null
  const reason =
    phase === 'columns' ? columnsReason : phase === 'review' && !canImport ? 'Nothing new to import.' : null
  const reasonId = 'iw-reason'

  const primary = (() => {
    switch (phase) {
      case 'columns':
        return {
          label: hasLaterPending ? 'Continue' : 'Continue to review',
          enabled: columnsReason === null,
          run: () => dispatch({ type: 'confirm-columns' }),
        }
      case 'review':
        return {
          label: `Import ${countLabel(plan?.totals.newRows ?? 0, 'transaction', 'transactions')}`,
          enabled: canImport,
          run: onConfirm,
        }
      case 'committing':
        return { label: 'Importing...', enabled: false, run: () => {} }
      case 'result':
        return commit && !commit.ok
          ? { label: 'Try again', enabled: true, run: () => dispatch({ type: 'review-again' }) }
          : { label: 'Done', enabled: true, run: onCancel }
      case 'error':
        return state.failure?.canPickAgain ? { label: 'Choose another file', enabled: true, run: onPickAgain } : null
      default:
        return null
    }
  })()

  const showCancelNote = phase === 'columns' || phase === 'review'
  const cancelLabel = phase === 'result' || phase === 'error' ? 'Close' : 'Cancel'
  const showCancel = !(phase === 'result' && commit?.ok)

  return (
    <div className="iw-overlay">
      <div ref={dialogRef} className="iw-dialog" role="dialog" aria-modal="true" aria-labelledby="iw-title">
        <header className="iw-header">
          <h2 id="iw-title" className="iw-title">
            Import transactions
          </h2>
          {stepper && <p className="iw-stepper">{stepper}</p>}
        </header>
        <div className="iw-live sr-only" role="status" aria-live="polite">
          {announcement}
        </div>
        <div className="iw-body" aria-busy={phase === 'loading' || committing}>
          {phase === 'loading' && (
            <section>
              <h3 className="iw-step-title" tabIndex={-1} data-iw-step-heading>
                Reading {state.loadingNames.join(', ')}...
              </h3>
              <div className="iw-spinner" aria-hidden="true" />
            </section>
          )}
          {phase === 'error' && state.failure && (
            <section>
              <h3 className="iw-step-title" tabIndex={-1} data-iw-step-heading>
                Could not open the file
              </h3>
              <p className="iw-error" role="alert">
                {state.failure.message}
              </p>
            </section>
          )}
          {phase === 'columns' && file && (
            <ColumnsStep
              key={fileIndex}
              file={file}
              fileIndex={fileIndex}
              fileCount={files.length}
              onDraft={draft => dispatch({ type: 'draft', draft })}
              onReparse={settings => dispatch({ type: 'reparse', settings })}
            />
          )}
          {(phase === 'review' || committing) && plan && (
            <ReviewStep plan={plan} onOptions={options => dispatch({ type: 'options', options })} />
          )}
          {phase === 'result' && commit && (
            <ResultStep
              result={commit}
              undone={state.undone}
              undoFailed={state.undoFailed}
              canUndo={canUndo}
              onUndo={onUndo}
            />
          )}
        </div>
        <footer className="iw-footer">
          {reason && (
            <p id={reasonId} className="iw-muted iw-reason">
              {reason}
            </p>
          )}
          <div className="iw-actions">
            {(phase === 'columns' || phase === 'review') && canGoBack(state) && (
              <button type="button" className="iw-btn" onClick={() => dispatch({ type: 'back' })}>
                Back
              </button>
            )}
            {showCancel && (
              <button type="button" className="iw-btn" disabled={committing} onClick={onCancel}>
                {cancelLabel}
              </button>
            )}
            {phase === 'result' && commit?.ok && onViewTransactions && (
              <button type="button" className="iw-btn" onClick={onViewTransactions}>
                View in Transactions
              </button>
            )}
            {primary && (
              <button
                type="button"
                className="iw-btn iw-btn--primary"
                aria-disabled={!primary.enabled}
                aria-describedby={reason ? reasonId : undefined}
                onClick={() => primary.enabled && primary.run()}
              >
                {primary.label}
              </button>
            )}
          </div>
          {showCancelNote && <p className="iw-muted iw-note">Nothing has been saved yet.</p>}
        </footer>
      </div>
    </div>
  )
}

export default ImportWizard
