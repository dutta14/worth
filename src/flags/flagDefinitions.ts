import { defineFlag } from './flagSystem'

export const FLAGS = {
  MODERN_DESIGN: defineFlag('modern-design', {
    type: 'boolean',
    default: false,
    description: 'Enables the modernized CSS design system',
    temporary: true,
  }),
  MONTHLY_CHECK_IN: defineFlag('monthly-check-in', {
    type: 'boolean',
    default: false,
    description: 'Home check-in strip, partial-month indicators, and Details check-in mode',
    temporary: true,
  }),
  CATEGORY_BUDGET_TARGETS: defineFlag('category-budget-targets', {
    type: 'boolean',
    default: false,
    description: 'Monthly targets per expense group on the Budget aggregated view and Home.',
    temporary: true,
  }),
  DATA_SAFETY_NET: defineFlag('data-safety-net', {
    type: 'boolean',
    default: false,
    description:
      'Protects data files: flush on page hide, visible save errors, corrupt-file quarantine, external-change detection, and _backups snapshots',
    temporary: true,
  }),
  ANNUAL_REVIEW: defineFlag('annual-review', {
    type: 'boolean',
    default: false,
    description: 'Shows the Annual Review tab under Wealth',
    temporary: true,
  }),
  IMPORT_WIZARD: defineFlag('import-wizard', {
    type: 'boolean',
    default: false,
    description: 'Guided import wizard for CSV files: column mapping, review, split by month, duplicate skipping, undo',
    temporary: true,
  }),
} as const
