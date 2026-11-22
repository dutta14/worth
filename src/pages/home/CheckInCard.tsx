import { FC, ReactNode, useState } from 'react'
import { plural } from '../../utils/plural'
import { currentMonthKey, type CheckInState, type MonthKey } from '../data/monthStatus'
import '../../styles/CheckInCard.css'

interface CheckInCardProps {
  state: CheckInState
  today: Date
  onStart: (month: MonthKey) => void
  onNavigate: (path: string) => void
  onSnooze: () => void
}

const MAX_LISTED_ACCOUNTS = 6
const DETAILS_PATH = '/net-worth/dashboard/details'
const SPREADSHEET_PATH = '/net-worth/dashboard/spreadsheet'
const ACCOUNTS_PATH = '/net-worth/dashboard/manage'

const accountsLabel = (n: number): string => `${n} ${plural(n, 'account', 'accounts')}`
const daysLabel = (n: number): string => `${n} ${plural(n, 'day', 'days')}`

/** Long month name, with the year added when it is not the current year. */
const monthLabel = (month: MonthKey, today: Date): string => {
  const [year, m] = month.split('-').map(Number)
  const name = new Date(year, m - 1, 1).toLocaleDateString('en-US', { month: 'long' })
  return month.slice(0, 4) === currentMonthKey(today).slice(0, 4) ? name : `${name} ${year}`
}

interface IconProps {
  kind: CheckInState['kind']
}

const CheckInIcon: FC<IconProps> = ({ kind }) => (
  <svg
    className="checkin-card__icon"
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {kind === 'partial' && (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4" />
        <path d="M12 16h.01" />
      </>
    )}
    {kind === 'up-to-date' && (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="m9 12 2 2 4-4" />
      </>
    )}
    {(kind === 'due' || kind === 'future-only') && (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </>
    )}
  </svg>
)

const CheckInCard: FC<CheckInCardProps> = ({ state, today, onStart, onNavigate, onSnooze }) => {
  const { kind, reportingMonth, targetMonth, status, futureMonths, isStale } = state
  const days = state.daysSinceMonthEnd
  const missing = status?.missing ?? []
  const label = (month: MonthKey) => monthLabel(month, today)

  let title = ''
  if (kind === 'partial' && reportingMonth)
    title = `${accountsLabel(missing.length)} missing for ${label(reportingMonth)}`
  else if (kind === 'due' && targetMonth) title = `${label(targetMonth)} balances are ready to record`
  else if (kind === 'up-to-date' && reportingMonth) title = `${label(reportingMonth)} is complete`
  else if (kind === 'future-only') title = 'Your latest balances are dated in the future'

  // Announce only when the state changes after mount, never on load, focus, or day rollover.
  const changeKey = `${reportingMonth}|${kind}|${missing.length}`
  const [seenKey, setSeenKey] = useState(changeKey)
  const [announcement, setAnnouncement] = useState('')
  if (changeKey !== seenKey) {
    setSeenKey(changeKey)
    setAnnouncement(`${title}.`)
  }

  if (kind === 'hidden') return null

  const lastMonth = reportingMonth ? label(reportingMonth) : ''
  let meta: ReactNode = null
  if ((kind === 'partial' || kind === 'due') && days !== null && days > 0) {
    meta = isStale ? (
      <p className="checkin-card__meta checkin-card__meta--stale">
        Last balances are from {lastMonth}, {daysLabel(days)} ago.
      </p>
    ) : (
      <p className="checkin-card__meta">
        {lastMonth} ended {daysLabel(days)} ago.
      </p>
    )
  } else if (kind === 'up-to-date') {
    const count = status?.expected.length ?? 0
    meta = (
      <p className="checkin-card__meta">
        {count === 1 ? 'Your active account has a balance.' : `All ${count} active accounts have a balance.`}
      </p>
    )
  }

  const futureNote =
    futureMonths.length === 0
      ? null
      : futureMonths.length === 1
        ? `Balances also exist for ${label(futureMonths[0])}, which is in the future.`
        : `Balances also exist for ${futureMonths.length} future months, starting ${label(futureMonths[0])}.`

  const modifiers = [kind === 'up-to-date' ? 'ok' : kind === 'future-only' ? 'future' : kind, isStale ? 'stale' : '']
    .filter(Boolean)
    .map(m => ` checkin-card--${m}`)
    .join('')

  const canSnooze = kind === 'partial' || kind === 'due'
  const listedAccounts = missing.slice(0, MAX_LISTED_ACCOUNTS)

  return (
    <section className={`checkin-card${modifiers}`} aria-labelledby="checkin-heading">
      <div className="checkin-card__body">
        <CheckInIcon kind={kind} />
        <div className="checkin-card__text">
          <h2 id="checkin-heading" className="checkin-card__title">
            {title}
          </h2>
          {meta}
          {kind === 'partial' && reportingMonth && (
            <>
              <p className="checkin-card__meta">
                Net worth for {label(reportingMonth)} leaves these out until you add them.
              </p>
              <ul className="checkin-card__list" aria-label={`Accounts missing for ${label(reportingMonth)}`}>
                {listedAccounts.map(account => (
                  <li key={account.id} className="checkin-card__chip">
                    {account.name.trim() || 'Unnamed account'}
                  </li>
                ))}
                {missing.length > MAX_LISTED_ACCOUNTS && (
                  <li className="checkin-card__more">and {missing.length - MAX_LISTED_ACCOUNTS} more</li>
                )}
              </ul>
            </>
          )}
          {futureNote && <p className="checkin-card__note">{futureNote}</p>}
        </div>
      </div>
      <div className="checkin-card__actions">
        {kind === 'partial' && reportingMonth && (
          <button type="button" className="checkin-card__cta" onClick={() => onStart(reportingMonth)}>
            Finish {label(reportingMonth)}
          </button>
        )}
        {kind === 'due' && targetMonth && (
          <button type="button" className="checkin-card__cta" onClick={() => onStart(targetMonth)}>
            Start {label(targetMonth)} check-in
          </button>
        )}
        {kind === 'up-to-date' && (
          <button type="button" className="checkin-card__link" onClick={() => onNavigate(DETAILS_PATH)}>
            Review balances
          </button>
        )}
        {kind === 'future-only' && (
          <button type="button" className="checkin-card__link" onClick={() => onNavigate(SPREADSHEET_PATH)}>
            Review months
          </button>
        )}
        {canSnooze && (
          <button type="button" className="checkin-card__link" onClick={onSnooze}>
            Snooze for 7 days
          </button>
        )}
        {kind === 'partial' && (
          <button type="button" className="checkin-card__link" onClick={() => onNavigate(ACCOUNTS_PATH)}>
            Account closed? Mark it inactive
          </button>
        )}
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </section>
  )
}

export default CheckInCard
