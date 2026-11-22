import { SNIFF_RECORD_LIMIT } from './constants'
import { tokenizeRecords } from './tokenize'
import type { Delimiter } from './types'

export const DELIMITERS: readonly Delimiter[] = [',', ';', '\t', '|']

interface Score {
  agreeing: number
  width: number
}

function scoreDelimiter(text: string, delimiter: Delimiter): Score {
  const widths = tokenizeRecords(text, delimiter, SNIFF_RECORD_LIMIT)
    .records.filter(record => record.some(cell => cell.trim() !== ''))
    .map(record => record.length)

  const counts = new Map<number, number>()
  for (const width of widths) counts.set(width, (counts.get(width) ?? 0) + 1)

  let best: Score = { agreeing: 0, width: 0 }
  for (const [width, agreeing] of counts) {
    if (width < 2) continue
    if (agreeing > best.agreeing || (agreeing === best.agreeing && width > best.width)) best = { agreeing, width }
  }
  return best
}

/**
 * Picks the delimiter that splits the first records into the most rows of one consistent width of at
 * least two columns. Ties go to the wider split, then to the order `, ; tab |`. Defaults to a comma.
 */
export function sniffDelimiter(text: string): Delimiter {
  let winner: Delimiter = ','
  let best: Score = { agreeing: 0, width: 0 }
  for (const delimiter of DELIMITERS) {
    const score = scoreDelimiter(text, delimiter)
    if (score.agreeing > best.agreeing || (score.agreeing === best.agreeing && score.width > best.width)) {
      winner = delimiter
      best = score
    }
  }
  return winner
}
