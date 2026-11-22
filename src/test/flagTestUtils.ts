import type { FlagContextValue } from '../flags/FlagContext'

/** A FlagContext value where the listed flag ids resolve to the given booleans and every other flag keeps its default. */
export const makeFlagContextValue = (
  flags: Record<string, boolean>,
  extra: Pick<FlagContextValue, 'isResolved'> & { overrides?: Record<string, unknown> } = {},
): FlagContextValue => ({
  resolveFlag: ((flag: { id: string; default: unknown }) =>
    flag.id in flags ? flags[flag.id] : flag.default) as FlagContextValue['resolveFlag'],
  overrides: extra.overrides ?? {},
  rolloutConfig: { version: 1, updatedAt: '', flags: {} },
  setOverride: () => {},
  resetAllOverrides: () => {},
  saveRolloutConfig: async () => {},
  refresh: async () => {},
  isAdmin: false,
  isLoading: false,
  error: null,
  environment: 'staging',
  clientId: '',
  isResolved: extra.isResolved,
})
