import { Page, Locator, expect } from '@playwright/test'
import {
  APP_BASE,
  hashUrl,
  NAV_PATHS,
  NavGroupName,
  PAGE_HEADINGS,
  PrimaryNavLink,
  SUB_PATHS,
} from '../fixtures/nav-data'

export type NavName = PrimaryNavLink | 'Drive'

/**
 * Page object for the sidebar / primary-navigation flows (#141, 61a).
 *
 * All locators are accessible-name based. `aria-current` is the canonical
 * active-state assertion, never the `active` CSS class: Home, Drive and the
 * current sub-item carry "page"; the accordion group header holding the
 * current route carries "true".
 */
export class NavigationPage {
  readonly page: Page

  readonly sidebar: Locator
  readonly utilities: Locator
  readonly toggleExpand: Locator
  readonly toggleCollapse: Locator

  constructor(page: Page) {
    this.page = page
    this.sidebar = page.getByRole('navigation', { name: 'Main navigation' })
    this.utilities = page.getByRole('group', { name: 'Utilities' })
    // The toggle sits inside the sidebar (or floats above main content when the
    // sidebar is unmounted at 479px and below); its accessible name flips with
    // state so each locator resolves to exactly one element at a time.
    this.toggleCollapse = page.getByRole('button', { name: 'Collapse sidebar' })
    this.toggleExpand = page.getByRole('button', { name: 'Expand sidebar' })
  }

  /** Navigate to the app root via the hash router. */
  async goto(path: string = '/'): Promise<void> {
    await this.page.goto(hashUrl(path))
    await this.page.waitForLoadState('domcontentloaded')
  }

  /** Locator for a primary nav button. Drive lives in the footer group. */
  link(name: NavName): Locator {
    if (name === 'Drive') return this.utilities.getByRole('button', { name: 'Drive' })
    return this.sidebar.getByRole('button', { name, exact: true })
  }

  /** Locator for a sub-item link inside an expanded accordion group (Planning, Wealth or Cashflow). */
  subLink(group: NavGroupName, label: string): Locator {
    return this.groupList(group).getByRole('link', { name: label, exact: true })
  }

  /** The child list a group header controls; only rendered while the group is expanded. */
  groupList(group: NavGroupName): Locator {
    const id = { Planning: 'goal', Wealth: 'net-worth', Cashflow: 'budget' }[group]
    return this.sidebar.locator(`#sidebar-group-${id}`)
  }

  /** Open an accordion group if it is collapsed. */
  async expandGroup(group: NavGroupName): Promise<void> {
    const header = this.link(group)
    if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'true')
  }

  /** Open a group and click one of its sub-items, then wait for the URL to match. */
  async navToSub(group: NavGroupName, label: string): Promise<void> {
    await this.expandGroup(group)
    await this.subLink(group, label).click()
    await expect(this.page).toHaveURL(routeRegex(SUB_PATHS[label]))
  }

  /** Click a nav link and wait until URL + heading reflect the new page. */
  async navTo(name: NavName): Promise<void> {
    await this.link(name).click()
    await this.expectOnPage(name)
  }

  /** Wait for the page to be on the route corresponding to `name`. */
  async expectOnPage(name: NavName): Promise<void> {
    await expect(this.page).toHaveURL(routeRegex(NAV_PATHS[name]))
    await expect(this.page.getByRole('heading', { level: 1, name: PAGE_HEADINGS[name] })).toBeVisible()
  }

  /**
   * Assert the nav item named `name` is the active one: a group header reads
   * `aria-current="true"`, Home and Drive read `"page"`, and no other
   * top-level item carries `aria-current`.
   */
  async expectActive(name: NavName): Promise<void> {
    const isGroup = name === 'Planning' || name === 'Wealth' || name === 'Cashflow'
    await expect(this.link(name)).toHaveAttribute('aria-current', isGroup ? 'true' : 'page')
    for (const other of (['Home', 'Planning', 'Wealth', 'Cashflow', 'Drive'] as NavName[]).filter(n => n !== name)) {
      await expect(this.link(other)).not.toHaveAttribute('aria-current', /.*/)
    }
  }

  /**
   * Click the sidebar collapse button and wait for the toggle to read "Expand sidebar".
   * At 480px and above the nav stays mounted as an icon rail; at 479px and below it unmounts.
   */
  async collapseSidebar(): Promise<void> {
    await this.toggleCollapse.click()
    await expect(this.toggleExpand).toBeVisible()
  }

  /** Click the expand button (visible only when sidebar is collapsed). */
  async expandSidebar(): Promise<void> {
    await this.toggleExpand.click()
    await expect(this.sidebar).toBeVisible()
    await expect(this.toggleCollapse).toBeVisible()
  }
}

/**
 * Build a regex that matches the trailing hash path. Uses end-of-string
 * anchor so `/net-worth` does not match `/net-worth/allocation`.
 */
export function routeRegex(hashPath: string): RegExp {
  const escaped = hashPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Home (`/`) is treated specially: HashRouter may render either
  // `#/` or no hash at all after `Navigate to="/"`. Accept both.
  if (hashPath === '/') return new RegExp(`${escapeForRegex(APP_BASE)}(?:#/?)?$`)
  return new RegExp(`#${escaped}$`)
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
