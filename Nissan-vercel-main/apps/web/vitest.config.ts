import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Standalone test config — deliberately excludes the tanstackStart()/nitro()
// plugins from vite.config.ts (they pull in server/router machinery that a
// jsdom component test doesn't need). Alias mirrors tsconfig paths.
const src = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^#\//, replacement: `${src}/` },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
})
