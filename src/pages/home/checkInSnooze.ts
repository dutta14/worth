import { getStorageItem, setStorageItem } from '../../utils/storage'
import { toDayKey, type MonthKey } from '../data/monthStatus'

export const SNOOZE_DAYS = 7

/** `until` is a local 'YYYY-MM-DD'; the strip is snoozed while today is before it. */
export interface CheckInSnooze {
  month: MonthKey
  until: string
}

export const loadSnooze = (): CheckInSnooze | null => getStorageItem('checkin-snooze', null)

export const saveSnooze = (snooze: CheckInSnooze): void => setStorageItem('checkin-snooze', snooze)

export const isSnoozed = (snooze: CheckInSnooze | null, reportingMonth: MonthKey | null, todayKey: string): boolean =>
  snooze !== null && reportingMonth !== null && snooze.month === reportingMonth && todayKey < snooze.until

export const snoozeFor = (reportingMonth: MonthKey, now: Date, days = SNOOZE_DAYS): CheckInSnooze => ({
  month: reportingMonth,
  until: toDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days)),
})
