// Ensures apps/web/.env.local points at the real local Supabase stack
// (`supabase start`). Run before the web dev server so Vite picks the
// values up at startup. .env.local is gitignored, so a fresh clone needs
// this generated once.
import { existsSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { execSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '../apps/web/.env.local')

if (existsSync(envPath)) {
  console.log('✓ apps/web/.env.local already exists — leaving it untouched')
  process.exit(0)
}

let status
try {
  status = execSync('supabase status -o env', { encoding: 'utf8' })
} catch {
  console.error(
    '✗ Could not read `supabase status` — run `colima start && supabase start` first, then re-run `npm run setup`/`npm run dev`.',
  )
  process.exit(1)
}

const get = (key) => status.match(new RegExp(`^${key}="?([^"\n]*)"?$`, 'm'))?.[1]
const apiUrl = get('API_URL')
const anonKey = get('ANON_KEY')

if (!apiUrl || !anonKey) {
  console.error('✗ `supabase status -o env` did not return API_URL/ANON_KEY — is the local stack running?')
  process.exit(1)
}

writeFileSync(
  envPath,
  [
    '# Auto-generated — points the web app at the local Supabase stack (`supabase start`).',
    '# Delete this file (or change the values) to use a different Supabase project instead.',
    `VITE_SUPABASE_URL=${apiUrl}`,
    `VITE_SUPABASE_ANON_KEY=${anonKey}`,
    '# FastAPI agent service (apps/api) — used by the Leads follow-up agent button.',
    'VITE_AGENT_API_URL=http://localhost:8000',
    '',
  ].join('\n'),
)
console.log('📝 Created apps/web/.env.local (pointing at the local Supabase stack)')
