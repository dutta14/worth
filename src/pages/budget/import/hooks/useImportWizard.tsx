import { ChangeEvent, ReactNode, useCallback, useMemo, useReducer, useRef, useState } from 'react'
import { useFileStore } from '../../../../contexts/FileStoreContext'
import type { BudgetStore } from '../../types'
import ImportWizard from '../components/ImportWizard'
import RulesDialog from '../components/RulesDialog'
import { buildImportPlan, type PlanFileInput } from '../buildImportPlan'
import { canUndoImport, type CommitResult, type UndoRecord, type UndoResult } from '../commitImport'
import {
  loadFormats,
  loadRules,
  noopPreImportSnapshot,
  saveFormatUpdates,
  saveRules,
  type FormatsLoad,
  type PreImportSnapshot,
  type RulesLoad,
  type RulesSaveResult,
} from '../importStorage'
import { rulesWarning } from '../ruleMessages'
import { emptyRulesFile, type CategoryRule } from '../rules'
import { normalizeRows } from '../normalizeRows'
import type { ImportPlan } from '../types'
import type { ReadableFile } from '../readFile'
import { STORE_UNREADABLE_HEADING, STORE_UNREADABLE_MESSAGE } from '../messages'
import { DEFAULT_TEXT_NAME, loadWizardFiles, type TextSource } from '../wizardFiles'
import { cleanFormatName, defaultFormatName, formatContent, type FormatUpdate } from '../savedFormats'
import type { WizardFile } from '../wizardFiles'
import { initialWizardState, wizardReducer, type FormatNote } from '../wizardState'

/** What the wizard needs from the Budget data hook. */
export interface ImportBudgetApi {
  store: BudgetStore
  commitImport: (plan: ImportPlan, snapshot?: PreImportSnapshot) => Promise<CommitResult>
  undoImport: (record: UndoRecord) => Promise<UndoResult>
  /** True when the budget files could not be read; the wizard then refuses to open rather than write over them. */
  blocked?: boolean
  /** Asks the host to read the budget files again; called when the wizard is opened while blocked. */
  reload?: () => void
}

export interface OpenRequest {
  files?: ReadableFile[]
  /** CSV text handed over by another tool, for example the PDF converter. */
  text?: string
  /** Name shown for `text`. */
  name?: string
  /** When neither files nor text is given, the file picker accepts several files. */
  multiple?: boolean
}

export interface ImportWizardOptions {
  preImportSnapshot?: PreImportSnapshot
  onViewTransactions?: () => void
}

const FILE_ACCEPT = '.csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values'

/** Today as YYYY-MM-DD in the user's own calendar, for the "last used" date of a saved format. */
function localToday(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** What the import teaches the formats file: formats to remember, and saved formats that were used again. */
function formatUpdatesFor(files: WizardFile[]): FormatUpdate[] {
  return files.flatMap((file): FormatUpdate[] => {
    if (file.auto === 'saved' && file.format) return [{ kind: 'touch', id: file.format.id }]
    if (file.auto !== null || file.mapping === null || !file.remember.enabled) return []
    const name = cleanFormatName(file.remember.name, defaultFormatName(file.name))
    return [
      { kind: 'save', replaceId: file.format?.id ?? null, content: formatContent(name, file.parsed, file.mapping) },
    ]
  })
}

function restoreFocus(opener: HTMLElement | null) {
  setTimeout(() => {
    if (opener?.isConnected) {
      opener.focus()
      return
    }
    const heading = document.querySelector<HTMLElement>('h1')
    if (heading) {
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1')
      heading.focus()
    }
  }, 0)
}

/**
 * Owns the import wizard for a host page. Call `open()` from a click handler; with no files it shows the
 * file picker (so the entry point works from any view), then walks through Columns and Review. Render
 * `element` once in the host. Nothing is written until the final confirm button.
 */
export function useImportWizard(budget: ImportBudgetApi, options: ImportWizardOptions = {}) {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState)
  const inputRef = useRef<HTMLInputElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const loadToken = useRef(0)
  const lastPlan = useRef<ImportPlan | null>(null)
  const { preImportSnapshot = noopPreImportSnapshot, onViewTransactions } = options
  const { fileStore } = useFileStore()
  const [rulesLoad, setRulesLoad] = useState<RulesLoad>({ state: 'ready', file: emptyRulesFile() })
  const [rulesOpen, setRulesOpen] = useState(false)
  const { phase, files, options: importOptions } = state
  const { store, blocked = false, reload } = budget

  const showBlocked = useCallback(() => {
    loadToken.current++
    reload?.()
    dispatch({
      type: 'load-failed',
      failure: { message: STORE_UNREADABLE_MESSAGE, canPickAgain: false, heading: STORE_UNREADABLE_HEADING },
    })
  }, [reload])

  const start = useCallback(
    async (sources: { files?: ReadableFile[]; texts?: TextSource[] }) => {
      if (blocked) {
        showBlocked()
        return
      }
      const token = ++loadToken.current
      const names = [...(sources.files ?? []).map(f => f.name), ...(sources.texts ?? []).map(t => t.name)]
      dispatch({ type: 'loading', names })
      const [formats, rules] = await Promise.all([loadFormats(fileStore), loadRules(fileStore)])
      if (token !== loadToken.current) return
      const result = await loadWizardFiles({ ...sources, formats: formats.state === 'ready' ? formats.file : null })
      if (token !== loadToken.current) return
      if (result.ok) {
        setRulesLoad(rules)
        dispatch({ type: 'loaded', files: result.files, formats })
      } else dispatch({ type: 'load-failed', failure: { message: result.message, canPickAgain: result.canPickAgain } })
    },
    [fileStore, blocked, showBlocked],
  )

  const pickFiles = useCallback((multiple: boolean) => {
    const input = inputRef.current
    if (!input) return
    input.multiple = multiple
    input.click()
  }, [])

  const open = useCallback(
    (request: OpenRequest = {}) => {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      if (blocked) showBlocked()
      else if (request.files && request.files.length > 0) void start({ files: request.files })
      else if (request.text !== undefined)
        void start({ texts: [{ name: request.name ?? DEFAULT_TEXT_NAME, text: request.text }] })
      else pickFiles(request.multiple ?? false)
    },
    [pickFiles, start, blocked, showBlocked],
  )

  const onInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (picked.length > 0) void start({ files: picked })
  }

  const close = useCallback(() => {
    loadToken.current++
    setRulesOpen(false)
    dispatch({ type: 'close' })
    restoreFocus(openerRef.current)
  }, [])

  const planInputs = useMemo((): PlanFileInput[] | null => {
    if (phase !== 'review') return null
    return files.map(file => {
      const { detection, tokenErrors } = file.parsed
      const { rows, skipped } = normalizeRows(detection.dataRecords, file.mapping!, {
        firstSourceRow: detection.firstSourceRow,
      })
      return {
        name: file.name,
        rows,
        skipped,
        notices: tokenErrors.map(error => `${error.message} It was skipped.`),
      }
    })
  }, [phase, files])

  const existingCsvs = useMemo(() => {
    if (phase !== 'review') return {}
    return Object.fromEntries(Object.entries(store.csvs).map(([month, csv]) => [month, csv.csv]))
  }, [phase, store])

  const rules = useMemo(() => (rulesLoad.state === 'ready' ? rulesLoad.file.rules : []), [rulesLoad])

  const livePlan = useMemo(
    () =>
      planInputs
        ? buildImportPlan({
            files: planInputs,
            existingCsvs,
            categoryGroups: store.categoryGroups ?? [],
            options: importOptions,
            rules,
          })
        : null,
    [planInputs, existingCsvs, store, importOptions, rules],
  )
  // While committing, keep showing the plan being written even though the store is changing underneath it.
  if (livePlan) lastPlan.current = livePlan
  const plan = phase === 'review' ? livePlan : phase === 'committing' ? lastPlan.current : null

  // Runs only after the import itself succeeded; a formats problem is reported next to the result, never as a failure.
  const rememberFormats = useCallback(
    async (used: WizardFile[], formats: FormatsLoad): Promise<FormatNote | null> => {
      const updates = formatUpdatesFor(used)
      if (updates.length === 0) return null
      const saves = updates.filter(update => update.kind === 'save')
      if (formats.state === 'unreadable') return saves.length > 0 ? { kind: 'not-saved', reason: 'unreadable' } : null
      const outcome = await saveFormatUpdates(fileStore, updates, localToday())
      if (saves.length === 0) return null
      if (!outcome.ok) return { kind: 'not-saved', reason: outcome.reason }
      return { kind: 'saved', names: saves.map(update => update.content.name) }
    },
    [fileStore],
  )

  const confirm = useCallback(async () => {
    if (!plan || plan.totals.newRows === 0) return
    dispatch({ type: 'committing' })
    let result: CommitResult
    try {
      result = await budget.commitImport(plan, preImportSnapshot)
    } catch {
      result = {
        ok: false,
        reason: 'write',
        failedMonths: Object.keys(plan.months),
        categoriesFailed: false,
        restored: false,
      }
    }
    const formatNote = result.ok ? await rememberFormats(files, state.formats) : null
    dispatch({ type: 'committed', result, formatNote })
  }, [budget, plan, preImportSnapshot, rememberFormats, files, state.formats])

  const undoRecord = state.commit?.ok ? state.commit.undo : null
  const canUndo = undoRecord !== null && !state.undone && canUndoImport(undoRecord, store)

  const undo = useCallback(async () => {
    if (!undoRecord) return
    try {
      const result = await budget.undoImport(undoRecord)
      dispatch(result.ok ? { type: 'undone' } : { type: 'undo-failed' })
    } catch {
      dispatch({ type: 'undo-failed' })
    }
  }, [budget, undoRecord])

  const changeRules = useCallback(
    async (next: CategoryRule[]): Promise<RulesSaveResult> => {
      const outcome = await saveRules(fileStore, next)
      if (outcome.ok) setRulesLoad({ state: 'ready', file: { ...emptyRulesFile(), rules: next } })
      return outcome
    },
    [fileStore],
  )

  const closeRules = useCallback(() => setRulesOpen(false), [])

  const viewTransactions = useMemo(
    () =>
      onViewTransactions
        ? () => {
            loadToken.current++
            setRulesOpen(false)
            dispatch({ type: 'close' })
            onViewTransactions()
          }
        : undefined,
    [onViewTransactions],
  )

  const element: ReactNode = (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={FILE_ACCEPT}
        hidden
        aria-hidden="true"
        tabIndex={-1}
        data-testid="import-wizard-input"
        onChange={onInputChange}
      />
      {phase !== 'idle' && (
        <ImportWizard
          state={state}
          plan={plan}
          canUndo={canUndo}
          dispatch={dispatch}
          onConfirm={confirm}
          onCancel={close}
          onUndo={undo}
          onPickAgain={() => pickFiles(files.length > 1)}
          onViewTransactions={viewTransactions}
          rulesOpen={rulesOpen}
          rulesWarning={rulesLoad.state === 'unreadable' ? rulesWarning(rulesLoad.reason) : null}
          rulesSkipped={lastPlan.current?.rulesSkipped ?? 0}
          onManageRules={() => setRulesOpen(true)}
        />
      )}
      {phase !== 'idle' && rulesOpen && (
        <RulesDialog
          rules={rulesLoad}
          categoryGroups={store.categoryGroups ?? []}
          onChange={changeRules}
          onClose={closeRules}
        />
      )}
    </>
  )

  return { open, element }
}
