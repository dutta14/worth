import { MAX_DATA_ROWS, MAX_FILES } from './constants'
import { initialDraft, legacyMapping, type MappingDraft } from './mapping'
import { parseFileText, type ParsedFile, type ParseSettings } from './parseFile'
import { ImportLimitError, readFile, type ReadableFile } from './readFile'
import type { ColumnMapping } from './types'

export const DEFAULT_TEXT_NAME = 'Imported CSV'

/** One file in the wizard: its text, how it was parsed, and the mapping chosen or inferred for it. */
export interface WizardFile {
  name: string
  text: string
  settings: ParseSettings
  parsed: ParsedFile
  draft: MappingDraft
  /** Null until the Columns step is confirmed for this file. */
  mapping: ColumnMapping | null
  /** 'legacy' skipped the Columns step; 'reused' copied the mapping of an earlier file with the same headers. */
  auto: 'legacy' | 'reused' | null
}

export interface LoadFailure {
  message: string
  /** Offer "Choose another file" next to the message. */
  canPickAgain: boolean
}

export const noRowsMessage = (name: string): string =>
  `We found no transactions in ${name}. Check the header row setting, or choose another file.`

/** Builds a WizardFile from decoded text; returns null when the file has no data rows. */
export function createWizardFile(name: string, text: string): WizardFile | null {
  const settings: ParseSettings = { delimiter: null, hasHeader: null, headerRow: null }
  const parsed = parseFileText(text, settings)
  const { dataRecords, headers } = parsed.detection
  if (dataRecords.length === 0) return null
  const mapping = legacyMapping(headers, dataRecords)
  return {
    name,
    text,
    settings,
    parsed,
    draft: initialDraft(headers, dataRecords),
    mapping,
    auto: mapping ? 'legacy' : null,
  }
}

/** Re-parses a file after the user changes the delimiter or header row; the mapping starts over. */
export function reparseWizardFile(file: WizardFile, settings: ParseSettings): WizardFile {
  const parsed = parseFileText(file.text, settings)
  const { headers, dataRecords } = parsed.detection
  return { ...file, settings, parsed, draft: initialDraft(headers, dataRecords), mapping: null, auto: null }
}

const yieldToUi = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

export type LoadResult = { ok: true; files: WizardFile[] } | ({ ok: false } & LoadFailure)

export interface TextSource {
  name: string
  text: string
}

/** Reads and parses every file, yielding to the UI between files. Refuses limits with the spec'd messages. */
export async function loadWizardFiles(sources: { files?: ReadableFile[]; texts?: TextSource[] }): Promise<LoadResult> {
  const { files = [], texts = [] } = sources
  if (files.length + texts.length > MAX_FILES) {
    return {
      ok: false,
      message: `You chose ${files.length + texts.length} files. Choose ${MAX_FILES} files or fewer.`,
      canPickAgain: true,
    }
  }

  const loaded: WizardFile[] = []
  const pending: TextSource[] = [...texts]
  for (const file of files) {
    try {
      pending.push({ name: file.name, text: (await readFile(file)).text })
    } catch (error) {
      const code = error instanceof ImportLimitError ? error.code : 'unreadable'
      return {
        ok: false,
        canPickAgain: true,
        message:
          code === 'file-too-large'
            ? `${file.name} is larger than 10 MB. Split it into smaller files and try again.`
            : `We could not read ${file.name}. Check that it is a text CSV file, then try again.`,
      }
    }
    await yieldToUi()
  }

  for (const source of pending) {
    const file = createWizardFile(source.name, source.text)
    if (file === null) return { ok: false, message: noRowsMessage(source.name), canPickAgain: true }
    const rowCount = file.parsed.detection.dataRecords.length
    if (rowCount > MAX_DATA_ROWS) {
      return {
        ok: false,
        canPickAgain: true,
        message: `${source.name} has ${rowCount.toLocaleString()} rows. Worth imports up to ${MAX_DATA_ROWS.toLocaleString()} rows at a time. Split the file and try again.`,
      }
    }
    loaded.push(file)
    await yieldToUi()
  }
  return { ok: true, files: loaded }
}
