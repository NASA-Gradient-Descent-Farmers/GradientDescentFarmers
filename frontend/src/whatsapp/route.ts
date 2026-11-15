// Where the simulator lives. It is reached at /demo/whatsapp (dev server and hosts that serve the app for any path) or,
// on a plain static host, at #/demo/whatsapp. The app has no router: main.tsx asks here whether to show it.

export const DEMO_PATH = '/demo/whatsapp'

interface Where {
  pathname: string
  hash: string
}

const tail = (path: string) => path.replace(/\/+$/, '')

export const isWhatsAppDemo = ({ pathname, hash }: Where): boolean => tail(pathname).endsWith(DEMO_PATH) || tail(hash.replace(/^#/, '')) === DEMO_PATH

/** The folder holding the app's files and its front page ("/" or "/yolia/"), whichever way the demo was reached. */
export function appRoot({ pathname }: Where): string {
  const trimmed = tail(pathname)
  if (trimmed.endsWith(DEMO_PATH)) return trimmed.slice(0, -DEMO_PATH.length) + '/'
  return pathname.replace(/[^/]*$/, '') || '/'
}
