import { describe, it, expect } from 'vitest'
import { containsRule, DEFAULT_TEST_GROUPS, planFromTexts } from '../../../test/importHelpers'
import type { CategoryGroup } from '../types'
import type { CategoryRule } from './rules'
import f02b from './fixtures/F02b-transaction-date.csv?raw'

const groups: CategoryGroup[] = [
  { id: 'food', name: 'Food', categories: ['Dining'] },
  ...DEFAULT_TEST_GROUPS.map(group => (group.id === 'others' ? { ...group, categories: ['Gas'] } : group)),
]

const plan = (rules: CategoryRule[] | undefined, text = f02b) =>
  planFromTexts([{ name: 'bank.csv', text }], { groups, rules })

const categoryOf = (result: ReturnType<typeof plan>, description: string) =>
  Object.values(result.months)
    .flatMap(month => month.added)
    .find(row => row.description === description)?.resolvedCategory

describe('buildImportPlan with rules', () => {
  it('files matching rows under the rule category and leaves the rest as fallbacks', () => {
    const result = plan([containsRule('r_01', 'STARBUCKS', 'Dining')])
    expect(categoryOf(result, 'Starbucks')).toBe('Dining')
    expect(categoryOf(result, 'Shell Oil')).toBe('Uncategorized')
    expect(result.rulesApplied).toBe(1)
    expect(result.rulesSkipped).toBe(0)
    expect(result.fallbackCount).toBe(2)
    expect(result.newCategories.map(c => c.name)).not.toContain('Dining')
  })

  it('does nothing without rules, or when every rule is off', () => {
    expect(plan(undefined).rulesApplied).toBe(0)
    const off = plan([containsRule('r_01', 'starbucks', 'Dining', false)])
    expect(off.rulesApplied).toBe(0)
    expect(off.fallbackCount).toBe(3)
  })

  it('uses the first matching rule and the budget spelling of the category', () => {
    const result = plan([containsRule('r_01', 'starbucks', 'DINING'), containsRule('r_02', 'star', 'Gas')])
    expect(categoryOf(result, 'Starbucks')).toBe('Dining')
  })

  it('never overrides a category from the file', () => {
    const text = 'Date,Category,Amount,Description\n2026-10-02,Coffee,-6.75,Starbucks\n2026-10-03,,-5.00,Starbucks'
    const result = plan([containsRule('r_01', 'starbucks', 'Dining')], text)
    expect(categoryOf(result, 'Starbucks')).toBe('Coffee')
    expect(result.rulesApplied).toBe(1)
    expect(Object.values(result.months)[0].added.map(row => row.resolvedCategory)).toEqual(['Coffee', 'Dining'])
  })

  it('skips a rule whose category no longer exists, counts it once, and never creates the category', () => {
    const result = plan([containsRule('r_01', 'starbucks', 'Vanished'), containsRule('r_02', 'shell', 'Gone too')])
    expect(categoryOf(result, 'Starbucks')).toBe('Uncategorized')
    expect(result.rulesApplied).toBe(0)
    expect(result.rulesSkipped).toBe(2)
    expect(result.newCategories.map(c => c.name)).not.toContain('Vanished')
  })

  it('lets a rule target a fallback category', () => {
    const result = plan([containsRule('r_01', 'payroll', 'Uncategorized income')])
    expect(categoryOf(result, 'Payroll Acme Corp')).toBe('Uncategorized income')
    expect(result.rulesApplied).toBe(1)
  })

  it('counts only rows that will be imported', () => {
    const existing = { '2026-10': 'Date,Category,Amount,Description\n2026-10-02,Dining,-6.75,Starbucks' }
    const result = planFromTexts([{ name: 'bank.csv', text: f02b }], {
      groups,
      existing,
      rules: [containsRule('r_01', 'starbucks', 'Dining'), containsRule('r_02', 'shell', 'Missing')],
    })
    expect(result.totals.duplicates).toBe(1)
    expect(result.rulesApplied).toBe(0)
    expect(result.rulesSkipped).toBe(1)
  })

  it('does not change what counts as a duplicate', () => {
    const existing = { '2026-10': 'Date,Category,Amount,Description\n2026-10-02,Gas,-6.75,Starbucks' }
    const result = planFromTexts([{ name: 'bank.csv', text: f02b }], {
      groups,
      existing,
      rules: [containsRule('r_01', 'starbucks', 'Dining')],
    })
    expect(result.totals.duplicates).toBe(1)
    expect(result.totals.newRows).toBe(2)
  })
})
