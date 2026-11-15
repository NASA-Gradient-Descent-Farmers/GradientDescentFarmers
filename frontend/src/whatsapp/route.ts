// Where the simulator lives. It is reached at /demo/whatsapp (dev server and hosts that serve the app for any path) or,
// on a plain static host, at #/demo/whatsapp. The app has no router: main.tsx asks here whether to show it.

export const DEMO_PATH = '/demo/whatsapp'
/** The link to the simulator from the app's own pages: the hash form works on any host, and main.tsx follows it. */
export const DEMO_HREF = `#${DEMO_PATH}`

interface Where {
  pathname: string
  hash: string
}

const tail = (path: string) => path.replace(/\/+$/, '')

/** Hosts that pass only a plain #name (such as a claude.ai artifact) can link the chat as #demo-whatsapp. */
export const DEMO_ALIAS = 'demo-whatsapp'

export const isWhatsAppDemo = ({ pathname, hash }: Where): boolean => tail(pathname).endsWith(DEMO_PATH) || [DEMO_PATH, DEMO_ALIAS].includes(tail(hash.replace(/^#/, '')))

/** The folder holding the app's files and its front page ("/" or "/yolia/"), whichever way the demo was reached. */
export function appRoot({ pathname }: Where): string {
  const trimmed = tail(pathname)
  if (trimmed.endsWith(DEMO_PATH)) return trimmed.slice(0, -DEMO_PATH.length) + '/'
  return pathname.replace(/[^/]*$/, '') || '/'
}

/** The simple farmer view (/campo) leaves the farmer's demo place here so the chat can open at it (WhatsAppDemo.tsx). */
export const WA_HANDOFF_KEY = 'yolia-wa-handoff'

/** The simple farmer view: /campo, #/campo, or #campo (hosts that pass only a plain hash). */
export const CAMPO_PATH = '/campo'
export const isCampo = ({ pathname, hash }: Where): boolean => tail(pathname).endsWith(CAMPO_PATH) || ['/campo', 'campo'].includes(tail(hash.replace(/^#/, '')))
