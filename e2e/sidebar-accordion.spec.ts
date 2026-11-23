import { test, expect } from './fixtures/base'
import type { Page } from '@playwright/test'
import { NavigationPage } from './pages/navigation.page'
import { NAV_GROUP_CHILDREN, NavGroupName, SUB_PATHS } from './fixtures/nav-data'

/**
 * Sidebar accordion navigation: Planning, Wealth and Cashflow are accordion groups whose
 * sub-items are the first-level sections of each page. Second-level controls stay in the page.
 */

/** Like `seedNav`, but only resets storage on the first load of a tab so reloads keep persisted UI state. */
async function seedOnce(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('_seeded')) return
    sessionStorage.setItem('_seeded', '1')
    localStorage.clear()
    localStorage.setItem('_e2eMode', '1')
    localStorage.setItem('encryption-enabled', '0')
    localStorage.setItem('onboarding-dismissed', '1')
  })
}

const GROUPS = Object.keys(NAV_GROUP_CHILDREN) as NavGroupName[]

test.describe('Sidebar accordion navigation', () => {
  test.beforeEach(async ({ page }) => {
    await seedOnce(page)
  })

  test('groups start collapsed on Home and expand and collapse from their headers', async ({ page }) => {
    const nav = new NavigationPage(page)
    await nav.goto('/')

    for (const group of GROUPS) {
      await expect(nav.link(group)).toHaveAttribute('aria-expanded', 'false')
      await expect(nav.groupList(group)).toHaveCount(0)
    }

    await nav.link('Planning').click()
    await expect(page).toHaveURL(/#\/goal\/plans$/)
    await expect(nav.link('Planning')).toHaveAttribute('aria-expanded', 'true')
    await expect(nav.groupList('Planning').getByRole('link')).toHaveText([...NAV_GROUP_CHILDREN.Planning])

    await nav.link('Planning').click()
    await expect(nav.link('Planning')).toHaveAttribute('aria-expanded', 'false')
    await expect(nav.groupList('Planning')).toHaveCount(0)
    await expect(page).toHaveURL(/#\/goal\/plans$/)

    await nav.link('Planning').click()
    await expect(nav.link('Planning')).toHaveAttribute('aria-expanded', 'true')
  })

  for (const group of GROUPS) {
    test(`${group}: every sub-item opens its route under a heading named after the sub-item, with aria-current`, async ({
      page,
    }) => {
      const nav = new NavigationPage(page)
      await nav.goto('/')
      await nav.expandGroup(group)

      for (const label of NAV_GROUP_CHILDREN[group]) {
        await nav.subLink(group, label).click()
        await expect(page).toHaveURL(new RegExp(`#${SUB_PATHS[label].replace('/', '\\/')}`))
        await expect(page.getByRole('heading', { level: 1, name: label, exact: true })).toBeVisible()
        await expect(nav.subLink(group, label)).toHaveAttribute('aria-current', 'page')
        await expect(page.locator('[aria-current="page"]')).toHaveCount(1)
        await nav.expectActive(group)
      }
    })
  }

  test('a deep link expands the group that holds the route and marks its sub-item', async ({ page }) => {
    const nav = new NavigationPage(page)

    await nav.goto('/net-worth/review/2025')
    await expect(nav.link('Wealth')).toHaveAttribute('aria-expanded', 'true')
    await expect(nav.subLink('Wealth', 'Review')).toHaveAttribute('aria-current', 'page')
    await expect(nav.link('Planning')).toHaveAttribute('aria-expanded', 'false')

    await nav.goto('/taxes')
    await expect(nav.link('Planning')).toHaveAttribute('aria-expanded', 'true')
    await expect(nav.subLink('Planning', 'Taxes')).toHaveAttribute('aria-current', 'page')

    await nav.goto('/transactions')
    await expect(nav.link('Cashflow')).toHaveAttribute('aria-expanded', 'true')
    await expect(nav.subLink('Cashflow', 'Transactions')).toHaveAttribute('aria-current', 'page')
  })

  test('expansion persists across a reload, and a reload re-opens the group that holds the route', async ({ page }) => {
    const nav = new NavigationPage(page)
    await nav.goto('/goal/plans')
    await nav.link('Wealth').click()
    await expect(page).toHaveURL(/#\/net-worth\/dashboard$/)
    await nav.link('Cashflow').click()
    await expect(page).toHaveURL(/#\/budget\/cashflow$/)

    await page.reload()
    for (const group of GROUPS) await expect(nav.link(group)).toHaveAttribute('aria-expanded', 'true')

    // Collapse Wealth while inside it, then move to Planning: Wealth stays collapsed after a reload.
    await nav.link('Wealth').click()
    await expect(page).toHaveURL(/#\/net-worth\/dashboard$/)
    await nav.link('Wealth').click()
    await expect(nav.link('Wealth')).toHaveAttribute('aria-expanded', 'false')
    await nav.link('Planning').click()
    await expect(page).toHaveURL(/#\/goal\/plans$/)

    await page.reload()
    await expect(nav.link('Wealth')).toHaveAttribute('aria-expanded', 'false')
    await expect(nav.link('Planning')).toHaveAttribute('aria-expanded', 'true')

    // Collapsing the active group is not remembered across a reload, because the route re-opens it.
    await nav.link('Planning').click()
    await expect(nav.link('Planning')).toHaveAttribute('aria-expanded', 'false')
    await page.reload()
    await expect(nav.link('Planning')).toHaveAttribute('aria-expanded', 'true')
  })

  test('works from the keyboard: Enter and Space toggle, Tab walks into the children, Enter follows a link', async ({
    page,
  }) => {
    const nav = new NavigationPage(page)
    await nav.goto('/net-worth/dashboard')
    const header = nav.link('Wealth')

    await header.focus()
    await page.keyboard.press('Enter')
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Space')
    await expect(header).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('Tab')
    await expect(nav.subLink('Wealth', 'Dashboard')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(nav.subLink('Wealth', 'Allocation')).toBeFocused()
    await page.keyboard.press('Enter')

    await expect(page).toHaveURL(/#\/net-worth\/allocation$/)
    await expect(nav.subLink('Wealth', 'Allocation')).toHaveAttribute('aria-current', 'page')
    await expect(nav.subLink('Wealth', 'Allocation')).toBeFocused()

    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(nav.subLink('Wealth', 'Review')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(nav.link('Cashflow')).toBeFocused()
  })

  test('collapsed icon rail shows only group icons and navigates to the default child', async ({ page }) => {
    const nav = new NavigationPage(page)
    await nav.goto('/goal/leverage')
    await expect(nav.subLink('Planning', 'Leverage')).toBeVisible()

    await nav.collapseSidebar()

    await expect(nav.sidebar.getByRole('link')).toHaveCount(0)
    await expect(nav.sidebar.locator('.sidebar-chevron')).toHaveCount(0)
    for (const group of GROUPS) await expect(nav.link(group)).not.toHaveAttribute('aria-expanded', /.*/)
    await expect(nav.link('Planning')).toHaveAttribute('aria-current', 'true')

    await nav.link('Planning').click()
    await expect(page).toHaveURL(/#\/goal\/leverage$/)

    await nav.link('Cashflow').click()
    await expect(page).toHaveURL(/#\/budget\/cashflow$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Overview' })).toBeVisible()
    await expect(nav.sidebar.getByRole('link')).toHaveCount(0)

    await nav.expandSidebar()
    await expect(nav.subLink('Cashflow', 'Overview')).toHaveAttribute('aria-current', 'page')
  })

  test('mobile: choosing a sub-item closes the overlay, while toggling a group keeps it open', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    const nav = new NavigationPage(page)
    await nav.goto('/goal/plans')
    await expect(nav.sidebar).toBeVisible()

    await nav.link('Planning').click()
    await expect(nav.link('Planning')).toHaveAttribute('aria-expanded', 'false')
    await expect(nav.sidebar).toBeVisible()
    await nav.link('Planning').click()
    await expect(nav.link('Planning')).toHaveAttribute('aria-expanded', 'true')

    await nav.subLink('Planning', 'Taxes').click()
    await expect(page).toHaveURL(/#\/taxes$/)
    await expect(nav.sidebar).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Taxes' })).toBeVisible()

    await nav.toggleExpand.click()
    await expect(nav.subLink('Planning', 'Taxes')).toHaveAttribute('aria-current', 'page')
    await nav.link('Wealth').click()
    await expect(page).toHaveURL(/#\/net-worth\/dashboard$/)
    await expect(nav.sidebar).toHaveCount(0)
  })

  test('tablet: choosing a sub-item collapses the overlay and moves focus to the page instead of losing it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 700, height: 800 })
    const nav = new NavigationPage(page)
    await nav.goto('/goal/plans')
    if (await nav.toggleExpand.isVisible()) await nav.toggleExpand.click()
    await expect(nav.link('Planning')).toHaveAttribute('aria-expanded', 'true')

    await nav.subLink('Planning', 'Taxes').click()
    await expect(page).toHaveURL(/#\/taxes$/)
    await expect(page.locator('#main-content')).toBeFocused()
  })

  test('with every group open on a short viewport the sidebar scrolls and nothing overflows sideways', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 600 })
    const nav = new NavigationPage(page)
    await nav.goto('/')
    for (const group of GROUPS) await nav.expandGroup(group)
    await nav.expectOnPage(GROUPS[GROUPS.length - 1])

    const metrics = await nav.sidebar.evaluate(el => ({
      overflowY: getComputedStyle(el).overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }))
    expect(['auto', 'scroll']).toContain(metrics.overflowY)
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false)

    const guide = nav.utilities.getByRole('button', { name: 'User Guide' })
    await guide.scrollIntoViewIfNeeded()
    await expect(guide).toBeInViewport()
    await expect(nav.subLink('Cashflow', 'Transactions')).toBeVisible()
  })
})
