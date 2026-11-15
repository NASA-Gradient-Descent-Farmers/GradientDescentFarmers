// Voice input, when the phone's browser has it (Chrome on Android does; some others do not). The browser's own service turns
// speech into text and may send the audio to its vendor's servers: the farmer taps the microphone each time, and nothing is
// recorded by YoliA. Where it is missing, the button is simply not shown.

interface SpeechResultLike {
  isFinal: boolean
  0: { transcript: string }
}

export interface Recognizer {
  start(): void
  stop(): void
}

interface RecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  start(): void
  stop(): void
  onresult: ((event: { results: ArrayLike<SpeechResultLike> }) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

type RecognitionConstructor = new () => RecognitionLike

const constructorOf = (): RecognitionConstructor | null => {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export const speechSupported = () => constructorOf() !== null

/** The text heard so far, in order, from a recognition result list. */
export function transcriptOf(results: ArrayLike<SpeechResultLike>): string {
  return Array.from(results)
    .map((result) => result[0].transcript)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function createRecognizer(lang: 'es' | 'en', handlers: { onText: (text: string) => void; onEnd: () => void; onError: () => void }): Recognizer | null {
  const Ctor = constructorOf()
  if (!Ctor) return null
  const recognition = new Ctor()
  recognition.lang = lang === 'es' ? 'es-MX' : 'en-US'
  recognition.interimResults = true
  recognition.continuous = false
  recognition.onresult = (event) => handlers.onText(transcriptOf(event.results))
  recognition.onerror = () => handlers.onError()
  recognition.onend = () => handlers.onEnd()
  return { start: () => recognition.start(), stop: () => recognition.stop() }
}
