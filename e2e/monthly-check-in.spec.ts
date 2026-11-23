import { test, expect } from './fixtures/base'
import type { Page } from '@playwright/test'
import { HomePage } from './pages/home.page'
import { SettingsPage } from './pages/settings.page'
import { readCsvFile } from './fixtures/filestore-helpers'
import {
  COMPLETE_OCTOBER,
  COMPLETE_SEPTEMBER,
  MISSING_NAMES,
  PARTIAL_OCTOBER,
  monthBalances,
  seedCheckIn,
} from './fixtures/check-in.fixtures'

/**
 * Monthly check-in (docs/specs/monthly-check-in.md, sections 7.3 and 7.4).
 * The clock is pinned to 2026-11-08 unless a test says otherwise, so October is last month and
 * the current month is November.
 */
const TODAY = new Date('2026-11-08T12:00:00Z')
const DETAILS_URL = '/worth/#/net-worth/dashboard/details'

async function openHome(page: Page, balances: Parameters<typeof seedCheckIn>[1]['balances'], today = TODAY) {
  await seedCheckIn(page, { balances })
  await page.clock.setFixedTime(today)
  const home = new HomePage(page)
  await home.goto()
  return home
}

const detailsInput = (page: Page, accountName: string) => page.getByLabel(`${accountName} balance`)
const saveStatus = (page: Page) => page.locator('.data-details-save-status')
// Details lists accounts by balance, so the first input is not the first account in the fixture.
const firstInput = (page: Page) => page.locator('.account-card__value-input').first()

/** Tabs forward until `target` has focus, so the run proves DOM order without a mouse. */
async function tabTo(page: Page, target: ReturnType<Page['locator']>, limit = 80) {
  for (let presses = 0; presses < limit; presses++) {
    if (await target.evaluate(el => el === document.activeElement)) return
    await page.keyboard.press('Tab')
  }
  throw new Error('Target never received focus by Tab')
}

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
      return [255, 255, 255]
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

test.describe('Monthly check-in: Home strip', () => {
  test('E2E-1: shows the missing count and names, and marks the Net Worth card as a partial month', async ({
    page,
  }) => {
    const home = await openHome(page, PARTIAL_OCTOBER)

    await expect(home.checkInTitle).toHaveText('2 accounts missing for October')
    await expect(home.checkInMissingList.getByRole('listitem')).toHaveText(MISSING_NAMES)
    await expect(home.checkInCta).toHaveText('Finish October')
    await expect(home.checkInCard).toContainText('October ended 8 days ago.')
    await expect(home.partialBadge).toHaveText('Partial month')
    await expect(page.getByText('Change hidden until October is complete.')).toBeVisible()
    await expect(home.nwChange).toHaveCount(0)
  })

  test('renders after the setup guide and before the card grid without touching the card slots', async ({ page }) => {
    await seedCheckIn(page, { balances: PARTIAL_OCTOBER, onboardingDismissed: false })
    await page.clock.setFixedTime(TODAY)
    const home = new HomePage(page)
    await home.goto()

    await expect(home.setupProgress).toBeVisible()
    await expect(home.checkInCard).toBeVisible()
    const order = await page.evaluate(() => {
      const setup = document.querySelector('.setup-progress')
      const strip = document.querySelector('.checkin-card')
      const grid = document.querySelector('.home-grid')
      if (!setup || !strip || !grid) return null
      const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
      return { setupBeforeStrip: follows(setup, strip), stripBeforeGrid: follows(strip, grid) }
    })
    expect(order).toEqual({ setupBeforeStrip: true, stripBeforeGrid: true })
    await expect(page.locator('[data-testid^="drag-slot-"]')).toHaveCount(5)
    await expect(home.checkInCard.locator('xpath=ancestor::*[@draggable="true"]')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('home-card-order'))).toBeNull()
  })

  test('E2E-4: is not stale 35 days after the end of the latest month', async ({ page }) => {
    const home = await openHome(page, COMPLETE_OCTOBER, new Date('2026-12-05T12:00:00Z'))

    await expect(home.checkInTitle).toHaveText('November balances are ready to record')
    await expect(home.checkInCard).toContainText('October ended 35 days ago.')
    await expect(home.checkInCard).not.toHaveClass(/checkin-card--stale/)
  })

  test('E2E-4: is stale 36 days after the end of the latest month', async ({ page }) => {
    const home = await openHome(page, COMPLETE_OCTOBER, new Date('2026-12-06T12:00:00Z'))

    await expect(home.checkInTitle).toHaveText('November balances are ready to record')
    await expect(home.checkInCard).toContainText('Last balances are from October, 36 days ago.')
    await expect(home.checkInCard).toHaveClass(/checkin-card--stale/)
  })

  test('E2E-8: demo mode shows no strip because its data is complete', async ({ page }) => {
    await seedCheckIn(page, { balances: PARTIAL_OCTOBER })
    await page.clock.setFixedTime(TODAY)
    const home = new HomePage(page)
    await home.goto()
    await expect(home.checkInTitle).toHaveText('2 accounts missing for October')

    const settings = new SettingsPage(page)
    await settings.open()
    await settings.navTo('labs')
    await settings.demoModeToggle.click()
    await page.keyboard.press('Escape')

    await expect(home.checkInCard).toHaveCount(0)
    await expect(home.partialBadge).toHaveCount(0)
  })
})

test.describe('Monthly check-in: guided entry', () => {
  test('E2E-2: starts a new month and saves unchanged in two activations', async ({ page }) => {
    const home = await openHome(page, COMPLETE_SEPTEMBER)
    await expect(home.checkInTitle).toHaveText('October balances are ready to record')

    await tabTo(page, home.checkInCta)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/net-worth\/dashboard\/details/)
    await expect(firstInput(page)).toBeFocused()
    await expect(detailsInput(page, 'Checking')).toHaveValue('1010')
    await expect(page.getByText('Copied from September 2026', { exact: true })).toHaveCount(9)

    const save = page.getByRole('button', { name: 'Save', exact: true })
    await save.focus()
    await page.keyboard.press('Enter')

    await expect(saveStatus(page)).toHaveText('Saved October 2026. All 9 accounts have a balance.')
    const rows = await readCsvFile(page, 'balances/2026.csv')
    expect(rows.filter(row => row[0] === '2026-10')).toHaveLength(9)

    await page.goBack()
    await expect(home.checkInCard).toHaveCount(0)
  })

  test('E2E-3: finishing a partial month clears the badge and caption and plots the month', async ({ page }) => {
    const home = await openHome(page, PARTIAL_OCTOBER)
    const chartCaption = home.chartsCard.getByText('October is not plotted until all accounts have a balance.')
    const chartPlot = home.chartsCard.locator('svg.recharts-surface')
    await expect(chartCaption).toBeVisible()
    await expect(chartPlot).toContainText('Sep 2026')
    await expect(chartPlot).not.toContainText('Oct 2026')

    await home.checkInCta.click()
    await expect(firstInput(page)).toBeFocused()
    await expect(detailsInput(page, 'Checking')).toHaveValue('1020')
    await expect(page.getByText('Adding the missing balances for October 2026')).toBeVisible()
    await expect(page.getByText('2 accounts still blank. Blank accounts are not saved.')).toBeVisible()
    await expect(page.getByText('No balance yet')).toHaveCount(2)
    await expect(detailsInput(page, 'Roth IRA')).toHaveAccessibleDescription(
      'No balance yet. Last recorded $8,010 in September 2026.',
    )

    await detailsInput(page, 'Roth IRA').fill('8,500')
    await detailsInput(page, 'Crypto Wallet').fill('9,100')
    await expect(page.getByText('Every account has a balance.')).toBeVisible()
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(saveStatus(page)).toHaveText('Saved October 2026. All 9 accounts have a balance.')

    await page.goBack()
    await expect(home.checkInCard).toHaveCount(0)
    await expect(home.partialBadge).toHaveCount(0)
    await expect(chartCaption).toHaveCount(0)
    await expect(chartPlot).toContainText('Oct 2026')
  })

  test('saving only some missing accounts reports how many are still missing and never deletes data', async ({
    page,
  }) => {
    const home = await openHome(page, PARTIAL_OCTOBER)
    await home.checkInCta.click()
    await detailsInput(page, 'Roth IRA').fill('8,500')
    await page.getByRole('button', { name: 'Save', exact: true }).click()

    await expect(saveStatus(page)).toHaveText('Saved October 2026. 1 account still has no balance.')
    const rows = await readCsvFile(page, 'balances/2026.csv')
    expect(rows.filter(row => row[0] === '2026-10')).toHaveLength(8)
    expect(rows.filter(row => row[0] === '2026-09')).toHaveLength(9)

    await page.goBack()
    await expect(home.checkInTitle).toHaveText('1 account missing for October')
    await expect(home.checkInMissingList.getByRole('listitem')).toHaveText(['Crypto Wallet'])
  })

  test('E2E-6: runs from the strip to a saved month by keyboard alone, and a reload does not reopen the form', async ({
    page,
  }) => {
    const home = await openHome(page, PARTIAL_OCTOBER)

    await tabTo(page, home.checkInCta)
    await page.keyboard.press('Space')
    await expect(firstInput(page)).toBeFocused()

    await tabTo(page, detailsInput(page, 'Roth IRA'))
    await page.keyboard.type('8500')
    await tabTo(page, detailsInput(page, 'Crypto Wallet'))
    await page.keyboard.type('9100')
    await tabTo(page, page.getByRole('button', { name: 'Save', exact: true }))
    await page.keyboard.press('Enter')
    await expect(saveStatus(page)).toHaveText('Saved October 2026. All 9 accounts have a balance.')

    await page.reload()
    await expect(page.getByRole('button', { name: '+ Add Entry' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
    await expect(detailsInput(page, 'Checking')).toHaveCount(0)
  })

  test('Wealth Charts omit the partial month and say so', async ({ page }) => {
    await seedCheckIn(page, { balances: PARTIAL_OCTOBER })
    await page.clock.setFixedTime(TODAY)
    await page.goto('/worth/#/net-worth/dashboard')

    await expect(page.getByText('October is not plotted until all accounts have a balance.')).toBeVisible()
    await expect(page.locator('svg.recharts-surface').first()).toContainText('Sep 2026')
    await expect(page.locator('svg.recharts-surface').first()).not.toContainText('Oct 2026')
  })

  test('Escape cancels the check-in and the form does not come back on Back or reload', async ({ page }) => {
    const home = await openHome(page, PARTIAL_OCTOBER)
    await home.checkInCta.click()
    await expect(firstInput(page)).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: '+ Add Entry' })).toBeVisible()
    await expect(detailsInput(page, 'Checking')).toHaveCount(0)
    const rows = await readCsvFile(page, 'balances/2026.csv')
    expect(rows.filter(row => row[0] === '2026-10')).toHaveLength(7)
  })

  test('ignores an invalid month in the router state and opens Details normally', async ({ page }) => {
    await seedCheckIn(page, { balances: PARTIAL_OCTOBER })
    await page.clock.setFixedTime(TODAY)
    await page.goto(DETAILS_URL)

    await expect(page.getByRole('button', { name: '+ Add Entry' })).toBeVisible()
    await expect(detailsInput(page, 'Checking')).toHaveCount(0)
  })
})

test.describe('Monthly check-in: snooze', () => {
  test('E2E-5: snoozing hides the strip, keeps the badge, moves focus to the heading and survives a reload', async ({
    page,
  }) => {
    const home = await openHome(page, PARTIAL_OCTOBER)
    await expect(home.checkInSnoozeBtn).toBeVisible()

    await home.checkInSnoozeBtn.click()
    await expect(home.checkInCard).toHaveCount(0)
    await expect(home.greeting).toBeFocused()
    await expect(page.getByText('Check-in snoozed for 7 days.')).toBeAttached()
    await expect(home.partialBadge).toBeVisible()
    await expect(page.locator('[data-testid^="drag-slot-"]')).toHaveCount(5)

    await page.reload()
    await expect(home.partialBadge).toBeVisible()
    await expect(home.checkInCard).toHaveCount(0)
    const stored = await page.evaluate(() => localStorage.getItem('checkin-snooze'))
    expect(JSON.parse(stored ?? 'null')).toEqual({ month: '2026-10', until: '2026-11-15' })
  })

  test('the strip returns once the seven days are over', async ({ page }) => {
    const home = await openHome(page, PARTIAL_OCTOBER)
    await home.checkInSnoozeBtn.click()
    await expect(home.checkInCard).toHaveCount(0)

    await page.clock.setFixedTime(new Date('2026-11-15T12:00:00Z'))
    await page.reload()
    await expect(home.checkInTitle).toHaveText('2 accounts missing for October')
  })

  test('E2E-5: a snooze for an earlier month does not hide a new month', async ({ page }) => {
    await seedCheckIn(page, {
      balances: [...COMPLETE_OCTOBER, ...monthBalances('2026-11', 30, [1, 2, 3, 4, 5, 6, 7])],
    })
    await page.addInitScript(() =>
      localStorage.setItem('checkin-snooze', JSON.stringify({ month: '2026-10', until: '2026-11-15' })),
    )
    await page.clock.setFixedTime(TODAY)
    const home = new HomePage(page)
    await home.goto()

    await expect(home.checkInTitle).toHaveText('2 accounts missing for November')
  })

  test('shows no strip when the month is complete', async ({ page }) => {
    const home = await openHome(page, COMPLETE_OCTOBER)

    await expect(home.checkInCard).toHaveCount(0)
    await expect(home.partialBadge).toHaveCount(0)
  })
})

test.describe('Monthly check-in: privacy', () => {
  test('E2E-7: makes no request beyond static assets and the flag config, and a check-in changes only the balances file', async ({
    page,
  }) => {
    const external: string[] = []
    page.on('request', request => {
      const { origin, hostname, pathname } = new URL(request.url())
      if (hostname === 'localhost' || request.url().startsWith('data:')) return
      // The Inter stylesheet and font files are loaded by index.html in every build, with or without this feature.
      if (origin === 'https://fonts.googleapis.com' || origin === 'https://fonts.gstatic.com') return
      if (origin === 'https://api.github.com' && pathname.endsWith('/feature-flags.json')) return
      external.push(request.url())
    })
    const snapshot = () =>
      page.evaluate(() => {
        const raw = localStorage.getItem('__e2eSeedData')
        const entries = Object.entries(JSON.parse(raw ?? '{}') as Record<string, { content: string }>)
        return Object.fromEntries(entries.map(([path, entry]) => [path, entry.content]))
      })

    const home = await openHome(page, PARTIAL_OCTOBER)
    await expect(home.checkInTitle).toBeVisible()
    const before = await snapshot()

    await home.checkInCta.click()
    await detailsInput(page, 'Roth IRA').fill('8,500')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(saveStatus(page)).toContainText('Saved October 2026.')
    await expect.poll(async () => (await snapshot())['balances/2026.csv']).not.toBe(before['balances/2026.csv'])
    const after = await snapshot()

    const changed = Object.keys({ ...before, ...after }).filter(path => before[path] !== after[path])
    expect(changed).toEqual(['balances/2026.csv'])
    expect(external).toEqual([])
  })
})

test.describe('Monthly check-in: accessibility', () => {
  test('headings stay in order and the strip is a named region', async ({ page }) => {
    const home = await openHome(page, PARTIAL_OCTOBER)
    await expect(home.checkInTitle).toBeVisible()

    await expect(page.getByRole('region', { name: '2 accounts missing for October' })).toBeVisible()
    await expect(home.checkInTitle).toHaveJSProperty('tagName', 'H2')
    await expect(home.checkInMissingList).toHaveAccessibleName('Accounts missing for October')
    const levels = await page.evaluate(() =>
      [...document.querySelectorAll('h1, h2, h3')]
        .filter(el => !el.closest('[hidden]'))
        .map(el => Number(el.tagName.slice(1))),
    )
    expect(levels[0]).toBe(1)
    levels.slice(1).forEach((level, index) => expect(level - levels[index]).toBeLessThanOrEqual(1))
    expect(levels.slice(0, 2)).toEqual([1, 2])
  })

  test('the strip status region is empty after load and while the page is used', async ({ page }) => {
    const home = await openHome(page, PARTIAL_OCTOBER)
    await expect(home.checkInTitle).toBeVisible()
    await expect(home.checkInStatus).toHaveText('')

    await home.checkInCta.focus()
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
    await expect(home.checkInStatus).toHaveText('')
    await expect(home.checkInStatus).toHaveAttribute('role', 'status')
  })

  test('the Details status region is empty until a save and is not written by typing', async ({ page }) => {
    const home = await openHome(page, PARTIAL_OCTOBER)
    await home.checkInCta.click()

    await expect(saveStatus(page)).toHaveAttribute('role', 'status')
    await expect(saveStatus(page)).toHaveText('')
    await detailsInput(page, 'Roth IRA').fill('8,500')
    await expect(saveStatus(page)).toHaveText('')
    await expect(page.locator('.data-details-entry-banner')).toHaveAttribute('aria-live', 'polite')
  })

  test('blank accounts are linked to their note and the caption clears when a copied value changes', async ({
    page,
  }) => {
    const home = await openHome(page, COMPLETE_SEPTEMBER)
    await home.checkInCta.click()
    const checking = detailsInput(page, 'Checking')

    await expect(checking).toHaveAccessibleDescription('Copied from September 2026')
    await checking.fill('1,500')
    await expect(checking).not.toHaveAttribute('aria-describedby', /.+/)
    await expect(page.getByText('Copied from September 2026', { exact: true })).toHaveCount(8)
    await expect(checking).not.toHaveAttribute('aria-invalid', /.*/)
  })

  test('focus goes to the page heading after snooze', async ({ page }) => {
    const home = await openHome(page, PARTIAL_OCTOBER)
    await home.checkInSnoozeBtn.focus()
    await page.keyboard.press('Enter')

    await expect(home.greeting).toBeFocused()
    await expect(home.greeting).toHaveAttribute('tabindex', '-1')
  })

  test('focus lands on Add Entry after saving or cancelling, not on the page body', async ({ page }) => {
    const home = await openHome(page, PARTIAL_OCTOBER)
    await home.checkInCta.click()
    await detailsInput(page, 'Roth IRA').fill('8,500')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.getByRole('button', { name: '+ Add Entry' })).toBeFocused()
    await expect(saveStatus(page)).toHaveText('Saved October 2026. 1 account still has no balance.')

    await page.goBack()
    await home.checkInCta.click()
    await expect(firstInput(page)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: '+ Add Entry' })).toBeFocused()
  })

  test('the CTA shows a visible focus ring when reached by keyboard', async ({ page }) => {
    const home = await openHome(page, PARTIAL_OCTOBER)
    await tabTo(page, home.checkInCta)

    const outline = await home.checkInCta.evaluate(el => {
      const style = getComputedStyle(el)
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) }
    })
    expect(outline.style).not.toBe('none')
    expect(outline.width).toBeGreaterThanOrEqual(2)
  })

  test('actions are at least 44px tall at 480px wide with no horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 })
    const home = await openHome(page, PARTIAL_OCTOBER)
    await expect(home.checkInTitle).toBeVisible()

    const buttons = home.checkInCard.getByRole('button')
    const count = await buttons.count()
    expect(count).toBe(3)
    for (let index = 0; index < count; index++) {
      const box = await buttons.nth(index).boundingBox()
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

  for (const darkMode of [false, true]) {
    test(`text meets AA contrast in the ${darkMode ? 'dark' : 'light'} theme`, async ({ page }) => {
      await seedCheckIn(page, { balances: PARTIAL_OCTOBER, darkMode })
      await page.clock.setFixedTime(TODAY)
      const home = new HomePage(page)
      await home.goto()
      await expect(home.checkInTitle).toBeVisible()

      const selectors = [
        '.checkin-card__title',
        '.checkin-card__meta',
        '.checkin-card__chip',
        '.checkin-card__cta',
        '.checkin-card__link',
        '.partial-badge',
      ]
      for (const selector of selectors) {
        const ratios = await contrastRatios(page, selector)
        expect(ratios.length, selector).toBeGreaterThan(0)
        for (const { text, ratio } of ratios) expect(ratio, `${selector} "${text}"`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  test('removes interaction transitions under prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const home = await openHome(page, PARTIAL_OCTOBER)
    await expect(home.checkInTitle).toBeVisible()

    for (const locator of [home.checkInCta, home.checkInSnoozeBtn]) {
      const duration = await locator.evaluate(el => getComputedStyle(el).transitionDuration)
      // The modern theme clamps durations to 0.01ms, which computes to 1e-05s, rather than 0.
      expect(duration.split(',').every(part => parseFloat(part) <= 0.0001)).toBe(true)
    }
  })
})
