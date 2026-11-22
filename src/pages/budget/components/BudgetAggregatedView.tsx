import { FC, useState } from 'react'
import { CategoryGroup, TimePeriod } from '../types'
import { shortMonthName, buildMonthKey } from '../utils/csvParser'
import { evaluatePeriod, monthlyTargetFor } from '../utils/budgetTargets'
import type { BudgetTargetsFile } from '../utils/budgetTargets'
import BudgetTargetCell from './BudgetTargetCell'
import BudgetTargetStatus from './BudgetTargetStatus'
import '../../../styles/BudgetTargets.css'

export interface BudgetTargetsConfig {
  targets: BudgetTargetsFile
  monthsWithData: ReadonlySet<string>
  nowMonthKey: string
  /** True when targets.json could not be read: targets are not applied and editing is off. */
  readOnly: boolean
  /** Live-region text for the latest change or failure. */
  message: string
  /** Changes on every announcement; keys the message so identical consecutive texts are re-announced. */
  messageId: number
  onSetTarget: (groupId: string, label: string, value: number | null) => Promise<{ ok: boolean }>
}

interface BudgetAggregatedViewProps {
  year: number
  type: 'income' | 'expense'
  categoryGroups: CategoryGroup[]
  categorySums: Record<string, Record<string, number>>
  timePeriod: TimePeriod
  incomeCategoryGroups?: CategoryGroup[]
  /** Present only when the targets flag is on and the Expenses tab is shown; absent renders the original table. */
  targetsConfig?: BudgetTargetsConfig
}

const TARGETS_INTRO = 'Set a monthly target on any group to see how each month compares.'
const TARGETS_NOTE =
  'Targets are monthly. Changing one applies from this month on; earlier months keep the target that applied then.'
const TARGETS_UNREADABLE =
  "Your targets file couldn't be read, so targets are turned off to keep it safe. The file is budget/targets.json in your data folder."

const fmt = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })

const BudgetAggregatedView: FC<BudgetAggregatedViewProps> = ({
  year,
  type,
  categoryGroups,
  categorySums,
  timePeriod,
  incomeCategoryGroups,
  targetsConfig,
}) => {
  const targetsOn = type === 'expense' && targetsConfig !== undefined
  const months = Array.from({ length: 12 }, (_, i) => buildMonthKey(year, i))

  const periods: { label: string; monthKeys: string[] }[] = (() => {
    if (timePeriod === 'quarter') {
      return [
        { label: 'Q1', monthKeys: months.slice(0, 3) },
        { label: 'Q2', monthKeys: months.slice(3, 6) },
        { label: 'Q3', monthKeys: months.slice(6, 9) },
        { label: 'Q4', monthKeys: months.slice(9, 12) },
      ]
    }
    if (timePeriod === 'half') {
      return [
        { label: 'H1', monthKeys: months.slice(0, 6) },
        { label: 'H2', monthKeys: months.slice(6, 12) },
      ]
    }
    return months.map((m, i) => ({ label: shortMonthName(i), monthKeys: [m] }))
  })()

  // If a category has ANY negative month, it's an expense (positives are refunds).
  const isTypeCategory = (cat: string): boolean => {
    const monthValues = Object.values(categorySums[cat] || {})
    const hasNegative = monthValues.some(v => v < 0)
    if (type === 'expense') return hasNegative
    return !hasNegative && monthValues.some(v => v > 0)
  }

  const hasTarget = (id: string): boolean => targetsOn && Object.hasOwn(targetsConfig.targets.groups, id)

  const relevantGroups: { id: string; name: string; categories: string[] }[] = (
    type === 'income' ? incomeCategoryGroups || [] : categoryGroups
  )
    .map(g => ({
      ...g,
      categories: g.categories.filter(c => isTypeCategory(c)),
    }))
    .filter(g => g.categories.length > 0 || hasTarget(g.id))

  const getGroupPeriodTotal = (group: { categories: string[] }, period: { monthKeys: string[] }): number => {
    let total = 0
    period.monthKeys.forEach(m => {
      group.categories.forEach(cat => {
        total += categorySums[cat]?.[m] || 0
      })
    })
    return total
  }

  const getGroupYearTotal = (group: { categories: string[] }): number => {
    let total = 0
    months.forEach(m => {
      group.categories.forEach(cat => {
        total += categorySums[cat]?.[m] || 0
      })
    })
    return total
  }

  const grandTotal = (): number => {
    let total = 0
    relevantGroups.forEach(g => {
      total += getGroupYearTotal(g)
    })
    return total
  }

  const getGroupPct = (group: { categories: string[] }): string => {
    const gt = Math.abs(grandTotal())
    if (gt === 0) return ''
    return `${((Math.abs(getGroupYearTotal(group)) / gt) * 100).toFixed(1)}%`
  }

  const evaluateGroup = (group: { id: string; categories: string[] }, monthKeys: string[]) =>
    targetsOn
      ? evaluatePeriod({
          record: targetsConfig.targets.groups[group.id],
          monthKeys,
          monthsWithData: targetsConfig.monthsWithData,
          signedNetFor: m => group.categories.reduce((sum, cat) => sum + (categorySums[cat]?.[m] || 0), 0),
          nowMonth: targetsConfig.nowMonthKey,
        })
      : null

  const [showPct, setShowPct] = useState(false)

  return (
    <div className="budget-table-section">
      <h3 className="budget-table-title">{type === 'income' ? 'Income' : 'Expenses'}</h3>
      {targetsOn && targetsConfig.readOnly && (
        <div className="budget-target-alert" role="alert">
          {TARGETS_UNREADABLE}
        </div>
      )}
      {targetsOn && !targetsConfig.readOnly && !categoryGroups.some(g => hasTarget(g.id)) && (
        <p className="budget-target-intro">{TARGETS_INTRO}</p>
      )}
      <div className="budget-table-wrapper">
        <table
          className={`budget-table${targetsOn ? ` budget-table--targets${timePeriod === 'month' ? ' budget-table--targets-months' : ''}` : ''}`}
        >
          <thead>
            <tr>
              <th className="budget-th budget-th--category">Group</th>
              {periods.map(p => (
                <th key={p.label} className="budget-th budget-th--month">
                  {p.label}
                </th>
              ))}
              <th
                className="budget-th budget-th--total budget-th--switchable"
                onClick={() => setShowPct(p => !p)}
                title="Click to toggle Total / %"
              >
                {showPct ? '%' : 'Total'}
              </th>
              {targetsOn && (
                <>
                  <th scope="col" className="budget-th budget-th--target">
                    Monthly target
                  </th>
                  <th scope="col" className="budget-th budget-th--vs">
                    Vs target
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {[...relevantGroups]
              .sort((a, b) => Math.abs(getGroupYearTotal(b)) - Math.abs(getGroupYearTotal(a)))
              .map(group => {
                const yearTotal = getGroupYearTotal(group)
                return (
                  <tr key={group.id} className="budget-tr--agg-row">
                    <td className="budget-td budget-td--category" title={targetsOn ? group.name : undefined}>
                      <strong>{group.name}</strong>
                    </td>
                    {periods.map(p => {
                      const val = getGroupPeriodTotal(group, p)
                      return (
                        <td
                          key={p.label}
                          className={`budget-td budget-td--number${type === 'expense' && val > 0 ? ' refund' : ''}`}
                        >
                          {val !== 0 ? fmt(Math.abs(val)) : ''}
                          {targetsOn && (
                            <BudgetTargetStatus result={evaluateGroup(group, p.monthKeys)} variant="period" />
                          )}
                        </td>
                      )
                    })}
                    <td
                      className={`budget-td ${showPct ? 'budget-td--pct' : `budget-td--number${type === 'expense' && yearTotal > 0 ? ' refund' : ''}`}`}
                    >
                      <strong>{showPct ? getGroupPct(group) : yearTotal !== 0 ? fmt(Math.abs(yearTotal)) : ''}</strong>
                    </td>
                    {targetsOn && (
                      <>
                        <td className="budget-td budget-td--target">
                          <BudgetTargetCell
                            groupName={group.name}
                            current={monthlyTargetFor(
                              targetsConfig.targets.groups[group.id],
                              targetsConfig.nowMonthKey,
                            )}
                            disabled={targetsConfig.readOnly}
                            onSave={value => targetsConfig.onSetTarget(group.id, group.name, value)}
                          />
                        </td>
                        <td className="budget-td budget-td--vs">
                          <BudgetTargetStatus result={evaluateGroup(group, months)} variant="full" />
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            {relevantGroups.length > 0 && (
              <tr className="budget-tr--grand-total">
                <td className="budget-td budget-td--category">
                  <strong>Grand Total</strong>
                </td>
                {periods.map(p => {
                  let periodTotal = 0
                  relevantGroups.forEach(g => {
                    periodTotal += getGroupPeriodTotal(g, p)
                  })
                  return (
                    <td key={p.label} className="budget-td budget-td--number">
                      <strong>{periodTotal !== 0 ? fmt(Math.abs(periodTotal)) : ''}</strong>
                    </td>
                  )
                })}
                <td className={`budget-td ${showPct ? 'budget-td--pct' : 'budget-td--number'}`}>
                  <strong>{showPct ? '100%' : fmt(Math.abs(grandTotal()))}</strong>
                </td>
                {targetsOn && (
                  <>
                    <td className="budget-td budget-td--target" />
                    <td className="budget-td budget-td--vs" />
                  </>
                )}
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {targetsOn && (
        <>
          <p className="budget-target-note">{TARGETS_NOTE}</p>
          <div className="sr-only" role="status" aria-live="polite">
            <span key={targetsConfig.messageId}>{targetsConfig.message}</span>
          </div>
        </>
      )}
    </div>
  )
}

export default BudgetAggregatedView
