import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const root = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const configuration = JSON.parse(readFileSync(new URL('./config.json', import.meta.url), 'utf8'))
const backend = JSON.parse(readFileSync(new URL('../backend/config.json', import.meta.url), 'utf8'))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '')
  const target = new URL(configuration.apiProxyOrigin)
  target.port = String(process.env.PORT ?? env.PORT ?? backend.port)
  return {
    root,
    envDir: projectRoot,
    base: '/',
    plugins: [react()],
    server: {
      port: Number(process.env.FRONTEND_PORT ?? env.FRONTEND_PORT ?? configuration.port),
      strictPort: true,
      proxy: { '/api': { target: target.origin } },
    },
  }
})
