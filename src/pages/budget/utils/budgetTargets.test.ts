import { describe, it, expect } from 'vitest'
import {
  parseTargetInput,
  normalizeTargetsFile,
  monthlyTargetFor,
  setGroupTarget,
  pruneTargets,
  evaluatePeriod,
  formatTargetStatus,
  summarizeGroups,
  sumByCategory,
  emptyTargetsFile,
} from './budgetTargets'
import type { BudgetTargetsFile, GroupTargetRecord, MonthKey, TargetResult } from './budgetTargets'

const NOW: MonthKey = '2026-11'

const monthsOf = (year: number, from = 1, to = 12): MonthKey[] =>
  Array.from({ length: to - from + 1 }, (_, i) => `${year}-${String(from + i).padStart(2, '0')}`)

const flat = (monthly: number): GroupTargetRecord => ({ history: [{ from: null, monthly }] })

/** Evaluates `record` over `monthKeys`, with `spendByMonth` as the positive amount spent in each month with data. */
function evaluate(
  record: GroupTargetRecord | undefined,
  monthKeys: MonthKey[],
  spendByMonth: Record<MonthKey, number>,
  nowMonth: MonthKey = NOW,
): TargetResult | null {
  return evaluatePeriod({
    record,
    monthKeys,
    monthsWithData: new Set(Object.keys(spendByMonth)),
    signedNetFor: month => -(spendByMonth[month] ?? 0),
    nowMonth,
  })
}

const evenly = (year: number, total: number, months = 12): Record<MonthKey, number> =>
  Object.fromEntries(monthsOf(year, 1, months).map(m => [m, total / months]))

const text = (r: TargetResult | null) => (r ? formatTargetStatus(r).text : null)

describe('parseTargetInput', () => {
  it.each([
    ['500', 500],
    ['$1,250.50', 1250.5],
    ['0', 0],
    [' 12 ', 12],
    ['$0.5', 0.5],
    ['9999999.99', 9999999.99],
    ['1,000,000', 1000000],
  ])('accepts %j as %d', (raw, value) => {
    expect(parseTargetInput(raw)).toEqual({ ok: true, value })
  })

  it.each([[''], ['   ']])('treats blank input %j as clear', raw => {
    expect(parseTargetInput(raw)).toEqual({ ok: true, value: null })
  })

  it.each([['-5'], ['-$5'], ['-0'], ['-1,250.50']])('rejects %j as negative', raw => {
    expect(parseTargetInput(raw)).toEqual({ ok: false, reason: 'negative' })
  })

  it.each([
    ['abc'],
    ['1e3'],
    ['5.005'],
    ['USD 500'],
    ['$ 5'],
    ['5.'],
    ['.5'],
    ['1,25'],
    ['12,34,567'],
    ['１２３'],
    ['$-5'],
    ['- 5'],
    ['-abc'],
    ['-'],
  ])('rejects %j as invalid', raw => {
    expect(parseTargetInput(raw)).toEqual({ ok: false, reason: 'invalid' })
  })

  it.each([['10000000'], ['10,000,000.00'], ['$12,345,678']])('rejects %j as too large', raw => {
    expect(parseTargetInput(raw)).toEqual({ ok: false, reason: 'too-large' })
  })
})

describe('normalizeTargetsFile', () => {
  it.each([[undefined], [null], ['x'], [42], [[]], [{}], [{ version: 1 }], [{ version: 1, groups: [] }]])(
    'returns null (unreadable) for %j',
    raw => {
      expect(normalizeTargetsFile(raw)).toBeNull()
    },
  )

  it.each([[2], [99], [0], ['1'], [null]])('returns null for version %j', version => {
    expect(normalizeTargetsFile({ version, groups: {} })).toBeNull()
  })

  it('accepts a missing version as version 1', () => {
    expect(normalizeTargetsFile({ groups: {} })).toEqual({ version: 1, groups: {} })
  })

  it('keeps a valid file unchanged', () => {
    const file = {
      version: 1,
      groups: {
        dining: {
          label: 'Dining',
          history: [
            { from: null, monthly: 500 },
            { from: '2026-11', monthly: 600 },
          ],
        },
        travel: {
          history: [
            { from: null, monthly: 300 },
            { from: '2026-09', monthly: null },
          ],
        },
      },
    }
    expect(normalizeTargetsFile(file)).toEqual(file)
  })

  it('drops groups whose record or history is malformed', () => {
    const result = normalizeTargetsFile({
      version: 1,
      groups: {
        ok: flat(10),
        notAnObject: 5,
        noHistory: { label: 'x' },
        historyNotArray: { history: {} },
        emptyHistory: { history: [] },
        allBad: { history: [{ from: 'nope', monthly: 1 }] },
      },
    })
    expect(Object.keys(result!.groups)).toEqual(['ok'])
  })

  it('drops bad entries and keeps the good ones', () => {
    const result = normalizeTargetsFile({
      version: 1,
      groups: {
        g: {
          history: [
            { from: null, monthly: 100 },
            { from: '2026-13', monthly: 1 },
            { from: '2026-1', monthly: 1 },
            { from: 202611, monthly: 1 },
            { from: '2026-02', monthly: -1 },
            { from: '2026-03', monthly: '5' },
            { from: '2026-04', monthly: Infinity },
            { from: '2026-05', monthly: 10_000_000 },
            { from: '2026-06' },
            'junk',
            null,
            { from: '2026-07', monthly: 200 },
          ],
        },
      },
    })
    expect(result!.groups.g.history).toEqual([
      { from: null, monthly: 100 },
      { from: '2026-07', monthly: 200 },
    ])
  })

  it('sorts entries ascending with the null entry first', () => {
    const result = normalizeTargetsFile({
      version: 1,
      groups: {
        g: {
          history: [
            { from: '2026-09', monthly: 3 },
            { from: null, monthly: 1 },
            { from: '2026-03', monthly: 2 },
          ],
        },
      },
    })
    expect(result!.groups.g.history.map(e => e.from)).toEqual([null, '2026-03', '2026-09'])
  })

  it('keeps dated entries in order whether they arrive ascending or descending', () => {
    const history = (froms: MonthKey[]) => froms.map((from, i) => ({ from, monthly: i }))
    const sorted = (froms: MonthKey[]) =>
      normalizeTargetsFile({ version: 1, groups: { g: { history: history(froms) } } })!.groups.g.history.map(
        e => e.from,
      )
    expect(sorted(['2026-01', '2026-03', '2026-09'])).toEqual(['2026-01', '2026-03', '2026-09'])
    expect(sorted(['2026-09', '2026-03', '2026-01'])).toEqual(['2026-01', '2026-03', '2026-09'])
  })

  it('lets the last entry win when a from value is duplicated', () => {
    const result = normalizeTargetsFile({
      version: 1,
      groups: {
        g: {
          history: [
            { from: null, monthly: 1 },
            { from: '2026-03', monthly: 2 },
            { from: null, monthly: 9 },
            { from: '2026-03', monthly: 4 },
          ],
        },
      },
    })
    expect(result!.groups.g.history).toEqual([
      { from: null, monthly: 9 },
      { from: '2026-03', monthly: 4 },
    ])
  })

  it('rounds amounts to cents', () => {
    const result = normalizeTargetsFile({ version: 1, groups: { g: { history: [{ from: null, monthly: 10.004 }] } } })
    expect(result!.groups.g.history[0].monthly).toBe(10)
  })

  it('ignores a non-string label', () => {
    const result = normalizeTargetsFile({
      version: 1,
      groups: { g: { label: 5, history: [{ from: null, monthly: 1 }] } },
    })
    expect(result!.groups.g).toEqual({ history: [{ from: null, monthly: 1 }] })
  })

  it('keeps a group id of __proto__ as an own key without touching the prototype', () => {
    const raw = JSON.parse('{"version":1,"groups":{"__proto__":{"history":[{"from":null,"monthly":1}]}}}')
    const result = normalizeTargetsFile(raw)!
    expect(Object.keys(result.groups)).toEqual(['__proto__'])
    expect(Object.getPrototypeOf(result.groups)).toBe(Object.prototype)
  })

  it('does not mutate its input', () => {
    const raw = {
      version: 1,
      groups: {
        g: {
          history: [
            { from: '2026-09', monthly: 3 },
            { from: null, monthly: 1 },
          ],
        },
      },
    }
    const copy = structuredClone(raw)
    normalizeTargetsFile(raw)
    expect(raw).toEqual(copy)
  })
})

describe('monthlyTargetFor', () => {
  const rec: GroupTargetRecord = {
    history: [
      { from: null, monthly: 500 },
      { from: '2026-11', monthly: 600 },
      { from: '2027-02', monthly: null },
    ],
  }

  it('returns null without a record', () => {
    expect(monthlyTargetFor(undefined, NOW)).toBeNull()
  })

  it('applies the null entry to every earlier month', () => {
    expect(monthlyTargetFor(rec, '2020-01')).toBe(500)
    expect(monthlyTargetFor(rec, '2026-10')).toBe(500)
  })

  it('switches to the new value in the month it starts', () => {
    expect(monthlyTargetFor(rec, '2026-11')).toBe(600)
    expect(monthlyTargetFor(rec, '2027-01')).toBe(600)
  })

  it('returns null from the month a target was cleared', () => {
    expect(monthlyTargetFor(rec, '2027-02')).toBeNull()
    expect(monthlyTargetFor(rec, '2030-01')).toBeNull()
  })

  it('returns null before the first dated entry when there is no null entry', () => {
    expect(monthlyTargetFor({ history: [{ from: '2026-05', monthly: 100 }] }, '2026-04')).toBeNull()
    expect(monthlyTargetFor({ history: [{ from: '2026-05', monthly: 100 }] }, '2026-05')).toBe(100)
  })

  it('treats 0 as a real target', () => {
    expect(monthlyTargetFor(flat(0), NOW)).toBe(0)
  })
})

describe('setGroupTarget', () => {
  const file = (groups: BudgetTargetsFile['groups']): BudgetTargetsFile => ({ version: 1, groups })

  it('stores the first target with from null and the label', () => {
    expect(setGroupTarget(emptyTargetsFile(), 'dining', 'Dining', 500, NOW)).toEqual(
      file({ dining: { label: 'Dining', history: [{ from: null, monthly: 500 }] } }),
    )
  })

  it('stores 0 as a target', () => {
    const result = setGroupTarget(emptyTargetsFile(), 'others', 'Others', 0, NOW)
    expect(result.groups.others.history).toEqual([{ from: null, monthly: 0 }])
  })

  it('adds an entry starting at the current month when the value changes', () => {
    const result = setGroupTarget(file({ d: flat(500) }), 'd', 'Dining', 600, NOW)
    expect(result.groups.d.history).toEqual([
      { from: null, monthly: 500 },
      { from: NOW, monthly: 600 },
    ])
  })

  it('keeps earlier months judged against the old target after a change', () => {
    const result = setGroupTarget(file({ d: flat(500) }), 'd', 'Dining', 600, NOW)
    expect(monthlyTargetFor(result.groups.d, '2026-10')).toBe(500)
    expect(monthlyTargetFor(result.groups.d, NOW)).toBe(600)
  })

  it('replaces the entry of the current month on a second change', () => {
    const first = setGroupTarget(file({ d: flat(500) }), 'd', 'Dining', 600, NOW)
    const second = setGroupTarget(first, 'd', 'Dining', 700, NOW)
    expect(second.groups.d.history).toEqual([
      { from: null, monthly: 500 },
      { from: NOW, monthly: 700 },
    ])
  })

  it('merges consecutive entries with equal values', () => {
    const first = setGroupTarget(file({ d: flat(500) }), 'd', 'Dining', 600, NOW)
    const back = setGroupTarget(first, 'd', 'Dining', 500, NOW)
    expect(back.groups.d.history).toEqual([{ from: null, monthly: 500 }])
  })

  it('does not add an entry when the value is unchanged', () => {
    const result = setGroupTarget(file({ d: flat(500) }), 'd', 'Dining', 500, NOW)
    expect(result.groups.d.history).toEqual([{ from: null, monthly: 500 }])
  })

  it('never modifies entries before the current month', () => {
    const history = [
      { from: null, monthly: 100 },
      { from: '2026-03', monthly: 200 },
    ]
    const result = setGroupTarget(file({ d: { history } }), 'd', 'Dining', 300, NOW)
    expect(result.groups.d.history.slice(0, 2)).toEqual(history)
  })

  it('drops hand-written entries dated after the current month', () => {
    const rec: GroupTargetRecord = {
      history: [
        { from: null, monthly: 100 },
        { from: '2027-01', monthly: 999 },
      ],
    }
    const result = setGroupTarget(file({ d: rec }), 'd', 'Dining', 300, NOW)
    expect(result.groups.d.history).toEqual([
      { from: null, monthly: 100 },
      { from: NOW, monthly: 300 },
    ])
  })

  it('keeps the first dated entry dated when the record had no null entry', () => {
    const rec: GroupTargetRecord = { history: [{ from: NOW, monthly: 100 }] }
    const result = setGroupTarget(file({ d: rec }), 'd', 'Dining', 300, NOW)
    expect(result.groups.d.history).toEqual([{ from: NOW, monthly: 300 }])
  })

  it('deletes the record when clearing a group that only has the null entry', () => {
    const result = setGroupTarget(file({ d: flat(500), e: flat(1) }), 'd', 'Dining', null, NOW)
    expect(Object.keys(result.groups)).toEqual(['e'])
  })

  it('appends a null entry from the current month when clearing a group with history', () => {
    const rec: GroupTargetRecord = {
      history: [
        { from: null, monthly: 500 },
        { from: '2026-03', monthly: 600 },
      ],
    }
    const result = setGroupTarget(file({ d: rec }), 'd', 'Dining', null, NOW)
    expect(result.groups.d.history).toEqual([...rec.history, { from: NOW, monthly: null }])
    expect(monthlyTargetFor(result.groups.d, '2026-10')).toBe(600)
    expect(monthlyTargetFor(result.groups.d, NOW)).toBeNull()
  })

  it('deletes the record when a clear leaves no target anywhere', () => {
    const rec: GroupTargetRecord = { history: [{ from: NOW, monthly: 100 }] }
    const result = setGroupTarget(file({ d: rec }), 'd', 'Dining', null, NOW)
    expect(result.groups).toEqual({})
  })

  it('leaves the file equal when clearing a group that has no record', () => {
    const start = file({ e: flat(1) })
    expect(setGroupTarget(start, 'd', 'Dining', null, NOW)).toEqual(start)
  })

  it('does not append a second clear when the target is already cleared', () => {
    const rec: GroupTargetRecord = {
      history: [
        { from: null, monthly: 500 },
        { from: '2026-09', monthly: null },
      ],
    }
    const result = setGroupTarget(file({ d: rec }), 'd', 'Dining', null, NOW)
    expect(result.groups.d.history).toEqual(rec.history)
  })

  it('starts a new entry after a clear', () => {
    const rec: GroupTargetRecord = {
      history: [
        { from: null, monthly: 500 },
        { from: '2026-09', monthly: null },
      ],
    }
    const result = setGroupTarget(file({ d: rec }), 'd', 'Dining', 400, NOW)
    expect(result.groups.d.history).toEqual([...rec.history, { from: NOW, monthly: 400 }])
  })

  it('refreshes the label on write', () => {
    const start = file({ d: { label: 'Old', history: [{ from: null, monthly: 500 }] } })
    expect(setGroupTarget(start, 'd', 'New', 600, NOW).groups.d.label).toBe('New')
  })

  it('never mutates its input', () => {
    const start = file({ d: { label: 'Dining', history: [{ from: null, monthly: 500 }] } })
    const copy = structuredClone(start)
    setGroupTarget(start, 'd', 'Dining', 600, NOW)
    setGroupTarget(start, 'd', 'Dining', null, NOW)
    setGroupTarget(start, 'new', 'New', 1, NOW)
    expect(start).toEqual(copy)
  })

  it('does not treat inherited properties as an existing record', () => {
    const result = setGroupTarget(emptyTargetsFile(), 'constructor', 'Odd', 5, NOW)
    expect(result.groups.constructor).toEqual({ label: 'Odd', history: [{ from: null, monthly: 5 }] })
  })
})

describe('pruneTargets', () => {
  const start: BudgetTargetsFile = { version: 1, groups: { a: flat(1), b: flat(2), c: flat(3) } }

  it('removes groups that are not valid ids', () => {
    expect(Object.keys(pruneTargets(start, new Set(['a', 'c'])).groups)).toEqual(['a', 'c'])
  })

  it('returns the same file when nothing needs pruning', () => {
    expect(pruneTargets(start, new Set(['a', 'b', 'c', 'd']))).toBe(start)
  })

  it('does not mutate its input', () => {
    pruneTargets(start, new Set())
    expect(Object.keys(start.groups)).toEqual(['a', 'b', 'c'])
  })
})

describe('evaluatePeriod worked examples', () => {
  it('1: under for a completed year ($5,880 against $500 a month)', () => {
    const r = evaluate(flat(500), monthsOf(2025), evenly(2025, 5880))
    expect(text(r)).toBe('$120 under')
    expect(r).toMatchObject({ status: 'under', inProgress: false, monthsCounted: 12, monthsInPeriod: 12 })
    expect(formatTargetStatus(r!).icon).toBe('down')
  })

  it('2: over in a single month ($620 against $500 in Jun 2026)', () => {
    const r = evaluate(flat(500), ['2026-06'], { '2026-06': 620 })
    expect(text(r)).toBe('$120 over')
    expect(formatTargetStatus(r!).icon).toBe('up')
  })

  it('3: exactly on target ($6,000 against $500 a month)', () => {
    const r = evaluate(flat(500), monthsOf(2025), evenly(2025, 6000))
    expect(text(r)).toBe('On target')
    expect(formatTargetStatus(r!).icon).toBe('check')
  })

  it('4: no target gives no result', () => {
    expect(evaluate(undefined, monthsOf(2025), evenly(2025, 400))).toBeNull()
  })

  it('5a: a zero target with nothing spent is on target', () => {
    expect(text(evaluate(flat(0), monthsOf(2025), evenly(2025, 0)))).toBe('On target')
  })

  it('5b: a zero target with $25 spent is $25 over', () => {
    expect(text(evaluate(flat(0), monthsOf(2025), evenly(2025, 25)))).toBe('$25 over')
  })

  it('6: quarterly view scales the target to $1,500 and reads $210 over', () => {
    const r = evaluate(flat(500), monthsOf(2026, 1, 3), { '2026-01': 570, '2026-02': 570, '2026-03': 570 })
    expect(r).toMatchObject({ targetDollars: 1500, spendDollars: 1710 })
    expect(text(r)).toBe('$210 over')
  })

  it('7a: an in-progress month under target reads "$200 left" and counts 1 of 12 months', () => {
    const r = evaluate(flat(500), monthsOf(2026), { '2026-11': 300 })
    expect(text(r)).toBe('$200 left')
    expect(r).toMatchObject({ inProgress: true, monthsCounted: 1, monthsInPeriod: 12 })
  })

  it('7b: an in-progress month over target reads "$20 over"', () => {
    const r = evaluate(flat(500), monthsOf(2026), { '2026-11': 520 })
    expect(text(r)).toBe('$20 over')
    expect(r!.inProgress).toBe(true)
  })

  it('8: a net refund gives "$540 under" and counts 1 of 12 months', () => {
    const r = evaluatePeriod({
      record: flat(500),
      monthKeys: monthsOf(2025),
      monthsWithData: new Set(['2025-03']),
      signedNetFor: () => 40,
      nowMonth: NOW,
    })
    expect(text(r)).toBe('$540 under')
    expect(r).toMatchObject({ spendDollars: -40, targetDollars: 500, monthsCounted: 1, monthsInPeriod: 12 })
  })

  it('9: a partial year compares only the 4 months with data ($300 over, 4 of 12)', () => {
    const r = evaluate(flat(500), monthsOf(2025), {
      '2025-01': 575,
      '2025-02': 575,
      '2025-03': 575,
      '2025-04': 575,
    })
    expect(text(r)).toBe('$300 over')
    expect(r).toMatchObject({ monthsCounted: 4, monthsInPeriod: 12 })
  })

  it('10a: $500.40 against $500 rounds to on target', () => {
    expect(text(evaluate(flat(500), ['2025-05'], { '2025-05': 500.4 }))).toBe('On target')
  })

  it('10b: $500.60 against $500 reads $1 over', () => {
    expect(text(evaluate(flat(500), ['2025-05'], { '2025-05': 500.6 }))).toBe('$1 over')
  })

  it('11: a target changed in November uses $500 for October and $600 for November', () => {
    const record: GroupTargetRecord = {
      history: [
        { from: null, monthly: 500 },
        { from: '2026-11', monthly: 600 },
      ],
    }
    const r = evaluate(record, monthsOf(2026), { '2026-10': 500, '2026-11': 500 })
    expect(r).toMatchObject({ targetDollars: 1100, spendDollars: 1000, monthsCounted: 2, monthsInPeriod: 12 })
    expect(text(r)).toBe('$100 left')
  })

  it('11: the Q4 period cell does not turn October over after the change', () => {
    const record: GroupTargetRecord = {
      history: [
        { from: null, monthly: 500 },
        { from: '2026-11', monthly: 600 },
      ],
    }
    const r = evaluate(record, ['2026-10', '2026-11', '2026-12'], { '2026-10': 500, '2026-11': 500 })
    expect(r!.status).not.toBe('over')
  })

  it('12: half-year view scales the target to $3,000 and reads $400 over', () => {
    const r = evaluate(flat(500), monthsOf(2026, 1, 6), evenly(2026, 3400, 6))
    expect(r).toMatchObject({ targetDollars: 3000, spendDollars: 3400 })
    expect(text(r)).toBe('$400 over')
  })
})

describe('evaluatePeriod edge cases', () => {
  it('excludes months without data from both target and spend', () => {
    const r = evaluate(flat(500), ['2025-01', '2025-02', '2025-03'], { '2025-01': 100, '2025-03': 100 })
    expect(r).toMatchObject({ targetDollars: 1000, spendDollars: 200, monthsCounted: 2, monthsInPeriod: 3 })
  })

  it('returns null when no month in the period has data', () => {
    expect(evaluate(flat(500), monthsOf(2025), {})).toBeNull()
  })

  it('returns null when the months with data are outside the period', () => {
    expect(evaluate(flat(500), monthsOf(2025, 1, 3), { '2025-07': 10 })).toBeNull()
  })

  it('returns null for an empty period', () => {
    expect(evaluate(flat(500), [], { '2025-07': 10 })).toBeNull()
  })

  it('excludes months where the target is cleared', () => {
    const record: GroupTargetRecord = {
      history: [
        { from: null, monthly: 500 },
        { from: '2025-03', monthly: null },
      ],
    }
    const r = evaluate(record, monthsOf(2025, 1, 4), evenly(2025, 400, 4))
    expect(r).toMatchObject({ monthsCounted: 2, targetDollars: 1000, spendDollars: 200 })
  })

  it('is not in progress when the current month is not counted', () => {
    expect(evaluate(flat(500), monthsOf(2026), { '2026-10': 100 })!.inProgress).toBe(false)
  })

  it('is in progress only when the counted months include the current month', () => {
    const record: GroupTargetRecord = { history: [{ from: '2026-01', monthly: 500 }] }
    expect(evaluate(record, monthsOf(2026), { '2026-10': 100 }, '2026-10')!.inProgress).toBe(true)
    expect(evaluate(record, monthsOf(2026), { '2026-10': 100 }, '2026-11')!.inProgress).toBe(false)
  })

  it('is not in progress when the current month has no target', () => {
    const record: GroupTargetRecord = {
      history: [
        { from: null, monthly: 500 },
        { from: NOW, monthly: null },
      ],
    }
    expect(evaluate(record, monthsOf(2026), { '2026-10': 100, [NOW]: 100 })!.inProgress).toBe(false)
  })

  it('sums float amounts in integer cents (0.1 + 0.2 is 0.30)', () => {
    const r = evaluatePeriod({
      record: flat(0),
      monthKeys: ['2025-01'],
      monthsWithData: new Set(['2025-01']),
      signedNetFor: () => -(0.1 + 0.2),
      nowMonth: NOW,
    })
    expect(r).toMatchObject({ spendDollars: 0, status: 'on-target' })
  })

  it('rounds half a dollar away from zero for spend and target', () => {
    expect(evaluate(flat(0), ['2025-01'], { '2025-01': 0.5 })).toMatchObject({ spendDollars: 1, status: 'over' })
    const refund = evaluatePeriod({
      record: flat(0),
      monthKeys: ['2025-01'],
      monthsWithData: new Set(['2025-01']),
      signedNetFor: () => 0.5,
      nowMonth: NOW,
    })
    expect(refund).toMatchObject({ spendDollars: -1, deltaDollars: 1, status: 'under' })
    expect(evaluate(flat(10.5), ['2025-01'], { '2025-01': 11 })).toMatchObject({
      targetDollars: 11,
      status: 'on-target',
    })
  })

  it('does not report negative zero for a month with no net amount', () => {
    const r = evaluate(flat(0), ['2025-01'], { '2025-01': 0 })
    expect(Object.is(r!.spendDollars, 0)).toBe(true)
  })

  it.each([0.3, 0.125])(
    'reports positive zero spend and on-target for a net credit of $%s against a $0 target',
    credit => {
      const r = evaluatePeriod({
        record: flat(0),
        monthKeys: ['2025-01'],
        monthsWithData: new Set(['2025-01']),
        signedNetFor: () => credit,
        nowMonth: NOW,
      })
      expect(Object.is(r!.spendDollars, 0)).toBe(true)
      expect(Object.is(r!.deltaDollars, 0)).toBe(true)
      expect(r!.status).toBe('on-target')
      expect(formatTargetStatus(r!).text).toBe('On target')
    },
  )

  it('treats a non-finite net as zero', () => {
    expect(evaluate(flat(0), ['2025-01'], { '2025-01': NaN })).toMatchObject({ spendDollars: 0 })
  })
})

describe('formatTargetStatus', () => {
  const base: TargetResult = {
    status: 'over',
    inProgress: false,
    deltaDollars: 1234,
    targetDollars: 0,
    spendDollars: 0,
    monthsCounted: 1,
    monthsInPeriod: 12,
  }

  it('formats over with thousands separators and an up icon', () => {
    expect(formatTargetStatus(base)).toEqual({ text: '$1,234 over', icon: 'up' })
  })

  it('formats under for a completed period', () => {
    expect(formatTargetStatus({ ...base, status: 'under' })).toEqual({ text: '$1,234 under', icon: 'down' })
  })

  it('formats left when the period is in progress', () => {
    expect(formatTargetStatus({ ...base, status: 'under', inProgress: true })).toEqual({
      text: '$1,234 left',
      icon: 'down',
    })
  })

  it('formats on target with a check icon, in progress or not', () => {
    expect(formatTargetStatus({ ...base, status: 'on-target', deltaDollars: 0 })).toEqual({
      text: 'On target',
      icon: 'check',
    })
    expect(formatTargetStatus({ ...base, status: 'on-target', deltaDollars: 0, inProgress: true }).text).toBe(
      'On target',
    )
  })

  it('never prints a minus sign', () => {
    const net = evaluatePeriod({
      record: flat(500),
      monthKeys: ['2025-03'],
      monthsWithData: new Set(['2025-03']),
      signedNetFor: () => 40,
      nowMonth: NOW,
    })
    expect(formatTargetStatus(net!).text).not.toContain('-')
  })
})

describe('summarizeGroups', () => {
  const result = (status: TargetResult['status']): TargetResult => ({
    status,
    inProgress: false,
    deltaDollars: 0,
    targetDollars: 0,
    spendDollars: 0,
    monthsCounted: 1,
    monthsInPeriod: 1,
  })

  it('counts evaluated and over groups and skips nulls', () => {
    expect(summarizeGroups([result('over'), null, result('under'), result('over'), result('on-target')])).toEqual({
      evaluated: 4,
      over: 2,
    })
  })

  it('returns zeros for no results', () => {
    expect(summarizeGroups([])).toEqual({ evaluated: 0, over: 0 })
    expect(summarizeGroups([null, null])).toEqual({ evaluated: 0, over: 0 })
  })
})

describe('sumByCategory', () => {
  it('sums signed amounts per category', () => {
    expect(
      sumByCategory(
        [
          { category: 'Dining', amount: -20 },
          { category: 'Dining', amount: -30.5 },
          { category: 'Dining', amount: 10 },
          { category: 'Rent', amount: -1000 },
        ],
        new Set(),
      ),
    ).toEqual({ Dining: -40.5, Rent: -1000 })
  })

  it('skips excluded categories', () => {
    expect(
      sumByCategory(
        [
          { category: 'Transfer', amount: -500 },
          { category: 'Rent', amount: -1000 },
        ],
        new Set(['Transfer']),
      ),
    ).toEqual({ Rent: -1000 })
  })

  it('sums in integer cents so 0.1 + 0.2 is exactly 0.3', () => {
    expect(
      sumByCategory(
        [
          { category: 'A', amount: 0.1 },
          { category: 'A', amount: 0.2 },
        ],
        new Set(),
      ).A,
    ).toBe(0.3)
  })

  it('ignores non-finite amounts', () => {
    expect(sumByCategory([{ category: 'A', amount: NaN }], new Set())).toEqual({})
  })

  it('returns an empty record for no transactions', () => {
    expect(sumByCategory([], new Set())).toEqual({})
  })

  it('handles a category named __proto__ as plain data', () => {
    const result = sumByCategory([{ category: '__proto__', amount: -5 }], new Set())
    expect(Object.keys(result)).toEqual(['__proto__'])
  })
})
