import type { FlagDefinition, FlagType } from './flagSystem'

/**
 * Registry of feature flags. Add one with `defineFlag()` and register it in `feature-flags.json`.
 * No flags are live right now; shipped features are permanent rather than flagged.
 */
export const FLAGS: Record<string, FlagDefinition<FlagType>> = {}
