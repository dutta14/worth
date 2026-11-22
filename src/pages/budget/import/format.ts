const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10" -> "Oct 2026". */
export function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-')
  return `${MONTHS[Number(month) - 1] ?? month} ${year}`
}

/** "Oct 2026", "Oct 2026 and Nov 2026", "Oct 2026, Nov 2026 and Dec 2026". */
export function formatMonthList(monthKeys: string[]): string {
  const names = monthKeys.map(formatMonth)
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Integer cents as dollars with two places, "$1,234.50". Sign is dropped; callers say spending or income. */
export function formatMoney(cents: number): string {
  return (Math.abs(cents) / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/** Signed form for table cells: "-$12.50", "$1,000.00". */
export const formatSignedMoney = (cents: number): string => `${cents < 0 ? '-' : ''}${formatMoney(cents)}`
