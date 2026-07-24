// ─── Posting Time Picker helpers (12-hour with AM/PM) ────────────────────────
// Single home for the two time helpers that were duplicated byte-for-byte in
// CampaignPlannerWizard.tsx and marketing.content-studio.tsx. Bodies are the
// originals, unchanged — this is a move, not a rewrite. See M4.

// Converts internal 24h "HH:MM" to display "hh:mm AM/PM".
export function to12hDisplay(val: string): string {
  const parts = (val || '10:00').split(':').map(Number)
  const h24 = parts[0] ?? 10
  const mm = String(parts[1] ?? 0).padStart(2, '0')
  const ampm = h24 < 12 ? 'AM' : 'PM'
  const h12 = String(h24 % 12 || 12).padStart(2, '0')
  return `${h12}:${mm} ${ampm}`
}

// Parses "hh:mm AM/PM" (or bare "HH:MM") → 24h "HH:MM". Returns null if invalid.
export function parse12hInput(raw: string): string | null {
  const s = raw.trim().toUpperCase()
  const m12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/)
  if (m12) {
    let h = parseInt(m12[1], 10)
    const mm = parseInt(m12[2], 10)
    if (h < 1 || h > 12 || mm < 0 || mm > 59) return null
    if (m12[3] === 'AM' && h === 12) h = 0
    if (m12[3] === 'PM' && h !== 12) h += 12
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/)
  if (m24) {
    const h = parseInt(m24[1], 10)
    const mm = parseInt(m24[2], 10)
    if (h < 0 || h > 23 || mm < 0 || mm > 59) return null
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
  return null
}
