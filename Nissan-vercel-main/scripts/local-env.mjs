// Ensures apps/web/.env.local points at the local DuckDB server.
// Run before the web dev server so Vite picks the values up at startup.
// .env.local is gitignored, so a fresh clone needs this generated once.
import { existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../apps/web/.env.local')

if (existsSync(envPath)) {
  console.log('✓ apps/web/.env.local already exists — leaving it untouched')
} else {
  writeFileSync(
    envPath,
    [
      '# Auto-generated — points the web app at the local DuckDB server (apps/local-api).',
      '# Delete this file (or change the values) to use a real Supabase project instead.',
      'VITE_SUPABASE_URL=http://localhost:54321',
      'VITE_SUPABASE_ANON_KEY=local-dev-anon-key',
      '# FastAPI agent service (apps/api) — used by the Leads follow-up agent button.',
      'VITE_AGENT_API_URL=http://localhost:8000',
      '',
    ].join('\n'),
  )
  console.log('📝 Created apps/web/.env.local (pointing at the local DuckDB server)')
}
