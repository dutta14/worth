import { FC, useId, useMemo, useState } from 'react'
import { plural } from '../../../../utils/plural'
import { savedFormatLabel } from '../messages'
import { formatMoney, formatMonth, formatMonthList, formatSignedMoney } from '../format'
import { UNCATEGORIZED_EXPENSE } from '../constants'
import {
  countLabel,
  filterEntries,
  reviewEntries,
  SKIP_REASON_TEXT,
  type ReviewEntry,
  type ReviewFilter,
} from '../reviewRows'
import type { ImportOptions, ImportPlan } from '../types'
import PreviewTable, { type PreviewRow } from './PreviewTable'

export interface SavedFormatUse {
  index: number
  fileName: string
  name: string
}

interface ReviewStepProps {
  plan: ImportPlan
  /** Files whose columns came from a saved format, so the Columns step was skipped. */
  savedFormats: SavedFormatUse[]
  onChangeFormat: (fileIndex: number) => void
  onOptions: (options: Partial<ImportOptions>) => void
}

const PAGE_SIZE = 100

const FILTERS: { value: ReviewFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'duplicates', label: 'Duplicates' },
  { value: 'skipped', label: 'Skipped' },
]

const STATUS_TEXT = { new: 'New', duplicate: 'Duplicate', skipped: 'Skipped' } as const

const toRow = (entry: ReviewEntry, showFile: boolean): PreviewRow => ({
  key: entry.key,
  cells: [
    showFile ? `${entry.fileName}, row ${entry.sourceRow}` : entry.sourceRow,
    entry.date,
    entry.description,
    entry.category,
    entry.amountCents === null ? '' : formatSignedMoney(entry.amountCents),
    entry.kind === 'skipped' && entry.reason ? `Skipped: ${SKIP_REASON_TEXT[entry.reason]}` : STATUS_TEXT[entry.kind],
  ],
})

const ReviewStep: FC<ReviewStepProps> = ({ plan, savedFormats, onChangeFormat, onOptions }) => {
  const id = useId()
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [page, setPage] = useState(0)

  const entries = useMemo(() => reviewEntries(plan), [plan])
  const shown = useMemo(() => filterEntries(entries, filter), [entries, filter])
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = Math.min(page, pageCount - 1)
  const start = current * PAGE_SIZE
  const visible = shown.slice(start, start + PAGE_SIZE)
  const showFile = plan.files.length > 1

  const { totals, options } = plan
  const monthKeys = Object.keys(plan.months)
  const replacedMonths = monthKeys.filter(month => plan.months[month].hasExistingFile)
  const nothingNew = totals.newRows === 0

  const chooseFilter = (next: ReviewFilter) => {
    setFilter(next)
    setPage(0)
  }

  return (
    <section className="iw-review" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="iw-step-title" tabIndex={-1} data-iw-step-heading>
        Review before importing
      </h3>

      {savedFormats.length > 0 && (
        <ul className="iw-formats" aria-label="Saved formats in use">
          {savedFormats.map(saved => (
            <li key={saved.index}>
              <span className="iw-chip">
                {savedFormatLabel(saved.name)}
                {showFile && <span className="iw-muted"> ({saved.fileName})</span>}
              </span>
              <button
                type="button"
                className="iw-link"
                aria-label={showFile ? `Change saved format for ${saved.fileName}` : undefined}
                onClick={() => onChangeFormat(saved.index)}
              >
                Change
              </button>
            </li>
          ))}
        </ul>
      )}

      {nothingNew ? (
        <p className="iw-muted">
          {totals.duplicates > 0
            ? 'Nothing new to import. Every transaction is already in your budget.'
            : 'None of the rows could be read. Go back and check the column choices.'}
        </p>
      ) : (
        <p className="iw-summary-line">
          {countLabel(totals.newRows, 'new transaction', 'new transactions')} across{' '}
          {countLabel(monthKeys.length, 'month', 'months')}
        </p>
      )}

      <ul className="iw-summary">
        {options.skipDuplicates && <li>{countLabel(totals.duplicates, 'duplicate', 'duplicates')} skipped</li>}
        {totals.skipped > 0 && (
          <li>
            <button type="button" className="iw-link" onClick={() => chooseFilter('skipped')}>
              {countLabel(totals.skipped, 'row', 'rows')} could not be read
            </button>
          </li>
        )}
        <li>
          Spending {formatMoney(totals.spendingCents)}. Income {formatMoney(totals.incomeCents)}.
        </li>
        {plan.newCategories.length > 0 && (
          <li>{countLabel(plan.newCategories.length, 'new category', 'new categories')} will be added</li>
        )}
        {plan.fallbackCount > 0 && (
          <li>
            {countLabel(plan.fallbackCount, 'transaction', 'transactions')} will go to {UNCATEGORIZED_EXPENSE}
          </li>
        )}
      </ul>

      {monthKeys.length > 0 && (
        <ul className="iw-months" aria-label="Transactions by month">
          {monthKeys.map(month => {
            const monthPlan = plan.months[month]
            const duplicates = options.skipDuplicates ? monthPlan.duplicateRows.length : 0
            return (
              <li key={month}>
                {formatMonth(month)}: {monthPlan.added.length.toLocaleString()} new, {duplicates.toLocaleString()}{' '}
                skipped as duplicates
              </li>
            )
          })}
        </ul>
      )}

      {showFile && (
        <ul className="iw-months" aria-label="Transactions by file">
          {plan.files.map((file, i) => (
            <li key={i}>
              {file.name}: {file.newRows.toLocaleString()} new, {file.duplicates.toLocaleString()}{' '}
              {plural(file.duplicates, 'duplicate', 'duplicates')}, {file.skipped.toLocaleString()} could not be read
            </li>
          ))}
        </ul>
      )}

      {plan.notices.length > 0 && (
        <ul className="iw-notices">
          {plan.notices.map(notice => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}

      <div className="iw-options">
        <label className="iw-check">
          <input
            type="checkbox"
            checked={options.skipDuplicates}
            onChange={e => onOptions({ skipDuplicates: e.target.checked })}
          />
          Skip duplicates
        </label>
        {!options.skipDuplicates && (
          <p className="iw-warning">Turning this off will count matching transactions twice.</p>
        )}
        <label className="iw-check">
          <input
            type="checkbox"
            checked={options.replaceMonths}
            onChange={e => onOptions({ replaceMonths: e.target.checked })}
          />
          Replace existing months
        </label>
        {options.replaceMonths && replacedMonths.length > 0 && (
          <p className="iw-warning">
            Existing transactions in {formatMonthList(replacedMonths)} will be replaced. You can undo this after
            importing.
          </p>
        )}
      </div>

      <div className="tab-bar iw-filters" role="group" aria-label="Show rows">
        {FILTERS.map(option => (
          <button
            key={option.value}
            type="button"
            className={`tab-btn tab-btn--sm${filter === option.value ? ' active' : ''}`}
            aria-pressed={filter === option.value}
            onClick={() => chooseFilter(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <PreviewTable
        caption="Rows in this import"
        columns={[
          { label: showFile ? 'File and row' : 'Row' },
          { label: 'Date' },
          { label: 'Description' },
          { label: 'Category' },
          { label: 'Amount', numeric: true },
          { label: 'Status' },
        ]}
        rows={visible.map(entry => toRow(entry, showFile))}
      />

      <div className="iw-pager">
        <button type="button" className="iw-btn" disabled={current === 0} onClick={() => setPage(current - 1)}>
          Previous page
        </button>
        <p className="iw-muted" role="status">
          {shown.length === 0
            ? 'No rows'
            : `Rows ${(start + 1).toLocaleString()} to ${(start + visible.length).toLocaleString()} of ${shown.length.toLocaleString()}`}
        </p>
        <button
          type="button"
          className="iw-btn"
          disabled={current >= pageCount - 1}
          onClick={() => setPage(current + 1)}
        >
          Next page
        </button>
      </div>
    </section>
  )
}

export default ReviewStep
