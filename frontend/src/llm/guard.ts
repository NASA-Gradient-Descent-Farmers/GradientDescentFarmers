// The honesty check on the language model's text: every number it writes must be one of the numbers in the facts it was
// given (or in the farmer's own message). A reply that brings a number from anywhere else is not shown; the chat falls back
// to its written template. Shared by the server handler and the tests; pure, no network.

/** Small counts ("2 opciones", "1 de cada 10", months) are allowed: they carry no model figure. */
const FREE_UP_TO = 12

/**
 * The numbers in a text, as values. "40,252" and "$40,252" are 40252; "7.05" is 7.05; "−2,821" is 2821 (the sign is words'
 * business here); "13%" is 13. A comma followed by exactly three digits is a thousands separator, as the engine writes them.
 */
export function numbersIn(text: string): number[] {
  const out: number[] = []
  for (const match of text.matchAll(/\d+(?:,\d{3})*(?:\.\d+)?/g)) {
    const value = Number(match[0].replace(/,/g, ''))
    if (Number.isFinite(value)) out.push(value)
  }
  return out
}

/** The ways a fact number may be written: as is, rounded to an integer, or to one decimal. */
function writings(value: number): number[] {
  return [value, Math.round(value), Math.round(value * 10) / 10]
}

export interface GuardResult {
  ok: boolean
  /** Numbers in the reply that are not in the facts. */
  unsupported: number[]
}

export function checkNumbers(reply: string, facts: string, question = ''): GuardResult {
  const allowed = new Set<number>()
  for (const value of [...numbersIn(facts), ...numbersIn(question)]) for (const w of writings(value)) allowed.add(w)
  const unsupported = [...new Set(numbersIn(reply).filter((n) => !(Number.isInteger(n) && n <= FREE_UP_TO) && !allowed.has(n)))]
  return { ok: unsupported.length === 0, unsupported }
}
