export type Delimiter = ',' | ';' | '\t' | '|'
export type AmountMode = 'single' | 'split'
export type SignConvention = 'negative-is-spending' | 'positive-is-spending'
export type DateFormat =
  | 'YYYY-MM-DD'
  | 'YYYY/MM/DD'
  | 'MM/DD/YYYY'
  | 'DD/MM/YYYY'
  | 'MM-DD-YYYY'
  | 'DD-MM-YYYY'
  | 'DD.MM.YYYY'
  | 'MM/DD/YY'
  | 'DD/MM/YY'
  | 'D MMM YYYY'
  | 'MMM D, YYYY'
  | 'YYYYMMDD'
export type DecimalSeparator = '.' | ','
export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'

/** Column positions are 0-based indexes into a record; `null` means "not mapped". */
export interface ColumnMapping {
  amountMode: AmountMode
  date: number
  description: number | null
  amount: number | null
  debit: number | null
  credit: number | null
  category: number | null
  signConvention: SignConvention
  /** `null` means "not chosen yet": normalizeRows only accepts it when the data has exactly one possible format. */
  dateFormat: DateFormat | null
  decimalSeparator: DecimalSeparator
}

export interface NormalizedRow {
  /** 1-based record number in the file, counting every record including blank ones. */
  sourceRow: number
  /** YYYY-MM-DD */
  date: string
  /** Negative = spending, positive = income. */
  amountCents: number
  description: string
  /** From the file; null when blank or unmapped. */
  category: string | null
}

export type SkipReason = 'bad-date' | 'bad-amount' | 'empty' | 'column-count'

export interface SkippedRow {
  sourceRow: number
  reason: SkipReason
  raw: string
}

export interface TokenizeError {
  row: number
  message: string
}

export interface ImportOptions {
  /** Default true: rows already in the month (or earlier in the batch) are left out. */
  skipDuplicates: boolean
  /** Default false: write only the imported rows for each touched month instead of appending. */
  replaceMonths: boolean
}

/** A normalized row with the category it will be filed under. */
export interface PlannedRow extends NormalizedRow {
  resolvedCategory: string
  /** True when neither the file nor a rule gave a category and the row went to one of the two fallback categories. */
  fallback: boolean
  fileName: string
  fileIndex: number
}

export interface MonthPlan {
  added: PlannedRow[]
  /** Rows recognized as duplicates; they are in `added` only when duplicates are not skipped. */
  duplicateRows: PlannedRow[]
  existingCount: number
  /** True when the month already has a non-empty file, even one whose rows could not be read. */
  hasExistingFile: boolean
}

export interface PlanSkippedRow extends SkippedRow {
  fileName: string
  fileIndex: number
}

export interface PlanFileSummary {
  name: string
  newRows: number
  duplicates: number
  skipped: number
}

export interface ImportPlan {
  /** Keyed by 'YYYY-MM', in ascending order. */
  months: Record<string, MonthPlan>
  options: ImportOptions
  totals: { newRows: number; duplicates: number; skipped: number; spendingCents: number; incomeCents: number }
  files: PlanFileSummary[]
  newCategories: { name: string; group: 'expense' | 'income' }[]
  /** Rows filed under the fallback categories. */
  fallbackCount: number
  /** Rows a rule categorized. */
  rulesApplied: number
  /** Rules that matched a row but were passed over because their category no longer exists. */
  rulesSkipped: number
  skipped: PlanSkippedRow[]
  /** Tokenizer messages, for example an unterminated quote. */
  notices: string[]
}
