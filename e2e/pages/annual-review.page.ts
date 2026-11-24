import type { Locator, Page } from '@playwright/test'

export class AnnualReviewPage {
  readonly page: Page
  readonly wealthLinks: Locator
  readonly reviewTab: Locator
  readonly title: Locator
  readonly printTitle: Locator
  readonly yearLabel: Locator
  readonly prevYearBtn: Locator
  readonly nextYearBtn: Locator
  readonly moreActionsBtn: Locator
  readonly printBtn: Locator
  readonly downloadBtn: Locator
  readonly liveRegion: Locator
  readonly chart: Locator
  readonly tooltip: Locator

  constructor(page: Page) {
    this.page = page
    this.wealthLinks = page.locator('#sidebar-group-net-worth').getByRole('link')
    this.reviewTab = this.wealthLinks.filter({ hasText: /^Review$/ })
    this.title = page.getByRole('heading', { level: 1, name: 'Annual Review', exact: true })
    this.printTitle = page.locator('.ar-print-title')
    this.yearLabel = page.locator('.budget-year-label')
    this.prevYearBtn = page.getByRole('button', { name: 'Previous year' })
    this.nextYearBtn = page.getByRole('button', { name: 'Next year' })
    this.moreActionsBtn = page.getByRole('button', { name: 'More actions' })
    this.printBtn = page.getByRole('button', { name: 'Print or save as PDF' })
    this.downloadBtn = page.getByRole('button', { name: 'Download CSV' })
    this.liveRegion = page.locator('.ar-live')
    this.chart = page.locator('.ar-chart-wrap')
    this.tooltip = page.locator('.ar-tooltip')
  }

  async goto(path = '') {
    await this.page.goto(`/worth/#/net-worth/review${path}`)
  }

  /** Print and Download CSV sit in a disclosure panel that is hidden until More actions is pressed. */
  async openActions() {
    if ((await this.moreActionsBtn.getAttribute('aria-expanded')) !== 'true') await this.moreActionsBtn.click()
  }

  async download() {
    await this.openActions()
    await this.downloadBtn.click()
  }

  async print() {
    await this.openActions()
    await this.printBtn.click()
  }

  section(name: string): Locator {
    return this.page.getByRole('region', { name })
  }

  /** The `<dd>` value that sits next to a headline label inside a section. */
  stat(section: string, label: string): Locator {
    return this.section(section).locator('.ar-stat', { has: this.page.getByText(label, { exact: true }) })
  }
}
