import type { BudgetStore, CategoryGroup } from '../pages/budget/types'
import { buildImportPlan } from '../pages/budget/import/buildImportPlan'
import { resolveMapping, type MappingDraft } from '../pages/budget/import/mapping'
import { normalizeRows } from '../pages/budget/import/normalizeRows'
import type { ImportOptions, ImportPlan } from '../pages/budget/import/types'
import type { CategoryRule } from '../pages/budget/import/rules'
import { createWizardFile } from '../pages/budget/import/wizardFiles'
import { DEFAULT_OPTIONS } from '../pages/budget/import/wizardState'

export const DEFAULT_TEST_GROUPS: CategoryGroup[] = [
  { id: 'others', name: 'Others', categories: [] },
  { id: 'removed', name: 'Remove from Budget', categories: [] },
  { id: 'income-others', name: 'Others', categories: [], type: 'income' },
]

export const emptyStore = (overrides: Partial<BudgetStore> = {}): BudgetStore => ({
  csvs: {},
  configs: {},
  years: [],
  categoryGroups: DEFAULT_TEST_GROUPS,
  ...overrides,
})

export const storeWithMonths = (months: Record<string, string>, overrides: Partial<BudgetStore> = {}): BudgetStore =>
  emptyStore({
    csvs: Object.fromEntries(Object.entries(months).map(([month, csv]) => [month, { month, csv, uploadedAt: '' }])),
    years: [...new Set(Object.keys(months).map(month => parseInt(month, 10)))],
    ...overrides,
  })

interface PlanFromTextOptions {
  existing?: Record<string, string>
  groups?: CategoryGroup[]
  options?: ImportOptions
  rules?: CategoryRule[]
  /** Applied on top of the suggested mapping, for example the sign choice the Columns step requires. */
  draft?: Partial<MappingDraft>
}

/** Runs the same steps the wizard does: parse, map, normalize, plan. */
export function planFromTexts(sources: { name: string; text: string }[], opts: PlanFromTextOptions = {}): ImportPlan {
  const files = sources.map(({ name, text }) => {
    const file = createWizardFile(name, text)
    if (!file) throw new Error(`no rows in ${name}`)
    const mapping =
      file.mapping ??
      resolveMapping(file.parsed.detection.dataRecords, {
        ...file.draft,
        signConvention: 'negative-is-spending',
        ...opts.draft,
      }).mapping
    if (!mapping) throw new Error(`could not map ${name}`)
    const { detection } = file.parsed
    const { rows, skipped } = normalizeRows(detection.dataRecords, mapping, {
      firstSourceRow: detection.firstSourceRow,
      maxYear: 2027,
    })
    return { name, rows, skipped }
  })
  return buildImportPlan({
    files,
    existingCsvs: opts.existing ?? {},
    categoryGroups: opts.groups ?? DEFAULT_TEST_GROUPS,
    options: opts.options ?? DEFAULT_OPTIONS,
    rules: opts.rules,
  })
}

export const containsRule = (id: string, value: string, category: string, enabled = true): CategoryRule => ({
  id,
  match: { field: 'description', type: 'contains', value },
  category,
  enabled,
})
