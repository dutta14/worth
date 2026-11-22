import { FC, useId } from 'react'
import type { CommitResult } from '../commitImport'
import type { FormatNote } from '../wizardState'
import { failureMessage, formatNoteMessage, importedMessage, UNDONE_MESSAGE } from '../messages'

interface ResultStepProps {
  result: CommitResult
  undone: boolean
  undoFailed: boolean
  formatNote: FormatNote | null
  canUndo: boolean
  onUndo: () => void
}

const ResultStep: FC<ResultStepProps> = ({ result, undone, undoFailed, formatNote, canUndo, onUndo }) => {
  const id = useId()

  if (!result.ok) {
    return (
      <section className="iw-result" aria-labelledby={`${id}-title`}>
        <h3 id={`${id}-title`} className="iw-step-title" tabIndex={-1} data-iw-step-heading>
          Import did not finish
        </h3>
        <p className="iw-error" role="alert">
          {failureMessage(result)}
        </p>
      </section>
    )
  }

  return (
    <section className="iw-result" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="iw-step-title" tabIndex={-1} data-iw-step-heading>
        {undone ? 'Import undone' : 'Import complete'}
      </h3>
      {undone ? (
        <p>{UNDONE_MESSAGE}</p>
      ) : (
        <>
          <p>{importedMessage(result)}</p>
          {result.snapshotFailed && (
            <p className="iw-warning">A backup could not be made before importing. Your import still went through.</p>
          )}
          {formatNote && (
            <p className={formatNote.kind === 'saved' ? 'iw-muted' : 'iw-warning'}>{formatNoteMessage(formatNote)}</p>
          )}
          <button type="button" className="iw-btn" aria-disabled={!canUndo} onClick={() => canUndo && onUndo()}>
            Undo import
          </button>
          {!canUndo && <p className="iw-muted">Undo is not available because these months changed after the import.</p>}
          {undoFailed && (
            <p className="iw-error" role="alert">
              Error: The import could not be undone. Check that the worth folder is still available, then try again.
            </p>
          )}
        </>
      )}
    </section>
  )
}

export default ResultStep
