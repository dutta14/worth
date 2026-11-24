import { FC, useEffect, useId, useRef, useState } from 'react'
import YearNav from '../../../components/YearNav'
import '../../../styles/Budget.css'

interface ReviewHeaderProps {
  /** Null while the route has not named a year yet. */
  year: number | null
  years: number[]
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
  disabled,
  actionsDisabled,
  onYearChange,
  onPrint,
  onDownload,
}) => {
  const [open, setOpen] = useState(false)
  const disclosure = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const actionsId = useId()
  const options = year === null ? [] : yearOptions(years, year)
  const index = year === null ? -1 : options.indexOf(year)
  const previous = options[index + 1]
  const next = index > 0 ? options[index - 1] : undefined

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !disclosure.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const runAction = (action: () => void) => {
    setOpen(false)
    trigger.current?.focus()
    action()
  }

  return (
    <div className="ar-controls">
      {year !== null && (
        <YearNav
          selectedYear={year}
          disablePrev={disabled || previous === undefined}
          disableNext={disabled || next === undefined}
          onPrevYear={() => previous !== undefined && onYearChange(previous)}
          onNextYear={() => next !== undefined && onYearChange(next)}
        />
      )}
      <div
        ref={disclosure}
        className="ar-actions"
        onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
        }}
        onKeyDown={event => {
          if (event.key !== 'Escape' || !open) return
          event.preventDefault()
          event.stopPropagation()
          setOpen(false)
          trigger.current?.focus()
        }}
      >
        <button
          ref={trigger}
          type="button"
          className="action-btn"
          aria-expanded={open}
          aria-controls={actionsId}
          onClick={() => setOpen(value => !value)}
        >
          More actions
        </button>
        <div id={actionsId} className="ar-actions__panel" hidden={!open}>
          <button
            type="button"
            className="ar-btn"
            disabled={actionsDisabled || disabled}
            onClick={() => runAction(onPrint)}
          >
            Print or save as PDF
          </button>
          <button
            type="button"
            className="ar-btn"
            disabled={actionsDisabled || disabled}
            onClick={() => runAction(onDownload)}
          >
            Download CSV
          </button>
        </div>
      </div>
    </div>
  )
}

export default ReviewHeader
