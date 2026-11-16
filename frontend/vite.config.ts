import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, type Plugin, type ViteDevServer, type PreviewServer } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * /api/yolia-chat and /api/yolia-translate for `npm run dev` and `npm run preview`: the same handler as the Netlify Function, so the WhatsApp demo can
 * use the language model locally. The key is read from frontend/.env.local (ANTHROPIC_API_KEY=..., git-ignored) or the shell;
 * without it the endpoint answers 503 and the chat uses its templates.
 */
function yoliaChat(mode: string): Plugin {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  type Handle = (body: unknown, env: { apiKey?: string; model?: string }) => Promise<{ status: number; body: unknown }>
  const route = (server: ViteDevServer | PreviewServer, path: string, handle: () => Promise<Handle>) => {
    server.middlewares.use(path, (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.end()
        return
      }
      let text = ''
      req.on('data', (chunk) => (text += chunk))
      req.on('end', async () => {
        let body: unknown = null
        try {
          body = JSON.parse(text)
        } catch {
          // refused by the handler
        }
        const result = await (await handle())(body, { apiKey: env.ANTHROPIC_API_KEY, model: env.YOLIA_LLM_MODEL })
        res.statusCode = result.status
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(result.body))
      })
    })
  }
  // the chat's model, and English for live engine text (src/llm/translate.ts)
  const attach = (server: ViteDevServer | PreviewServer, load: (path: string) => Promise<unknown>) => {
    route(server, '/api/yolia-chat', async () => ((await load('/src/llm/handler.ts')) as typeof import('./src/llm/handler.ts')).handleNarrate)
    route(server, '/api/yolia-translate', async () => ((await load('/src/llm/translate.ts')) as typeof import('./src/llm/translate.ts')).handleTranslate)
  }
  return {
    name: 'yolia-chat',
    configureServer(server) {
      attach(server, (path) => server.ssrLoadModule(path))
    },
    configurePreviewServer(server) {
      attach(server, (path) => (path.endsWith('handler.ts') ? import('./src/llm/handler.ts') : import('./src/llm/translate.ts')))
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Assets and data are served from the site root (Netlify, or any host that serves the app at "/"), so a deep link such as
  // /demo/whatsapp still finds them. To host the build under a sub-folder, build with VITE_BASE=./ (relative paths) or
  // VITE_BASE=/folder/.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), yoliaChat(mode)],
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
}))
