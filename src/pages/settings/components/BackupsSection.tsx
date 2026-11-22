import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSafetyNet } from '../../../contexts/SafetyNetContext'
import { formatBackupSize, stampToDate } from '../../../utils/safetyNet'
import type { BackupEntry } from '../../../utils/safetyNet'
import '../../../styles/DataSafetyNet.css'

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; entries: BackupEntry[] }

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' })
const formatWhen = (entry: BackupEntry): string => DATE_FORMAT.format(stampToDate(entry.stamp))

/** Lists the copies kept in `_backups/` for one file at a time and restores one after an inline confirmation. */
const BackupsSection: FC = () => {
  const { snapshot, listBackups, restoreBackup } = useSafetyNet()
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [file, setFile] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreFailed, setRestoreFailed] = useState(false)
  const [restored, setRestored] = useState('')
  const [returnFocusTo, setReturnFocusTo] = useState<string | null>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const entries = await listBackups()
      if (mounted.current) setLoad({ status: 'ready', entries })
    } catch (error) {
      console.error('Backups list failed:', error)
      if (mounted.current) setLoad({ status: 'error' })
    }
  }, [listBackups])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const entries = useMemo(() => (load.status === 'ready' ? load.entries : []), [load])
  const files = useMemo(() => [...new Set(entries.map(entry => entry.path))].sort(), [entries])
  const selected = files.includes(file) ? file : (files[0] ?? '')
  const rows = useMemo(() => entries.filter(entry => entry.path === selected), [entries, selected])

  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
  }, [confirming])

  useEffect(() => {
    if (returnFocusTo === null) return
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button[data-backup-path]') ?? []
    const target = [...buttons].find(button => button.dataset.backupPath === returnFocusTo)
    ;(target ?? selectRef.current)?.focus()
    setReturnFocusTo(null)
  }, [returnFocusTo, load])

  const startConfirm = (entry: BackupEntry): void => {
    setRestored('')
    setRestoreFailed(false)
    setConfirming(entry.backupPath)
  }

  const cancel = (entry: BackupEntry): void => {
    setConfirming(null)
    setReturnFocusTo(entry.backupPath)
  }

  const confirmRestore = async (entry: BackupEntry): Promise<void> => {
    if (restoring) return
    setRestoring(true)
    setRestoreFailed(false)
    try {
      await restoreBackup(entry)
      if (!mounted.current) return
      setRestored(`Restored ${entry.path} from ${formatWhen(entry)}.`)
      setConfirming(null)
      setReturnFocusTo(entry.backupPath)
      await refresh()
    } catch (error) {
      console.error('Backup restore failed:', error)
      if (mounted.current) setRestoreFailed(true)
    } finally {
      if (mounted.current) setRestoring(false)
    }
  }

  return (
    <div className="dsn-backups">
      <h4 className="dsn-backups__title" id="dsn-backups-title">
        Backups
      </h4>
      <p className="settings-description">
        Before a file is changed, the app keeps a copy in the _backups folder inside your data folder. The newest 10
        copies of each file are kept. Your sync and backup tools will see this folder too.
      </p>

      {!snapshot.backupsHealthy && (
        <p className="dsn-backups__warning" role="status">
          The last backup copy couldn&apos;t be saved. Your changes were saved normally.
        </p>
      )}

      {load.status === 'loading' && (
        <p className="settings-description" role="status">
          Reading backups...
        </p>
      )}
      {load.status === 'error' && (
        <p className="dsn-backups__error" role="alert">
          Couldn&apos;t read the _backups folder. Check that your data folder is connected.
        </p>
      )}
      {load.status === 'ready' && files.length === 0 && (
        <p className="settings-description">No backups yet. Copies appear the first time a file is changed.</p>
      )}

      {files.length > 0 && (
        <>
          <div className="dsn-backups__field">
            <label htmlFor="dsn-backups-file">File</label>
            <select
              id="dsn-backups-file"
              className="dsn-select"
              ref={selectRef}
              value={selected}
              onChange={event => {
                setFile(event.target.value)
                setConfirming(null)
                setRestored('')
                setRestoreFailed(false)
              }}
            >
              {files.map(path => (
                <option key={path} value={path}>
                  {path}
                </option>
              ))}
            </select>
          </div>

          <ul className="dsn-backups__list" aria-labelledby="dsn-backups-title" ref={listRef}>
            {rows.map(entry => {
              const when = formatWhen(entry)
              const isConfirming = confirming === entry.backupPath
              return (
                <li className="dsn-backups__row" key={entry.backupPath}>
                  <span className="dsn-backups__date">{entry.unsaved ? `Unsaved edit, ${when}` : when}</span>
                  <span className="dsn-backups__size">{formatBackupSize(entry.size)}</span>
                  <button
                    type="button"
                    className="dsn-btn"
                    data-backup-path={entry.backupPath}
                    aria-label={`Restore ${entry.path} from ${when}${entry.unsaved ? ' (unsaved edit)' : ''}`}
                    aria-expanded={isConfirming}
                    onClick={() => startConfirm(entry)}
                  >
                    Restore
                  </button>
                  {isConfirming && (
                    <div className="dsn-backups__confirm">
                      <p>Replace the current {entry.path} with this copy? The current version is backed up first.</p>
                      <div className="dsn-backups__confirm-actions">
                        <button
                          type="button"
                          className="dsn-btn dsn-btn--primary"
                          ref={confirmRef}
                          aria-disabled={restoring}
                          onClick={() => void confirmRestore(entry)}
                        >
                          Restore this copy
                        </button>
                        <button type="button" className="dsn-btn" onClick={() => cancel(entry)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}

      {restoreFailed && (
        <p className="dsn-backups__error" role="alert">
          Couldn&apos;t restore that copy. The current file was not changed. Check that your data folder is connected,
          then try again.
        </p>
      )}
      <p className="dsn-backups__status" role="status">
        {restored}
      </p>
    </div>
  )
}

export default BackupsSection
