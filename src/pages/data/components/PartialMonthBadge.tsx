import { FC, useId } from 'react'
import { plural } from '../../../utils/plural'
import '../../../styles/PartialMonthBadge.css'

interface PartialMonthBadgeProps {
  monthLabel: string
  missingCount: number
}

const PartialMonthBadge: FC<PartialMonthBadgeProps> = ({ monthLabel, missingCount }) => {
  const descriptionId = useId()
  const description = `${missingCount} ${plural(missingCount, 'account has', 'accounts have')} no balance for ${monthLabel}. Net worth leaves ${plural(missingCount, 'it', 'them')} out.`

  return (
    <>
      <span className="partial-badge" title={description} aria-describedby={descriptionId}>
        Partial month
      </span>
      <span id={descriptionId} hidden>
        {description}
      </span>
    </>
  )
}

export default PartialMonthBadge
