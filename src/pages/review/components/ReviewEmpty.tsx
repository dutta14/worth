import { FC } from 'react'
import { Link } from 'react-router-dom'

interface ReviewEmptyProps {
  year: number
  /** True when no year has any data at all. */
  noDataAnywhere: boolean
}

const ReviewEmpty: FC<ReviewEmptyProps> = ({ year, noDataAnywhere }) => (
  <section className="ar-empty" aria-labelledby="ar-empty-h">
    <h3 id="ar-empty-h" className="ar-empty__title">
      {noDataAnywhere ? 'Nothing to review yet' : `Not enough data for ${year}`}
    </h3>
    <p className="ar-empty__body">
      Add month-end balances in Wealth or import transactions in Cashflow, then come back.
    </p>
    <div className="ar-empty__actions">
      <Link className="ar-btn ar-link" to="/net-worth/dashboard">
        Go to Wealth
      </Link>
      <Link className="ar-btn ar-link" to="/budget">
        Go to Cashflow
      </Link>
    </div>
  </section>
)

export default ReviewEmpty
