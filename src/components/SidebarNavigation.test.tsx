import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import SidebarNavigation from './SidebarNavigation'
import { SettingsProvider } from '../contexts/SettingsContext'
import { GoalsProvider } from '../contexts/GoalsContext'
import { LayoutProvider } from '../contexts/LayoutContext'
import { FileStoreTestProvider } from '../test/fileStoreTestUtils'
import type { NavigationProps, PageType } from '../types'

const noop = () => {}

const pageFor = (pathname: string): PageType => {
  if (pathname === '/goal' || pathname.startsWith('/goal/') || pathname === '/taxes') return 'goal'
  if (pathname.startsWith('/net-worth')) return 'net-worth'
  if (pathname.startsWith('/budget') || pathname.startsWith('/transactions')) return 'budget'
  if (pathname.startsWith('/drive')) return 'drive'
  if (pathname === '/guide') return 'guide'
  return 'home'
}

const LocationProbe = () => <output data-testid="location">{useLocation().pathname}</output>

const ExternalNav = () => {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate('/net-worth/review/2025')}>
      Go to review externally
    </button>
  )
}

/** Mirrors App.tsx by deriving currentPage from the route, so the sidebar sees realistic props. */
const RoutedSidebar = (props: Partial<NavigationProps>) => {
  const { pathname } = useLocation()
  return <SidebarNavigation currentPage={pageFor(pathname)} setCurrentPage={noop} {...props} />
}

const renderSidebar = (overrides: Partial<NavigationProps> = {}, route = '/') =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <FileStoreTestProvider>
        <SettingsProvider>
          <GoalsProvider>
            <LayoutProvider>
              <RoutedSidebar {...overrides} />
              <LocationProbe />
              <ExternalNav />
            </LayoutProvider>
          </GoalsProvider>
        </SettingsProvider>
      </FileStoreTestProvider>
    </MemoryRouter>,
  )

const currentPath = () => screen.getByTestId('location').textContent

beforeEach(() => {
  localStorage.clear()
})

describe('SidebarNavigation', () => {
  it('renders expected nav links and footer icons (no Tools)', () => {
    renderSidebar()

    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Planning')).toBeInTheDocument()
    expect(screen.getByText('Wealth')).toBeInTheDocument()
    expect(screen.getByText('Cashflow')).toBeInTheDocument()
    expect(screen.queryByText('Transactions')).not.toBeInTheDocument()
    expect(screen.queryByText('Taxes')).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: 'Drive' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'User Guide' })).toBeInTheDocument()

    expect(screen.queryByText('Tools')).not.toBeInTheDocument()
  })

  it('does not render a Tools nav button', () => {
    renderSidebar()

    const buttons = screen.getAllByRole('button')
    const labels = buttons.map(b => b.textContent?.trim())
    expect(labels).not.toContain('Tools')
  })

  it('does not render Drive as a text link in the primary nav list', () => {
    renderSidebar()

    const navList = screen.getByRole('list')
    const navButtons = within(navList).getAllByRole('button')
    const navLabels = navButtons.map(b => b.textContent?.trim())
    expect(navLabels).not.toContain('Drive')
  })

  it('calls setCurrentPage with "drive" when the Drive button is clicked', async () => {
    const setCurrentPage = vi.fn()
    const user = userEvent.setup()
    renderSidebar({ setCurrentPage })

    await user.click(screen.getByRole('button', { name: 'Drive' }))

    expect(setCurrentPage).toHaveBeenCalledTimes(1)
    expect(setCurrentPage).toHaveBeenCalledWith('drive')
  })

  it('calls setCurrentPage with "guide" when the User Guide button is clicked', async () => {
    const setCurrentPage = vi.fn()
    const user = userEvent.setup()
    renderSidebar({ setCurrentPage })

    await user.click(screen.getByRole('button', { name: 'User Guide' }))

    expect(setCurrentPage).toHaveBeenCalledTimes(1)
    expect(setCurrentPage).toHaveBeenCalledWith('guide')
  })

  it('opens the settings modal when the Settings icon button is clicked', async () => {
    const user = userEvent.setup()
    renderSidebar()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Settings' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('applies aria-current to Drive button when currentPage is "drive"', () => {
    renderSidebar({}, '/drive')

    const driveBtn = screen.getByRole('button', { name: 'Drive' })
    expect(driveBtn).toHaveAttribute('aria-current', 'page')
  })

  it('applies aria-current to Guide button when currentPage is "guide"', () => {
    renderSidebar({}, '/guide')

    const guideBtn = screen.getByRole('button', { name: 'User Guide' })
    expect(guideBtn).toHaveAttribute('aria-current', 'page')
  })

  it('does not apply aria-current to Drive button when currentPage is not "drive"', () => {
    renderSidebar({}, '/')

    const driveBtn = screen.getByRole('button', { name: 'Drive' })
    expect(driveBtn).not.toHaveAttribute('aria-current')
  })

  it('applies aria-current to Home button when currentPage is "home"', () => {
    renderSidebar({}, '/')

    const homeBtn = screen.getByRole('button', { name: 'Home' })
    expect(homeBtn).toHaveAttribute('aria-current', 'page')
  })

  it('has no top-level Taxes or Transactions button, since they are children of Planning and Cashflow', () => {
    renderSidebar({}, '/goal/plans')

    expect(screen.queryByRole('button', { name: 'Taxes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Transactions' })).not.toBeInTheDocument()
  })

  it('renders the footer group with correct ARIA attributes', () => {
    renderSidebar()

    const group = screen.getByRole('group', { name: 'Utilities' })
    expect(group).toBeInTheDocument()
    expect(group).toHaveClass('sidebar-footer-menu')

    const buttons = within(group).getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(3)
  })

  describe('User guide link', () => {
    it('renders the User guide button in the sidebar footer', () => {
      renderSidebar()

      const group = screen.getByRole('group', { name: 'Utilities' })
      const button = within(group).getByRole('button', { name: /user guide/i })
      expect(button).toBeInTheDocument()
    })

    it('stays available as an icon-only button when the sidebar is collapsed', async () => {
      const user = userEvent.setup()
      renderSidebar()

      await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

      expect(screen.getByRole('button', { name: /user guide/i })).toBeInTheDocument()
    })
  })

  describe('Collapsed icon rail', () => {
    it('keeps every nav button reachable by name and adds a tooltip', async () => {
      const user = userEvent.setup()
      renderSidebar()

      await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

      for (const name of ['Home', 'Planning', 'Wealth', 'Cashflow', 'Drive', 'Settings']) {
        const button = screen.getByRole('button', { name })
        expect(button).toHaveAttribute('title', name)
      }
    })

    it('shows Search in the header beside the toggle and drops it from the rail', async () => {
      const user = userEvent.setup()
      renderSidebar()

      expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

      expect(screen.queryByRole('button', { name: 'Search' })).not.toBeInTheDocument()
    })

    it('marks the nav collapsed and offers an Expand sidebar button', async () => {
      const user = userEvent.setup()
      renderSidebar()

      await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

      expect(screen.getByRole('navigation', { name: 'Main navigation' })).toHaveClass('collapsed')
      expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    })

    it('restores labels and the wordmark when expanded again', async () => {
      const user = userEvent.setup()
      renderSidebar()

      await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
      await user.click(screen.getByRole('button', { name: 'Expand sidebar' }))

      expect(screen.getByText('Worth')).toBeInTheDocument()
      expect(screen.getByRole('navigation', { name: 'Main navigation' })).not.toHaveClass('collapsed')
      expect(screen.getByRole('button', { name: 'Planning' })).not.toHaveAttribute('title')
    })

    it('navigates to the default child when a rail icon is clicked outside its group', async () => {
      const user = userEvent.setup()
      renderSidebar()

      await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
      await user.click(screen.getByRole('button', { name: 'Cashflow' }))

      expect(currentPath()).toBe('/budget/cashflow')
    })
  })

  describe('Accordion groups', () => {
    const groupNames = ['Planning', 'Wealth', 'Cashflow']

    it('renders Planning, Wealth and Cashflow as buttons with aria-expanded and a decorative chevron', () => {
      renderSidebar()

      for (const name of groupNames) {
        const header = screen.getByRole('button', { name })
        expect(header).toHaveAttribute('aria-expanded', 'false')
        const chevron = header.querySelector('.sidebar-chevron')
        expect(chevron).toHaveAttribute('aria-hidden', 'true')
      }
    })

    it('keeps Home, Drive and User Guide as plain buttons without aria-expanded', () => {
      renderSidebar()

      for (const name of ['Home', 'Drive', 'User Guide']) {
        expect(screen.getByRole('button', { name })).not.toHaveAttribute('aria-expanded')
      }
    })

    it('renders no child links while every group is collapsed', () => {
      renderSidebar()

      expect(screen.queryAllByRole('link')).toHaveLength(0)
    })

    it('expands the active group automatically and points aria-controls at its list', () => {
      renderSidebar({}, '/net-worth/dashboard')

      const header = screen.getByRole('button', { name: 'Wealth' })
      expect(header).toHaveAttribute('aria-expanded', 'true')
      const list = document.getElementById(header.getAttribute('aria-controls') ?? '')
      expect(list).not.toBeNull()
      expect(within(list as HTMLElement).getAllByRole('link')).toHaveLength(4)
      expect(screen.getByRole('button', { name: 'Planning' })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByRole('button', { name: 'Cashflow' })).toHaveAttribute('aria-expanded', 'false')
    })

    it('renders each group with its children as links with the right hrefs', () => {
      const expected: Record<string, Array<[string, string]>> = {
        '/goal/plans': [
          ['Goals', '/goal/plans'],
          ['Leverage', '/goal/leverage'],
          ['Pay Down', '/goal/paydown'],
          ['FIRE Calculator', '/goal/calculator'],
          ['Taxes', '/taxes'],
        ],
        '/net-worth/dashboard': [
          ['Dashboard', '/net-worth/dashboard'],
          ['Allocation', '/net-worth/allocation'],
          ['Growth', '/net-worth/growth'],
          ['Review', '/net-worth/review'],
        ],
        '/budget/cashflow': [
          ['Overview', '/budget/cashflow'],
          ['Spreadsheet', '/budget/spreadsheet'],
          ['Groups', '/budget/groups'],
          ['Transactions', '/transactions'],
        ],
      }
      for (const [route, links] of Object.entries(expected)) {
        const { unmount } = renderSidebar({}, route)
        const rendered = screen.getAllByRole('link').map(l => [l.textContent, l.getAttribute('href')])
        expect(rendered).toEqual(links)
        unmount()
        localStorage.clear()
      }
    })

    it.each([
      ['/goal/plans', 'Goals'],
      ['/goal/plans/3', 'Goals'],
      ['/goal', 'Goals'],
      ['/goal/leverage', 'Leverage'],
      ['/goal/paydown', 'Pay Down'],
      ['/goal/calculator', 'FIRE Calculator'],
      ['/taxes', 'Taxes'],
      ['/net-worth', 'Dashboard'],
      ['/net-worth/dashboard', 'Dashboard'],
      ['/net-worth/dashboard/details', 'Dashboard'],
      ['/net-worth/allocation/ratios', 'Allocation'],
      ['/net-worth/growth/income', 'Growth'],
      ['/net-worth/review/2025', 'Review'],
      ['/budget/cashflow', 'Overview'],
      ['/budget', 'Overview'],
      ['/budget/spreadsheet', 'Spreadsheet'],
      ['/budget/groups', 'Groups'],
      ['/transactions', 'Transactions'],
    ])('marks exactly one element aria-current="page" on %s: the %s link', (route, label) => {
      renderSidebar({}, route)

      const current = document.querySelectorAll('[aria-current="page"]')
      expect(current).toHaveLength(1)
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
    })

    it('marks the group header with aria-current="true" and the active class when the route is inside it', () => {
      renderSidebar({}, '/transactions')

      const header = screen.getByRole('button', { name: 'Cashflow' })
      expect(header).toHaveAttribute('aria-current', 'true')
      expect(header).toHaveClass('active')
      expect(screen.getByRole('button', { name: 'Planning' })).not.toHaveAttribute('aria-current')
      expect(screen.getByRole('button', { name: 'Home' })).not.toHaveAttribute('aria-current')
    })

    it('navigates to the default child and expands the group when its header is clicked from outside', async () => {
      const user = userEvent.setup()
      renderSidebar()

      await user.click(screen.getByRole('button', { name: 'Planning' }))

      expect(currentPath()).toBe('/goal/plans')
      expect(screen.getByRole('button', { name: 'Planning' })).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('link', { name: 'Goals' })).toHaveAttribute('aria-current', 'page')
    })

    it.each([
      ['Wealth', '/net-worth/dashboard'],
      ['Cashflow', '/budget/cashflow'],
    ])('uses %s default child %s when navigating from another group', async (name, path) => {
      const user = userEvent.setup()
      renderSidebar({}, '/guide')

      await user.click(screen.getByRole('button', { name }))

      expect(currentPath()).toBe(path)
    })

    it('toggles without navigating when the header of the active group is clicked', async () => {
      const user = userEvent.setup()
      renderSidebar({}, '/goal/leverage')
      const header = screen.getByRole('button', { name: 'Planning' })

      await user.click(header)
      expect(header).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryAllByRole('link')).toHaveLength(0)
      expect(currentPath()).toBe('/goal/leverage')

      await user.click(header)
      expect(header).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('link', { name: 'Leverage' })).toHaveAttribute('aria-current', 'page')
      expect(currentPath()).toBe('/goal/leverage')
    })

    it('navigates when a child link is clicked and keeps the group open', async () => {
      const user = userEvent.setup()
      renderSidebar({}, '/net-worth/dashboard')

      await user.click(screen.getByRole('link', { name: 'Review' }))

      expect(currentPath()).toBe('/net-worth/review')
      expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('aria-current', 'page')
      expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current')
      expect(screen.getByRole('button', { name: 'Wealth' })).toHaveAttribute('aria-expanded', 'true')
    })

    it('keeps focus on a child link after it is activated', async () => {
      const user = userEvent.setup()
      renderSidebar({}, '/net-worth/dashboard')

      await user.click(screen.getByRole('link', { name: 'Growth' }))

      expect(screen.getByRole('link', { name: 'Growth' })).toHaveFocus()
    })

    it('lets modified clicks fall through to the browser instead of navigating in-app', async () => {
      const navigateTo = vi.fn()
      const user = userEvent.setup()
      renderSidebar({ navigateTo }, '/net-worth/dashboard')

      await user.keyboard('{Control>}')
      await user.click(screen.getByRole('link', { name: 'Review' }))
      await user.keyboard('{/Control}')

      expect(navigateTo).not.toHaveBeenCalled()
    })

    it('keeps groups independent so more than one can be open', async () => {
      const user = userEvent.setup()
      renderSidebar({}, '/goal/plans')

      await user.click(screen.getByRole('button', { name: 'Wealth' }))

      expect(screen.getByRole('button', { name: 'Planning' })).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('button', { name: 'Wealth' })).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('link', { name: 'Goals' })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    })

    it('leaves a previously opened group open when the route moves to another group', async () => {
      const user = userEvent.setup()
      renderSidebar({}, '/goal/plans')

      await user.click(screen.getByRole('button', { name: 'Cashflow' }))

      expect(screen.getByRole('button', { name: 'Planning' })).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('button', { name: 'Cashflow' })).toHaveAttribute('aria-expanded', 'true')
    })

    it('expands a group when the route enters it from outside the sidebar', async () => {
      const user = userEvent.setup()
      renderSidebar()
      expect(screen.getByRole('button', { name: 'Wealth' })).toHaveAttribute('aria-expanded', 'false')

      await user.click(screen.getByRole('button', { name: 'Go to review externally' }))

      expect(screen.getByRole('button', { name: 'Wealth' })).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByRole('link', { name: 'Review' })).toHaveAttribute('aria-current', 'page')
    })

    it('does not reopen a group the user collapsed while the route stays inside it', async () => {
      const user = userEvent.setup()
      renderSidebar({}, '/net-worth/dashboard')
      await user.click(screen.getByRole('button', { name: 'Wealth' }))
      expect(screen.getByRole('button', { name: 'Wealth' })).toHaveAttribute('aria-expanded', 'false')

      await user.click(screen.getByRole('button', { name: 'Go to review externally' }))

      expect(screen.getByRole('button', { name: 'Wealth' })).toHaveAttribute('aria-expanded', 'false')
    })

    it('does not render children of a collapsed group, so they cannot take focus', async () => {
      const user = userEvent.setup()
      renderSidebar({}, '/goal/plans')
      await user.click(screen.getByRole('button', { name: 'Planning' }))

      await user.tab()
      expect(screen.queryByRole('link', { name: 'Goals' })).not.toBeInTheDocument()
    })

    describe('keyboard', () => {
      it('toggles the active group with Enter and Space', async () => {
        const user = userEvent.setup()
        renderSidebar({}, '/goal/plans')
        const header = screen.getByRole('button', { name: 'Planning' })
        header.focus()

        await user.keyboard('{Enter}')
        expect(header).toHaveAttribute('aria-expanded', 'false')

        await user.keyboard(' ')
        expect(header).toHaveAttribute('aria-expanded', 'true')
      })

      it('moves focus from the header into its children and then to the next item', async () => {
        const user = userEvent.setup()
        renderSidebar({}, '/net-worth/dashboard')
        screen.getByRole('button', { name: 'Wealth' }).focus()

        await user.tab()
        expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveFocus()
        await user.tab()
        await user.tab()
        await user.tab()
        expect(screen.getByRole('link', { name: 'Review' })).toHaveFocus()
        await user.tab()
        expect(screen.getByRole('button', { name: 'Cashflow' })).toHaveFocus()
      })

      it('navigates to a child with Enter', async () => {
        const user = userEvent.setup()
        renderSidebar({}, '/net-worth/dashboard')
        screen.getByRole('link', { name: 'Allocation' }).focus()

        await user.keyboard('{Enter}')

        expect(currentPath()).toBe('/net-worth/allocation')
      })
    })

    describe('persistence', () => {
      it('persists which groups are open', async () => {
        const user = userEvent.setup()
        renderSidebar({}, '/goal/plans')
        await user.click(screen.getByRole('button', { name: 'Wealth' }))

        expect(JSON.parse(localStorage.getItem('sidebar-open-groups') ?? '[]')).toEqual(['goal', 'net-worth'])
      })

      it('restores stored open groups on mount in addition to the active group', () => {
        localStorage.setItem('sidebar-open-groups', JSON.stringify(['net-worth']))
        renderSidebar({}, '/budget/cashflow')

        expect(screen.getByRole('button', { name: 'Wealth' })).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('button', { name: 'Cashflow' })).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('button', { name: 'Planning' })).toHaveAttribute('aria-expanded', 'false')
      })

      it('persists a manual collapse of the active group', async () => {
        const user = userEvent.setup()
        renderSidebar({}, '/goal/plans')
        await user.click(screen.getByRole('button', { name: 'Planning' }))

        expect(JSON.parse(localStorage.getItem('sidebar-open-groups') ?? 'null')).toEqual([])
      })

      it.each([
        ['malformed JSON', '{oops'],
        ['a non-array value', '"goal"'],
        ['an array of non-strings', '[1, 2]'],
      ])('falls back to only the active group open when storage holds %s', (_label, raw) => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        localStorage.setItem('sidebar-open-groups', raw)
        renderSidebar({}, '/goal/plans')

        expect(screen.getByRole('button', { name: 'Planning' })).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('button', { name: 'Wealth' })).toHaveAttribute('aria-expanded', 'false')
        warn.mockRestore()
      })

      it('ignores unknown group ids in storage', () => {
        localStorage.setItem('sidebar-open-groups', JSON.stringify(['nope', 'home', 'budget']))
        renderSidebar()

        expect(screen.getByRole('button', { name: 'Cashflow' })).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByRole('button', { name: 'Planning' })).toHaveAttribute('aria-expanded', 'false')
      })

      it('keeps working when storage writes fail', async () => {
        const user = userEvent.setup()
        const originalSetItem = Storage.prototype.setItem
        const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
          this: Storage,
          key: string,
          value: string,
        ) {
          if (key === 'sidebar-open-groups') throw new Error('quota')
          originalSetItem.call(this, key, value)
        })
        renderSidebar({}, '/goal/plans')

        await user.click(screen.getByRole('button', { name: 'Planning' }))

        expect(screen.getByRole('button', { name: 'Planning' })).toHaveAttribute('aria-expanded', 'false')
        setItem.mockRestore()
      })
    })

    describe('collapsed icon rail', () => {
      it('shows no children and no chevrons or aria-expanded, even for the active group', async () => {
        const user = userEvent.setup()
        renderSidebar({}, '/goal/plans')

        await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

        expect(screen.queryAllByRole('link')).toHaveLength(0)
        expect(document.querySelector('.sidebar-chevron')).toBeNull()
        for (const name of groupNames) {
          expect(screen.getByRole('button', { name })).not.toHaveAttribute('aria-expanded')
        }
        expect(screen.getByRole('button', { name: 'Planning' })).toHaveAttribute('aria-current', 'true')
      })

      it('does nothing when the active group icon is clicked', async () => {
        const user = userEvent.setup()
        renderSidebar({}, '/goal/leverage')
        await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

        await user.click(screen.getByRole('button', { name: 'Planning' }))

        expect(currentPath()).toBe('/goal/leverage')
        await user.click(screen.getByRole('button', { name: 'Expand sidebar' }))
        expect(screen.getByRole('button', { name: 'Planning' })).toHaveAttribute('aria-expanded', 'true')
      })

      it('navigates to the default child when another group icon is clicked', async () => {
        const user = userEvent.setup()
        renderSidebar({}, '/goal/leverage')
        await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

        await user.click(screen.getByRole('button', { name: 'Wealth' }))

        expect(currentPath()).toBe('/net-worth/dashboard')
      })

      it('restores children when the sidebar is expanded again', async () => {
        const user = userEvent.setup()
        renderSidebar({}, '/goal/plans')
        await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }))
        await user.click(screen.getByRole('button', { name: 'Expand sidebar' }))

        expect(screen.getByRole('link', { name: 'Taxes' })).toBeInTheDocument()
      })
    })

    describe('navigateTo (mobile close hook)', () => {
      it('is called with the child path on a plain child click, in place of router navigation', async () => {
        const navigateTo = vi.fn()
        const user = userEvent.setup()
        renderSidebar({ navigateTo }, '/goal/plans')

        await user.click(screen.getByRole('link', { name: 'Taxes' }))

        expect(navigateTo).toHaveBeenCalledTimes(1)
        expect(navigateTo).toHaveBeenCalledWith('/taxes')
        expect(currentPath()).toBe('/goal/plans')
      })

      it('is called with the default path when a header navigates', async () => {
        const navigateTo = vi.fn()
        const user = userEvent.setup()
        renderSidebar({ navigateTo })

        await user.click(screen.getByRole('button', { name: 'Cashflow' }))

        expect(navigateTo).toHaveBeenCalledWith('/budget/cashflow')
      })

      it('is not called when a header only toggles expansion', async () => {
        const navigateTo = vi.fn()
        const user = userEvent.setup()
        renderSidebar({ navigateTo }, '/goal/plans')

        await user.click(screen.getByRole('button', { name: 'Planning' }))

        expect(navigateTo).not.toHaveBeenCalled()
      })
    })
  })

  describe('sync integration renders correctly (regression)', () => {
    it('renders without errors when consuming all sync contexts including budget and tax', () => {
      expect(() => renderSidebar()).not.toThrow()
      expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeInTheDocument()
    })

    it('Settings button is functional and opens the settings dialog containing sync controls', async () => {
      const user = userEvent.setup()
      renderSidebar()

      const settingsBtn = screen.getByRole('button', { name: 'Settings' })
      expect(settingsBtn).toBeInTheDocument()

      await user.click(settingsBtn)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('exposes all expected nav links after mounting with full provider tree', () => {
      renderSidebar()

      expect(screen.getByText('Home')).toBeInTheDocument()
      expect(screen.getByText('Planning')).toBeInTheDocument()
      expect(screen.getByText('Wealth')).toBeInTheDocument()
      expect(screen.getByText('Cashflow')).toBeInTheDocument()
      expect(screen.queryByText('Transactions')).not.toBeInTheDocument()
      expect(screen.queryByText('Taxes')).not.toBeInTheDocument()
      expect(screen.getByText('User Guide')).toBeInTheDocument()
    })
  })

  describe('no legacy multi-select or drag UI', () => {
    it('does not render overflow menu buttons', () => {
      renderSidebar()

      expect(document.querySelector('.sidebar-overflow-btn')).toBeNull()
      expect(document.querySelector('.sidebar-overflow-menu')).toBeNull()
      expect(document.querySelector('.sidebar-menu-overlay')).toBeNull()
    })

    it('does not render multi-select bar, checkboxes or draggable elements', () => {
      renderSidebar({}, '/goal/plans')

      expect(document.querySelector('.sidebar-multiselect-bar')).toBeNull()
      expect(document.querySelector('.sidebar-checkbox')).toBeNull()
      expect(document.querySelector('.sidebar-rename-input')).toBeNull()
      expect(document.querySelectorAll('[draggable="true"]')).toHaveLength(0)
    })
  })
})
