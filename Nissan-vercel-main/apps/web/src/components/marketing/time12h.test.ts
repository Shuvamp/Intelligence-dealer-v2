import { describe, it, expect } from 'vitest'
import { to12hDisplay, parse12hInput } from './time12h'

// Locks the behavior of the two helpers that were deduped out of
// CampaignPlannerWizard.tsx and marketing.content-studio.tsx (M4), so a future
// edit to the shared copy can't silently change either caller.

describe('to12hDisplay', () => {
  it('maps 24h to 12h with AM/PM', () => {
    expect(to12hDisplay('00:00')).toBe('12:00 AM')
    expect(to12hDisplay('09:05')).toBe('09:05 AM')
    expect(to12hDisplay('12:00')).toBe('12:00 PM')
    expect(to12hDisplay('13:30')).toBe('01:30 PM')
    expect(to12hDisplay('23:59')).toBe('11:59 PM')
  })

  it('falls back to 10:00 AM on empty input', () => {
    expect(to12hDisplay('')).toBe('10:00 AM')
  })
})

describe('parse12hInput', () => {
  it('parses 12h input', () => {
    expect(parse12hInput('12:00 AM')).toBe('00:00')
    expect(parse12hInput('12:00 PM')).toBe('12:00')
    expect(parse12hInput('1:30 pm')).toBe('13:30')
    expect(parse12hInput(' 09:05 AM ')).toBe('09:05')
  })

  it('parses bare 24h input', () => {
    expect(parse12hInput('23:59')).toBe('23:59')
    expect(parse12hInput('7:00')).toBe('07:00')
  })

  it('rejects out-of-range and malformed input', () => {
    expect(parse12hInput('13:00 PM')).toBeNull()
    expect(parse12hInput('00:00 AM')).toBeNull()
    expect(parse12hInput('10:75 AM')).toBeNull()
    expect(parse12hInput('24:00')).toBeNull()
    expect(parse12hInput('nope')).toBeNull()
    expect(parse12hInput('')).toBeNull()
  })

  it('round-trips with to12hDisplay', () => {
    for (const t of ['00:00', '07:15', '12:00', '13:30', '23:59']) {
      expect(parse12hInput(to12hDisplay(t))).toBe(t)
    }
  })
})
