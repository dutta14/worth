import { FC, ReactNode } from 'react'

export interface PreviewColumn {
  label: string
  numeric?: boolean
}

export interface PreviewRow {
  key: string
  cells: ReactNode[]
}

interface PreviewTableProps {
  caption: string
  columns: PreviewColumn[]
  rows: PreviewRow[]
}

/** A table inside a focusable, labelled scroll region so keyboard users can scroll it. */
const PreviewTable: FC<PreviewTableProps> = ({ caption, columns, rows }) => (
  <div className="iw-table-scroll" tabIndex={0} role="region" aria-label={caption}>
    <table className="iw-table">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((column, i) => (
            <th key={i} scope="col" className={column.numeric ? 'iw-num' : undefined}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(row => (
          <tr key={row.key}>
            {row.cells.map((cell, i) => (
              <td key={i} className={columns[i]?.numeric ? 'iw-num' : undefined}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

export default PreviewTable
