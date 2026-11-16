// A small RFC 4180 reader shared by the slimming scripts: quoted fields, embedded commas and quotes.
import { readFileSync } from 'node:fs'

/** The rows of a CSV file as objects keyed by the header row. */
export function readCsv(path) {
  return parseCsv(readFileSync(path, 'utf8'))
}

/** The rows of CSV text as objects keyed by the header row. */
export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') (row.push(field), (field = ''))
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) (row.push(field), rows.push(row))
  const [head, ...body] = rows
  return body.map((values) => Object.fromEntries(head.map((key, i) => [key, values[i] ?? ''])))
}
