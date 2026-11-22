import { useContext } from 'react'
import { FlagContext } from './FlagContext'
import type { FlagDefinition, FlagType } from './flagSystem'

export function useFlag<T extends FlagType>(flag: FlagDefinition<T>): FlagDefinition<T>['default'] {
  const { resolveFlag } = useContext(FlagContext)
  return resolveFlag(flag)
}

/** True once the flag's value can be trusted: a local override is synchronous, otherwise wait for the rollout config. */
export function useFlagResolved<T extends FlagType>(flag: FlagDefinition<T>): boolean {
  const { isResolved, overrides } = useContext(FlagContext)
  return isResolved !== false || flag.id in overrides
}
