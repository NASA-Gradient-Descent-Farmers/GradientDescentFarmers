// The shared frontend files read Vite's `import.meta.env.BASE_URL` in browser-only paths (loading files over HTTP).
// The server never reaches those paths; this only lets the type checker accept them.
interface ImportMeta {
  readonly env: { readonly BASE_URL: string }
}
