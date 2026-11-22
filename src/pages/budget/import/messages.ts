import type { CommitFailure, CommitSuccess } from './commitImport'
import { formatMonthList } from './format'
import type { MappingProblem } from './mapping'
import type { FormatsLoad } from './importStorage'
import { countLabel } from './reviewRows'
import type { FormatNote } from './wizardState'

export const UNDONE_MESSAGE = 'Import undone. Your budget is back to how it was.'

export const importedMessage = (result: CommitSuccess): string =>
  `Imported ${countLabel(result.imported, 'transaction', 'transactions')} into ${countLabel(result.months.length, 'month', 'months')}.`

export const failureMessage = (result: CommitFailure): string => {
  if (result.reason === 'unmergeable') {
    return `${formatMonthList(result.failedMonths)} already has data Worth cannot add to. Nothing was changed.`
  }
  const what = result.categoriesFailed
    ? 'Your categories could not be saved.'
    : `${formatMonthList(result.failedMonths)} could not be saved.`
  const tail = result.restored ? '' : ' Some months may be partly written, so check your budget before trying again.'
  return `Import did not finish. ${what} Check that the worth folder is still available, then try again.${tail}`
}

/** What to tell the user next to a disabled "Continue" button. */
export const columnsBlockReason = (problem: MappingProblem): string => {
  switch (problem) {
    case 'date-column':
      return 'Choose a date column to continue.'
    case 'amount-column':
      return 'Choose an amount column to continue.'
    case 'money-column':
      return 'Choose a money out or money in column to continue.'
    case 'sign':
      return 'Choose which sign means spending to continue.'
    case 'no-dates':
      return 'Choose a different date column or format to continue.'
    case 'date-format':
      return 'Choose a date format to continue.'
  }
}

export const COLUMNS_INTRO = 'Choose which column holds each value.'
export const COLUMNS_INTRO_FIRST_TIME = `${COLUMNS_INTRO} Worth remembers your choices.`

/** Shown in the Columns step when the saved formats file cannot be used; the file is never changed. */
export const formatsWarning = (reason: Extract<FormatsLoad, { state: 'unreadable' }>['reason']): string =>
  reason === 'newer'
    ? 'Your saved formats file was saved by a newer version of Worth. It is left as it is.'
    : 'Your saved formats file could not be read. You can still map columns by hand. The file has not been changed.'

export const savedFormatLabel = (name: string): string => `Using saved format: ${name}`

export const formatNoteMessage = (note: FormatNote): string => {
  if (note.kind === 'saved') return `Saved format: ${note.names.join(', ')}.`
  return note.reason === 'unreadable'
    ? 'Your import went through. The format was not saved because your saved formats file could not be read. The file has not been changed.'
    : 'Your import went through, but the format could not be saved. Check that the worth folder is still available.'
}
