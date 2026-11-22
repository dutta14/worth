import { plural } from '../../../utils/plural'
import { MAX_RULE_VALUE, MAX_RULES, MIN_RULE_VALUE, type RuleError } from './rules'
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
