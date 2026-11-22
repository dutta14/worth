import type { CommitResult } from './commitImport'
import { headerSignature, type ParseSettings } from './parseFile'
import { draftFromMapping, resolveMapping, type MappingDraft } from './mapping'
import { reparseWizardFile, type LoadFailure, type WizardFile } from './wizardFiles'
import type { ImportOptions } from './types'

export type WizardPhase = 'idle' | 'loading' | 'error' | 'columns' | 'review' | 'committing' | 'result'

export interface WizardState {
  phase: WizardPhase
  files: WizardFile[]
  /** The file shown in the Columns step. */
  fileIndex: number
  options: ImportOptions
  loadingNames: string[]
  failure: LoadFailure | null
  commit: CommitResult | null
  undone: boolean
  undoFailed: boolean
}

export const DEFAULT_OPTIONS: ImportOptions = { skipDuplicates: true, replaceMonths: false }

export const initialWizardState: WizardState = {
  phase: 'idle',
  files: [],
  fileIndex: 0,
  options: DEFAULT_OPTIONS,
  loadingNames: [],
  failure: null,
  commit: null,
  undone: false,
  undoFailed: false,
}

export type WizardAction =
  | { type: 'loading'; names: string[] }
  | { type: 'loaded'; files: WizardFile[] }
  | { type: 'load-failed'; failure: LoadFailure }
  | { type: 'draft'; draft: MappingDraft }
  | { type: 'reparse'; settings: ParseSettings }
  | { type: 'confirm-columns' }
  | { type: 'back' }
  | { type: 'options'; options: Partial<ImportOptions> }
  | { type: 'committing' }
  | { type: 'committed'; result: CommitResult }
  | { type: 'review-again' }
  | { type: 'undone' }
  | { type: 'undo-failed' }
  | { type: 'close' }

const nextPending = (files: WizardFile[], from: number): number =>
  files.findIndex((f, i) => i > from && f.mapping === null)

const lastManual = (files: WizardFile[], before: number): number => {
  for (let i = before - 1; i >= 0; i--) if (files[i].auto === null) return i
  return -1
}

/** Copies a confirmed mapping to later files that have the same headers and delimiter, when it still resolves for them. */
function propagate(files: WizardFile[], from: number): WizardFile[] {
  const source = files[from]
  if (source.mapping === null) return files
  const signature = headerSignature(source.parsed.detection.headers)
  return files.map((file, i) => {
    if (i <= from || (file.auto === null && file.mapping !== null)) return file
    if (file.auto === 'legacy') return file
    const sameShape =
      file.parsed.delimiter === source.parsed.delimiter &&
      file.parsed.detection.hasHeader === source.parsed.detection.hasHeader &&
      headerSignature(file.parsed.detection.headers) === signature
    if (!sameShape) return file.auto === 'reused' ? { ...file, mapping: null, auto: null } : file
    const draft = draftFromMapping(source.mapping!)
    const { mapping } = resolveMapping(file.parsed.detection.dataRecords, draft)
    return mapping
      ? { ...file, draft, mapping, auto: 'reused' }
      : file.auto === 'reused'
        ? { ...file, mapping: null, auto: null }
        : file
  })
}

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case 'loading':
      return { ...initialWizardState, phase: 'loading', loadingNames: action.names, options: state.options }
    case 'loaded': {
      const first = action.files.findIndex(f => f.mapping === null)
      return {
        ...state,
        phase: first === -1 ? 'review' : 'columns',
        files: action.files,
        fileIndex: Math.max(first, 0),
        failure: null,
      }
    }
    case 'load-failed':
      return { ...state, phase: 'error', failure: action.failure }
    case 'draft':
      return {
        ...state,
        files: state.files.map((f, i) => (i === state.fileIndex ? { ...f, draft: action.draft } : f)),
      }
    case 'reparse':
      return {
        ...state,
        files: state.files.map((f, i) => (i === state.fileIndex ? reparseWizardFile(f, action.settings) : f)),
      }
    case 'confirm-columns': {
      const file = state.files[state.fileIndex]
      const { mapping } = resolveMapping(file.parsed.detection.dataRecords, file.draft)
      if (mapping === null) return state
      const confirmed = state.files.map((f, i) => (i === state.fileIndex ? { ...f, mapping, auto: null } : f))
      const files = propagate(confirmed, state.fileIndex)
      const next = nextPending(files, state.fileIndex)
      return next === -1 ? { ...state, files, phase: 'review' } : { ...state, files, fileIndex: next }
    }
    case 'back': {
      if (state.phase === 'review') {
        const last = lastManual(state.files, state.files.length)
        return last === -1 ? state : { ...state, phase: 'columns', fileIndex: last }
      }
      const previous = lastManual(state.files, state.fileIndex)
      return previous === -1 ? state : { ...state, fileIndex: previous }
    }
    case 'options':
      return { ...state, options: { ...state.options, ...action.options } }
    case 'committing':
      return { ...state, phase: 'committing' }
    case 'committed':
      return { ...state, phase: 'result', commit: action.result, undone: false, undoFailed: false }
    case 'review-again':
      return { ...state, phase: 'review', commit: null }
    case 'undone':
      return { ...state, undone: true, undoFailed: false }
    case 'undo-failed':
      return { ...state, undoFailed: true }
    case 'close':
      return { ...initialWizardState, options: DEFAULT_OPTIONS }
  }
}

/** Whether the flow has a Columns step at all (for "Step n of total"). */
export const hasColumnsStep = (files: WizardFile[]): boolean => files.some(file => file.auto === null)

/** Whether Back leads somewhere from the current step. */
export const canGoBack = (state: WizardState): boolean =>
  state.phase === 'review' ? hasColumnsStep(state.files) : lastManual(state.files, state.fileIndex) !== -1
