import { FC, useId } from 'react'

interface ColumnSelectProps {
  label: string
  value: number | null
  labels: string[]
  /** Text of the option that clears the choice; omit when the field is required. */
  noneLabel?: string
  placeholder?: string
  invalid?: boolean
  describedBy?: string
  onChange: (value: number | null) => void
}

const ColumnSelect: FC<ColumnSelectProps> = ({
  label,
  value,
  labels,
  noneLabel,
  placeholder = 'Choose a column',
  invalid,
  describedBy,
  onChange,
}) => {
  const id = useId()
  return (
    <div className="iw-field">
      <label htmlFor={id} className="iw-label">
        {label}
      </label>
      <select
        id={id}
        className="iw-select"
        value={value === null ? '' : String(value)}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
      >
        <option value="">{noneLabel ?? placeholder}</option>
        {labels.map((text, i) => (
          <option key={i} value={i}>
            {text}
          </option>
        ))}
      </select>
    </div>
  )
}

export default ColumnSelect
