import { describe, expect, it } from 'vitest'
import { isVersion } from './version.ts'

describe('isVersion', () => {
  it('accepts exactly the two versions', () => {
    expect(isVersion('agricultor')).toBe(true)
    expect(isVersion('tecnico')).toBe(true)
    for (const other of ['Agricultor', 'técnico', '', null, undefined, 3]) expect(isVersion(other)).toBe(false)
  })
})
