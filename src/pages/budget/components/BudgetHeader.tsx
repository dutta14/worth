import { FC } from 'react'
import { TimePeriod, BudgetViewMode } from '../types'
import YearNav from '../../../components/YearNav'

interface BudgetHeaderProps {
  selectedYear: number
  viewMode: BudgetViewMode
  timePeriod: TimePeriod
  onPrevYear: () => void
  onNextYear: () => void
  onSetTimePeriod: (period: TimePeriod) => void
}

const BudgetHeader: FC<BudgetHeaderProps> = ({
  selectedYear,
  viewMode,
  timePeriod,
  onPrevYear,
  onNextYear,
  onSetTimePeriod,
}) => (
  <div className="budget-header">
    <div className="budget-header-left">
      <h1 className="budget-title">Cashflow</h1>
    </div>
    <div className="budget-header-right">
      {viewMode !== 'groups' && (
        <div className="tab-bar">
          <button
            className={`tab-btn${timePeriod === 'month' ? ' active' : ''}`}
            onClick={() => onSetTimePeriod('month')}
          >
            M
          </button>
          <button
            className={`tab-btn${timePeriod === 'quarter' ? ' active' : ''}`}
            onClick={() => onSetTimePeriod('quarter')}
          >
            Q
          </button>
          <button
            className={`tab-btn${timePeriod === 'half' ? ' active' : ''}`}
            onClick={() => onSetTimePeriod('half')}
          >
            H
          </button>
        </div>
      )}
      <YearNav selectedYear={selectedYear} onPrevYear={onPrevYear} onNextYear={onNextYear} />
    </div>
  </div>
)

export default BudgetHeader
