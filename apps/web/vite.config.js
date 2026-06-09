import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Source maps in prod so TDZ / hook-order errors can be traced
    // back to the original line in DevTools instead of column 46662
    // of a minified bundle. Adds ~25% to the dist size — acceptable
    // for the debuggability win.
    sourcemap: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
