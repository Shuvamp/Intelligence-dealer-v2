// ─── Voice Input Service ───────────────────────────────────────────────────────
//
// Provider seam for speech-to-text. The browser Web Speech API is the default
// and only implemented provider today. The interface is deliberately
// transport-agnostic so server-backed providers (OpenAI Whisper, Azure Speech,
// Google Cloud Speech-to-Text) can be added later WITHOUT touching the UI:
// each just needs to emit onInterim/onFinal as audio is recognised.
//
// To add a provider later:
//   1. Implement VoiceProvider (start() streams chunks → onInterim/onFinal).
//   2. Register it in getVoiceProvider().
//   3. Flip the default id (or expose a setting). UI code stays unchanged.

type VoiceProviderId = 'browser' | 'whisper' | 'azure' | 'google'

interface VoiceCallbacks {
  /** Recognition object created, before audio. */
  onStart?: () => void
  /** Microphone audio capture began. */
  onAudioStart?: () => void
  /** User started speaking. */
  onSpeechStart?: () => void
  /** User stopped speaking (audio still flushing). */
  onSpeechEnd?: () => void
  /** Live, not-yet-confirmed text. Replaces the interim tail each call. */
  onInterim?: (text: string) => void
  /** Confirmed text chunk. Append to the committed transcript. */
  onFinal?: (text: string) => void
  /** Error code (Web Speech API codes, e.g. 'network', 'not-allowed'). */
  onError?: (code: string) => void
  /** Recognition fully ended. */
  onEnd?: () => void
}

interface VoiceStartOptions {
  lang?: string
}

export interface VoiceSession {
  stop: () => void
}

interface VoiceProvider {
  id: VoiceProviderId
  /** True if this provider can run in the current environment. */
  isSupported: () => boolean
  /** Begin a streaming recognition session. */
  start: (opts: VoiceStartOptions, cb: VoiceCallbacks) => VoiceSession
}

// ─── Browser provider (Web Speech API) ──────────────────────────────────────────

function getSpeechRecognitionCtor(): (new () => any) | null {
  if (typeof window === 'undefined') return null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

const browserVoiceProvider: VoiceProvider = {
  id: 'browser',
  isSupported: () => getSpeechRecognitionCtor() !== null,
  start(opts, cb) {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      cb.onError?.('not-supported')
      return { stop: () => {} }
    }
    const recognition = new Ctor()
    // Streaming config — interimResults is the key to near real-time text.
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.lang = opts.lang ?? 'en-US'

    recognition.onaudiostart = () => cb.onAudioStart?.()
    recognition.onspeechstart = () => cb.onSpeechStart?.()
    recognition.onspeechend = () => cb.onSpeechEnd?.()

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      let interim = ''
      let final = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i]!
        const text = result[0]!.transcript
        if (result.isFinal) final += (final ? ' ' : '') + text.trim()
        else interim += text
      }
      // Emit interim first so the live tail shows before the committed chunk.
      if (interim.trim()) cb.onInterim?.(interim.trim())
      if (final.trim()) cb.onFinal?.(final.trim())
    }

    recognition.onerror = (e: SpeechRecognitionErrorEvent) => cb.onError?.(e.error)
    recognition.onend = () => cb.onEnd?.()

    recognition.start()
    cb.onStart?.()

    return {
      stop: () => {
        try {
          recognition.stop()
        } catch {
          /* already stopped */
        }
      },
    }
  },
}

// ─── Selector ────────────────────────────────────────────────────────────────

const DEFAULT_PROVIDER: VoiceProviderId = 'browser'

/**
 * Returns the active voice provider. Browser (Web Speech API) is the default.
 * Server-backed providers are not yet implemented — requesting one falls back
 * to the browser provider with a console warning so the UI never breaks.
 */
export function getVoiceProvider(id: VoiceProviderId = DEFAULT_PROVIDER): VoiceProvider {
  switch (id) {
    case 'browser':
      return browserVoiceProvider
    case 'whisper':
    case 'azure':
    case 'google':
      console.warn(`[voice] provider "${id}" not implemented yet — using browser provider`)
      return browserVoiceProvider
    default:
      return browserVoiceProvider
  }
}
