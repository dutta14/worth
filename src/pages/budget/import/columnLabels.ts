/** Option labels for the column selects; repeated or empty header names are told apart by position. */
export function columnLabels(headers: string[]): string[] {
  const counts = new Map<string, number>()
  headers.forEach(header => counts.set(header, (counts.get(header) ?? 0) + 1))
  return headers.map((header, i) => {
    if (header === '') return `Column ${i + 1}`
    return (counts.get(header) ?? 0) > 1 ? `${header} (column ${i + 1})` : header
  })
}
