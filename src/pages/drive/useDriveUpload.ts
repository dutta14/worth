import { useState, useCallback, useRef } from 'react'
import { useBudget } from '../budget/hooks/useBudget'
import { useImportWizard, type ImportBudgetApi } from '../budget/import/hooks/useImportWizard'

interface DriveUploadOptions {
  onViewTransactions?: () => void
}

export function useDriveUpload(refreshTree: () => void, { onViewTransactions }: DriveUploadOptions = {}) {
  const { store, commitImport, undoImport, importBlocked, reload } = useBudget()
  const wizardBudget: ImportBudgetApi = {
    store,
    blocked: importBlocked,
    reload,
    commitImport: async (plan, snapshot) => {
      const result = await commitImport(plan, snapshot)
      refreshTree()
      return result
    },
    undoImport: async record => {
      const result = await undoImport(record)
      refreshTree()
      return result
    },
  }
  const wizard = useImportWizard(wizardBudget, { onViewTransactions })
  const openWizard = wizard.open
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg)
    setTimeout(() => setToastMsg(null), 5000)
  }, [])

  const dismissToast = useCallback(() => setToastMsg(null), [])

  const processFiles = useCallback((files: File[]) => openWizard({ files }), [openWizard])

  /* ── drag & drop ───────────────────────────────────────────── */
  const [dragOver, setDragOver] = useState(false)
  const dragCounter = useRef(0)

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current++
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounter.current--
    if (dragCounter.current <= 0) {
      dragCounter.current = 0
      setDragOver(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      dragCounter.current = 0
      const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.csv'))
      if (files.length === 0) {
        showToast('No CSV files found. Drop .csv files to upload.')
        return
      }
      processFiles(files)
    },
    [processFiles, showToast],
  )

  /* ── file input for click-to-browse ────────────────────────── */
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files || files.length === 0) return
      processFiles(Array.from(files))
      if (fileInputRef.current) fileInputRef.current.value = ''
    },
    [processFiles],
  )

  const openFilePicker = useCallback(() => fileInputRef.current?.click(), [])

  return {
    wizardElement: wizard.element,
    toastMsg,
    dismissToast,
    dragOver,
    fileInputRef,
    processFiles,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileInputChange,
    openFilePicker,
  }
}
