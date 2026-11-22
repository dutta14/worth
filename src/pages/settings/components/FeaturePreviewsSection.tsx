import { FC } from 'react'
import { useFlagContext } from '../../../flags/FlagContext'
import { FLAGS } from '../../../flags/flagDefinitions'
import type { FlagDefinition } from '../../../flags/flagSystem'

interface Preview {
  flag: FlagDefinition<'boolean'>
  label: string
  hint: string
}

export const FEATURE_PREVIEWS: Preview[] = [
  {
    flag: FLAGS.MONTHLY_CHECK_IN,
    label: 'Monthly check-in',
    hint: 'A Home strip that finds missing or stale balances, plus partial-month handling.',
  },
  {
    flag: FLAGS.CATEGORY_BUDGET_TARGETS,
    label: 'Budget targets',
    hint: 'Set a monthly target per expense group and see budget vs actual on Cashflow and Home.',
  },
  {
    flag: FLAGS.DATA_SAFETY_NET,
    label: 'Data safety net',
    hint: 'Visible save errors, backups in _backups/, corrupt-file protection and external-change detection.',
  },
  {
    flag: FLAGS.ANNUAL_REVIEW,
    label: 'Annual review',
    hint: 'A printable Review tab under Wealth with a CSV export.',
  },
  {
    flag: FLAGS.IMPORT_WIZARD,
    label: 'Import wizard',
    hint: 'Guided CSV import with column mapping, rules, duplicate skipping and undo.',
  },
]

const FeaturePreviewsSection: FC = () => {
  const { resolveFlag, overrides, setOverride, resetAllOverrides } = useFlagContext()
  const hasOverrides = FEATURE_PREVIEWS.some(({ flag }) => flag.id in overrides)

  return (
    <div className="settings-feature-previews">
      <h4 className="settings-subheading">Feature previews</h4>
      <p className="settings-description">
        New features that are still being rolled out. Switching one on here affects only this browser.
      </p>
      {FEATURE_PREVIEWS.map(({ flag, label, hint }) => {
        const on = resolveFlag(flag)
        return (
          <div className="settings-toggle-row" key={flag.id}>
            <div>
              <span className="settings-toggle-label">{label}</span>
              <span className="settings-toggle-hint">{hint}</span>
            </div>
            <button
              className={`settings-toggle-switch${on ? ' on' : ''}`}
              onClick={() => setOverride(flag.id, !on)}
              role="switch"
              aria-checked={on}
              aria-label={label}
            >
              <span className="settings-toggle-knob" />
            </button>
          </div>
        )
      })}
      {hasOverrides && (
        <button
          type="button"
          className="settings-btn settings-btn--outline settings-feature-previews-reset"
          onClick={resetAllOverrides}
        >
          Reset previews to default
        </button>
      )}
    </div>
  )
}

export default FeaturePreviewsSection
