import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSafetyNet } from '../contexts/SafetyNetContext'
import { deriveIssues, moreIssuesText, stampToDate } from '../utils/safetyNet'
import type { CorruptAction, ExternalAction, SafetyIssue } from '../utils/safetyNet'
import '../styles/DataSafetyNet.css'

const SAVED_STATUS = 'All changes saved.'
const SAVED_STATUS_MS = 1000
const RESOLVE_FAILED =
  "Couldn't finish that. The file was not changed. Check that your data folder is connected, then try again."
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })

type CorruptIssue = Extract<SafetyIssue, { type: 'corrupt' }>
type WriteFailedIssue = Extract<SafetyIssue, { type: 'write-failed' }>
type ExternalIssue = Extract<SafetyIssue, { type: 'external-change' }>

const baseName = (path: string): string => path.split('/').pop() ?? path

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

const writeFailedCopy = (issue: WriteFailedIssue, retried: boolean): BannerCopy => {
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

const corruptCopy = (issue: CorruptIssue, failed: boolean): BannerCopy => ({
  title: `Couldn't read ${issue.path}.`,
  body: failed
    ? RESOLVE_FAILED
    : issue.copyPath
      ? `The file isn't valid JSON, so the app left it untouched and saved a copy as ${baseName(issue.copyPath)}. Changes to it won't be saved until you choose how to continue.`
      : "The file isn't valid JSON and a copy couldn't be saved, so the app left it untouched. Changes to it won't be saved until you choose how to continue.",
})

const externalCopy = (issue: ExternalIssue, failed: boolean): BannerCopy => {
  const single = issue.paths.length === 1
  const file = issue.paths[0]
  const body = failed
    ? RESOLVE_FAILED
    : issue.deleted
      ? `${file} was deleted outside this tab. Saving to it is paused. Reload to see what's on disk, or keep your version to create it again.`
      : single
        ? 'It was changed outside this tab, maybe on another computer or by a sync tool. Saving to it is paused so nothing gets overwritten.'
        : 'They were changed outside this tab, maybe on another computer or by a sync tool. Saving to them is paused so nothing gets overwritten.'
  return { title: single ? `${file} changed on disk.` : 'Files changed on disk.', body }
}

const resolvedText = (path: string, action: CorruptAction, restoredStamp: string | null): string =>
  action === 'restore-latest' && restoredStamp
    ? `${path} restored from the backup of ${DATE_FORMAT.format(stampToDate(restoredStamp))}.`
    : `${path} replaced. The unreadable copy is still in your folder.`

/**
 * Sticky, non-dismissible strip that reports the highest-priority data-safety
 * issue. It never steals focus; it is announced by its live regions.
 */
const DataSafetyBanner: FC = () => {
  const {
    enabled,
    snapshot,
    reconnectDenied,
    retryFailed,
    reconnect,
    chooseFolderAgain,
    resolveCorrupt,
    resolveExternal,
    notice,
  } = useSafetyNet()
  const issues = useMemo(() => deriveIssues(snapshot), [snapshot])
  const [retrying, setRetrying] = useState(false)
  const [retried, setRetried] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolveFailed, setResolveFailed] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')
  const regionRef = useRef<HTMLDivElement>(null)
  const hadIssues = useRef(false)
  // Guards against a second click while a corrupt-file resolution is running.
  const resolvingRef = useRef(false)
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
    // The control the user just pressed is gone; hand focus to the page instead of dropping it on <body>.
    const active = document.activeElement
    if (!active || active === document.body || regionRef.current?.contains(active)) {
      document.getElementById('main-content')?.focus()
    }
    // A resolution may already have set its own message; keep it.
    setSavedMessage(current => current || SAVED_STATUS)
  }, [hasIssues])

  useEffect(() => {
    if (!savedMessage) return
    const timer = setTimeout(() => setSavedMessage(''), SAVED_STATUS_MS)
    return () => clearTimeout(timer)
  }, [savedMessage])

  const handleRetry = useCallback(async () => {
    if (retrying) return
    setRetrying(true)
    try {
      // Only flag a retry when something is still failing, or a later unrelated failure would read as a repeat.
      setRetried(await retryFailed())
    } finally {
      setRetrying(false)
    }
  }, [retrying, retryFailed])

  // The app shell (and this banner) remounts after a Reload, so the status text arrives from the provider.
  useEffect(() => {
    if (notice) setSavedMessage(notice)
  }, [notice])

  const top = issues[0]
  const topResolveKey =
    top?.type === 'corrupt' ? top.path : top?.type === 'external-change' ? top.paths.join('|') : null

  useEffect(() => {
    setResolveFailed(false)
  }, [topResolveKey])

  const handleResolve = useCallback(
    async (issue: CorruptIssue, action: CorruptAction) => {
      if (resolvingRef.current) return
      resolvingRef.current = true
      setResolving(true)
      setResolveFailed(false)
      try {
        const restored = await resolveCorrupt(issue.path, action)
        setSavedMessage(resolvedText(issue.path, action, restored?.stamp ?? null))
      } catch (error) {
        console.error('Resolving the unreadable file failed:', error)
        setResolveFailed(true)
      } finally {
        resolvingRef.current = false
        setResolving(false)
      }
    },
    [resolveCorrupt],
  )

  const handleExternal = useCallback(
    async (action: ExternalAction) => {
      if (resolvingRef.current) return
      resolvingRef.current = true
      setResolving(true)
      setResolveFailed(false)
      try {
        await resolveExternal(action)
      } catch (error) {
        console.error('Resolving the changed files failed:', error)
        setResolveFailed(true)
      } finally {
        resolvingRef.current = false
        setResolving(false)
      }
    },
    [resolveExternal],
  )

  if (!enabled) return null

  const copy = !top
    ? null
    : top.type === 'permission'
      ? permissionCopy(reconnectDenied)
      : top.type === 'corrupt'
        ? corruptCopy(top, resolveFailed)
        : top.type === 'external-change'
          ? externalCopy(top, resolveFailed)
          : writeFailedCopy(top, retried)

  const isExternal = top?.type === 'external-change'
  const visible = hasIssues || savedMessage !== ''

  return (
    <div
      className="dsn-region"
      role={visible ? 'region' : undefined}
      aria-label={visible ? 'Data safety' : undefined}
      ref={regionRef}
    >
      {top && copy && (
        <section
          key={isExternal ? 'status' : 'alert'}
          className={`dsn-banner ${isExternal ? 'dsn-banner--warning' : 'dsn-banner--error'}`}
          role={isExternal ? 'status' : 'alert'}
          aria-busy={retrying || resolving || undefined}
        >
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
            ) : top.type === 'external-change' ? (
              <>
                <button
                  type="button"
                  className="dsn-btn dsn-btn--primary"
                  aria-disabled={resolving}
                  onClick={() => void handleExternal('reload')}
                >
                  Reload
                </button>
                <button
                  type="button"
                  className="dsn-btn"
                  aria-disabled={resolving}
                  onClick={() => void handleExternal('keep')}
                >
                  Keep my version
                </button>
              </>
            ) : top.type === 'corrupt' ? (
              <>
                {top.hasBackup && (
                  <button
                    type="button"
                    className="dsn-btn dsn-btn--primary"
                    aria-disabled={resolving}
                    onClick={() => void handleResolve(top, 'restore-latest')}
                  >
                    Restore latest backup
                  </button>
                )}
                <button
                  type="button"
                  className={top.hasBackup ? 'dsn-btn' : 'dsn-btn dsn-btn--primary'}
                  aria-disabled={resolving}
                  onClick={() => void handleResolve(top, 'start-fresh')}
                >
                  Start fresh
                </button>
              </>
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
      {/* Always mounted so assistive tech registers it before the text changes. */}
      <p className="sr-only" role="status" aria-live="polite">
        {savedMessage}
      </p>
    </div>
  )
}

export default DataSafetyBanner
