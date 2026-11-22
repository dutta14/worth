import { FC } from 'react'
import '../../../styles/PartialMonthBadge.css'

interface PartialMonthCaptionProps {
  monthLabel: string
}

const PartialMonthCaption: FC<PartialMonthCaptionProps> = ({ monthLabel }) => (
  <p className="partial-caption">{monthLabel} is not plotted until all accounts have a balance.</p>
)

export default PartialMonthCaption
