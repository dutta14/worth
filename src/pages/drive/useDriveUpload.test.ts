import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDriveUpload } from './useDriveUpload'

/* ─── Mock dependencies ─── */

const mockOpen = vi.fn()
const mockCommitImport = vi.fn()
const mockUndoImport = vi.fn()
let lastWizardBudget: { commitImport: typeof mockCommitImport; undoImport: typeof mockUndoImport } | null = null

vi.mock('../budget/hooks/useBudget', () => ({
  useBudget: () => ({
    store: { csvs: {}, configs: {}, years: [], categoryGroups: [] },
    commitImport: mockCommitImport,
    undoImport: mockUndoImport,
    importBlocked: false,
    reload: vi.fn(),
  }),
}))

vi.mock('../budget/import/hooks/useImportWizard', () => ({
  useImportWizard: (budget: typeof lastWizardBudget) => {
    lastWizardBudget = budget
    return { open: mockOpen, element: null }
  },
}))

const refreshTree = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  lastWizardBudget = null
})

afterEach(() => {
  try {
    vi.runOnlyPendingTimers()
  } catch {
    /* timers not mocked */
  }
  vi.useRealTimers()
})

function renderUploadHook() {
  return renderHook(() => useDriveUpload(refreshTree))
}

const csvFile = (name = '2025-01.csv') => new File(['csv'], name, { type: 'text/csv' })

/* ═══════════════════════════════════════════════════════════════
   processFiles
   ═══════════════════════════════════════════════════════════════ */

describe('useDriveUpload — processFiles', () => {
  it('opens the import wizard with the given files, whatever their names are', () => {
    const { result } = renderUploadHook()
    const files = [csvFile('random.csv'), csvFile('2025-02.csv')]

    act(() => {
      result.current.processFiles(files)
    })

    expect(mockOpen).toHaveBeenCalledWith({ files })
  })
})

/* ═══════════════════════════════════════════════════════════════
   Wizard budget API
   ═══════════════════════════════════════════════════════════════ */

describe('useDriveUpload — wizard budget API', () => {
  it('refreshes the Drive tree after a committed import', async () => {
    mockCommitImport.mockResolvedValue({ ok: true })
    renderUploadHook()

    const result = await lastWizardBudget?.commitImport({} as never)

    expect(result).toEqual({ ok: true })
    expect(refreshTree).toHaveBeenCalledTimes(1)
  })

  it('refreshes the Drive tree after an undone import', async () => {
    mockUndoImport.mockResolvedValue({ ok: true })
    renderUploadHook()

    const result = await lastWizardBudget?.undoImport({} as never)

    expect(result).toEqual({ ok: true })
    expect(refreshTree).toHaveBeenCalledTimes(1)
  })
})

/* ═══════════════════════════════════════════════════════════════
   Drag and drop handlers
   ═══════════════════════════════════════════════════════════════ */

describe('useDriveUpload — drag and drop', () => {
  it('sets dragOver to true on dragEnter and false on drop', async () => {
    const { result } = renderUploadHook()

    act(() => {
      result.current.handleDragEnter({ preventDefault: vi.fn() } as unknown as React.DragEvent)
    })
    expect(result.current.dragOver).toBe(true)

    await act(async () => {
      result.current.handleDrop({
        preventDefault: vi.fn(),
        dataTransfer: { files: [] },
      } as unknown as React.DragEvent)
    })
    expect(result.current.dragOver).toBe(false)
  })
})

/* ═══════════════════════════════════════════════════════════════
   dismissToast
   ═══════════════════════════════════════════════════════════════ */

describe('useDriveUpload — dismissToast', () => {
  it('clears the toast message', async () => {
    vi.useFakeTimers()
    const { result } = renderUploadHook()

    act(() => {
      result.current.handleDrop({
        preventDefault: vi.fn(),
        dataTransfer: { files: [] },
      } as unknown as React.DragEvent)
    })

    expect(result.current.toastMsg).toBeTruthy()

    act(() => {
      result.current.dismissToast()
    })

    expect(result.current.toastMsg).toBeNull()
  })
})

/* ═══════════════════════════════════════════════════════════════
   handleDragLeave
   ═══════════════════════════════════════════════════════════════ */

describe('useDriveUpload — handleDragLeave', () => {
  it('decrements drag counter and clears dragOver when counter reaches 0', () => {
    const { result } = renderUploadHook()

    // Enter twice
    act(() => {
      result.current.handleDragEnter({ preventDefault: vi.fn() } as unknown as React.DragEvent)
    })
    act(() => {
      result.current.handleDragEnter({ preventDefault: vi.fn() } as unknown as React.DragEvent)
    })
    expect(result.current.dragOver).toBe(true)

    // Leave once — counter is 1, still dragging
    act(() => {
      result.current.handleDragLeave({ preventDefault: vi.fn() } as unknown as React.DragEvent)
    })
    expect(result.current.dragOver).toBe(true)

    // Leave again — counter is 0, no longer dragging
    act(() => {
      result.current.handleDragLeave({ preventDefault: vi.fn() } as unknown as React.DragEvent)
    })
    expect(result.current.dragOver).toBe(false)
  })
})

/* ═══════════════════════════════════════════════════════════════
   handleDrop — no CSV files
   ═══════════════════════════════════════════════════════════════ */

describe('useDriveUpload — handleDrop no CSVs', () => {
  it('shows toast when dropped files contain no CSVs', async () => {
    vi.useFakeTimers()
    const { result } = renderUploadHook()

    await act(async () => {
      result.current.handleDrop({
        preventDefault: vi.fn(),
        dataTransfer: { files: [new File(['img'], 'photo.png', { type: 'image/png' })] },
      } as unknown as React.DragEvent)
    })

    expect(result.current.toastMsg).toContain('No CSV files found')
    expect(result.current.dragOver).toBe(false)
  })

  it('opens the wizard with only the CSV files from a mixed drop', () => {
    const { result } = renderUploadHook()
    const csv = csvFile()

    act(() => {
      result.current.handleDrop({
        preventDefault: vi.fn(),
        dataTransfer: { files: [new File(['img'], 'photo.png', { type: 'image/png' }), csv] },
      } as unknown as React.DragEvent)
    })

    expect(mockOpen).toHaveBeenCalledWith({ files: [csv] })
  })
})

/* ═══════════════════════════════════════════════════════════════
   handleFileInputChange
   ═══════════════════════════════════════════════════════════════ */

describe('useDriveUpload — handleFileInputChange', () => {
  it('opens the wizard with the chosen files and resets the input value', () => {
    const { result } = renderUploadHook()
    const csv = csvFile()

    const inputEl = { value: '2025-01.csv' } as HTMLInputElement
    ;(result.current.fileInputRef as { current: HTMLInputElement }).current = inputEl

    act(() => {
      result.current.handleFileInputChange({
        target: { files: [csv] },
      } as unknown as React.ChangeEvent<HTMLInputElement>)
    })

    expect(mockOpen).toHaveBeenCalledWith({ files: [csv] })
    expect(inputEl.value).toBe('')
  })

  it('does nothing when file input has no files', () => {
    const { result } = renderUploadHook()

    act(() => {
      result.current.handleFileInputChange({
        target: { files: null },
      } as unknown as React.ChangeEvent<HTMLInputElement>)
    })

    expect(mockOpen).not.toHaveBeenCalled()
  })
})

/* ═══════════════════════════════════════════════════════════════
   handleDragOver
   ═══════════════════════════════════════════════════════════════ */

describe('useDriveUpload — handleDragOver', () => {
  it('prevents default on dragOver event', () => {
    const { result } = renderUploadHook()
    const preventDefault = vi.fn()

    act(() => {
      result.current.handleDragOver({ preventDefault } as unknown as React.DragEvent)
    })

    expect(preventDefault).toHaveBeenCalled()
  })
})

/* ═══════════════════════════════════════════════════════════════
   openFilePicker
   ═══════════════════════════════════════════════════════════════ */

describe('useDriveUpload — openFilePicker', () => {
  it('calls click on fileInputRef', () => {
    const { result } = renderUploadHook()
    const mockClick = vi.fn()
    ;(result.current.fileInputRef as { current: HTMLInputElement }).current = {
      click: mockClick,
    } as unknown as HTMLInputElement

    act(() => {
      result.current.openFilePicker()
    })

    expect(mockClick).toHaveBeenCalled()
  })
})
