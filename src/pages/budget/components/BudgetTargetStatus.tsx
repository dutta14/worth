import { FC } from 'react'
import { formatTargetStatus } from '../utils/budgetTargets'
import type { TargetResult } from '../utils/budgetTargets'

interface BudgetTargetStatusProps {
  result: TargetResult | null
  /** `full` is the Vs target column; `period` is the second line under an over-target period amount. */
  variant: 'full' | 'period'
}

const ICON_PATHS = {
  up: 'M6 2.5 10.5 9.5h-9z',
  down: 'M6 9.5 1.5 2.5h9z',
  check: 'M2 6.5 5 9.5 10.5 3',
} as const

const StatusIcon: FC<{ icon: keyof typeof ICON_PATHS }> = ({ icon }) => (
  <svg className="budget-target-icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
    <path
      d={ICON_PATHS[icon]}
      fill={icon === 'check' ? 'none' : 'currentColor'}
      stroke="currentColor"
      strokeWidth={icon === 'check' ? 1.75 : 1}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const BudgetTargetStatus: FC<BudgetTargetStatusProps> = ({ result, variant }) => {
  if (!result) return null
  if (variant === 'period' && result.status !== 'over') return null

  const { text, icon } = formatTargetStatus(result)
  const showCaption = variant === 'full' && result.monthsCounted < result.monthsInPeriod

  if (variant === 'period') {
    return (
      <span className="budget-target-delta">
        <StatusIcon icon={icon} />
        <span>{text}</span>
      </span>
    )
  }

  return (
    <>
      <span
        className={`budget-target-status budget-target-status--${result.status === 'on-target' ? 'on' : result.status}`}
      >
        <StatusIcon icon={icon} />
        <span>{text}</span>
      </span>
      {showCaption && (
        <span className="budget-target-caption">
          {result.monthsCounted} of {result.monthsInPeriod} months
        </span>
      )}
    </>
  )
}

export default BudgetTargetStatus
