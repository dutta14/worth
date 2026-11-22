import type { Page } from '@playwright/test'
import { balanceEntriesToEntries, seedFileStore } from './seed-filestore'

/**
 * Seed helpers for the Monthly check-in E2E suite (docs/specs/monthly-check-in.md, section 7.4).
 */

/** Nine active accounts; ids 8 and 9 are the ones left out of a partial month. */
export const CHECK_IN_ACCOUNTS = [
  'Checking',
  'Savings',
  '401(k)',
  'Brokerage',
  'HSA',
  'Money Market',
  'CD Ladder',
  'Roth IRA',
  'Crypto Wallet',
].map((name, index) => ({
  id: index + 1,
  name,
  type: 'liquid',
  owner: 'primary',
  status: 'active',
  goalType: 'fi',
  nature: 'asset',
  allocation: 'cash',
}))

export const MISSING_NAMES = ['Roth IRA', 'Crypto Wallet']

/** Whole-dollar balances: account id times 1000, plus a per-month step so every month differs. */
export function monthBalances(month: string, step: number, accountIds: number[] = CHECK_IN_ACCOUNTS.map(a => a.id)) {
  return accountIds.map(accountId => ({ accountId, month, balance: accountId * 1000 + step }))
}

const ALL_IDS = CHECK_IN_ACCOUNTS.map(a => a.id)
const FIRST_SEVEN = ALL_IDS.slice(0, 7)

/** September complete, October 7 of 9 (Roth IRA and Crypto Wallet missing). */
export const PARTIAL_OCTOBER = [
  ...monthBalances('2026-08', 0),
  ...monthBalances('2026-09', 10),
  ...monthBalances('2026-10', 20, FIRST_SEVEN),
]

/** August and September complete, nothing for October. */
export const COMPLETE_SEPTEMBER = [...monthBalances('2026-08', 0), ...monthBalances('2026-09', 10)]

/** October complete. */
export const COMPLETE_OCTOBER = [...COMPLETE_SEPTEMBER, ...monthBalances('2026-10', 20)]

interface SeedCheckInOptions {
  balances: Array<{ accountId: number; month: string; balance: number }>
  darkMode?: boolean
  onboardingDismissed?: boolean
}

/**
 * Seeds the file store and localStorage once per tab, so edits and the snooze survive a reload.
 * Call BEFORE page.goto(); pin the clock separately with page.clock.setFixedTime.
 */
export async function seedCheckIn(
  page: Page,
  { balances, darkMode = false, onboardingDismissed = true }: SeedCheckInOptions,
): Promise<void> {
  await seedFileStore(
    page,
    [
      { path: 'accounts.json', data: CHECK_IN_ACCOUNTS, type: 'json' },
      ...balanceEntriesToEntries(balances.map((entry, index) => ({ ...entry, id: index + 1 }))),
    ],
    { onceKey: 'check-in-e2e-seeded' },
  )
  await page.addInitScript(
    ({ darkMode, onboardingDismissed }) => {
      if (sessionStorage.getItem('check-in-e2e-init') !== '1') {
        localStorage.clear()
        sessionStorage.setItem('check-in-e2e-init', '1')
        localStorage.setItem('onboarding-dismissed', onboardingDismissed ? '1' : '0')
      }
      localStorage.setItem('_e2eMode', '1')
      localStorage.setItem('encryption-enabled', '0')
      localStorage.setItem('darkMode', darkMode ? '1' : '0')
    },
    { darkMode, onboardingDismissed },
  )
}
