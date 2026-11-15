import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // Assets and data are served from the site root (Netlify, or any host that serves the app at "/"), so a deep link such as
  // /demo/whatsapp still finds them. To host the build under a sub-folder, build with VITE_BASE=./ (relative paths) or
  // VITE_BASE=/folder/.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
})
