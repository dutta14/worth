import type { DecimalSeparator } from './types'

const CURRENCY_CODES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'AUD',
  'NZD',
  'CHF',
  'INR',
  'CNY',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'MXN',
  'BRL',
  'ZAR',
  'SGD',
  'HKD',
  'KRW',
  'TRY',
  'RUB',
  'ILS',
  'AED',
  'THB',
]
const CURRENCY = `[$€£¥₹₩₽₺₫₪]|${CURRENCY_CODES.join('|')}`
const SIGN_CHARS = '+\\-\\u2212'

// One removable token at an edge: whitespace (including NBSP), a sign, or a currency symbol / ISO code.
const LEADING = new RegExp(`^(?:\\s+|([${SIGN_CHARS}])|${CURRENCY})`, 'i')
const TRAILING = new RegExp(`(?:\\s+|([${SIGN_CHARS}])|${CURRENCY})$`, 'i')

const GROUP_SEPARATORS: Record<DecimalSeparator, string> = {
  '.': ",\\s'\\u2019",
  ',': ".\\s'\\u2019",
}

const numberPattern = (decimal: DecimalSeparator): RegExp => {
  const point = decimal === '.' ? '\\.' : ','
  return new RegExp(`^(?:(\\d{1,3})(?:([${GROUP_SEPARATORS[decimal]}])\\d{3}(?:\\2\\d{3})*)|\\d*)(?:${point}(\\d+))?$`)
}
const NUMBER_PATTERNS: Record<DecimalSeparator, RegExp> = { '.': numberPattern('.'), ',': numberPattern(',') }

const MAX_INTEGER_DIGITS = 13
// No amount is this long; the cap keeps free-text cells from being scanned.
const MAX_AMOUNT_LENGTH = 64

/**
 * Parses a money string to integer cents, or null when it is not an exact amount.
 *
 * Accepts currency symbols and ISO codes on either side, parentheses or a leading/trailing minus for
 * negatives, a leading plus, and thousands separators (comma, period, space, NBSP, apostrophe) that
 * differ from `decimalSeparator`. Math is on digit strings, so results are exact. A fraction longer than
 * two digits is accepted only when the extra digits are zeros; anything else is not exact to the cent.
 */
export function parseAmountToCents(text: string, decimalSeparator: DecimalSeparator): number | null {
  if (text.length > MAX_AMOUNT_LENGTH) return null
  let core = text
  let negative = false
  let signs = 0
  let parens = false

  for (;;) {
    let changed = true
    while (changed) {
      changed = false
      for (const edge of [LEADING, TRAILING]) {
        const match = core.match(edge)
        if (!match) continue
        core = edge === LEADING ? core.slice(match[0].length) : core.slice(0, core.length - match[0].length)
        if (match[1]) {
          signs++
          negative = match[1] !== '+'
        }
        changed = true
      }
    }
    if (!parens && core.startsWith('(') && core.endsWith(')')) {
      parens = true
      negative = true
      core = core.slice(1, -1)
      continue
    }
    break
  }

  if (signs > 1 || (parens && signs > 0)) return null

  const match = core.replace(/\s+/g, ' ').match(NUMBER_PATTERNS[decimalSeparator])
  if (!match) return null

  const digits = core.replace(/\D/g, '')
  const fraction = match[3] ?? ''
  const integer = digits.slice(0, digits.length - fraction.length)
  if (digits === '' || integer.length > MAX_INTEGER_DIGITS) return null
  if (/[^0]/.test(fraction.slice(2))) return null

  const cents = Number(integer || '0') * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'))
  return negative && cents !== 0 ? -cents : cents
}
