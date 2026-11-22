import type { BalanceEntry } from '../pages/data/types'
import type { FileStore } from './fileStoreTypes'

const BALANCES_DIR = 'balances'
const HEADER = ['month', 'accountId', 'balance']
const YEAR_FILE = /^(\d{4})\.csv$/

export const balanceFilePath = (year: string | number): string => `${BALANCES_DIR}/${year}.csv`

/** Groups balance entries by the year embedded in their `YYYY-MM` month key. */
export function groupBalancesByYear(balances: BalanceEntry[]): Map<string, BalanceEntry[]> {
  const byYear = new Map<string, BalanceEntry[]>()
  for (const entry of balances) {
    const year = String(entry.month).slice(0, 4)
    if (!/^\d{4}$/.test(year)) continue
    const list = byYear.get(year)
    if (list) list.push(entry)
    else byYear.set(year, [entry])
  }
  return byYear
}

/** Reads every `balances/{year}.csv` file and flattens them into one array. */
export async function loadBalances(fileStore: FileStore): Promise<BalanceEntry[]> {
  const names = (await fileStore.listFiles(BALANCES_DIR)).filter(name => YEAR_FILE.test(name)).sort()
  const balances: BalanceEntry[] = []
  let nextId = 1

  for (const name of names) {
    const rows = await fileStore.readCSV(`${BALANCES_DIR}/${name}`)
    for (const row of rows) {
      if (row.length < 3) continue
      const [month, accountId, balance] = row
      if (month === HEADER[0]) continue
      const parsedAccountId = Number(accountId)
      const parsedBalance = Number(balance)
      if (!Number.isFinite(parsedAccountId) || !Number.isFinite(parsedBalance)) continue
      balances.push({ id: nextId++, accountId: parsedAccountId, month, balance: parsedBalance })
    }
  }

  return balances
}

/**
 * Writes one CSV per year. Years that no longer have any entries are deleted
 * so stale files never resurrect removed data, but only after every write has
 * succeeded: a failed write must never cost the user the old year file.
 *
 * The file listing and every write are started before any I/O is awaited, so a
 * page-hide flush sees all of them instead of only the first year.
 */
export async function saveBalances(fileStore: FileStore, balances: BalanceEntry[]): Promise<void> {
  const byYear = groupBalancesByYear(balances)
  const listing = fileStore.listFiles(BALANCES_DIR)
  // A failed write rejects below; keep a failed listing from also surfacing as unhandled.
  listing.catch(() => {})

  const writes = [...byYear].map(([year, entries]) => {
    const rows = [HEADER, ...entries.map(e => [e.month, String(e.accountId), String(e.balance)])]
    return fileStore.writeCSV(balanceFilePath(year), rows)
  })

  await Promise.all(writes)

  for (const name of (await listing).filter(n => YEAR_FILE.test(n))) {
    const year = name.replace('.csv', '')
    if (!byYear.has(year)) await fileStore.delete(`${BALANCES_DIR}/${name}`)
  }
}
