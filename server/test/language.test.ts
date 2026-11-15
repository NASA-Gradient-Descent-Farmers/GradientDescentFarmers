import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectLanguage, languageRequest } from '../src/language.ts'

describe('asking for a language', () => {
  for (const text of ['english', 'English', 'inglés', 'in English', 'switch to english']) it(`"${text}" asks for English`, () => assert.equal(languageRequest(text), 'en'))
  for (const text of ['español', 'Espanol', 'spanish', 'en español']) it(`"${text}" asks for Spanish`, () => assert.equal(languageRequest(text), 'es'))
  it('only a whole message that is such a request counts', () => {
    for (const text of ['I speak english', 'what is english wheat', 'Sonora', '1', 'ok']) assert.equal(languageRequest(text), null, text)
  })
})

describe('telling the language of a message', () => {
  it('English questions are English, Spanish ones Spanish', () => {
    for (const text of ['What should I plant?', 'How much could I earn?', 'Hello', 'Where does the data come from?']) assert.equal(detectLanguage(text), 'en', text)
    for (const text of ['¿Qué me conviene sembrar?', 'Hola', '¿Cuánto podría ganar?', '¿De dónde salen los datos?']) assert.equal(detectLanguage(text), 'es', text)
  })

  it('a message with no language in it says nothing (a place, a number, "ok")', () => {
    for (const text of ['Sonora', 'Guanajuato', '1', '3', 'ok', '😀']) assert.equal(detectLanguage(text), null, text)
  })

  it('changing a conversation under way takes two clear words, not one', () => {
    assert.equal(detectLanguage('hello', 2), null)
    assert.equal(detectLanguage('What should I plant?', 2), 'en')
    assert.equal(detectLanguage('hola', 2), null)
    assert.equal(detectLanguage('¿Qué me conviene sembrar?', 2), 'es')
  })
})
