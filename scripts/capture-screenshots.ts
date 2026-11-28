/* eslint-disable no-console */
/**
 * capture-screenshots.ts
 *
 * Renders the worth app under Playwright with a fixed fake persona ("Avery Chen")
 * and writes the PNGs in docs/screenshots/ that the README and the GitHub wiki embed.
 *
 * Assumes the Vite dev server is already running at http://localhost:5173/worth/
 * (run `npm run dev` in another terminal first). `npm run screenshots` is the entry point.
 *
 * Seeding uses the same mechanism as the Playwright e2e suite: `_e2eMode` makes the app use a
 * MemoryFileStore, and `window.__e2eSeedData` (path -> file text) fills it before first render.
 * Nothing touches a real folder. The browser clock is pinned to 2025-06-01.
 */

import { chromium, type Page, type Browser } from '@playwright/test'
import { mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  balanceEntriesToEntries,
  budgetCsvsToEntries,
  goalsToEntry,
  seedFileStore,
  taxStoreToEntries,
  type SeedEntry,
} from '../e2e/fixtures/seed-filestore'

const __dirname = dirname(fileURLToPath(import.meta.url))

const OUT_DIR = join(__dirname, '..', 'docs', 'screenshots')
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173/worth/'
const VIEWPORT = { width: 1440, height: 900 }
const DEVICE_SCALE_FACTOR = 2
const FLAGS_URL = 'https://api.github.com/repos/dutta14/worth/contents/feature-flags.json'

/* ── Fake persona: "Avery Chen" ──────────────────────────────────
 *
 * Numbers are plausibly real (not round, not too neat) but obviously
 * synthetic. Six months of balance history ending May 2025, total ≈ $287,000.
 */

const PROFILE = { name: 'Avery Chen', avatarDataUrl: '', birthday: '1990-08-22' }

const account = (
  id: number,
  name: string,
  type: string,
  goalType: 'fi' | 'gw',
  allocation: string,
  institution: string,
  group: string,
) => ({ id, name, type, owner: 'primary', status: 'active', goalType, nature: 'asset', allocation, institution, group })

const ACCOUNTS = [
  account(1, '401(k)', 'retirement', 'fi', 'us-stock', 'Fidelity', 'Retirement'),
  account(2, 'Roth IRA', 'retirement', 'fi', 'intl-stock', 'Vanguard', 'Retirement'),
  account(3, 'Brokerage', 'non-retirement', 'fi', 'us-stock', 'Schwab', 'Taxable'),
  account(4, 'High-Yield Savings', 'liquid', 'gw', 'cash', 'Marcus', 'Cash'),
  account(5, 'Checking', 'liquid', 'gw', 'cash', 'Chase', 'Cash'),
  account(6, 'Home Equity', 'illiquid', 'gw', 'real-estate', 'Property', 'Real Estate'),
]

// Balances per month, in account-id order (1..6). Monthly totals:
// Dec 2024 ≈ 260,400, Jan ≈ 265,700, Feb ≈ 271,300, Mar ≈ 276,900, Apr ≈ 282,100, May ≈ 287,000.
const BALANCES_BY_MONTH: Record<string, number[]> = {
  '2024-12': [129_000, 43_700, 53_100, 16_700, 4_850, 13_050],
  '2025-01': [131_500, 44_500, 54_700, 17_100, 4_800, 13_100],
  '2025-02': [134_100, 45_400, 56_500, 17_500, 4_650, 13_150],
  '2025-03': [136_800, 46_300, 58_200, 17_900, 4_500, 13_200],
  '2025-04': [139_400, 47_100, 59_800, 18_200, 4_350, 13_250],
  '2025-05': [142_000, 48_000, 61_000, 18_500, 4_200, 13_300],
}

const toBalanceRows = (byMonth: Record<string, number[]>) =>
  Object.entries(byMonth).flatMap(([month, values]) =>
    values.map((balance, i) => ({ month, accountId: i + 1, balance })),
  )

const GOALS = [
  {
    id: 1,
    goalName: 'Financial Independence',
    createdAt: '2022-01-15T00:00:00.000Z',
    birthday: '1990-08-22',
    goalCreatedIn: '2022-01',
    goalEndYear: '2075',
    resetExpenseMonth: false,
    retirementAge: 55,
    expenseMonth: 5,
    expenseValue: 60_000,
    monthlyExpenseValue: 5_000,
    expenseValueMar2026: 61_800,
    expenseValue2047: 112_000,
    monthlyExpenseRetirement: 9_300,
    safeWithdrawalRate: 4,
    growth: 7,
    retirement: '2045-08',
    fiGoal: 1_250_000,
    progress: 23,
  },
]

const monthCsv = (month: string, rows: Array<[string, string, number, string]>): string =>
  [
    'Date,Category,Amount,Description',
    ...rows.map(([day, category, amount, description]) => `${month}-${day},${category},${amount},${description}`),
  ].join('\n')

const TRANSACTIONS: Record<string, { csv: string }> = {
  '2025-03': {
    csv: monthCsv('2025-03', [
      ['01', 'Salary', 9800, 'Acme Payroll'],
      ['14', 'Side Income', 380, 'Freelance'],
      ['01', 'Rent', -2150, 'Apartment'],
      ['05', 'Groceries', -161.2, 'Whole Foods'],
      ['08', 'Utilities', -84.6, 'Electric'],
      ['12', 'Dining', -73.5, 'Restaurant'],
      ['19', 'Transport', -58.4, 'Gas station'],
      ['22', 'Subscriptions', -46.99, 'Streaming bundle'],
      ['27', 'Groceries', -122.3, 'Costco'],
    ]),
  },
  '2025-04': {
    csv: monthCsv('2025-04', [
      ['01', 'Salary', 9800, 'Acme Payroll'],
      ['12', 'Side Income', 425, 'Freelance'],
      ['01', 'Rent', -2150, 'Apartment'],
      ['03', 'Groceries', -142.18, 'Whole Foods'],
      ['06', 'Dining', -58.94, 'Restaurant'],
      ['08', 'Utilities', -88.31, 'Electric'],
      ['10', 'Transport', -55.2, 'Gas station'],
      ['15', 'Subscriptions', -46.99, 'Streaming bundle'],
      ['18', 'Groceries', -103.42, 'Costco'],
      ['22', 'Dining', -41.3, 'Coffee'],
      ['25', 'Transport', -72.8, 'Rideshare'],
    ]),
  },
  '2025-05': {
    csv: monthCsv('2025-05', [
      ['01', 'Salary', 9800, 'Acme Payroll'],
      ['15', 'Side Income', 600, 'Freelance writeup'],
      ['01', 'Rent', -2150, 'Apartment'],
      ['03', 'Groceries', -187.42, 'Trader Joes'],
      ['04', 'Subscriptions', -14.99, 'Streaming'],
      ['06', 'Dining', -62.18, 'Sushi night'],
      ['07', 'Transport', -48.3, 'Gas station'],
      ['08', 'Utilities', -92.47, 'Electric'],
      ['10', 'Groceries', -143.85, 'Whole Foods'],
      ['11', 'Dining', -31.42, 'Coffee shop'],
      ['12', 'Subscriptions', -9.99, 'Music'],
      ['13', 'Subscriptions', -22, 'Gym'],
      ['14', 'Transport', -65.1, 'Rideshare'],
      ['16', 'Groceries', -78.93, 'Local market'],
      ['18', 'Utilities', -52.84, 'Internet'],
      ['19', 'Dining', -51.46, 'Restaurant'],
      ['20', 'Transport', -22.4, 'Bus pass'],
      ['21', 'Groceries', -91.13, 'Trader Joes'],
      ['22', 'Subscriptions', -95, 'Cloud storage'],
      ['24', 'Dining', -72.84, 'Brunch'],
      ['25', 'Transport', -89.2, 'Car maintenance'],
      ['26', 'Health', -1260, 'Dental work'],
      ['28', 'Groceries', -67.18, 'Costco'],
      ['30', 'Dining', -47.1, 'Takeout'],
    ]),
  },
}

const BUDGET_CONFIG = {
  version: 1,
  years: [2025],
  categoryGroups: [
    { id: 'income', name: 'Income', categories: ['Salary', 'Side Income'], type: 'income' },
    { id: 'housing', name: 'Housing', categories: ['Rent', 'Utilities'] },
    { id: 'food', name: 'Food', categories: ['Groceries', 'Dining'] },
    { id: 'transport', name: 'Transport', categories: ['Transport'] },
    { id: 'subscriptions', name: 'Subscriptions', categories: ['Subscriptions'] },
    { id: 'health', name: 'Health', categories: ['Health'] },
    { id: 'others', name: 'Others', categories: [] },
    { id: 'removed', name: 'Remove from Budget', categories: [] },
  ],
}

const BUDGET_TARGETS = {
  version: 1,
  groups: {
    housing: { label: 'Housing', history: [{ from: null, monthly: 2_300 }] },
    food: { label: 'Food', history: [{ from: null, monthly: 650 }] },
    transport: { label: 'Transport', history: [{ from: null, monthly: 250 }] },
    subscriptions: { label: 'Subscriptions', history: [{ from: null, monthly: 120 }] },
    health: { label: 'Health', history: [{ from: null, monthly: 300 }] },
  },
}

const taxFile = (id: string, name: string, uploadedAt: string) => ({ id, name, ext: 'pdf', uploadedAt })

// Tax checklist for 2025, half the items done (files attached) to show mixed progress.
const TAX_STORE = {
  years: {
    2025: {
      items: [
        {
          id: 'tax-1',
          label: 'W-2 (Acme Corp)',
          owner: 'primary',
          category: 'paystub',
          accountIds: [],
          files: [taxFile('f1', 'w2-acme-2025.pdf', '2026-02-10T00:00:00.000Z')],
        },
        {
          id: 'tax-2',
          label: '1099-INT (High-Yield Savings)',
          owner: 'primary',
          category: 'account',
          accountIds: [4],
          files: [taxFile('f2', '1099-int-marcus.pdf', '2026-02-12T00:00:00.000Z')],
        },
        {
          id: 'tax-3',
          label: '1099-DIV (Brokerage)',
          owner: 'primary',
          category: 'account',
          accountIds: [3],
          files: [taxFile('f3', '1099-div-schwab.pdf', '2026-02-15T00:00:00.000Z')],
        },
        { id: 'tax-4', label: '1099-R (401k)', owner: 'primary', category: 'account', accountIds: [1], files: [] },
        {
          id: 'tax-5',
          label: 'Mortgage interest (1098)',
          owner: 'primary',
          category: 'custom',
          accountIds: [],
          files: [],
        },
        { id: 'tax-6', label: 'Charitable donations', owner: 'primary', category: 'custom', accountIds: [], files: [] },
        {
          id: 'tax-7',
          label: 'Previous-year tax return',
          owner: 'primary',
          category: 'tax-return',
          accountIds: [],
          files: [taxFile('f4', 'tax-return-2024.pdf', '2025-04-15T00:00:00.000Z')],
        },
        {
          id: 'tax-8',
          label: 'HSA contributions (5498-SA)',
          owner: 'primary',
          category: 'custom',
          accountIds: [],
          files: [],
        },
      ],
    },
  },
}

/* ── Seeding ─────────────────────────────────────────────────── */

interface SeedFlags {
  darkMode?: boolean
  /** Use the e2e MemoryFileStore. False shows the real first-run folder picker (default true). */
  memoryStore?: boolean
  accounts?: boolean
  balances?: Record<string, number[]> | false
  goals?: boolean
  budget?: boolean
  taxes?: boolean
  profile?: boolean
  onboardingDismissed?: boolean
}

async function seed(page: Page, flags: SeedFlags = {}): Promise<void> {
  const {
    darkMode = false,
    memoryStore = true,
    accounts = true,
    balances = BALANCES_BY_MONTH,
    goals = true,
    budget = true,
    taxes = true,
    profile = true,
    onboardingDismissed = true,
  } = flags

  // Keep the feature-flag fetch off the network so rate limits cannot leak into a capture.
  await page.route(FLAGS_URL, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        content: Buffer.from(JSON.stringify({ flags: {} })).toString('base64'),
        encoding: 'base64',
      }),
    }),
  )

  await page.addInitScript(
    ({ dark, e2e, dismissed }) => {
      localStorage.clear()
      if (e2e) localStorage.setItem('_e2eMode', '1')
      localStorage.setItem('darkMode', dark ? '1' : '0')
      localStorage.setItem('onboarding-dismissed', dismissed ? '1' : '0')
    },
    { dark: darkMode, e2e: memoryStore, dismissed: onboardingDismissed },
  )

  if (!memoryStore) return

  const entries: SeedEntry[] = []
  if (profile) entries.push({ path: 'profile.json', data: PROFILE, type: 'json' })
  if (accounts) entries.push({ path: 'accounts.json', data: ACCOUNTS, type: 'json' })
  if (balances) entries.push(...balanceEntriesToEntries(toBalanceRows(balances)))
  if (goals) entries.push(goalsToEntry(GOALS, []))
  if (budget) {
    entries.push(...budgetCsvsToEntries(TRANSACTIONS))
    entries.push({ path: 'budget/categories.json', data: BUDGET_CONFIG, type: 'json' })
    entries.push({ path: 'budget/targets.json', data: BUDGET_TARGETS, type: 'json' })
  }
  if (taxes) entries.push(...taxStoreToEntries(TAX_STORE))
  await seedFileStore(page, entries)
}

/* ── Page helpers ────────────────────────────────────────────── */

/** Wait for the app shell, fonts and (optionally) a chart, then freeze animations. */
async function settle(page: Page, opts: { expectSvg?: boolean } = {}): Promise<void> {
  const { expectSvg = true } = opts
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => document.fonts.ready)
  await page.addStyleTag({
    content:
      '*, *::before, *::after { transition: none !important; animation: none !important; caret-color: transparent !important; }',
  })
  if (expectSvg) {
    await page
      .waitForFunction(
        () => document.querySelectorAll('.recharts-wrapper svg, svg.recharts-surface').length > 0,
        undefined,
        {
          timeout: 5000,
        },
      )
      .catch(() => {
        /* some screens render without a chart */
      })
  }
  // Recharts animates in JS (CSS overrides don't stop it); wait for entry animations to finish.
  await page.waitForTimeout(expectSvg ? 2000 : 500)
}

async function snap(page: Page, filename: string, opts: { fullPage?: boolean } = {}): Promise<void> {
  const path = join(OUT_DIR, filename)
  await page.screenshot({ path, fullPage: opts.fullPage ?? false, type: 'png', animations: 'disabled' })
  console.log(`  ✓ ${filename}  (${(statSync(path).size / 1024).toFixed(1)} KB)`)
}

async function open(page: Page, hash: string, opts: { expectSvg?: boolean } = {}): Promise<void> {
  await page.goto(APP_URL + '#' + hash, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('main#main-content, main.main-content', { timeout: 15_000 })
  await settle(page, opts)
}

/* ── Captures ────────────────────────────────────────────────── */

async function captureHome(page: Page, mode: 'light' | 'dark'): Promise<void> {
  await seed(page, { darkMode: mode === 'dark' })
  await open(page, '/')
  if (mode === 'dark') {
    const hasDark = await page.evaluate(() => document.body.classList.contains('dark'))
    if (!hasDark) throw new Error('Dark mode screenshot taken without body.dark class')
  }
  await snap(page, `home-${mode}.png`)
}

async function captureGoals(page: Page): Promise<void> {
  await seed(page)
  await open(page, '/goal/plans')
  await snap(page, 'goals.png', { fullPage: true })
}

async function captureCalculator(page: Page): Promise<void> {
  await seed(page)
  await open(page, '/goal/calculator')
  // The calculator defaults to retiring next year, which reads as an absurd savings figure; step out to 2040.
  const later = page.getByRole('button', { name: '›' }).first()
  for (let i = 0; i < 14; i++) await later.click()
  await page.waitForTimeout(1000)
  await snap(page, 'fire-calculator.png', { fullPage: true })
}

async function captureNetWorth(page: Page): Promise<void> {
  await seed(page)
  await open(page, '/net-worth/dashboard/spreadsheet', { expectSvg: false })
  await snap(page, 'networth.png', { fullPage: true })
}

async function captureAllocation(page: Page): Promise<void> {
  await seed(page)
  await open(page, '/net-worth/allocation')
  await snap(page, 'allocation.png', { fullPage: true })
}

async function captureGrowth(page: Page): Promise<void> {
  await seed(page)
  await open(page, '/net-worth/growth')
  await snap(page, 'growth.png', { fullPage: true })
}

async function captureReview(page: Page): Promise<void> {
  await seed(page)
  await open(page, '/net-worth/review/2025')
  await snap(page, 'review.png', { fullPage: true })
}

async function captureBudget(page: Page): Promise<void> {
  await seed(page)
  await open(page, '/budget/cashflow')
  await snap(page, 'budget.png', { fullPage: true })
}

async function captureTargets(page: Page): Promise<void> {
  await seed(page)
  await open(page, '/budget/spreadsheet', { expectSvg: false })
  await page
    .getByRole('button', { name: /^Aggregated$/ })
    .first()
    .click()
  await settle(page, { expectSvg: false })
  await snap(page, 'budget-targets.png', { fullPage: true })
}

async function captureTransactions(page: Page): Promise<void> {
  await seed(page)
  await open(page, '/transactions', { expectSvg: false })
  await snap(page, 'transactions.png', { fullPage: true })
}

async function captureTaxes(page: Page): Promise<void> {
  await seed(page)
  await open(page, '/taxes', { expectSvg: false })
  await snap(page, 'taxes.png', { fullPage: true })
}

async function captureDrive(page: Page): Promise<void> {
  await seed(page)
  await open(page, '/drive', { expectSvg: false })
  await page.getByText('Budget', { exact: true }).first().click()
  await page.getByText('2025', { exact: true }).first().click()
  await settle(page, { expectSvg: false })
  await snap(page, 'drive.png', { fullPage: true })
}

async function captureSettings(page: Page): Promise<void> {
  await seed(page)
  await open(page, '/', { expectSvg: false })
  await page.locator('button[aria-label="Settings"]').first().click()
  await page.waitForSelector('.settings-modal', { timeout: 5_000 })
  await page.locator('.settings-modal-nav button', { hasText: 'Appearance' }).first().click()
  await settle(page, { expectSvg: false })
  await snap(page, 'settings.png')
}

/* ── Quick-start screenshots ─────────────────────────────────── */

// Step 1: first visit. No folder chosen yet, so the app shows the full-page folder picker.
async function captureQuickstart1(page: Page): Promise<void> {
  await seed(page, { memoryStore: false, onboardingDismissed: false })
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.folder-picker, [class*="folder-picker"]', { timeout: 15_000 })
  await settle(page, { expectSvg: false })
  await snap(page, 'quickstart-1.png')
}

// Step 2: a brand-new folder. Home shows the setup guide with nothing done yet.
async function captureQuickstart2(page: Page): Promise<void> {
  await seed(page, {
    profile: false,
    accounts: false,
    balances: false,
    goals: false,
    budget: false,
    taxes: false,
    onboardingDismissed: false,
  })
  await open(page, '/', { expectSvg: false })
  await snap(page, 'quickstart-2.png')
}

// Step 3: the Add Account form, filled in.
async function captureQuickstart3(page: Page): Promise<void> {
  await seed(page, { accounts: false, balances: false, goals: false, budget: false, taxes: false })
  await open(page, '/net-worth/dashboard', { expectSvg: false })
  await page
    .getByRole('button', { name: /Add Account/i })
    .first()
    .click()
  const innerAdd = page.getByRole('button', { name: /\+ Add Account/i }).last()
  if (await innerAdd.isVisible().catch(() => false)) await innerAdd.click()
  await page
    .getByLabel(/name/i)
    .first()
    .fill('High-Yield Savings')
    .catch(() => {})
  await settle(page, { expectSvg: false })
  await snap(page, 'quickstart-3.png')
}

// Step 4: guided monthly entry (Details), with May only partly filled in.
async function captureQuickstart4(page: Page): Promise<void> {
  const partial = { ...BALANCES_BY_MONTH, '2025-05': BALANCES_BY_MONTH['2025-05'].slice(0, 2) }
  await seed(page, { balances: partial, goals: false, budget: false, taxes: false })
  await open(page, '/net-worth/dashboard/details', { expectSvg: false })
  await snap(page, 'quickstart-4.png')
}

// Step 5: the first win. One account with three months of balances on the dashboard.
async function captureQuickstart5(page: Page): Promise<void> {
  const [first] = ACCOUNTS
  await seed(page, {
    accounts: false,
    balances: false,
    goals: false,
    budget: false,
    taxes: false,
  })
  await seedFileStore(page, [
    { path: 'accounts.json', data: [first], type: 'json' },
    ...balanceEntriesToEntries(
      ['2025-03', '2025-04', '2025-05'].map(month => ({
        month,
        accountId: 1,
        balance: BALANCES_BY_MONTH[month][0],
      })),
    ),
  ])
  await open(page, '/')
  await snap(page, 'quickstart-5.png')
}

/* ── Orchestration ───────────────────────────────────────────── */

async function withFreshPage<T>(browser: Browser, fn: (page: Page) => Promise<T>): Promise<T> {
  // A context per capture keeps init scripts and storage isolated.
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR })
  const page = await context.newPage()
  // Freeze the clock so the seeded May-2025 data is "last month" on every screen.
  await page.clock.install({ time: new Date('2025-06-01T12:00:00Z') })
  try {
    return await fn(page)
  } finally {
    await context.close()
  }
}

async function ensureServerReady(): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(APP_URL)
      if (res.ok) return
    } catch {
      /* not ready yet */
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(`Dev server not reachable at ${APP_URL}. Start it with 'npm run dev'.`)
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true })
  await ensureServerReady()

  const only = process.argv[2]
  const captures: Array<[string, (page: Page) => Promise<void>]> = [
    ['home-light', p => captureHome(p, 'light')],
    ['home-dark', p => captureHome(p, 'dark')],
    ['goals', captureGoals],
    ['fire-calculator', captureCalculator],
    ['networth', captureNetWorth],
    ['allocation', captureAllocation],
    ['growth', captureGrowth],
    ['review', captureReview],
    ['budget', captureBudget],
    ['budget-targets', captureTargets],
    ['transactions', captureTransactions],
    ['taxes', captureTaxes],
    ['drive', captureDrive],
    ['settings', captureSettings],
    ['quickstart-1', captureQuickstart1],
    ['quickstart-2', captureQuickstart2],
    ['quickstart-3', captureQuickstart3],
    ['quickstart-4', captureQuickstart4],
    ['quickstart-5', captureQuickstart5],
  ]
  const selected = only ? captures.filter(([name]) => name === only) : captures
  if (selected.length === 0)
    throw new Error(`Unknown capture '${only}'. Choose from: ${captures.map(c => c[0]).join(', ')}`)

  const browser = await chromium.launch({ headless: true })
  try {
    console.log(`Capturing ${selected.length} screenshot(s) → docs/screenshots/`)
    for (const [, fn] of selected) await withFreshPage(browser, fn)
    console.log('\nDone. Wrote to', OUT_DIR)
  } finally {
    await browser.close()
  }
}

main().catch(err => {
  console.error('Screenshot capture failed:', err)
  process.exit(1)
})
