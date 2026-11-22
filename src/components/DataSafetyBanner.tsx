import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSafetyNet } from '../contexts/SafetyNetContext'
import { deriveIssues, moreIssuesText } from '../utils/safetyNet'
import type { SafetyIssue } from '../utils/safetyNet'
import '../styles/DataSafetyNet.css'

const SAVED_STATUS = 'All changes saved.'
const SAVED_STATUS_MS = 1000

const WarningIcon: FC = () => (
  <svg
    className="dsn-banner__icon"
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
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
)

interface BannerCopy {
  title: string
  body: string
}

const writeFailedCopy = (issue: Extract<SafetyIssue, { type: 'write-failed' }>, retried: boolean): BannerCopy => {
  const count = issue.paths.length
  const subject = count === 1 ? issue.paths[0] : `${count} files`
  const body = retried
    ? `Still couldn't save ${subject}. Your changes are safe on screen; leaving this tab would lose them.`
    : issue.diskFull
      ? 'Your changes are still on screen but not on disk. The disk looks full. Free some space, then try again.'
      : 'Your changes are still on screen but not on disk. Check that your data folder is available, then try again.'
  return { title: `Couldn't save changes to ${subject}.`, body }
}

const permissionCopy = (denied: boolean): BannerCopy => ({
  title: 'Access to your data folder was lost.',
  body: denied
    ? "Access wasn't granted. Choosing the folder again reloads it from disk, so unsaved changes on screen may be lost."
    : 'Your changes are still on screen but not saved. Reconnect to keep them.',
})

/**
 * Sticky, non-dismissible strip that reports the highest-priority data-safety
 * issue. It never steals focus; it is announced by its live regions.
 */
const DataSafetyBanner: FC = () => {
  const { enabled, snapshot, reconnectDenied, retryFailed, reconnect, chooseFolderAgain } = useSafetyNet()
  const issues = useMemo(() => deriveIssues(snapshot), [snapshot])
  const [retrying, setRetrying] = useState(false)
  const [retried, setRetried] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')
  const regionRef = useRef<HTMLDivElement>(null)
  const hadIssues = useRef(false)
  const hasWriteFailure = issues.some(issue => issue.type === 'write-failed')
  const hasIssues = issues.length > 0

  useEffect(() => {
    if (!hasWriteFailure) setRetried(false)
  }, [hasWriteFailure])

  useEffect(() => {
    if (hasIssues) {
      hadIssues.current = true
      setSavedMessage('')
      return
    }
    if (!hadIssues.current) return
    hadIssues.current = false
    setSavedMessage(SAVED_STATUS)
    // The control the user just pressed is gone; hand focus to the page instead of dropping it on <body>.
    const active = document.activeElement
    if (!active || active === document.body || regionRef.current?.contains(active)) {
      document.getElementById('main-content')?.focus()
    }
    const timer = setTimeout(() => setSavedMessage(''), SAVED_STATUS_MS)
    return () => clearTimeout(timer)
  }, [hasIssues])

  const handleRetry = useCallback(async () => {
    if (retrying) return
    setRetrying(true)
    try {
      await retryFailed()
    } finally {
      setRetrying(false)
      setRetried(true)
    }
  }, [retrying, retryFailed])

  if (!enabled || (!hasIssues && !savedMessage)) return null

  const top = issues[0]
  const copy = top
    ? top.type === 'permission'
      ? permissionCopy(reconnectDenied)
      : writeFailedCopy(top, retried)
    : null

  return (
    <div className="dsn-region" role="region" aria-label="Data safety" ref={regionRef}>
      {top && copy && (
        <section className="dsn-banner dsn-banner--error" role="alert" aria-busy={retrying || undefined}>
          <WarningIcon />
          <div className="dsn-banner__text">
            <p className="dsn-banner__title">{copy.title}</p>
            <p className="dsn-banner__body">{copy.body}</p>
            {issues.length > 1 && <p className="dsn-banner__more">{moreIssuesText(issues.length - 1)}</p>}
          </div>
          <div className="dsn-banner__actions">
            {top.type === 'write-failed' ? (
              <button type="button" className="dsn-btn dsn-btn--primary" aria-disabled={retrying} onClick={handleRetry}>
                {retrying ? 'Trying again...' : 'Try again'}
              </button>
            ) : (
              <button
                type="button"
                className="dsn-btn dsn-btn--primary"
                onClick={reconnectDenied ? chooseFolderAgain : reconnect}
              >
                {reconnectDenied ? 'Choose folder again' : 'Reconnect folder'}
              </button>
            )}
          </div>
        </section>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {savedMessage}
      </p>
    </div>
  )
}

export default DataSafetyBanner
