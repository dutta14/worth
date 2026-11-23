import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import Goal from './Goal'

vi.mock('../../contexts/GoalsContext', () => ({
  useGoals: () => ({
    visibleGoals: [],
    gwGoals: [],
    profile: { birthday: '' },
    createGoal: () => {},
    updateGoal: () => {},
    handleDeleteGoal: () => {},
    handleDeleteWithUndo: () => {},
    reorderGoals: () => {},
    handleCopyGwGoals: () => {},
    createGwGoal: () => {},
    updateGwGoal: () => {},
    deleteGwGoal: () => {},
  }),
}))

vi.mock('../../contexts/LayoutContext', () => ({
  useLayout: () => ({
    handleOpenProfile: () => {},
  }),
}))

function renderGoal(initialRoute = '/goal') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/goal/*" element={<Goal />} />
      </Routes>
    </MemoryRouter>,
  )
}

/* ─── Page header ─── */

describe('Goal page header', () => {
  it('renders the Planning heading', () => {
    renderGoal()
    expect(screen.getByRole('heading', { level: 1, name: 'Planning' })).toBeInTheDocument()
  })

  it('does not render an in-page section tab bar, since sections live in the sidebar', () => {
    renderGoal()
    expect(screen.queryByRole('navigation', { name: 'Planning sections' })).not.toBeInTheDocument()
    for (const name of ['Goals', 'Leverage', 'Pay Down', 'FIRE Calculator', 'Taxes']) {
      expect(screen.queryByRole('link', { name })).not.toBeInTheDocument()
    }
  })
})

/* ─── Header actions visibility ─── */

describe('Goal header actions per tab', () => {
  it('shows the "New Goal" button on /goal', () => {
    renderGoal('/goal')
    const btn = screen.getByRole('button', { name: /new goal/i })
    expect(btn).toBeInTheDocument()
  })

  it('does not show the "New Goal" button on /goal/calculator', () => {
    renderGoal('/goal/calculator')
    const btn = screen.queryByRole('button', { name: /new goal/i })
    expect(btn).not.toBeInTheDocument()
  })
})
