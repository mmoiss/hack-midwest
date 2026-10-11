import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createStream } from './server.ts'

// Read .env fresh on every config (re)load. Not via process.env, which survives Vite's in-process restarts.
const readEnv = () => {
  try {
    return parseEnv(readFileSync('.env', 'utf8'))
  } catch {
    return {}
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Serve the SQLite feed from the dev server itself, so `npm run dev` is all you need.
    { name: 'dashboard-stream', configureServer: (s) => void s.middlewares.use('/api/stream', createStream(readEnv().TEAM_TOKENS)) },
  ],
  server: {
    // Human decisions (Accept/Reject a proposal, Mark resolved) POST to the Python server,
    // the only SQLite writer -- `python -m backend.mcp` on :8000 by default. In production
    // Caddy routes /api/* to it the same way, so the browser code is same-origin either way.
    proxy: {
      '/api/proposals': readEnv().BACKEND_URL ?? 'http://localhost:8000',
      '/api/alerts': readEnv().BACKEND_URL ?? 'http://localhost:8000',
    },
  },
})
