import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Keeps production asset paths relative, so dist/index.html can be opened
  // from a local folder as well as served through Vite.
  base: './',
  plugins: [react()],
})
