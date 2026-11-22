import { plural } from '../../../utils/plural'
import { MAX_RULE_VALUE, MAX_RULES, MIN_RULE_VALUE, type RuleError } from './rules'
import { formatMonthList } from './format'
import type { RulesLoad, RulesSaveResult } from './importStorage'

export const RULES_TITLE = 'Categorization rules'
export const RULES_INTRO = 'Rules sort new transactions by what the description contains. The first matching rule wins.'
export const RULES_EMPTY = 'No rules yet. Add one to sort a merchant automatically.'
export const RULE_VALUE_LABEL = 'Description contains'
export const RULE_CATEGORY_LABEL = 'Category'
export const RULE_CATEGORY_PLACEHOLDER = 'Choose a category'
export const RULE_UNSUPPORTED = 'This rule needs a newer version of Worth. It is kept as it is and not applied.'
export const RULE_CATEGORY_MISSING = 'This category no longer exists, so the rule is skipped.'

export const ruleErrorMessage = (error: RuleError, value: string): string => {
  switch (error) {
    case 'short':
      return `Enter at least ${MIN_RULE_VALUE} characters.`
    case 'long':
      return `Use ${MAX_RULE_VALUE} characters or fewer.`
    case 'duplicate':
      return `A rule for "${value}" already exists.`
    case 'category':
      return 'Choose a category.'
    case 'limit':
      return `You have reached the limit of ${MAX_RULES} rules. Delete one to add another.`
  }
}

export const rulesSkippedMessage = (n: number): string =>
  `${n.toLocaleString()} ${plural(n, 'rule', 'rules')} skipped because the category no longer exists.`

export const rulesSortedMessage = (n: number): string =>
  `${n.toLocaleString()} ${plural(n, 'transaction', 'transactions')} sorted by your rules`

/** Shown when the rules file cannot be used; the file is never changed. */
export const rulesWarning = (reason: Extract<RulesLoad, { state: 'unreadable' }>['reason']): string =>
  reason === 'newer'
    ? 'Your rules file was saved by a newer version of Worth, so rules are off for this import. The file is left as it is.'
    : 'Your rules file could not be read, so rules are off for this import. The file has not been changed.'

export const rulesSaveFailure = (reason: Extract<RulesSaveResult, { ok: false }>['reason']): string =>
  reason === 'unreadable'
    ? 'Your rules file could not be read, so nothing was saved. The file has not been changed.'
    : 'Your rules could not be saved. Check that the worth folder is still available, then try again.'

export const ruleSaved = (value: string): string => `Rule saved: ${value}.`

export const ruleDeleted = (value: string): string => `Rule deleted: ${value}.`

export const ruleMoved = (value: string, position: number, total: number): string =>
  `Moved rule ${value} to position ${position} of ${total}.`

export const ruleToggled = (value: string, enabled: boolean): string =>
  `Rule ${value} turned ${enabled ? 'on' : 'off'}.`

export const CREATE_RULE_HEADING = 'Create a rule'

export const createRuleEntryLabel = (category: string | null): string =>
  category ? `Always categorize merchants like this as ${category}` : 'Always categorize merchants like this as…'

export const ruleMatchPreview = (n: number, value: string): string =>
  `${n.toLocaleString()} ${plural(n, 'transaction', 'transactions')} match "${value}".`

export const RULE_CREATE_LABEL = 'Create rule'

export const ruleCreateAndApplyLabel = (n: number): string => `Create rule and apply to ${n.toLocaleString()}`

export const RULE_CREATED = 'Rule saved.'

export const ruleCreatedAndApplied = (k: number): string => `${RULE_CREATED} ${applyDoneMessage(k)}`

export const APPLY_BUTTON_LABEL = 'Apply rules to uncategorized'

export const applyConfirmTitle = (n: number): string =>
  `Apply rules to ${n.toLocaleString()} uncategorized ${plural(n, 'transaction', 'transactions')}?`

export const APPLY_CONFIRM_BODY =
  'Only uncategorized transactions change. Anything you have categorized stays as it is.'

export const APPLY_NONE = 'No uncategorized transactions match your rules.'

export const APPLY_UNDONE = 'Undone. Those transactions are back to how they were.'

export const applyDoneMessage = (k: number): string =>
  `Recategorized ${k.toLocaleString()} ${plural(k, 'transaction', 'transactions')}.`

export const applyFailureMessage = (reason: 'stale' | 'write', months: string[], restored: boolean): string => {
  if (reason === 'stale') return 'Your transactions changed while this window was open. Close it and try again.'
  const tail = restored ? '' : ' Some months may be partly changed, so check your transactions before trying again.'
  return `Nothing was applied. ${formatMonthList(months)} could not be saved. Check that the worth folder is still available, then try again.${tail}`
}

export const APPLY_UNDO_FAILURE =
  'The change could not be undone. Check that the worth folder is still available, then try again.'

export const MANAGE_RULES_LABEL = 'Rules'
