/**
 * Text-to-Speech (TTS) manager strictly adhering to iOS Safari user-gesture rules (Rule 8).
 * Preloads voices on startup, selects native English voices, and triggers speech synchronously
 * inside touch/click handlers (NO awaits before speak).
 */

let voices: SpeechSynthesisVoice[] = [];
let voiceLoaded = false;
let preferredVoice: SpeechSynthesisVoice | null = null;

/**
 * Preloads browser voices. Safe to call multiple times.
 */
export function initTTS(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return;
  }

  const updateVoices = () => {
    voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      voiceLoaded = true;
      // Prioritize natural/enhanced en-US voices, fallback to en-GB, then any English
      preferredVoice =
        voices.find((v) => v.lang === 'en-US' && /siri|natural|enhanced/i.test(v.name)) ||
        voices.find((v) => v.lang === 'en-US') ||
        voices.find((v) => v.lang === 'en-GB') ||
        voices.find((v) => v.lang.startsWith('en')) ||
        null;
    }
  };

  updateVoices();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = updateVoices;
  }
}

/**
 * Returns whether TTS is supported in this browser environment.
 */
export function isTTSSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export interface SpeakOptions {
  rate?: number; // default 0.9 for clear learning pronunciation
  pitch?: number; // default 1.0
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (err: any) => void;
}

/**
 * CRITICAL (Rule 8): Must be called SYNCHRONOUSLY inside the touch/click event handler.
 * Never call after an `await` statement on iOS Safari, or speech will be silently dropped.
 */
export function speakWord(text: string, options: SpeakOptions = {}): boolean {
  if (!isTTSSupported() || !text.trim()) {
    return false;
  }

  try {
    // 1. Cancel any active or queued speech
    window.speechSynthesis.cancel();

    // 2. Build utterance
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = options.rate ?? 0.9;
    utterance.pitch = options.pitch ?? 1.0;

    // Use preloaded English voice if ready
    if (!voiceLoaded) {
      voices = window.speechSynthesis.getVoices();
      preferredVoice =
        voices.find((v) => v.lang.startsWith('en-US')) ||
        voices.find((v) => v.lang.startsWith('en')) ||
        null;
    }

    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }

    // Set voice language explicitly
    utterance.lang = preferredVoice?.lang || 'en-US';

    if (options.onStart) {
      utterance.onstart = options.onStart;
    }

    if (options.onEnd) {
      utterance.onend = options.onEnd;
    }

    if (options.onError) {
      utterance.onerror = options.onError;
    }

    // 3. Synchronously speak
    window.speechSynthesis.speak(utterance);
    return true;
  } catch (err) {
    console.error('[TTS] Failed to speak:', err);
    options.onError?.(err);
    return false;
  }
}

/**
 * Stops any current speech output.
 */
export function stopSpeech(): void {
  if (isTTSSupported()) {
    window.speechSynthesis.cancel();
  }
}
