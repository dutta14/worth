import { FC } from 'react'
import type { SpendingTargetsLine } from './spendingTargetsLine'

interface SpendingPeekTargetsProps {
  line: SpendingTargetsLine
  onOpenTargets?: () => void
}

const SpendingPeekTargets: FC<SpendingPeekTargetsProps> = ({ line, onOpenTargets }) => (
  <div className="spending-peek-targets">
    <svg
      className={`spending-peek-targets-icon spending-peek-targets-icon--${line.anyOver ? 'over' : 'within'}`}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d={line.anyOver ? 'M6 2.5 10.5 9.5h-9z' : 'M2 6.5 5 9.5 10.5 3'}
        fill={line.anyOver ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={line.anyOver ? 1 : 1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
    <span className="spending-peek-targets-text">{line.text}</span>
    {onOpenTargets && (
      <button type="button" className="home-card-link spending-peek-targets-link" onClick={onOpenTargets}>
        See targets →
      </button>
    )}
  </div>
)

export default SpendingPeekTargets
