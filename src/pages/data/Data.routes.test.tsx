import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Data from './Data'

vi.mock('../../contexts/GoalsContext', () => ({
  useGoals: () => ({
    profile: { name: '', currency: 'USD', locale: 'en-US', dateFormat: 'MMM YYYY' },
  }),
}))

vi.mock('../../contexts/SettingsContext', () => ({
  useSettings: () => ({
    allowCsvImport: false,
  }),
}))

vi.mock('../review/AnnualReview', () => ({
  default: () => <div>Review page</div>,
}))

vi.mock('../../contexts/GitHubSyncContext', () => ({
  useGitHubSyncContext: () => ({
    handleDataChange: () => {},
  }),
}))

vi.mock('../../contexts/DataContext', () => ({
  useData: () => ({
    accounts: [],
    balances: [],
    setAccounts: () => {},
    setBalances: () => {},
  }),
}))

function renderData(initialRoute = '/net-worth/dashboard') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/net-worth/*" element={<Data />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  localStorage.clear()
})

/* ─── Page header ─── */

describe('Wealth page header', () => {
  it('renders the Wealth heading', () => {
    renderData()
    expect(screen.getByRole('heading', { level: 1, name: 'Wealth' })).toBeInTheDocument()
  })

  it('does not render an in-page section tab bar, since sections live in the sidebar', () => {
    renderData()
    expect(screen.queryByRole('navigation', { name: 'Wealth sections' })).not.toBeInTheDocument()
    for (const name of ['Dashboard', 'Allocation', 'Growth', 'Review']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument()
    }
  })
})

/* ─── Route content ─── */

function renderReview(initialRoute: string) {
  return renderData(initialRoute)
}

describe('Wealth routes', () => {
  it('renders the Review page on a review year route', async () => {
    renderReview('/net-worth/review/2025')
    expect(await screen.findByText('Review page')).toBeInTheDocument()
  })

  it('renders the page on /net-worth/review with no year', async () => {
    renderReview('/net-worth/review')
    expect(await screen.findByText('Review page')).toBeInTheDocument()
  })

  it('hides the dashboard view tabs on the Review route', () => {
    renderReview('/net-worth/review/2025')
    expect(screen.queryByRole('tablist', { name: 'Data view' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Growth view mode' })).not.toBeInTheDocument()
  })
})
