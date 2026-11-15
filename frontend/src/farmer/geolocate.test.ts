import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentPosition, GeoError } from './geolocate.ts'

afterEach(() => vi.unstubAllGlobals())

const stub = (geolocation: unknown) => vi.stubGlobal('navigator', { geolocation })

describe('currentPosition', () => {
  it('resolves with the position as latitude and longitude', async () => {
    stub({ getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 19.5, longitude: -98.9 } }) })
    expect(await currentPosition()).toEqual({ lat: 19.5, lon: -98.9 })
  })

  it('says why it failed: no permission, no signal, too slow, or no support', async () => {
    const fail = (code: number) => stub({ getCurrentPosition: (_: unknown, bad: (e: { code: number }) => void) => bad({ code }) })
    for (const [code, expected] of [[1, 'denied'], [2, 'unavailable'], [3, 'timeout']] as const) {
      fail(code)
      await expect(currentPosition()).rejects.toMatchObject({ code: expected })
    }
    stub(undefined)
    await expect(currentPosition()).rejects.toBeInstanceOf(GeoError)
    await expect(currentPosition()).rejects.toMatchObject({ code: 'unsupported' })
  })
})
