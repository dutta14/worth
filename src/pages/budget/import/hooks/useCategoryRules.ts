import { useCallback, useState } from 'react'
import { useFileStore } from '../../../../contexts/FileStoreContext'
import { loadRules, saveRules, type RulesLoad, type RulesSaveResult } from '../importStorage'
import { emptyRulesFile, type CategoryRule } from '../rules'

/**
 * The rules file for a page that manages rules outside the import wizard. Nothing is read until `load()` is
 * called, so a host that never opens a rules dialog does no I/O. Saves go through `saveRules`, which refuses
 * to overwrite a file this version cannot read.
 */
export function useCategoryRules() {
  const { fileStore } = useFileStore()
  const [rules, setRules] = useState<RulesLoad | null>(null)

  const load = useCallback(async (): Promise<RulesLoad> => {
    const next = await loadRules(fileStore)
    setRules(next)
    return next
  }, [fileStore])

  const change = useCallback(
    async (next: CategoryRule[]): Promise<RulesSaveResult> => {
      const outcome = await saveRules(fileStore, next)
      if (outcome.ok) setRules({ state: 'ready', file: { ...emptyRulesFile(), rules: next } })
      return outcome
    },
    [fileStore],
  )

  return { rules, load, change }
}
