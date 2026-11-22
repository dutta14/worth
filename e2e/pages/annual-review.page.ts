import type { Locator, Page } from '@playwright/test'

export class AnnualReviewPage {
  readonly page: Page
  readonly tabBar: Locator
  readonly reviewTab: Locator
  readonly title: Locator
  readonly period: Locator
  readonly yearSelect: Locator
  readonly printBtn: Locator
  readonly downloadBtn: Locator
  readonly liveRegion: Locator
  readonly toggleValuesBtn: Locator

  constructor(page: Page) {
    this.page = page
    this.tabBar = page.getByRole('navigation', { name: 'Wealth sections' })
    this.reviewTab = this.tabBar.getByRole('link', { name: 'Review' })
    this.title = page.getByRole('heading', { level: 2, name: /^Annual Review/ })
    this.period = page.locator('.ar-period')
    this.yearSelect = page.getByLabel('Year', { exact: true })
    this.printBtn = page.getByRole('button', { name: 'Print or save as PDF' })
    this.downloadBtn = page.getByRole('button', { name: 'Download CSV' })
    this.liveRegion = page.locator('.ar-live')
    this.toggleValuesBtn = page.getByRole('button', { name: /monthly values/ })
  }

  async goto(path = '') {
    await this.page.goto(`/worth/#/net-worth/review${path}`)
  }

  section(name: string): Locator {
    return this.page.getByRole('region', { name })
  }

  /** The `<dd>` value that sits next to a headline label inside a section. */
  stat(section: string, label: string): Locator {
    return this.section(section).locator('.ar-stat', { has: this.page.getByText(label, { exact: true }) })
  }
}
