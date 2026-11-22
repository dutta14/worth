import { FC, useId, useMemo } from 'react'
import { columnLabels } from '../columnLabels'
import type { FormatsLoad } from '../importStorage'
import { COLUMNS_INTRO, COLUMNS_INTRO_FIRST_TIME, formatsWarning } from '../messages'
import { defaultFormatName, MAX_FORMAT_NAME } from '../savedFormats'
import { dateInfo, readableDate, sameSignWarning, type MappingDraft } from '../mapping'
import type { ParseSettings } from '../parseFile'
import type { Delimiter, DateFormat, DecimalSeparator } from '../types'
import type { WizardFile } from '../wizardFiles'
import ColumnSelect from './ColumnSelect'
import PreviewTable from './PreviewTable'

interface ColumnsStepProps {
  file: WizardFile
  fileIndex: number
  fileCount: number
  formats: FormatsLoad
  onRemember: (remember: Partial<WizardFile['remember']>) => void
  onDraft: (draft: MappingDraft) => void
  onReparse: (settings: ParseSettings) => void
}

const DELIMITER_OPTIONS: { value: Delimiter; label: string }[] = [
  { value: ',', label: 'Comma' },
  { value: ';', label: 'Semicolon' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe' },
]

const DECIMAL_OPTIONS: { value: DecimalSeparator; label: string }[] = [
  { value: '.', label: 'Period (1,234.50)' },
  { value: ',', label: 'Comma (1.234,50)' },
]

const PREVIEW_ROWS = 5

const ColumnsStep: FC<ColumnsStepProps> = ({ file, fileIndex, fileCount, formats, onRemember, onDraft, onReparse }) => {
  const id = useId()
  const { draft, parsed } = file
  const { detection } = parsed
  const records = detection.dataRecords
  const labels = useMemo(() => columnLabels(detection.headers), [detection.headers])
  const dates = useMemo(() => dateInfo(records, draft), [records, draft])
  const sameSign = useMemo(() => sameSignWarning(records, draft), [records, draft])

  const set = (patch: Partial<MappingDraft>) => onDraft({ ...draft, ...patch })
  const dateError = draft.date !== null && dates.candidates.length === 0
  const dateErrorId = `${id}-date-error`
  const caption = `First rows of ${file.name}`

  return (
    <section className="iw-columns" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="iw-step-title" tabIndex={-1} data-iw-step-heading>
        Columns
      </h3>
      {fileCount > 1 && (
        <p className="iw-muted">
          File {fileIndex + 1} of {fileCount}: {file.name}
        </p>
      )}
      <p className="iw-muted">
        {formats.state === 'ready' && formats.file.mappings.length === 0 ? COLUMNS_INTRO_FIRST_TIME : COLUMNS_INTRO}
      </p>
      {formats.state === 'unreadable' && <p className="iw-warning">{formatsWarning(formats.reason)}</p>}

      <div className="iw-grid">
        <div className="iw-field">
          <label htmlFor={`${id}-delimiter`} className="iw-label">
            Columns are separated by
          </label>
          <select
            id={`${id}-delimiter`}
            className="iw-select"
            value={parsed.delimiter}
            onChange={e => onReparse({ ...file.settings, delimiter: e.target.value as Delimiter })}
          >
            {DELIMITER_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="iw-field">
          <label className="iw-check">
            <input
              type="checkbox"
              checked={detection.hasHeader}
              onChange={e => onReparse({ ...file.settings, hasHeader: e.target.checked, headerRow: null })}
            />
            First row is column names
          </label>
          {detection.hasHeader && (
            <>
              <label htmlFor={`${id}-header-row`} className="iw-label">
                Header row number
              </label>
              <input
                id={`${id}-header-row`}
                className="iw-input iw-input--narrow"
                type="number"
                min={1}
                max={parsed.records.length}
                value={detection.headerIndex + 1}
                onChange={e => {
                  const row = Number(e.target.value)
                  if (Number.isInteger(row) && row >= 1 && row <= parsed.records.length) {
                    onReparse({ ...file.settings, hasHeader: true, headerRow: row })
                  }
                }}
              />
            </>
          )}
        </div>
      </div>

      <fieldset className="iw-fieldset">
        <legend>Amounts</legend>
        <label className="iw-radio">
          <input
            type="radio"
            name={`${id}-amount-mode`}
            checked={draft.amountMode === 'single'}
            onChange={() => set({ amountMode: 'single' })}
          />
          One amount column
        </label>
        <label className="iw-radio">
          <input
            type="radio"
            name={`${id}-amount-mode`}
            checked={draft.amountMode === 'split'}
            onChange={() => set({ amountMode: 'split' })}
          />
          Separate debit and credit columns
        </label>
      </fieldset>

      <div className="iw-grid">
        <ColumnSelect
          label="Date column"
          value={draft.date}
          labels={labels}
          invalid={dateError}
          describedBy={dateError ? dateErrorId : undefined}
          onChange={date => set({ date, dateFormat: null })}
        />
        <ColumnSelect
          label="Description column"
          value={draft.description}
          labels={labels}
          noneLabel="None"
          onChange={description => set({ description })}
        />
        {draft.amountMode === 'single' ? (
          <ColumnSelect
            label="Amount column"
            value={draft.amount}
            labels={labels}
            onChange={amount => set({ amount })}
          />
        ) : (
          <>
            <ColumnSelect
              label="Money out column"
              value={draft.debit}
              labels={labels}
              noneLabel="None"
              onChange={debit => set({ debit })}
            />
            <ColumnSelect
              label="Money in column"
              value={draft.credit}
              labels={labels}
              noneLabel="None"
              onChange={credit => set({ credit })}
            />
          </>
        )}
        <ColumnSelect
          label="Category column (optional)"
          value={draft.category}
          labels={labels}
          noneLabel="None"
          onChange={category => set({ category })}
        />
      </div>

      {dateError && (
        <p id={dateErrorId} className="iw-error" role="alert">
          Error: We could not read any dates in the &quot;{labels[draft.date ?? 0]}&quot; column. Choose a different
          date column or format.
        </p>
      )}

      {draft.amountMode === 'single' && (
        <fieldset className="iw-fieldset">
          <legend>Which sign means spending?</legend>
          <label className="iw-radio">
            <input
              type="radio"
              name={`${id}-sign`}
              checked={draft.signConvention === 'negative-is-spending'}
              onChange={() => set({ signConvention: 'negative-is-spending' })}
            />
            Negative numbers are spending
          </label>
          <label className="iw-radio">
            <input
              type="radio"
              name={`${id}-sign`}
              checked={draft.signConvention === 'positive-is-spending'}
              onChange={() => set({ signConvention: 'positive-is-spending' })}
            />
            Positive numbers are spending
          </label>
          {sameSign && (
            <p className="iw-warning" role="status">
              Every amount in this column is {sameSign}. Check that the sign choice is right.
            </p>
          )}
        </fieldset>
      )}

      <fieldset className="iw-fieldset">
        <legend>Decimal mark</legend>
        {DECIMAL_OPTIONS.map(option => (
          <label key={option.value} className="iw-radio">
            <input
              type="radio"
              name={`${id}-decimal`}
              checked={draft.decimalSeparator === option.value}
              onChange={() => set({ decimalSeparator: option.value })}
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      {draft.date !== null && dates.candidates.length > 0 && (
        <fieldset className="iw-fieldset">
          <legend>How are dates written?</legend>
          {dates.candidates.length > 1 &&
            dates.candidates.map((format: DateFormat) => (
              <label key={format} className="iw-radio">
                <input
                  type="radio"
                  name={`${id}-date-format`}
                  checked={dates.format === format}
                  onChange={() => set({ dateFormat: format })}
                />
                {format}
                {dates.sample !== null && readableDate(dates.sample, format) !== null && (
                  <span className="iw-muted"> (reads as {readableDate(dates.sample, format)})</span>
                )}
              </label>
            ))}
          {dates.format !== null && dates.sample !== null && (
            <p className="iw-sample">
              &quot;{dates.sample}&quot; reads as {readableDate(dates.sample, dates.format)}
            </p>
          )}
          {dates.candidates.length === 1 && <p className="iw-muted">Dates are written {dates.candidates[0]}.</p>}
        </fieldset>
      )}

      <PreviewTable
        caption={caption}
        columns={labels.map(label => ({ label }))}
        rows={records.slice(0, PREVIEW_ROWS).map((record, i) => ({
          key: String(i),
          cells: labels.map((_, c) => record[c] ?? ''),
        }))}
      />

      {formats.state === 'ready' && (
        <div className="iw-remember">
          <label className="iw-check">
            <input
              type="checkbox"
              checked={file.remember.enabled}
              onChange={e => onRemember({ enabled: e.target.checked })}
            />
            Remember this format as
          </label>
          <input
            className="iw-input"
            type="text"
            aria-label="Format name"
            maxLength={MAX_FORMAT_NAME}
            placeholder={defaultFormatName(file.name)}
            disabled={!file.remember.enabled}
            value={file.remember.name}
            onChange={e => onRemember({ name: e.target.value })}
          />
        </div>
      )}
    </section>
  )
}

export default ColumnsStep
