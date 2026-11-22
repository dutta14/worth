/** Fallback category for spending (and zero-amount) rows that arrive without a category. */
export const UNCATEGORIZED_EXPENSE = 'Uncategorized'
/** Fallback category for income rows that arrive without a category. */
export const UNCATEGORIZED_INCOME = 'Uncategorized income'

export const MAX_DATA_ROWS = 50_000
export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const MAX_FILES = 20

export const MIN_PLAUSIBLE_YEAR = 1990
/** Maximum records examined when sniffing the delimiter. */
export const SNIFF_RECORD_LIMIT = 20
/** Longest `raw` text kept on a skipped row. */
export const MAX_RAW_LENGTH = 500
