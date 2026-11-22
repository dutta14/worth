import type { CategoryGroup } from '../types'
import { UNCATEGORIZED_EXPENSE, UNCATEGORIZED_INCOME } from './constants'
import type { NormalizedRow } from './types'

export const RULES_SCHEMA_VERSION = 1
export const MAX_RULES = 500
export const MIN_RULE_VALUE = 2
export const MAX_RULE_VALUE = 100

/** `value` is `unknown` because a rule type this version does not know may carry any kind of value. */
export interface RuleMatch {
  field: string
  type: string
  value: unknown
}

export interface CategoryRule {
  id: string
  match: RuleMatch
  /** A category name, the way month files and categories.json refer to categories. */
  category: string
  enabled: boolean
}

/** The only rule v1 understands: the description contains a value. */
export interface ContainsRule extends CategoryRule {
  match: { field: 'description'; type: 'contains'; value: string }
}

export interface RulesFile {
  schemaVersion: typeof RULES_SCHEMA_VERSION
  rules: CategoryRule[]
}

export const emptyRulesFile = (): RulesFile => ({ schemaVersion: RULES_SCHEMA_VERSION, rules: [] })

export type RulesParse = { kind: 'ok'; file: RulesFile } | { kind: 'corrupt' } | { kind: 'newer' }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const isContainsRule = (rule: CategoryRule): rule is ContainsRule =>
  rule.match.field === 'description' && rule.match.type === 'contains' && typeof rule.match.value === 'string'

/** Rules of a type this version does not know are kept as they are (extra keys included) and never applied. */
function parseRule(raw: unknown): CategoryRule | null {
  if (!isRecord(raw) || !isRecord(raw.match)) return null
  if (typeof raw.id !== 'string' || raw.id === '' || typeof raw.category !== 'string') return null
  if (typeof raw.enabled !== 'boolean') return null
  const { field, type, value } = raw.match
  if (typeof field !== 'string' || typeof type !== 'string') return null
  if (field === 'description' && type === 'contains' && typeof value !== 'string') return null
  return { ...raw, match: { ...raw.match } } as unknown as CategoryRule
}

/**
 * Reads the raw file content. Anything that is not what this version writes is refused whole, so the file is
 * never rewritten from a partial reading: a newer `schemaVersion` is 'newer', everything else 'corrupt'.
 */
export function parseRulesFile(raw: unknown): RulesParse {
  if (!isRecord(raw)) return { kind: 'corrupt' }
  if (typeof raw.schemaVersion === 'number' && raw.schemaVersion > RULES_SCHEMA_VERSION) return { kind: 'newer' }
  if (raw.schemaVersion !== RULES_SCHEMA_VERSION || !Array.isArray(raw.rules)) return { kind: 'corrupt' }
  const rules: CategoryRule[] = []
  for (const entry of raw.rules) {
    const rule = parseRule(entry)
    if (rule === null) return { kind: 'corrupt' }
    rules.push(rule)
  }
  return { kind: 'ok', file: { schemaVersion: RULES_SCHEMA_VERSION, rules } }
}

/** Lowercase, no diacritics, single spaces: "  CAFÉ   Rouge " becomes "cafe rouge". */
export const normalizeDescription = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** The value as it is stored: trimmed, with runs of whitespace collapsed. */
export const cleanRuleValue = (value: string): string => value.replace(/\s+/g, ' ').trim()

export interface CompiledRule {
  id: string
  needle: string
  /** The category as spelled in the budget, or null when the category no longer exists. */
  category: string | null
}

/** Case-insensitive lookup of a category name; returns the budget's own spelling, or null if unknown. */
export type CategoryResolver = (name: string) => string | null

/**
 * The two fallback categories count as existing: they are created on demand, and a rule may target them.
 * The first spelling of a name wins.
 */
export function categoryResolver(groups: CategoryGroup[]): CategoryResolver {
  const known = new Map<string, string>()
  const add = (name: string) => {
    const key = name.trim().toLowerCase()
    if (!known.has(key)) known.set(key, name)
  }
  groups.forEach(group => group.categories.forEach(add))
  add(UNCATEGORIZED_EXPENSE)
  add(UNCATEGORIZED_INCOME)
  return name => known.get(name.trim().toLowerCase()) ?? null
}

/** The categories a rule can target: every category in the budget except the two fallbacks. */
export function ruleCategoryOptions(groups: CategoryGroup[]): string[] {
  const fallbacks = new Set([UNCATEGORIZED_EXPENSE.toLowerCase(), UNCATEGORIZED_INCOME.toLowerCase()])
  const seen = new Set<string>()
  const options: string[] = []
  for (const category of groups.flatMap(group => group.categories)) {
    const key = category.trim().toLowerCase()
    if (key === '' || fallbacks.has(key) || seen.has(key)) continue
    seen.add(key)
    options.push(category)
  }
  return options
}

/** Enabled rules this version understands, with values normalized once so each row costs one substring check per rule. */
export function compileRules(rules: CategoryRule[], resolve: CategoryResolver): CompiledRule[] {
  const compiled: CompiledRule[] = []
  for (const rule of rules) {
    if (!rule.enabled || !isContainsRule(rule)) continue
    const needle = normalizeDescription(rule.match.value)
    if (needle !== '') compiled.push({ id: rule.id, needle, category: resolve(rule.category) })
  }
  return compiled
}

export interface RuleMatchResult {
  category: string | null
  /** Matching rules passed over because their category no longer exists. */
  skipped: string[]
}

/** The first rule that matches and still has a category wins; one whose category is gone is skipped and reported. */
export function matchRules(compiled: CompiledRule[], description: string): RuleMatchResult {
  const text = normalizeDescription(description)
  const skipped: string[] = []
  if (text === '') return { category: null, skipped }
  for (const rule of compiled) {
    if (!text.includes(rule.needle)) continue
    if (rule.category === null) skipped.push(rule.id)
    else return { category: rule.category, skipped }
  }
  return { category: null, skipped }
}

/** The category the rules give a row, or null. A category supplied by the file is never overridden. */
export function applyRules(row: NormalizedRow, rules: CategoryRule[]): string | null {
  if (row.category !== null) return null
  return matchRules(
    compileRules(rules, name => name),
    row.description,
  ).category
}

export type RuleError = 'short' | 'long' | 'category' | 'duplicate' | 'limit'

export interface RuleDraft {
  value: string
  category: string
}

/** First problem with a new rule, or null. At the limit nothing can be added, so that is reported first. */
export function validateRule(draft: RuleDraft, existing: CategoryRule[]): RuleError | null {
  if (existing.length >= MAX_RULES) return 'limit'
  const value = cleanRuleValue(draft.value)
  if (value.length < MIN_RULE_VALUE) return 'short'
  if (value.length > MAX_RULE_VALUE) return 'long'
  if (draft.category.trim() === '') return 'category'
  const needle = normalizeDescription(value)
  const taken = existing.some(rule => isContainsRule(rule) && normalizeDescription(rule.match.value) === needle)
  return taken ? 'duplicate' : null
}

const idNumber = (id: string): number => {
  const match = /^r_(\d+)$/.exec(id)
  return match ? Number(match[1]) : 0
}

export function nextRuleId(rules: CategoryRule[]): string {
  const used = new Set(rules.map(rule => rule.id))
  let n = Math.max(rules.length, ...rules.map(rule => idNumber(rule.id))) + 1
  while (used.has(`r_${String(n).padStart(2, '0')}`)) n++
  return `r_${String(n).padStart(2, '0')}`
}

/** Appends a rule; the caller has validated it. New rules go last, so existing behavior does not change. */
export const addRule = (rules: CategoryRule[], draft: RuleDraft): CategoryRule[] => [
  ...rules,
  {
    id: nextRuleId(rules),
    match: { field: 'description', type: 'contains', value: cleanRuleValue(draft.value) },
    category: draft.category,
    enabled: true,
  },
]

export const removeRule = (rules: CategoryRule[], index: number): CategoryRule[] => rules.filter((_, i) => i !== index)

export const setRuleEnabled = (rules: CategoryRule[], index: number, enabled: boolean): CategoryRule[] =>
  rules.map((rule, i) => (i === index ? { ...rule, enabled } : rule))

/** Moves a rule one place earlier (-1) or later (1); out-of-range moves return the list unchanged. */
export function moveRule(rules: CategoryRule[], index: number, direction: -1 | 1): CategoryRule[] {
  const target = index + direction
  if (index < 0 || index >= rules.length || target < 0 || target >= rules.length) return rules
  const next = [...rules]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

/** Points rules at `to` when they target one of the merged-away categories. `changed` is the number of rules updated. */
export function retargetRules(
  rules: CategoryRule[],
  from: readonly string[],
  to: string,
): { rules: CategoryRule[]; changed: number } {
  const sources = new Set(from.filter(name => name !== to))
  let changed = 0
  const next = rules.map(rule => {
    if (!sources.has(rule.category)) return rule
    changed++
    return { ...rule, category: to }
  })
  return { rules: next, changed }
}
