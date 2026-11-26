export type NarratorVoice = 'Charon' | 'Kore';
export type NarrationProvider = 'gemini' | 'browser';
export type NarrationStatus = 'idle' | 'loading' | 'speaking' | 'error';

export interface NarrationCallbacks {
  onStatusChange: (
    status: NarrationStatus,
    errorMessage?: string,
    quotaExhausted?: boolean
  ) => void;
  onStageFinished: (stageId: number) => void;
}

class TtsQuotaError extends Error {
  public readonly quotaExhausted = true;
  constructor(message: string) {
    super(message);
    this.name = 'TtsQuotaError';
  }
}

/**
 * Manages Kazakh voiceover narration via server-side Gemini TTS (/api/tts)
 * played through an unlocked Web Audio API AudioContext (immune to async iframe
 * HTMLAudioElement autoplay expiration), with HTMLAudioElement fallback and
 * robust Browser SpeechSynthesis support.
 */
export class KazakhNarrationEngine {
  private audioCtx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private activeSource: AudioBufferSourceNode | null = null;
  private audioEl: HTMLAudioElement;

  private rawBufferCache = new Map<string, ArrayBuffer>();
  private decodedCache = new Map<string, AudioBuffer>();
  private blobUrlCache = new Map<string, string>();
  private inflight = new Map<string, Promise<ArrayBuffer>>();

  private currentRequestToken = 0;
  private activeStageId = -1;
  private voice: NarratorVoice = 'Charon';
  private provider: NarrationProvider = 'gemini';
  private callbacks: NarrationCallbacks;
  private isSpeakingNow = false;

  // Strong references to prevent Chrome GC & 15s pause bug on SpeechSynthesis
  private activeUtterance: SpeechSynthesisUtterance | null = null;
  private browserSpeakTimer: number | null = null;
  private browserKeepAliveTimer: number | null = null;

  constructor(callbacks: NarrationCallbacks) {
    this.callbacks = callbacks;
    this.audioEl = new Audio();
    this.audioEl.preload = 'auto';
    this.audioEl.volume = 1.0;
    this.audioEl.muted = false;

    this.audioEl.addEventListener('playing', () => {
      this.isSpeakingNow = true;
      this.callbacks.onStatusChange('speaking');
    });

    this.audioEl.addEventListener('ended', () => {
      this.isSpeakingNow = false;
      this.callbacks.onStatusChange('idle');
      if (this.activeStageId >= 0) {
        this.callbacks.onStageFinished(this.activeStageId);
      }
    });

    this.audioEl.addEventListener('error', () => {
      this.isSpeakingNow = false;
      this.callbacks.onStatusChange('error', 'Аудио ойнату кезінде қате шықты.', false);
    });

    // Pre-warm browser SpeechSynthesis voice list
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.getVoices();
      } catch {
        // ignore
      }
    }
  }

  /**
   * Must be called synchronously inside a user click/key gesture handler so
   * AudioContext and SpeechSynthesis are unlocked before async network fetches finish.
   */
  public unlockAudio(): void {
    if (typeof window === 'undefined') return;

    try {
      const AudioCtxCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (AudioCtxCtor) {
        if (!this.audioCtx) {
          this.audioCtx = new AudioCtxCtor();
          this.gainNode = this.audioCtx.createGain();
          this.gainNode.gain.value = 1.0;
          this.gainNode.connect(this.audioCtx.destination);
        }
        if (this.audioCtx.state === 'suspended') {
          void this.audioCtx.resume();
        }
        // Play a 1-sample silent buffer to firmly unlock iOS/Chrome iframe audio output
        const silentBuf = this.audioCtx.createBuffer(1, 1, 22050);
        const src = this.audioCtx.createBufferSource();
        src.buffer = silentBuf;
        src.connect(this.audioCtx.destination);
        src.start(0);
      }
    } catch {
      // Fall back to HTMLAudioElement if Web Audio is unavailable
    }

    if ('speechSynthesis' in window) {
      try {
        window.speechSynthesis.getVoices();
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      } catch {
        // ignore
      }
    }
  }

  public setVoice(nextVoice: NarratorVoice): void {
    this.voice = nextVoice;
  }

  public setProvider(nextProvider: NarrationProvider): void {
    this.provider = nextProvider;
  }

  public isBusy(): boolean {
    return this.isSpeakingNow;
  }

  private getCacheKey(stageId: number, voice: NarratorVoice): string {
    return `${stageId}:${voice}`;
  }

  private clearBrowserTimers(): void {
    if (this.browserSpeakTimer !== null) {
      window.clearTimeout(this.browserSpeakTimer);
      this.browserSpeakTimer = null;
    }
    if (this.browserKeepAliveTimer !== null) {
      window.clearInterval(this.browserKeepAliveTimer);
      this.browserKeepAliveTimer = null;
    }
  }

  private stopAudioNodesOnly(): void {
    this.clearBrowserTimers();

    if (this.activeSource) {
      try {
        this.activeSource.onended = null;
        this.activeSource.stop();
        this.activeSource.disconnect();
      } catch {
        // Already stopped
      }
      this.activeSource = null;
    }

    this.audioEl.pause();
    this.audioEl.currentTime = 0;

    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    this.activeUtterance = null;
    this.isSpeakingNow = false;
  }

  private async fetchAudioBytes(
    stageId: number,
    text: string,
    voice: NarratorVoice
  ): Promise<ArrayBuffer> {
    const key = this.getCacheKey(stageId, voice);
    const cached = this.rawBufferCache.get(key);
    if (cached) return cached;

    const existingPromise = this.inflight.get(key);
    if (existingPromise) return existingPromise;

    const promise = (async () => {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stageId,
          text,
          voiceName: voice,
        }),
      });

      if (!response.ok) {
        let errText = 'Дыбыстау қызметі уақытша қолжетімсіз.';
        let errCode = '';
        try {
          const data = (await response.json()) as { error?: string; code?: string };
          if (data?.error) errText = data.error;
          if (data?.code) errCode = data.code;
        } catch {
          // ignore parse error
        }
        if (response.status === 429 || errCode === 'QUOTA_EXHAUSTED') {
          throw new TtsQuotaError(errText);
        }
        throw new Error(errText);
      }

      const arrayBuffer = await response.arrayBuffer();
      if (arrayBuffer.byteLength < 64) {
        throw new Error('Серверден бос аудио дерек келді.');
      }
      this.rawBufferCache.set(key, arrayBuffer);
      return arrayBuffer;
    })();

    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  private async playWavViaWebAudioOrElement(
    stageId: number,
    cacheKey: string,
    wavBytes: ArrayBuffer,
    token: number
  ): Promise<void> {
    // Prefer Web Audio API (already unlocked in user gesture, immune to iframe autoplay timeout)
    try {
      if (!this.audioCtx) {
        this.unlockAudio();
      }
      if (this.audioCtx && this.gainNode) {
        if (this.audioCtx.state === 'suspended') {
          await this.audioCtx.resume();
        }
        let decoded = this.decodedCache.get(cacheKey);
        if (!decoded) {
          decoded = await this.audioCtx.decodeAudioData(wavBytes.slice(0));
          this.decodedCache.set(cacheKey, decoded);
        }

        if (token !== this.currentRequestToken) return;

        const source = this.audioCtx.createBufferSource();
        source.buffer = decoded;
        source.connect(this.gainNode);

        this.activeSource = source;
        this.isSpeakingNow = true;
        this.callbacks.onStatusChange('speaking');

        source.onended = () => {
          if (this.activeSource === source) {
            this.activeSource = null;
          }
          if (token !== this.currentRequestToken) return;
          this.isSpeakingNow = false;
          this.callbacks.onStatusChange('idle');
          if (this.activeStageId === stageId) {
            this.callbacks.onStageFinished(stageId);
          }
        };

        source.start(0);
        return;
      }
    } catch {
      // Fall through to HTMLAudioElement playback below
    }

    if (token !== this.currentRequestToken) return;

    // Fallback: HTMLAudioElement with Blob URL
    let blobUrl = this.blobUrlCache.get(cacheKey);
    if (!blobUrl) {
      const blob = new Blob([wavBytes], { type: 'audio/wav' });
      blobUrl = URL.createObjectURL(blob);
      this.blobUrlCache.set(cacheKey, blobUrl);
    }

    this.audioEl.volume = 1.0;
    this.audioEl.muted = false;
    this.audioEl.src = blobUrl;
    this.audioEl.currentTime = 0;
    await this.audioEl.play();
  }

  private async loadBrowserVoices(): Promise<SpeechSynthesisVoice[]> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
    const immediate = window.speechSynthesis.getVoices();
    if (immediate.length > 0) return immediate;

    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        window.speechSynthesis.removeEventListener('voiceschanged', onVoicesChanged);
        resolve(window.speechSynthesis.getVoices());
      };
      const onVoicesChanged = () => {
        if (window.speechSynthesis.getVoices().length > 0) {
          done();
        }
      };
      window.speechSynthesis.addEventListener('voiceschanged', onVoicesChanged);
      window.setTimeout(done, 450);
    });
  }

  private pickBestBrowserVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
    if (voices.length === 0) return null;

    // 1. Exact Kazakh voice if available on the user's OS/browser
    const kkVoices = voices.filter(
      (v) =>
        v.lang.toLowerCase().startsWith('kk') ||
        v.name.toLowerCase().includes('kazakh') ||
        v.name.toLowerCase().includes('қазақ')
    );
    if (kkVoices.length > 0) {
      return kkVoices[0];
    }

    // 2. Cyrillic-reading Russian voice so Kazakh Cyrillic text is spoken audibly
    // (Setting lang='kk-KZ' with no Kazakh voice causes Chrome/macOS/Windows to output total silence!)
    const ruVoices = voices.filter((v) => v.lang.toLowerCase().startsWith('ru'));
    if (ruVoices.length > 0) {
      const wantFemale = this.voice === 'Kore';
      const preferred = ruVoices.find((v) => {
        const lower = v.name.toLowerCase();
        return wantFemale
          ? lower.includes('irina') || lower.includes('milena') || lower.includes('svetlana') || lower.includes('female')
          : lower.includes('pavel') || lower.includes('yuri') || lower.includes('dmitry') || lower.includes('male');
      });
      return preferred ?? ruVoices[0];
    }

    // 3. Any default / first system voice
    return voices.find((v) => v.default) ?? voices[0];
  }

  private async speakBrowser(stageId: number, text: string, token: number): Promise<void> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      this.callbacks.onStatusChange(
        'error',
        'Бұл браузерде кіріктірілген дауыстап оқу қолжетімді емес.',
        false
      );
      return;
    }

    const wasBusy = window.speechSynthesis.speaking || window.speechSynthesis.pending;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }

    const voices = await this.loadBrowserVoices();
    if (token !== this.currentRequestToken) return;

    const chosenVoice = this.pickBestBrowserVoice(voices);
    const utterance = new SpeechSynthesisUtterance(text);
    if (chosenVoice) {
      utterance.voice = chosenVoice;
      utterance.lang = chosenVoice.lang;
    } else {
      utterance.lang = 'ru-RU';
    }
    utterance.volume = 1.0;
    utterance.rate = 0.95;
    utterance.pitch = this.voice === 'Kore' ? 1.08 : 0.92;

    this.activeUtterance = utterance;

    utterance.onstart = () => {
      if (token !== this.currentRequestToken) return;
      this.isSpeakingNow = true;
      this.callbacks.onStatusChange('speaking');
    };

    utterance.onend = () => {
      if (token !== this.currentRequestToken) return;
      this.clearBrowserTimers();
      this.activeUtterance = null;
      this.isSpeakingNow = false;
      this.callbacks.onStatusChange('idle');
      this.callbacks.onStageFinished(stageId);
    };

    utterance.onerror = (ev) => {
      if (token !== this.currentRequestToken) return;
      // Ignore 'canceled' / 'interrupted' caused by user switching stages or stopping
      if (ev.error === 'canceled' || ev.error === 'interrupted') {
        return;
      }
      this.clearBrowserTimers();
      this.activeUtterance = null;
      this.isSpeakingNow = false;
      this.callbacks.onStatusChange(
        'error',
        'Браузер дикторы дыбыс шығара алмады. Құрылғы дыбысы қосулы екенін тексеріңіз.',
        false
      );
    };

    const startSpeech = () => {
      if (token !== this.currentRequestToken) return;
      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        window.speechSynthesis.speak(utterance);
        // Chrome keep-alive prevents silent freeze on utterances longer than ~15s
        this.browserKeepAliveTimer = window.setInterval(() => {
          if (token !== this.currentRequestToken) {
            this.clearBrowserTimers();
            return;
          }
          if (window.speechSynthesis.speaking) {
            window.speechSynthesis.resume();
          }
        }, 10000);
      } catch {
        this.callbacks.onStatusChange(
          'error',
          'Браузер дикторын іске қосу мүмкін болмады.',
          false
        );
      }
    };

    // Short delay after cancel() avoids Chrome dropping the newly queued utterance
    if (wasBusy) {
      this.browserSpeakTimer = window.setTimeout(startSpeech, 70);
    } else {
      startSpeech();
    }
  }

  public async speakStage(stageId: number, text: string): Promise<void> {
    const token = ++this.currentRequestToken;
    this.activeStageId = stageId;

    this.stopAudioNodesOnly();

    if (this.provider === 'browser') {
      this.callbacks.onStatusChange('loading');
      await this.speakBrowser(stageId, text, token);
      return;
    }

    this.callbacks.onStatusChange('loading');

    try {
      const cacheKey = this.getCacheKey(stageId, this.voice);
      const wavBytes = await this.fetchAudioBytes(stageId, text, this.voice);
      if (token !== this.currentRequestToken) return;

      await this.playWavViaWebAudioOrElement(stageId, cacheKey, wavBytes, token);
    } catch (err: unknown) {
      if (token !== this.currentRequestToken) return;
      this.isSpeakingNow = false;
      const isQuota = err instanceof TtsQuotaError;
      const isNotAllowed =
        err instanceof DOMException && err.name === 'NotAllowedError';
      const msg = isNotAllowed
        ? 'Браузер дыбыс ойнатуды бұғаттады. «Қайталау» немесе дыбыстау батырмасын қайта басыңыз.'
        : err instanceof Error
          ? err.message
          : 'Қазақша дыбыстауды жүктеу сәтсіз аяқталды.';
      this.callbacks.onStatusChange('error', msg, isQuota);
    }
  }

  public stop(): void {
    this.currentRequestToken++;
    this.activeStageId = -1;
    this.stopAudioNodesOnly();
    this.callbacks.onStatusChange('idle');
  }

  public dispose(): void {
    this.stop();
    for (const url of this.blobUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobUrlCache.clear();
    this.rawBufferCache.clear();
    this.decodedCache.clear();
    this.inflight.clear();
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
      this.gainNode = null;
    }
  }
}
