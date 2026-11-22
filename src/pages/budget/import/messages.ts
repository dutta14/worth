import type { CommitFailure } from './commitImport'
import { formatMonthList } from './format'
import type { MappingProblem } from './mapping'

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
