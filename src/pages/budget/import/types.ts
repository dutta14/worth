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
