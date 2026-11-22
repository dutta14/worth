import { FC } from 'react'

interface ReviewHeaderProps {
  /** Null while the route has not named a year yet. */
  year: number | null
  years: number[]
  period: string | null
  disabled: boolean
  /** Print and Download are off while loading and when there is nothing to export. */
  actionsDisabled: boolean
  onYearChange: (year: number) => void
  onPrint: () => void
  onDownload: () => void
}

const yearOptions = (years: number[], year: number): number[] => [...new Set([...years, year])].sort((a, b) => b - a)

const ReviewHeader: FC<ReviewHeaderProps> = ({
  year,
  years,
  period,
  disabled,
  actionsDisabled,
  onYearChange,
  onPrint,
  onDownload,
}) => (
  <header className="ar-header">
    <div className="ar-header__titles">
      <h2 className="ar-title">
        Annual Review
        {year !== null && (
          <>
            {' '}
            <span>{year}</span>
          </>
        )}
      </h2>
      <p className="ar-subtitle">Your year in money, built from the files in your folder.</p>
      {period && <p className="ar-period">{period}</p>}
    </div>
    <div className="ar-controls">
      <label htmlFor="ar-year" className="ar-label">
        Year
      </label>
      <select
        id="ar-year"
        className="ar-select"
        value={year ?? ''}
        disabled={disabled || year === null}
        onChange={event => onYearChange(Number(event.target.value))}
      >
        {year === null ? (
          <option value="">Select a year</option>
        ) : (
          yearOptions(years, year).map(y => (
            <option key={y} value={y}>
              {y}
            </option>
          ))
        )}
      </select>
      <button type="button" className="ar-btn" disabled={actionsDisabled} onClick={onPrint}>
        Print or save as PDF
      </button>
      <button type="button" className="ar-btn" disabled={actionsDisabled} onClick={onDownload}>
        Download CSV
      </button>
    </div>
  </header>
)

export default ReviewHeader
