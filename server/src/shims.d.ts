// The shared frontend files read Vite's `import.meta.env` (BASE_URL, and the optional VITE_LLM / VITE_DISTRICT_API) in browser-only paths (loading files over HTTP).
// The server never reaches those paths; this only lets the type checker accept them.
interface ImportMeta {
  readonly env: { readonly BASE_URL: string; readonly VITE_LLM?: string; readonly VITE_DISTRICT_API?: string }
}
