import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const CSP = "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'"

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [
      react(),
      tailwindcss(),
      // Build only: Vite's dev server needs inline scripts for HMR, which this CSP forbids.
      {
        name: 'csp',
        apply: 'build',
        transformIndexHtml: (html) => html.replace('<!--csp-->', `<meta http-equiv="Content-Security-Policy" content="${CSP}">`),
      },
    ],
  },
})
