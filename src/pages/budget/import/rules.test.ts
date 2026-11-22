import { describe, it, expect } from 'vitest'
import { containsRule } from '../../../test/importHelpers'
import type { CategoryGroup } from '../types'
import type { NormalizedRow } from './types'
import {
  addRule,
  applyRules,
  categoryResolver,
  cleanRuleValue,
  compileRules,
  isContainsRule,
  matchRules,
  matchRulesDetailed,
  MAX_RULES,
  moveRule,
  nextRuleId,
  normalizeDescription,
  parseRulesFile,
  removeRule,
  retargetRules,
  ruleCategoryOptions,
  setRuleEnabled,
  suggestRuleValue,
  validateRule,
  type CategoryRule,
} from './rules'

const row = (over: Partial<NormalizedRow> = {}): NormalizedRow => ({
  sourceRow: 1,
  date: '2026-10-02',
  amountCents: -675,
  description: 'STARBUCKS #1234',
  category: null,
  ...over,
})

const groups: CategoryGroup[] = [
  { id: 'food', name: 'Food', categories: ['Dining', 'Groceries'] },
  { id: 'others', name: 'Others', categories: ['Gas', 'dining', 'Uncategorized', ' '] },
  { id: 'income-others', name: 'Others', categories: ['Uncategorized income'], type: 'income' },
]

describe('normalizeDescription and cleanRuleValue', () => {
  it('lowercases, strips diacritics and collapses whitespace', () => {
    expect(normalizeDescription('  CAFÉ   Rouge\t ')).toBe('cafe rouge')
    expect(normalizeDescription('Crème Brûlée')).toBe('creme brulee')
    expect(normalizeDescription('   ')).toBe('')
  })

  it('trims and collapses whitespace without changing case', () => {
    expect(cleanRuleValue('  Star   Bucks ')).toBe('Star Bucks')
  })
})

describe('parseRulesFile', () => {
  const rule = containsRule('r_01', 'STARBUCKS', 'Dining')

  it('reads what this version writes', () => {
    const parsed = parseRulesFile({ schemaVersion: 1, rules: [rule] })
    expect(parsed).toEqual({ kind: 'ok', file: { schemaVersion: 1, rules: [rule] } })
  })

  it('keeps rules of an unknown type, with their extra keys, as they are', () => {
    const future = {
      id: 'r_02',
      match: { field: 'amount', type: 'between', value: [1, 2] },
      category: 'Gas',
      enabled: true,
      note: 'x',
    }
    const parsed = parseRulesFile({ schemaVersion: 1, rules: [future] })
    expect(parsed.kind === 'ok' && parsed.file.rules[0]).toEqual(future)
    expect(parsed.kind === 'ok' && isContainsRule(parsed.file.rules[0])).toBe(false)
  })

  it('reports a newer schema version as newer and everything else unusable as corrupt', () => {
    expect(parseRulesFile({ schemaVersion: 2, rules: [] })).toEqual({ kind: 'newer' })
    expect(parseRulesFile(null)).toEqual({ kind: 'corrupt' })
    expect(parseRulesFile([])).toEqual({ kind: 'corrupt' })
    expect(parseRulesFile({ schemaVersion: 1 })).toEqual({ kind: 'corrupt' })
    expect(parseRulesFile({ schemaVersion: 0, rules: [] })).toEqual({ kind: 'corrupt' })
  })

  it.each([
    ['not an object', 'x'],
    ['no match', { id: 'a', category: 'C', enabled: true }],
    [
      'empty id',
      { id: '', match: { field: 'description', type: 'contains', value: 'ab' }, category: 'C', enabled: true },
    ],
    [
      'bad category',
      { id: 'a', match: { field: 'description', type: 'contains', value: 'ab' }, category: 1, enabled: true },
    ],
    [
      'bad enabled',
      { id: 'a', match: { field: 'description', type: 'contains', value: 'ab' }, category: 'C', enabled: 'yes' },
    ],
    ['bad field', { id: 'a', match: { field: 1, type: 'contains', value: 'ab' }, category: 'C', enabled: true }],
    [
      'contains without a text value',
      { id: 'a', match: { field: 'description', type: 'contains', value: 4 }, category: 'C', enabled: true },
    ],
  ])('treats the whole file as corrupt when a rule is invalid: %s', (_, bad) => {
    expect(parseRulesFile({ schemaVersion: 1, rules: [rule, bad] })).toEqual({ kind: 'corrupt' })
  })
})

describe('categoryResolver and ruleCategoryOptions', () => {
  it('finds categories case-insensitively with the first spelling, and counts the fallbacks as existing', () => {
    const resolve = categoryResolver(groups)
    expect(resolve('DINING')).toBe('Dining')
    expect(resolve(' gas ')).toBe('Gas')
    expect(resolve('Uncategorized')).toBe('Uncategorized')
    expect(categoryResolver([])('Uncategorized income')).toBe('Uncategorized income')
    expect(resolve('Travel')).toBeNull()
  })

  it('lists each category once and leaves out the fallbacks', () => {
    expect(ruleCategoryOptions(groups)).toEqual(['Dining', 'Groceries', 'Gas'])
  })
})

describe('compileRules, matchRules and applyRules', () => {
  const rules: CategoryRule[] = [
    containsRule('r_01', 'starbucks', 'Dining'),
    containsRule('r_02', 'star', 'Groceries'),
    containsRule('r_03', 'shell oil', 'Gas', false),
    containsRule('r_04', 'gone', 'Vanished'),
    containsRule('r_05', ' ', 'Gas'),
    { id: 'r_06', match: { field: 'amount', type: 'gt', value: '5' }, category: 'Gas', enabled: true },
  ]

  it('matches in any case, with extra spaces and diacritics', () => {
    expect(applyRules(row({ description: 'STARBUCKS #1' }), rules)).toBe('Dining')
    expect(
      applyRules(row({ description: '  StarBucks   Coffee' }), [containsRule('a', 'STAR  BUCKS', 'Dining')]),
    ).toBeNull()
    expect(applyRules(row({ description: 'Café  Rouge' }), [containsRule('a', 'CAFE rouge', 'Dining')])).toBe('Dining')
  })

  it('lets the first enabled match win and ignores disabled, blank and unknown-type rules', () => {
    expect(applyRules(row({ description: 'Starlight' }), rules)).toBe('Groceries')
    expect(applyRules(row({ description: 'Shell Oil 55' }), rules)).toBeNull()
    expect(compileRules(rules, name => name).map(r => r.id)).toEqual(['r_01', 'r_02', 'r_04'])
  })

  it('never overrides a category from the file', () => {
    expect(applyRules(row({ category: 'Fuel' }), rules)).toBeNull()
  })

  it('returns null for an empty description', () => {
    expect(
      matchRules(
        compileRules(rules, name => name),
        '  ',
      ),
    ).toEqual({ category: null, skipped: [] })
  })

  it('skips a rule whose category is gone, reports it and lets a later rule win', () => {
    const compiled = compileRules(
      [containsRule('a', 'gone', 'Vanished'), containsRule('b', 'gone', 'Gas')],
      categoryResolver(groups),
    )
    expect(matchRules(compiled, 'gone fishing')).toEqual({ category: 'Gas', skipped: ['a'] })
    expect(matchRules(compiled.slice(0, 1), 'gone fishing')).toEqual({ category: null, skipped: ['a'] })
  })
})

describe('validateRule', () => {
  const existing = [containsRule('r_01', 'Starbucks', 'Dining')]

  it.each([
    [{ value: 'a', category: 'Dining' }, 'short'],
    [{ value: '   a  ', category: 'Dining' }, 'short'],
    [{ value: 'x'.repeat(101), category: 'Dining' }, 'long'],
    [{ value: 'ab', category: '' }, 'category'],
    [{ value: 'ab', category: '  ' }, 'category'],
    [{ value: ' STARBUCKS ', category: 'Gas' }, 'duplicate'],
    [{ value: 'starbucks', category: 'Gas' }, 'duplicate'],
  ])('rejects %j as %s', (draft, expected) => {
    expect(validateRule(draft, existing)).toBe(expected)
  })

  it('accepts two and 100 characters', () => {
    expect(validateRule({ value: 'ab', category: 'Gas' }, existing)).toBeNull()
    expect(validateRule({ value: 'x'.repeat(100), category: 'Gas' }, existing)).toBeNull()
  })

  it('refuses a new rule at the limit', () => {
    const full = Array.from({ length: MAX_RULES }, (_, i) => containsRule(`r_${i}`, `merchant ${i}`, 'Gas'))
    expect(validateRule({ value: 'brand new', category: 'Gas' }, full)).toBe('limit')
    expect(validateRule({ value: 'brand new', category: 'Gas' }, full.slice(1))).toBeNull()
  })

  it('does not treat an unknown-type rule as a duplicate', () => {
    const future: CategoryRule = {
      id: 'x',
      match: { field: 'amount', type: 'gt', value: 'ab' },
      category: 'Gas',
      enabled: true,
    }
    expect(validateRule({ value: 'ab', category: 'Gas' }, [future])).toBeNull()
  })
})

describe('list operations', () => {
  const a = containsRule('r_01', 'aa', 'Dining')
  const b = containsRule('r_02', 'bb', 'Gas')
  const c = containsRule('r_03', 'cc', 'Gas')

  it('adds a cleaned, enabled rule at the end with a fresh id', () => {
    const next = addRule([a, b], { value: '  New   Shop ', category: 'Dining' })
    expect(next).toHaveLength(3)
    expect(next[2]).toEqual(containsRule('r_03', 'New Shop', 'Dining'))
    expect(next.slice(0, 2)).toEqual([a, b])
  })

  it('never reuses an id that is taken', () => {
    expect(nextRuleId([])).toBe('r_01')
    expect(nextRuleId([containsRule('r_02', 'aa', 'X')])).toBe('r_03')
    expect(nextRuleId([containsRule('custom', 'aa', 'X'), containsRule('r_02', 'bb', 'X')])).toBe('r_03')
    expect(
      nextRuleId([containsRule('r_02', 'aa', 'X'), containsRule('r_03', 'bb', 'X'), containsRule('z', 'cc', 'X')]),
    ).toBe('r_04')
  })

  it('removes, toggles and moves without changing the input', () => {
    const list = [a, b, c]
    expect(removeRule(list, 1)).toEqual([a, c])
    expect(setRuleEnabled(list, 0, false)[0].enabled).toBe(false)
    expect(setRuleEnabled(list, 0, false)[1]).toBe(b)
    expect(moveRule(list, 2, -1)).toEqual([a, c, b])
    expect(moveRule(list, 0, 1)).toEqual([b, a, c])
    expect(list).toEqual([a, b, c])
  })

  it('leaves the list alone for a move off either end', () => {
    const list = [a, b]
    expect(moveRule(list, 0, -1)).toBe(list)
    expect(moveRule(list, 1, 1)).toBe(list)
    expect(moveRule(list, 5, -1)).toBe(list)
  })
})

describe('retargetRules', () => {
  const rules = [containsRule('a', 'aa', 'Dining'), containsRule('b', 'bb', 'Cafes'), containsRule('c', 'cc', 'Gas')]

  it('points rules at the merge target and counts them', () => {
    const { rules: next, changed } = retargetRules(rules, ['Dining', 'Cafes'], 'Food')
    expect(changed).toBe(2)
    expect(next.map(r => r.category)).toEqual(['Food', 'Food', 'Gas'])
    expect(rules[0].category).toBe('Dining')
  })

  it('ignores the target itself and reports no change when nothing matches', () => {
    expect(retargetRules(rules, ['Gas'], 'Gas')).toEqual({ rules, changed: 0 })
    expect(retargetRules(rules, ['Travel'], 'Food').changed).toBe(0)
  })
})

describe('matchRulesDetailed', () => {
  const compiled = compileRules(
    [containsRule('r_01', 'gone', 'Missing'), containsRule('r_02', 'starbucks', 'Dining')],
    categoryResolver(groups),
  )

  it('reports which rule won and which were passed over', () => {
    expect(matchRulesDetailed(compiled, 'Gone Starbucks')).toEqual({
      category: 'Dining',
      ruleId: 'r_02',
      skipped: ['r_01'],
    })
  })

  it('returns no rule for an empty or unmatched description', () => {
    expect(matchRulesDetailed(compiled, '  ')).toEqual({ category: null, ruleId: null, skipped: [] })
    expect(matchRulesDetailed(compiled, 'Kroger')).toEqual({ category: null, ruleId: null, skipped: [] })
  })
})

describe('suggestRuleValue', () => {
  it.each([
    ['SQ *BLUE BOTTLE #1234', 'BLUE BOTTLE'],
    ['STARBUCKS #1234', 'STARBUCKS'],
    ["POS Purchase TST* Joe's Pizza 0412", "Joe's Pizza"],
    ['AMAZON MKTPLACE PMTS AMZN.COM/BILL', 'AMAZON MKTPLACE'],
    ['Kroger', 'Kroger'],
    ["Trader Joe's, 55", "Trader Joe's"],
    ['  Whole   Foods  Market  ', 'Whole Foods'],
  ])('suggests the merchant from %s', (description, expected) => {
    expect(suggestRuleValue(description)).toBe(expected)
  })

  it('falls back to the whole description when nothing usable is left', () => {
    expect(suggestRuleValue('12345 67890')).toBe('12345 67890')
    expect(suggestRuleValue('A')).toBe('A')
    expect(suggestRuleValue('')).toBe('')
  })

  it('caps the fallback at 100 characters', () => {
    expect(suggestRuleValue(`1${'2'.repeat(200)}`)).toHaveLength(100)
  })
})
