import { MAX_DATA_ROWS, MAX_FILES } from './constants'
import { draftFromMapping, initialDraft, legacyMapping, type MappingDraft } from './mapping'
import { AUTO_SETTINGS, parseFileText, type ParsedFile, type ParseSettings } from './parseFile'
import { ImportLimitError, readFile, type ReadableFile } from './readFile'
import { defaultFormatName, lookupSavedFormat, type FormatsFile } from './savedFormats'
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
  /**
   * 'saved' and 'legacy' skipped the Columns step; 'reused' copied the mapping of an earlier file with the same
   * headers. Null means the user confirmed the mapping.
   */
  auto: 'saved' | 'legacy' | 'reused' | null
  /** The saved format this file matched, kept when the user changes it so the same entry is updated. */
  format: { id: string; name: string } | null
  /** Whether to remember the confirmed mapping as a saved format, and under what name. */
  remember: { enabled: boolean; name: string }
  /** The file as it was before "Change", so Back from the Columns step can return to the saved format. */
  restoreTo: WizardFile | null
}

export interface LoadFailure {
  message: string
  /** Offer "Choose another file" next to the message. */
  canPickAgain: boolean
  /** Replaces the default "Could not open the file" heading. */
  heading?: string
}

export const noRowsMessage = (name: string): string =>
  `We found no transactions in ${name}. Check the header row setting, or choose another file.`

/**
 * Builds a WizardFile from decoded text; returns null when the file has no data rows. With `formats` (null when
 * the saved formats file could not be read), a file whose headers match a saved format skips the Columns step.
 */
export function createWizardFile(name: string, text: string, formats: FormatsFile | null = null): WizardFile | null {
  const detected = parseFileText(text, AUTO_SETTINGS)
  if (detected.detection.dataRecords.length === 0) return null

  const lookup = formats ? lookupSavedFormat(text, detected, formats.mappings) : null
  const parsed = lookup?.parsed ?? detected
  const settings = lookup?.settings ?? AUTO_SETTINGS
  const { dataRecords, headers } = parsed.detection
  const remember = { enabled: formats !== null, name: lookup?.match.format.name ?? defaultFormatName(name) }
  const base = { name, text, settings, parsed, remember, restoreTo: null }

  if (lookup) {
    const { format, mapping } = lookup.match
    return {
      ...base,
      draft: draftFromMapping(mapping),
      mapping,
      auto: 'saved',
      format: { id: format.id, name: format.name },
    }
  }
  const mapping = legacyMapping(headers, dataRecords)
  return { ...base, draft: initialDraft(headers, dataRecords), mapping, auto: mapping ? 'legacy' : null, format: null }
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
export async function loadWizardFiles(sources: {
  files?: ReadableFile[]
  texts?: TextSource[]
  /** Saved formats to match against; null when the formats file could not be read. */
  formats?: FormatsFile | null
}): Promise<LoadResult> {
  const { files = [], texts = [], formats = null } = sources
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
    const file = createWizardFile(source.name, source.text, formats)
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
