import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { loadEnv, type Plugin, type ViteDevServer, type PreviewServer } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * /api/yolia-chat for `npm run dev` and `npm run preview`: the same handler as the Netlify Function, so the WhatsApp demo can
 * use the language model locally. The key is read from frontend/.env.local (ANTHROPIC_API_KEY=..., git-ignored) or the shell;
 * without it the endpoint answers 503 and the chat uses its templates.
 */
function yoliaChat(mode: string): Plugin {
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const attach = (server: ViteDevServer | PreviewServer, load: () => Promise<typeof import('./src/llm/handler.ts')>) => {
    server.middlewares.use('/api/yolia-chat', (req: IncomingMessage, res: ServerResponse) => {
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
        const { handleNarrate } = await load()
        const result = await handleNarrate(body, { apiKey: env.ANTHROPIC_API_KEY, model: env.YOLIA_LLM_MODEL })
        res.statusCode = result.status
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(result.body))
      })
    })
  }
  return {
    name: 'yolia-chat',
    configureServer(server) {
      attach(server, () => server.ssrLoadModule('/src/llm/handler.ts') as Promise<typeof import('./src/llm/handler.ts')>)
    },
    configurePreviewServer(server) {
      attach(server, () => import('./src/llm/handler.ts'))
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
