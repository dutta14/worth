import { test, expect } from './fixtures/base'
import { seedCrossPage, CROSS_PAGE_GOAL } from './fixtures/cross-page-data'
import { fullYearStore } from './fixtures/budget.fixtures'
import type { Page } from '@playwright/test'

async function openGoal(page: Page, annualSpending: number | null) {
  await seedCrossPage(page, {
    goals: [{ ...CROSS_PAGE_GOAL, annualSpending }],
    budgetStore: fullYearStore(new Date().getFullYear()) as never,
    budgetConfig: null,
  })
  await page.goto(`/worth/#/goal/plans/${CROSS_PAGE_GOAL.id}`)
}

test.describe('Goal card and FI chart agree on savings', () => {
  test('uses the budget savings in both when there is no expense override', async ({ page }) => {
    await openGoal(page, null)

    await expect(page.locator('.fi-projection-row', { hasText: 'Save' })).toContainText('$5,700/mo')
    await expect(page.locator('.projection-controls .tab-btn', { hasText: 'Projected' })).toContainText('$5,700/mo')
  })

  test('uses the reduced savings in both when expenses are overridden below income', async ({ page }) => {
    await openGoal(page, 90_000)

    await expect(page.locator('.fi-projection-row', { hasText: 'Save' })).toContainText('$500/mo')
    await expect(page.locator('.projection-controls .tab-btn', { hasText: 'Projected' })).toContainText('$500/mo')
  })

  test('uses $0 in both and still projects an FI date when expenses exceed income', async ({ page }) => {
    await openGoal(page, 150_000)

    await expect(page.locator('.fi-projection-row', { hasText: 'Save' })).toContainText('$0/mo')
    await expect(page.locator('.projection-controls .tab-btn', { hasText: 'Projected' })).toContainText('$0/mo')
    await expect(page.locator('.fi-projection-block')).toContainText('FI in')
    await expect(page.locator('.fi-projection-block')).not.toContainText('not reachable')
  })
})
