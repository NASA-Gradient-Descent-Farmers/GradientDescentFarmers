import { describe, expect, it } from 'vitest'
import { appRoot, isWhatsAppDemo } from './route.ts'

const at = (pathname: string, hash = '') => ({ pathname, hash })

describe('isWhatsAppDemo', () => {
  it('is true at /demo/whatsapp, with or without a trailing slash or a folder before it', () => {
    expect(isWhatsAppDemo(at('/demo/whatsapp'))).toBe(true)
    expect(isWhatsAppDemo(at('/demo/whatsapp/'))).toBe(true)
    expect(isWhatsAppDemo(at('/yolia/demo/whatsapp'))).toBe(true)
  })

  it('is true at #/demo/whatsapp on a static host', () => {
    expect(isWhatsAppDemo(at('/', '#/demo/whatsapp'))).toBe(true)
    expect(isWhatsAppDemo(at('/index.html', '#/demo/whatsapp/'))).toBe(true)
  })

  it('is false everywhere else, so the app is untouched', () => {
    for (const where of [at('/'), at('/index.html'), at('/demo'), at('/demo/whatsapp-clone'), at('/', '#/planner')]) expect(isWhatsAppDemo(where), where.pathname + where.hash).toBe(false)
  })
})

describe('appRoot', () => {
  it('is the folder the app was served from, whichever way the demo was reached', () => {
    expect(appRoot(at('/demo/whatsapp'))).toBe('/')
    expect(appRoot(at('/demo/whatsapp/'))).toBe('/')
    expect(appRoot(at('/yolia/demo/whatsapp'))).toBe('/yolia/')
    expect(appRoot(at('/yolia/index.html', '#/demo/whatsapp'))).toBe('/yolia/')
    expect(appRoot(at('/', '#/demo/whatsapp'))).toBe('/')
  })
})
