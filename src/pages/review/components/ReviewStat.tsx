import { FC } from 'react'

interface ReviewStatProps {
  label: string
  value: string
  sub?: string | null
  /** Prior-year comparison line, already worded. */
  prior?: string | null
}

const ReviewStat: FC<ReviewStatProps> = ({ label, value, sub, prior }) => (
  <div className="ar-stat">
    <dt className="ar-stat__label">{label}</dt>
    <dd className="ar-stat__value">{value}</dd>
    {sub && <dd className="ar-stat__sub">{sub}</dd>}
    {prior && <dd className="ar-stat__sub ar-stat__prior">{prior}</dd>}
  </div>
)

export default ReviewStat
