import type { FlagContextValue } from '../flags/FlagContext'

/** A FlagContext value where the listed flag ids resolve to the given booleans and every other flag keeps its default. */
export const makeFlagContextValue = (flags: Record<string, boolean>): FlagContextValue => ({
  resolveFlag: ((flag: { id: string; default: unknown }) =>
    flag.id in flags ? flags[flag.id] : flag.default) as FlagContextValue['resolveFlag'],
  overrides: {},
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
})
