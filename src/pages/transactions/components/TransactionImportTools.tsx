import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFileStore } from '../../../contexts/FileStoreContext'
import type { BudgetStore } from '../../budget/types'
import { loadBudgetStoreStrict } from '../../budget/utils/budgetStorage'
import ApplyRulesDialog from '../../budget/import/components/ApplyRulesDialog'
import CreateRuleDialog, { type CreateRuleOutcome } from '../../budget/import/components/CreateRuleDialog'
import RulesDialog from '../../budget/import/components/RulesDialog'
import { canUndoImport, executeImport, executeUndo, type UndoRecord } from '../../budget/import/commitImport'
import { useCategoryRules } from '../../budget/import/hooks/useCategoryRules'
import { useImportWizard, type ImportBudgetApi } from '../../budget/import/hooks/useImportWizard'
import {
  executeRecategorize,
  planRecategorize,
  toImpactRows,
  type RecategorizePlan,
  type RecategorizeResult,
} from '../../budget/import/recategorize'
import {
  APPLY_BUTTON_LABEL,
  applyFailureMessage,
  MANAGE_RULES_LABEL,
  rulesSaveFailure,
} from '../../budget/import/ruleMessages'
import { STORE_UNREADABLE_MESSAGE as IMPORT_PAUSED_MESSAGE } from '../../budget/import/messages'
import { addRule, categoryResolver, type RuleDraft } from '../../budget/import/rules'

/** The transaction a rule is being made from. */
export interface RuleSource {
  description: string
  category: string
}

interface TransactionImportToolsProps {
  transactions: { description?: string; category: string }[]
  ruleSource: RuleSource | null
  onRuleSourceClose: () => void
  /** Drops the page's cached transactions; called before and after anything is written. */
  onInvalidate: () => void
}

const EMPTY_STORE: BudgetStore = { csvs: {}, configs: {}, years: [], categoryGroups: [] }

type Panel = 'rules' | 'apply' | null

/**
 * The import-wizard additions to the Transactions toolbar: Import, Apply rules to uncategorized and Rules, plus
 * the dialogs they open. Rendered only when the `import-wizard` flag is on, so the flag-off page never mounts it.
 * It keeps its own snapshot of the budget (refreshed on every change) because the page's cache is not shared.
 */
const TransactionImportTools: FC<TransactionImportToolsProps> = ({
  transactions,
  ruleSource,
  onRuleSourceClose,
  onInvalidate,
}) => {
  const { fileStore } = useFileStore()
  const [store, setStore] = useState<BudgetStore>(EMPTY_STORE)
  const [loaded, setLoaded] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)
  const storeRef = useRef(store)
  const [panel, setPanel] = useState<Panel>(null)
  const [applyPlan, setApplyPlan] = useState<RecategorizePlan | null>(null)
  const [createReady, setCreateReady] = useState(false)
  const createUndo = useRef<UndoRecord | null>(null)
  const { rules, load: loadRules, change: changeRules } = useCategoryRules()

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      // Strict: an unreadable folder must not look like an empty one, or an import would write over real months.
      loadBudgetStoreStrict(fileStore)
        .then(next => {
          if (cancelled) return
          storeRef.current = next
          setStore(next)
          setLoadFailed(false)
          setLoaded(true)
        })
        .catch(error => {
          console.error(error)
          if (cancelled) return
          setLoadFailed(true)
          setLoaded(false)
        })
    }
    refresh()
    const unsubscribe = fileStore.subscribe('budget/categories.json', refresh)
    window.addEventListener('budget-changed', refresh)
    return () => {
      cancelled = true
      unsubscribe()
      window.removeEventListener('budget-changed', refresh)
    }
  }, [fileStore, reloadTick])

  const adopt = useCallback(
    (next: BudgetStore | null) => {
      if (next) {
        storeRef.current = next
        setStore(next)
      }
      // The first event can be answered from the page's cache before it knows the files changed.
      onInvalidate()
      window.dispatchEvent(new Event('budget-changed'))
    },
    [onInvalidate],
  )

  const budget = useMemo<ImportBudgetApi>(
    () => ({
      store,
      blocked: !loaded,
      commitImport: async (plan, snapshot) => {
        onInvalidate()
        const { result, store: next } = await executeImport({ fileStore, store: storeRef.current, plan, snapshot })
        adopt(next)
        return result
      },
      undoImport: async record => {
        onInvalidate()
        const { result, store: next } = await executeUndo({ fileStore, store: storeRef.current, record })
        adopt(next)
        return result
      },
    }),
    [store, loaded, fileStore, onInvalidate, adopt],
  )
  const wizard = useImportWizard(budget)

  const groups = useMemo(() => store.categoryGroups ?? [], [store.categoryGroups])
  const resolve = useMemo(() => categoryResolver(groups), [groups])

  const runPlan = useCallback(
    async (plan: RecategorizePlan): Promise<RecategorizeResult> => {
      onInvalidate()
      const { result, store: next } = await executeRecategorize({ fileStore, store: storeRef.current, plan })
      adopt(next)
      return result
    },
    [fileStore, onInvalidate, adopt],
  )

  const undoRecord = useCallback(
    async (record: UndoRecord): Promise<boolean> => {
      onInvalidate()
      const { result, store: next } = await executeUndo({ fileStore, store: storeRef.current, record })
      adopt(next)
      return result.ok
    },
    [fileStore, onInvalidate, adopt],
  )

  const openRules = async () => {
    await loadRules()
    setPanel('rules')
  }

  const openApply = async () => {
    const current = await loadRules()
    setApplyPlan(
      current.state === 'ready'
        ? planRecategorize(storeRef.current.csvs, current.file.rules, resolve)
        : { months: {}, changed: 0, skippedRules: 0 },
    )
    setPanel('apply')
  }

  const closePanel = useCallback(() => {
    setPanel(null)
    setApplyPlan(null)
  }, [])

  useEffect(() => {
    if (!ruleSource) {
      setCreateReady(false)
      createUndo.current = null
      return
    }
    let cancelled = false
    void loadRules().then(() => {
      if (!cancelled) setCreateReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [ruleSource, loadRules])

  const impactRows = useMemo(() => (ruleSource ? toImpactRows(transactions) : []), [ruleSource, transactions])

  const createRule = async (draft: RuleDraft, apply: boolean): Promise<CreateRuleOutcome> => {
    if (rules?.state !== 'ready') return { ok: false, message: rulesSaveFailure('unreadable') }
    const next = addRule(rules.file.rules, draft)
    const saved = await changeRules(next)
    if (!saved.ok) return { ok: false, message: rulesSaveFailure(saved.reason) }
    if (!apply) return { ok: true, applied: null, canUndo: false }

    const plan = planRecategorize(storeRef.current.csvs, next, resolve, next[next.length - 1].id)
    if (plan.changed === 0) return { ok: true, applied: 0, canUndo: false }
    const result = await runPlan(plan)
    if (!result.ok) {
      return {
        ok: true,
        applied: null,
        canUndo: false,
        warning: applyFailureMessage(result.reason, result.failedMonths, result.restored),
      }
    }
    createUndo.current = result.undo
    return { ok: true, applied: result.changed, canUndo: true }
  }

  const undoCreate = async (): Promise<boolean> => {
    const record = createUndo.current
    if (!record || !canUndoImport(record, storeRef.current)) return false
    return undoRecord(record)
  }

  const dialogs = (
    <>
      {wizard.element}
      {panel === 'rules' && rules && (
        <RulesDialog rules={rules} categoryGroups={groups} onChange={changeRules} onClose={closePanel} />
      )}
      {panel === 'apply' && rules && applyPlan && (
        <ApplyRulesDialog
          rules={rules}
          count={applyPlan.changed}
          skippedRules={applyPlan.skippedRules}
          onApply={() => runPlan(applyPlan)}
          onUndo={result => undoRecord(result.undo)}
          canUndo={result => canUndoImport(result.undo, store)}
          onClose={closePanel}
        />
      )}
      {ruleSource && createReady && rules && (
        <CreateRuleDialog
          description={ruleSource.description}
          currentCategory={ruleSource.category}
          rules={rules}
          categoryGroups={groups}
          rows={impactRows}
          onCreate={createRule}
          onUndo={undoCreate}
          onClose={onRuleSourceClose}
        />
      )}
    </>
  )

  return (
    <>
      <button
        type="button"
        className="txn-filter-btn"
        disabled={!loaded}
        onClick={() => wizard.open({ multiple: true })}
      >
        <span className="txn-filter-btn-key">Import</span>
      </button>
      <button type="button" className="txn-filter-btn" disabled={!loaded} onClick={() => void openApply()}>
        <span className="txn-filter-btn-key">{APPLY_BUTTON_LABEL}</span>
      </button>
      <button type="button" className="txn-filter-btn" onClick={() => void openRules()}>
        <span className="txn-filter-btn-key">{MANAGE_RULES_LABEL}</span>
      </button>
      {loadFailed && (
        <>
          <span className="txn-import-error" role="alert">
            {IMPORT_PAUSED_MESSAGE}
          </span>
          <button type="button" className="txn-filter-btn" onClick={() => setReloadTick(tick => tick + 1)}>
            <span className="txn-filter-btn-key">Try again</span>
          </button>
        </>
      )}
      {createPortal(dialogs, document.body)}
    </>
  )
}

export default TransactionImportTools
