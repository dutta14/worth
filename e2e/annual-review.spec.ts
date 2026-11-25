import { test, expect } from './fixtures/base'
import { AnnualReviewPage } from './pages/annual-review.page'
import { NavigationPage } from './pages/navigation.page'
import { BALANCES, seedAnnualReview, seedEmptyReview } from './fixtures/annual-review.fixtures'

/**
 * Annual Review (docs/specs/annual-review.md, section 7.4). See the fixtures file for the data.
 */

const FLAG_FETCH = 'https://api.github.com/repos/dutta14/worth/contents/feature-flags.json'

// Requests the shell makes on every page (flag registry, web fonts); the review itself must add none.
const FONT_HOSTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//

const readStat = async (review: AnnualReviewPage, section: string, label: string) =>
  review.stat(section, label).locator('dd').first()

test.describe('Annual Review', () => {
  test('opens from the fourth Wealth tab on the default year and keeps Wealth active in the sidebar', async ({
    page,
  }) => {
    await seedAnnualReview(page)
    const review = new AnnualReviewPage(page)
    const nav = new NavigationPage(page)

    await page.goto('/worth/#/net-worth/dashboard')
    await expect(review.wealthLinks).toHaveText(['Dashboard', 'Allocation', 'Growth', 'Review'])
    await review.reviewTab.click()

    await expect(page).toHaveURL(/#\/net-worth\/review\/2025$/)
    await expect(review.title).toBeVisible()
    await expect(review.reviewTab).toHaveAttribute('aria-current', 'page')
    await expect(review.yearLabel).toHaveText('2025')
    await nav.expectActive('Wealth')
    await expect(page).toHaveTitle('Annual Review 2025 - worth')
  })

  test('opens the review for a year from its Growth card', async ({ page }) => {
    await seedAnnualReview(page)
    const review = new AnnualReviewPage(page)

    await page.goto('/worth/#/net-worth/growth/savings')
    await page.getByRole('link', { name: 'View review for 2024' }).click()

    await expect(page).toHaveURL(/#\/net-worth\/review\/2024$/)
    await expect(review.title).toBeVisible()
    await expect(review.yearLabel).toHaveText('2024')
    await expect(page).toHaveTitle('Annual Review 2024 - worth')
  })

  test('shows the headline figures for the default year in every section', async ({ page }) => {
    await seedAnnualReview(page)
    const review = new AnnualReviewPage(page)
    await review.goto()

    await expect(review.title).toHaveText('Annual Review')
    await expect(page).toHaveURL(/#\/net-worth\/review\/2025$/)
    await expect(review.yearLabel).toHaveText('2025')
    await expect(page).toHaveTitle('Annual Review 2025 - worth')

    const headline = page.locator('.ar-headline')
    await expect(headline.locator('dt')).toHaveText('Net worth')
    await expect(headline.locator('dd')).toHaveText('$220,000')

    const change = review.stat('Net worth', 'Net worth change')
    await expect(await readStat(review, 'Net worth', 'Net worth change')).toContainText('$60,000')
    await expect(change.locator('.ar-stat__value .ar-delta--positive')).toContainText('↗')
    await expect(change.locator('.ar-stat__value .sr-only')).toHaveText('Up')
    await expect(change).toContainText('37.5%')
    await expect(change).not.toContainText('Dec 2024 to')
    await expect(change.locator('.ar-stat__prior')).toContainText('vs. 2024:')
    await expect(change.locator('.ar-stat__prior .ar-delta--positive')).toContainText('$10,000')
    await expect(change.locator('.ar-stat__prior .sr-only')).toHaveText('Up')
    await expect(await readStat(review, 'Net worth', 'Starting net worth')).toHaveText('$160,000')
    await expect(await readStat(review, 'Net worth', 'Ending net worth')).toHaveText('$220,000')

    await expect(await readStat(review, 'Income and savings', 'Income')).toHaveText('$120,000')
    await expect(await readStat(review, 'Income and savings', 'Expenses')).toHaveText('$62,000')
    await expect(await readStat(review, 'Income and savings', 'Savings')).toHaveText('$58,000')
    await expect(await readStat(review, 'Income and savings', 'Savings rate')).toHaveText('48.3%')

    const spending = review.section('Top spending groups')
    await expect(
      spending.getByRole('img', { name: /^Spending by group, 2025\. Housing: \$36,000, 58\.1%;/ }),
    ).toBeVisible()
    await expect(spending.getByRole('table', { name: 'Spending by group, 2025' })).toBeVisible()
    await expect(spending.getByRole('row')).toHaveCount(7)
    await expect(spending.getByRole('row', { name: /^Housing \$36,000 58\.1%/ })).toBeVisible()
    await expect(spending.getByRole('row', { name: /^All other groups \(1\) \$2,000 3\.2%/ })).toBeVisible()

    const goals = review.section('Goal progress at year end')
    const goalRow = goals.getByRole('row', { name: /^Early Retirement/ })
    await expect(goalRow).toContainText('$897,441')
    await expect(goalRow).toContainText('21.7%')
    await expect(goalRow.locator('.ar-delta--positive')).toContainText('6.1 points')
    await expect(goals.getByRole('columnheader', { name: 'GW target' })).toHaveCount(0)
    await expect(await readStat(review, 'Goal progress at year end', 'FI balance')).toHaveText('$195,000')
    await expect(await readStat(review, 'Goal progress at year end', 'GW balance')).toHaveText('$25,000')
    await expect(goals).toContainText('Progress is measured against each goal as it is set today.')
    await expect(review.section('Things to know')).toHaveCount(0)
  })

  test('the chart is a line chart with a text summary and no monthly table toggle', async ({ page }) => {
    await seedAnnualReview(page)
    const review = new AnnualReviewPage(page)
    await review.goto('/2025')

    await expect(
      review.chart.and(
        page.getByRole('group', {
          name: 'Net worth rose from $160,000 in December 2024 to $220,000 in December 2025.',
        }),
      ),
    ).toBeVisible()
    await expect(review.chart.locator('path.recharts-line-curve')).toBeVisible()
    await expect(review.chart.locator('.recharts-line-dot')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /monthly values/ })).toHaveCount(0)
    await expect(review.section('Net worth').getByRole('table')).toHaveCount(0)
  })

  test('hovering the chart shows the month, net worth and change from the previous month', async ({ page }) => {
    const november = [
      { month: '2025-11', accountId: 1, balance: 120000 },
      { month: '2025-11', accountId: 2, balance: 68000 },
      { month: '2025-11', accountId: 3, balance: 24000 },
    ]
    await seedAnnualReview(page, { balances: [...BALANCES, ...november] })
    const review = new AnnualReviewPage(page)
    await review.goto('/2025')
    await expect(review.chart.locator('path.recharts-line-curve')).toBeVisible()
    await expect(review.tooltip).toHaveCount(0)

    const box = await review.chart.locator('.recharts-surface').boundingBox()
    if (!box) throw new Error('chart has no bounding box')
    // The plot area ends 24px before the right edge, so this lands on the December point.
    await page.mouse.move(box.x + box.width - 26, box.y + box.height / 2)

    await expect(review.tooltip).toBeVisible()
    await expect(review.tooltip.locator('.ar-tooltip__label')).toHaveText('Dec 2025')
    await expect(review.tooltip.locator('.ar-tooltip__value')).toHaveText('$220,000')
    await expect(review.tooltip.locator('.ar-tooltip__change')).toHaveText('+$8,000 (+3.8%)')

    await page.mouse.move(box.x + box.width / 2, box.y - 40)
    await expect(review.tooltip).toHaveCount(0)
  })

  test('switching year navigates with replace, announces it, and survives a reload', async ({ page }) => {
    await seedAnnualReview(page)
    const review = new AnnualReviewPage(page)
    await review.goto('/2025')
    await expect(review.liveRegion).toHaveText('Review for 2025 is ready.')

    await expect(review.yearLabel).toHaveText('2025')
    await expect(review.prevYearBtn).toBeEnabled()
    await expect(review.nextYearBtn).toBeEnabled()
    await review.prevYearBtn.click()

    await expect(page).toHaveURL(/#\/net-worth\/review\/2024$/)
    await expect(review.yearLabel).toHaveText('2024')
    await expect(page).toHaveTitle('Annual Review 2024 - worth')
    await expect(review.liveRegion).toHaveText('Showing the review for 2024.')
    await expect(await readStat(review, 'Net worth', 'Net worth change')).toContainText('$50,000')
    await expect(await readStat(review, 'Net worth', 'Starting net worth')).toHaveText('$110,000')
    await expect(review.section('Income and savings')).toContainText('No income or expense data for 2024')
    await expect(review.section('Top spending groups')).toHaveCount(0)

    await review.nextYearBtn.click()
    await expect(page).toHaveURL(/#\/net-worth\/review\/2025$/)
    await expect(review.yearLabel).toHaveText('2025')
    await review.prevYearBtn.click()

    await page.reload()
    await expect(review.yearLabel).toHaveText('2024')
    await expect(await readStat(review, 'Net worth', 'Starting net worth')).toHaveText('$110,000')

    // Replace, not push: Back leaves the review instead of stepping through years.
    await page.goBack()
    await expect(page).not.toHaveURL(/net-worth\/review/)
  })

  test('the in-progress current year says how far it goes', async ({ page }) => {
    await seedAnnualReview(page)
    const review = new AnnualReviewPage(page)
    await review.goto('/2026')

    await expect(review.yearLabel).toHaveText('2026')
    await expect(review.nextYearBtn).toBeDisabled()
    await expect(review.section('Things to know')).toContainText('2026 is still in progress.')
    await expect(await readStat(review, 'Net worth', 'Ending net worth')).toHaveText('$228,000')
    await expect(review.stat('Net worth', 'Ending net worth')).toContainText('Oct 2026')
  })

  test('a year argument that is not four digits falls back to the default year', async ({ page }) => {
    await seedAnnualReview(page)
    const review = new AnnualReviewPage(page)

    await review.goto('/20x5')

    await expect(page).toHaveURL(/#\/net-worth\/review\/2025$/)
    await expect(review.yearLabel).toHaveText('2025')
  })

  test('a year with no data shows the empty state with links and disabled actions', async ({ page }) => {
    await seedAnnualReview(page)
    const review = new AnnualReviewPage(page)
    await review.goto('/2019')

    await expect(review.title).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Not enough data for 2019' })).toBeVisible()
    await expect(review.yearLabel).toHaveText('2019')
    await expect(review.prevYearBtn).toBeDisabled()
    await expect(review.nextYearBtn).toBeEnabled()
    await expect(page.locator('.ar-headline')).toHaveCount(0)
    await review.openActions()
    await expect(review.printBtn).toBeDisabled()
    await expect(review.downloadBtn).toBeDisabled()
    await expect(page.getByRole('link', { name: 'Go to Wealth' })).toHaveAttribute('href', /#\/net-worth\/dashboard/)
    await expect(page.getByRole('link', { name: 'Go to Cashflow' })).toHaveAttribute('href', /#\/budget/)
  })

  test('with no data anywhere it says there is nothing to review yet', async ({ page }) => {
    await seedEmptyReview(page)
    const review = new AnnualReviewPage(page)
    await review.goto()

    await expect(page).toHaveURL(/#\/net-worth\/review\/2026$/)
    await expect(page.getByRole('heading', { level: 2, name: 'Nothing to review yet' })).toBeVisible()
    await review.openActions()
    await expect(review.printBtn).toBeDisabled()
    await expect(review.downloadBtn).toBeDisabled()
  })

  test('an incomplete December names the missing account and shows no change', async ({ page }) => {
    const balances = BALANCES.filter(b => !(b.month === '2025-12' && b.accountId === 3))
    await seedAnnualReview(page, { balances })
    const review = new AnnualReviewPage(page)
    await review.goto('/2025')

    await expect(review.yearLabel).toHaveText('2025')
    await expect(await readStat(review, 'Net worth', 'Net worth change')).toHaveText('Not available')
    await expect(review.stat('Net worth', 'Ending net worth')).toContainText('Dec 2025, incomplete')
    const notes = review.section('Things to know')
    await expect(notes).toContainText('December 2025 is missing a balance for Savings.')
    await expect(notes.getByRole('link', { name: 'Open the spreadsheet' })).toBeVisible()
    await expect(page.locator('.sr-only', { hasText: /notes? about this data follow/ })).toHaveCount(1)
  })

  test('uses the yearly log from Growth when there are no transactions for the year', async ({ page }) => {
    await seedAnnualReview(page, {
      includeTransactions: false,
      extra: [
        { path: 'savings-tracker-overrides.json', type: 'json', data: { 2025: { netIncome: 100000, savings: 30000 } } },
      ],
    })
    const review = new AnnualReviewPage(page)
    await review.goto('/2025')

    await expect(await readStat(review, 'Income and savings', 'Income')).toHaveText('$100,000')
    await expect(await readStat(review, 'Income and savings', 'Expenses')).toHaveText('$70,000')
    await expect(await readStat(review, 'Income and savings', 'Savings rate')).toHaveText('30.0%')
    await expect(review.section('Top spending groups')).toHaveCount(0)
  })

  test('a failed read shows an error with Try again, and the review returns once it works', async ({ page }) => {
    await seedAnnualReview(page)
    const review = new AnnualReviewPage(page)
    await review.goto('/2025')
    await expect(review.yearLabel).toHaveText('2025')
    await expect(await readStat(review, 'Net worth', 'Net worth change')).toBeVisible()

    await page.evaluate(() => {
      const w = window as Window &
        typeof globalThis & { __e2eFileStore: { listFiles: (p: string) => Promise<string[]> } }
      const original = w.__e2eFileStore.listFiles.bind(w.__e2eFileStore)
      ;(window as Window & { __restoreListFiles?: () => void }).__restoreListFiles = () => {
        w.__e2eFileStore.listFiles = original
      }
      w.__e2eFileStore.listFiles = () => Promise.reject(new Error('disk unplugged'))
      window.dispatchEvent(new Event('budget-changed'))
    })

    const alert = page.getByRole('alert')
    await expect(alert).toContainText('The review could not be built. Your files were not changed.')
    await expect(page.getByRole('heading', { level: 2, name: 'Net worth' })).toHaveCount(0)

    await page.evaluate(() => (window as Window & { __restoreListFiles?: () => void }).__restoreListFiles?.())
    await alert.getByRole('button', { name: 'Try again' }).click()

    await expect(alert).toHaveCount(0)
    await expect(await readStat(review, 'Net worth', 'Net worth change')).toContainText('$60,000')
  })
})

test.describe('Annual Review CSV and keyboard', () => {
  test('Download CSV saves worth-annual-review-2025.csv with the numbers on screen and announces it', async ({
    page,
  }) => {
    await seedAnnualReview(page)
    const review = new AnnualReviewPage(page)
    await review.goto('/2025')
    await review.openActions()
    await expect(review.downloadBtn).toBeEnabled()

    const [download] = await Promise.all([page.waitForEvent('download'), review.downloadBtn.click()])

    expect(download.suggestedFilename()).toBe('worth-annual-review-2025.csv')
    const stream = await download.createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk))
    const lines = Buffer.concat(chunks).toString('utf8').trimEnd().split('\n')
    expect(lines[0]).toBe('section,item,label,value,unit,share_percent,note')
    expect(lines).toContain('report,year,Year,2025,year,,')
    expect(lines).toContain('networth,start,Starting net worth,160000.00,usd,,')
    expect(lines).toContain('networth,end,Ending net worth,220000.00,usd,,')
    expect(lines).toContain('networth,change,Net worth change,60000.00,usd,,')
    expect(lines).toContain('networth,change_percent,Net worth change percent,37.50,percent,,')
    expect(lines).toContain('cashflow,income,Income,120000.00,usd,,')
    expect(lines).toContain('cashflow,expenses,Expenses,62000.00,usd,,')
    expect(lines).toContain('cashflow,savings,Savings,58000.00,usd,,')
    expect(lines).toContain('spending,group_1,Housing,36000.00,usd,58.06,')
    expect(lines).toContain('spending,other,All other groups,2000.00,usd,3.23,1 group')
    await expect(review.liveRegion).toHaveText('Downloaded worth-annual-review-2025.csv.')
  })

  test('Print calls the browser print dialog', async ({ page }) => {
    await seedAnnualReview(page)
    const review = new AnnualReviewPage(page)
    await review.goto('/2025')
    await review.openActions()
    await expect(review.printBtn).toBeEnabled()
    await page.evaluate(() => {
      ;(window as Window & { __printCalls?: number }).__printCalls = 0
      window.print = () => {
        ;(window as Window & { __printCalls?: number }).__printCalls! += 1
      }
    })

    await review.printBtn.click()

    expect(await page.evaluate(() => (window as Window & { __printCalls?: number }).__printCalls)).toBe(1)
    await expect(review.moreActionsBtn).toHaveAttribute('aria-expanded', 'false')
    await expect(review.printBtn).toBeHidden()
    await expect(review.moreActionsBtn).toBeFocused()
  })

  test('every control is reachable by keyboard in order, and Escape closes the actions menu', async ({ page }) => {
    await seedAnnualReview(page)
    const review = new AnnualReviewPage(page)
    await review.goto('/2025')
    await expect(review.yearLabel).toHaveText('2025')

    await review.prevYearBtn.focus()
    await page.keyboard.press('Tab')
    await expect(review.nextYearBtn).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(review.moreActionsBtn).toBeFocused()
    await expect(review.moreActionsBtn).toHaveAttribute('aria-expanded', 'false')
    await expect(review.printBtn).toBeHidden()
    await page.keyboard.press('Enter')
    await expect(review.moreActionsBtn).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Tab')
    await expect(review.printBtn).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(review.downloadBtn).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(review.moreActionsBtn).toHaveAttribute('aria-expanded', 'false')
    await expect(review.moreActionsBtn).toBeFocused()

    await review.prevYearBtn.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/net-worth\/review\/2024$/)
    await expect(review.liveRegion).toHaveText('Showing the review for 2024.')
  })

  test('the year buttons, menu and actions are named, and the actions meet the 44px touch target on a phone', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await seedAnnualReview(page)
    const review = new AnnualReviewPage(page)
    await review.goto('/2025')
    await expect(review.yearLabel).toHaveText('2025')
    // On a phone the sidebar opens over the page with a scrim; dismiss it to reach the header controls.
    await page.locator('.sidebar-overlay').click({ position: { x: 340, y: 400 } })
    await expect(page.locator('.sidebar-overlay')).toHaveCount(0)
    await review.openActions()

    // Prev/next (24px) and More actions (36px) are shared header controls and are not held to 44px here.
    for (const control of [review.printBtn, review.downloadBtn]) {
      const box = await control.boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})

test.describe('Annual Review print and privacy', () => {
  for (const darkMode of [false, true]) {
    test(`print layout hides the app chrome and uses a white page${darkMode ? ' even in dark mode' : ''}`, async ({
      page,
    }) => {
      await seedAnnualReview(page, { darkMode })
      const review = new AnnualReviewPage(page)
      await review.goto('/2025')
      await expect(review.yearLabel).toHaveText('2025')
      if (darkMode) await expect(page.locator('body')).toHaveClass(/dark/)

      await review.openActions()
      await page.emulateMedia({ media: 'print' })

      await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden()
      await expect(review.reviewTab).toBeHidden()
      await expect(review.prevYearBtn).toBeHidden()
      await expect(review.nextYearBtn).toBeHidden()
      await expect(review.moreActionsBtn).toBeHidden()
      await expect(review.printBtn).toBeHidden()
      await expect(review.downloadBtn).toBeHidden()
      await expect(review.title).toBeHidden()
      await expect(review.printTitle).toHaveText('Annual Review 2025')
      await expect(review.section('Net worth')).toBeVisible()
      await expect(
        page.getByText(/^Prepared with worth on \d{4}-\d{2}-\d{2}\. Your data stays on your computer\.$/),
      ).toBeVisible()
      expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)')
    })
  }

  test('building, switching and downloading a review makes no request outside the app', async ({ page }) => {
    const external: string[] = []
    page.on('request', request => {
      const url = request.url()
      if (url.startsWith('data:') || url.startsWith('blob:') || url === FLAG_FETCH || FONT_HOSTS.test(url)) return
      if (new URL(url).hostname !== 'localhost') external.push(url)
    })
    await seedAnnualReview(page)
    const review = new AnnualReviewPage(page)
    await review.goto('/2025')
    await expect(review.yearLabel).toHaveText('2025')
    await review.prevYearBtn.click()
    await expect(review.yearLabel).toHaveText('2024')
    await review.nextYearBtn.click()
    await expect(review.yearLabel).toHaveText('2025')
    await Promise.all([page.waitForEvent('download'), review.download()])

    expect(external).toEqual([])
  })
})
