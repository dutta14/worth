import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FlagContext, type FlagContextValue } from '../../../flags/FlagContext'
import { FLAGS } from '../../../flags/flagDefinitions'
import type { FlagDefinition, FlagType } from '../../../flags/flagSystem'
import FeaturePreviewsSection from './FeaturePreviewsSection'

const setOverride = vi.fn()
const resetAllOverrides = vi.fn()

const renderSection = (overrides: Record<string, unknown> = {}) => {
  const value: FlagContextValue = {
    resolveFlag: <T extends FlagType>(flag: FlagDefinition<T>) =>
      (flag.id in overrides ? overrides[flag.id] : flag.default) as FlagDefinition<T>['default'],
    overrides,
    rolloutConfig: { version: 1, updatedAt: '', flags: {} },
    setOverride,
    resetAllOverrides,
    saveRolloutConfig: async () => {},
    refresh: async () => {},
    isAdmin: false,
    isLoading: false,
    error: null,
    environment: 'staging',
    clientId: 'test',
  }
  return render(
    <FlagContext.Provider value={value}>
      <FeaturePreviewsSection />
    </FlagContext.Provider>,
  )
}

beforeEach(() => vi.clearAllMocks())

describe('FeaturePreviewsSection', () => {
  it('renders a switch for each preview, all off by default', () => {
    renderSection()
    for (const name of ['Monthly check-in', 'Budget targets', 'Data safety net', 'Annual review', 'Import wizard']) {
      expect(screen.getByRole('switch', { name })).toHaveAttribute('aria-checked', 'false')
    }
  })

  it('shows a preview as on when its override is on', () => {
    renderSection({ [FLAGS.ANNUAL_REVIEW.id]: true })
    expect(screen.getByRole('switch', { name: 'Annual review' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch', { name: 'Import wizard' })).toHaveAttribute('aria-checked', 'false')
  })

  it('turns a preview on by setting an override to true', async () => {
    renderSection()
    await userEvent.click(screen.getByRole('switch', { name: 'Import wizard' }))
    expect(setOverride).toHaveBeenCalledWith(FLAGS.IMPORT_WIZARD.id, true)
  })

  it('turns a preview off by setting an override to false', async () => {
    renderSection({ [FLAGS.MONTHLY_CHECK_IN.id]: true })
    await userEvent.click(screen.getByRole('switch', { name: 'Monthly check-in' }))
    expect(setOverride).toHaveBeenCalledWith(FLAGS.MONTHLY_CHECK_IN.id, false)
  })

  it('hides the reset button when no preview is overridden', () => {
    renderSection({ 'some-other-flag': true })
    expect(screen.queryByRole('button', { name: 'Reset previews to default' })).not.toBeInTheDocument()
  })

  it('resets all overrides from the reset button', async () => {
    renderSection({ [FLAGS.DATA_SAFETY_NET.id]: true })
    await userEvent.click(screen.getByRole('button', { name: 'Reset previews to default' }))
    expect(resetAllOverrides).toHaveBeenCalledOnce()
  })
})
