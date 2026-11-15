import { describe, expect, it } from 'vitest'
import { createRecognizer, speechSupported, transcriptOf } from './speech.ts'

describe('speech', () => {
  it('is simply unavailable where the browser has no recognition (the button is then hidden)', () => {
    expect(speechSupported()).toBe(false)
    expect(createRecognizer('es', { onText: () => {}, onEnd: () => {}, onError: () => {} })).toBeNull()
  })

  it('joins what was heard into one tidy line', () => {
    const results = [
      { isFinal: true, 0: { transcript: ' ¿Qué me conviene ' } },
      { isFinal: false, 0: { transcript: 'sembrar   después del maíz?' } },
    ]
    expect(transcriptOf(results)).toBe('¿Qué me conviene sembrar después del maíz?')
    expect(transcriptOf([])).toBe('')
  })
})
