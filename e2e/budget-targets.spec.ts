import { test, expect } from './fixtures/base'
import type { Locator, Page } from '@playwright/test'
import { BudgetPage } from './pages/budget.page'
import { HomePage } from './pages/home.page'
import { seedFileStore } from './fixtures/seed-filestore'
import type { SeedEntry } from './fixtures/seed-filestore'
import { readJsonFile } from './fixtures/filestore-helpers'

/**
 * Category budget targets (docs/specs/category-budget-targets.md, section 7.4).
 * The clock is pinned to 2026-11-18, so November 2026 is the in-progress month.
 *
 * Data (2026), net spend per month with data:
 *   Dining    Jun 620, Oct 400, Nov 250      Transport  100 in each of Jun, Oct, Nov
 *   Groceries Jun 300
 */
const NOW = new Date('2026-11-18T12:00:00Z')
const TARGETS = 'budget/targets.json'

const DINING = 'dining'
const GROUPS = [
  { id: DINING, name: 'Dining', categories: ['Restaurants'] },
  { id: 'groceries', name: 'Groceries', categories: ['Groceries'] },
  { id: 'transport', name: 'Transport', categories: ['Gas'] },
  { id: 'income-others', name: 'Income', categories: ['Salary'], type: 'income' },
  { id: 'others', name: 'Others', categories: [] },
  { id: 'removed', name: 'Remove from Budget', categories: [] },
]

const monthCsv = (month: string, rows: Array<[number, string, number]>): SeedEntry => ({
  path: `transactions/2026/2026-${month}.csv`,
  type: 'csv',
  data: [
    ['Date', 'Category', 'Amount'],
    ...rows.map(([day, category, amount]) => [
      `2026-${month}-${String(day).padStart(2, '0')}`,
      category,
      String(amount),
    ]),
  ],
})

const BUDGET_FILES: SeedEntry[] = [
  { path: 'budget/categories.json', type: 'json', data: { version: 1, years: [2026], categoryGroups: GROUPS } },
  monthCsv('06', [
    [1, 'Salary', 5000],
    [10, 'Restaurants', -620],
    [12, 'Groceries', -300],
    [20, 'Gas', -100],
  ]),
  monthCsv('10', [
    [10, 'Restaurants', -400],
    [20, 'Gas', -100],
  ]),
  monthCsv('11', [
    [10, 'Restaurants', -250],
    [12, 'Gas', -100],
  ]),
]

const targetFor = (...history: Array<{ from: string | null; monthly: number | null }>) => ({ label: '', history })

const targetsFile = (groups: Record<string, ReturnType<typeof targetFor>>) => ({ version: 1, groups })

interface SeedOptions {
  flag?: boolean
  targets?: unknown
  darkMode?: boolean
}

/**
 * Seeds the file store once per tab (so edits survive a reload, unlike seedBudget) and pins the clock.
 */
async function seed(page: Page, { flag = true, targets, darkMode = false }: SeedOptions = {}) {
  const entries =
    targets === undefined ? BUDGET_FILES : [...BUDGET_FILES, { path: TARGETS, type: 'json' as const, data: targets }]
  await seedFileStore(page, entries, { onceKey: 'targets-e2e-seeded' })
  await page.addInitScript(
    ({ flag, darkMode }) => {
      if (sessionStorage.getItem('targets-e2e-init') !== '1') {
        localStorage.clear()
        sessionStorage.setItem('targets-e2e-init', '1')
      }
      localStorage.setItem('_e2eMode', '1')
      localStorage.setItem('encryption-enabled', '0')
      localStorage.setItem('darkMode', darkMode ? '1' : '0')
      if (flag) localStorage.setItem('flag-overrides', JSON.stringify({ 'category-budget-targets': true }))
    },
    { flag, darkMode },
  )
  await page.clock.setFixedTime(NOW)
}

const groupRow = (page: Page, name: string): Locator =>
  page
    .locator('tr.budget-tr--agg-row')
    .filter({ has: page.locator('td.budget-td--category strong', { hasText: new RegExp(`^${name}$`) }) })

const targetButton = (page: Page, name: string): Locator => groupRow(page, name).locator('.budget-target-btn')

const vsTarget = (page: Page, name: string): Locator => groupRow(page, name).locator('td.budget-td--vs')

const liveRegion = (page: Page): Locator => page.getByRole('status').filter({ has: page.locator('span') })

const readTargets = (page: Page) =>
  readJsonFile<{ version: number; groups: Record<string, { history: unknown[] }> } | null>(page, TARGETS, null)

/** WCAG contrast of each matching element's text against its first opaque ancestor background. */
const contrastRatios = (page: Page, selector: string) =>
  page.evaluate(selector => {
    const parse = (value: string): [number, number, number, number] => {
      const parts = (value.match(/rgba?\(([^)]+)\)/)?.[1] ?? '0,0,0').split(',').map(p => parseFloat(p.trim()))
      return [parts[0], parts[1], parts[2], parts[3] ?? 1]
    }
    const background = (el: Element | null): [number, number, number] => {
      for (let cur = el; cur; cur = cur.parentElement) {
        const rgb = parse(getComputedStyle(cur).backgroundColor)
        if (rgb[3] > 0) return [rgb[0], rgb[1], rgb[2]]
      }
      return [0, 0, 0]
    }
    const luminance = ([r, g, b]: [number, number, number]) => {
      const channel = (c: number) => (c / 255 <= 0.03928 ? c / 255 / 12.92 : Math.pow((c / 255 + 0.055) / 1.055, 2.4))
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
    }
    return [...document.querySelectorAll(selector)].map(el => {
      const [r, g, b] = parse(getComputedStyle(el).color)
      const l1 = luminance([r, g, b])
      const l2 = luminance(background(el))
      return { text: el.textContent, ratio: (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) }
    })
  }, selector)

async function gotoTargets(page: Page): Promise<BudgetPage> {
  const budget = new BudgetPage(page)
  await budget.goto()
  await budget.setSpreadsheetMode('aggregated')
  await budget.setSpreadsheetCategory('expense')
  await expect(page.getByRole('columnheader', { name: 'Monthly target' })).toBeVisible()
  return budget
}

test.describe('Category budget targets', () => {
  test('sets a $500 Dining target, shows "$120 over" in June, and keeps it after a reload', async ({ page }) => {
    await seed(page)
    await gotoTargets(page)

    await expect(page.getByText('Set a monthly target on any group to see how each month compares.')).toBeVisible()
    await expect(targetButton(page, 'Dining')).toHaveText('Set target')
    await expect(vsTarget(page, 'Dining')).toBeEmpty()

    await targetButton(page, 'Dining').click()
    await page.getByRole('textbox', { name: 'Monthly target for Dining' }).fill('500')
    await page.keyboard.press('Enter')

    await expect(targetButton(page, 'Dining')).toHaveText('$500')
    await expect(page.getByText('Dining target set to $500 a month.')).toBeAttached()
    // Jun column: 620 spent against 500.
    await expect(groupRow(page, 'Dining').locator('td').nth(6)).toContainText('$120 over')
    // Year compare: Jun + Oct + Nov = $1,500 target vs $1,270 spent, November still in progress.
    await expect(vsTarget(page, 'Dining')).toContainText('$230 left')
    await expect(vsTarget(page, 'Dining')).toContainText('3 of 12 months')
    // Rows without a target get no indicator.
    await expect(targetButton(page, 'Groceries')).toHaveText('Set target')
    await expect(groupRow(page, 'Groceries').locator('.budget-target-status, .budget-target-delta')).toHaveCount(0)
    await expect(page.getByText('Set a monthly target on any group to see how each month compares.')).toBeHidden()

    expect(await readTargets(page)).toEqual(
      targetsFile({ [DINING]: { label: 'Dining', history: [{ from: null, monthly: 500 }] } }),
    )

    await page.reload()
    await expect(targetButton(page, 'Dining')).toHaveText('$500')
    await expect(groupRow(page, 'Dining').locator('td').nth(6)).toContainText('$120 over')
  })

  test('sets, rejects, cancels and clears a target with the keyboard alone', async ({ page }) => {
    await seed(page)
    await gotoTargets(page)

    const button = page.getByRole('button', { name: 'Set monthly target for Dining' })
    await button.focus()
    await page.keyboard.press('Enter')
    const input = page.getByRole('textbox', { name: 'Monthly target for Dining' })
    await expect(input).toBeFocused()

    await page.keyboard.type('abc')
    await page.keyboard.press('Enter')
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText('Enter an amount from 0 to 9,999,999.')).toBeVisible()
    expect(await readTargets(page)).toBeNull()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Set monthly target for Dining' })).toBeFocused()

    await page.keyboard.press('Space')
    await page.keyboard.type('$1,250.50')
    await page.keyboard.press('Enter')
    const edit = page.getByRole('button', { name: 'Dining monthly target $1,251, edit' })
    await expect(edit).toBeFocused()
    await expect(liveRegion(page)).toHaveText('Dining target set to $1,251 a month.')
    expect((await readTargets(page))?.groups[DINING].history).toEqual([{ from: null, monthly: 1250.5 }])

    await page.keyboard.press('Enter')
    await expect(page.getByRole('textbox', { name: 'Monthly target for Dining' })).toHaveValue('1250.5')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: 'Set monthly target for Dining' })).toBeFocused()
    await expect(liveRegion(page)).toHaveText('Dining target cleared.')
    expect(await readTargets(page)).toEqual(targetsFile({}))
  })

  test('scales the target in the quarterly and half-year views', async ({ page }) => {
    await seed(page, { targets: targetsFile({ [DINING]: targetFor({ from: null, monthly: 500 }) }) })
    const budget = await gotoTargets(page)

    await budget.setTimePeriod('Q')
    // Q2 has only June with data: $620 against one month of target.
    await expect(groupRow(page, 'Dining').locator('td').nth(2)).toContainText('$120 over')
    await expect(groupRow(page, 'Dining').locator('td').nth(2)).toContainText('$620')
    // Q4 (Oct + Nov, in progress) is under target, so no marker.
    await expect(groupRow(page, 'Dining').locator('td').nth(4).locator('.budget-target-delta')).toHaveCount(0)
    await expect(vsTarget(page, 'Dining')).toContainText('$230 left')

    await budget.setTimePeriod('H')
    await expect(groupRow(page, 'Dining').locator('td').nth(1)).toContainText('$120 over')
    await expect(vsTarget(page, 'Dining')).toContainText('$230 left')
  })

  test('judges older months against the target that applied then after a change', async ({ page }) => {
    await seed(page, { targets: targetsFile({ [DINING]: targetFor({ from: null, monthly: 500 }) }) })
    await gotoTargets(page)

    await targetButton(page, 'Dining').click()
    await page.getByRole('textbox', { name: 'Monthly target for Dining' }).fill('900')
    await page.keyboard.press('Enter')

    await expect(targetButton(page, 'Dining')).toHaveText('$900')
    // June keeps its $500 target.
    await expect(groupRow(page, 'Dining').locator('td').nth(6)).toContainText('$120 over')
    // $500 + $500 + $900 = $1,900 against $1,270.
    await expect(vsTarget(page, 'Dining')).toContainText('$630 left')
    expect((await readTargets(page))?.groups[DINING].history).toEqual([
      { from: null, monthly: 500 },
      { from: '2026-11', monthly: 900 },
    ])
  })

  test('drops the target from the table when its group is deleted', async ({ page }) => {
    await seed(page, { targets: targetsFile({ [DINING]: targetFor({ from: null, monthly: 500 }) }) })
    const budget = await gotoTargets(page)
    await expect(targetButton(page, 'Dining')).toHaveText('$500')

    await budget.setViewMode('groups')
    await page
      .locator('.budget-group-block')
      .filter({ has: page.locator('.budget-group-name', { hasText: /^Dining/ }) })
      .getByTitle('Delete group (categories move to Others)')
      .click()
    await budget.setViewMode('spreadsheet')

    await expect(groupRow(page, 'Dining')).toHaveCount(0)
    await expect(groupRow(page, 'Others').locator('.budget-target-status, .budget-target-delta')).toHaveCount(0)
    await expect(targetButton(page, 'Others')).toHaveText('Set target')
  })

  test('turns editing off and leaves the file untouched when budget/targets.json cannot be used', async ({ page }) => {
    const unreadable = { version: 2, groups: { [DINING]: targetFor({ from: null, monthly: 500 }) } }
    await seed(page, { targets: unreadable })
    await gotoTargets(page)

    await expect(page.getByRole('alert')).toContainText(
      "Your targets file couldn't be read, so targets are turned off to keep it safe.",
    )
    const button = page.getByRole('button', { name: 'Set monthly target for Dining' })
    await expect(button).toHaveAttribute('aria-disabled', 'true')
    await button.dispatchEvent('click')
    await expect(page.getByRole('textbox', { name: 'Monthly target for Dining' })).toHaveCount(0)
    await expect(vsTarget(page, 'Dining')).toBeEmpty()
    expect(await readTargets(page)).toEqual(unreadable)
  })

  test('makes no request that leaves the app other than the flag config and fonts, and none carries target data', async ({
    page,
    baseURL,
  }) => {
    const external: string[] = []
    const withBody: string[] = []
    page.on('request', request => {
      const url = new URL(request.url())
      if (url.origin !== new URL(baseURL ?? 'http://localhost').origin) external.push(request.url())
      if (/target/i.test(request.postData() ?? '')) withBody.push(request.url())
    })
    await seed(page)
    await gotoTargets(page)

    await targetButton(page, 'Dining').click()
    await page.getByRole('textbox', { name: 'Monthly target for Dining' }).fill('777')
    await page.keyboard.press('Enter')
    await expect(targetButton(page, 'Dining')).toHaveText('$777')
    await page.reload()
    await expect(targetButton(page, 'Dining')).toHaveText('$777')

    // The flag config and the Google Fonts stylesheet predate this feature.
    const allowed = ['https://api.github.com/repos/dutta14/worth/', 'https://fonts.googleapis.com/']
    expect([...new Set(external)].filter(url => !allowed.some(prefix => url.startsWith(prefix)))).toEqual([])
    expect(withBody).toEqual([])
    expect(external.some(url => url.includes('777'))).toBe(false)
  })

  for (const darkMode of [false, true]) {
    test(`verdicts show an icon and text and keep AA contrast in ${darkMode ? 'dark' : 'light'} mode`, async ({
      page,
    }) => {
      await seed(page, {
        darkMode,
        targets: targetsFile({
          [DINING]: targetFor({ from: null, monthly: 100 }),
          groceries: targetFor({ from: null, monthly: 300 }),
          transport: targetFor({ from: null, monthly: 100 }),
        }),
      })
      await gotoTargets(page)
      expect(await page.evaluate(() => document.body.classList.contains('dark'))).toBe(darkMode)

      const expected = [
        ['Dining', /over$/],
        ['Groceries', /left$/],
        ['Transport', /^On target$/],
      ] as const
      for (const [name, text] of expected) {
        const verdict = vsTarget(page, name).locator('.budget-target-status')
        await expect(verdict).toBeVisible()
        await expect(verdict.locator('span').last()).toHaveText(text)
        await expect(verdict.locator('svg[aria-hidden="true"]')).toHaveCount(1)
      }

      const ratios = await contrastRatios(page, '.budget-target-status, .budget-target-btn, .budget-target-delta')
      expect(ratios.length).toBeGreaterThanOrEqual(6)
      for (const { text, ratio } of ratios) expect(ratio, `contrast of "${text}"`).toBeGreaterThanOrEqual(4.5)
    })
  }
})

test.describe('Category budget targets on Home', () => {
  const spendingCard = (page: Page) => page.locator('.home-card--spending')

  test('shows one line about the newest month and opens the Budget aggregated view from its link', async ({ page }) => {
    await seed(page, { targets: targetsFile({ [DINING]: targetFor({ from: null, monthly: 200 }) }) })
    const home = new HomePage(page)
    await home.goto()

    await expect(spendingCard(page).getByText('November so far: Dining is over target')).toBeVisible()
    await expect(spendingCard(page).locator('.spending-peek-targets')).toHaveCount(1)

    await spendingCard(page)
      .getByRole('button', { name: /^See targets/ })
      .click()
    await expect(page).toHaveURL(/#\/budget\/spreadsheet$/)
    await expect(page.getByRole('columnheader', { name: 'Vs target' })).toBeVisible()
  })

  test('shows nothing extra when no group has a target', async ({ page }) => {
    await seed(page)
    const home = new HomePage(page)
    await home.goto()

    await expect(spendingCard(page).getByText(/this month|last month/)).toBeVisible()
    await expect(page.locator('.spending-peek-targets')).toHaveCount(0)
  })

  test('shows nothing and never touches the targets file with the flag off', async ({ page }) => {
    const targets = targetsFile({ [DINING]: targetFor({ from: null, monthly: 200 }) })
    await seed(page, { flag: false, targets })
    const home = new HomePage(page)
    await home.goto()

    await expect(spendingCard(page).getByText(/this month|last month/)).toBeVisible()
    await expect(page.locator('.spending-peek-targets')).toHaveCount(0)
    expect(await readTargets(page)).toEqual(targets)
  })

  for (const darkMode of [false, true]) {
    test(`keeps the line and its link at AA contrast in ${darkMode ? 'dark' : 'light'} mode`, async ({ page }) => {
      await seed(page, { darkMode, targets: targetsFile({ [DINING]: targetFor({ from: null, monthly: 200 }) }) })
      const home = new HomePage(page)
      await home.goto()

      await expect(spendingCard(page).locator('.spending-peek-targets svg[aria-hidden="true"]')).toHaveCount(1)
      const ratios = await contrastRatios(page, '.spending-peek-targets-text, .spending-peek-targets-link')
      expect(ratios).toHaveLength(2)
      for (const { text, ratio } of ratios) expect(ratio, `contrast of "${text}"`).toBeGreaterThanOrEqual(4.5)
    })
  }
})
