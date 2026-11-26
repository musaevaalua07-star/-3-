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
 * with client-side Blob caching, quota-safe error handling (no aggressive prefetch
 * or 429 retry loops), and an explicit opt-in Browser SpeechSynthesis mode.
 */
export class KazakhNarrationEngine {
  private audioEl: HTMLAudioElement;
  private blobCache = new Map<string, string>();
  private inflight = new Map<string, Promise<string>>();
  private currentRequestToken = 0;
  private activeStageId = -1;
  private voice: NarratorVoice = 'Charon';
  private provider: NarrationProvider = 'gemini';
  private callbacks: NarrationCallbacks;
  private isSpeakingNow = false;

  constructor(callbacks: NarrationCallbacks) {
    this.callbacks = callbacks;
    this.audioEl = new Audio();
    this.audioEl.preload = 'auto';

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

  private async fetchAudioUrl(stageId: number, text: string, voice: NarratorVoice): Promise<string> {
    const key = this.getCacheKey(stageId, voice);
    const cached = this.blobCache.get(key);
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

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      this.blobCache.set(key, url);
      return url;
    })();

    this.inflight.set(key, promise);
    try {
      return await promise;
    } finally {
      this.inflight.delete(key);
    }
  }

  private speakBrowser(stageId: number, text: string, token: number): void {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      this.callbacks.onStatusChange(
        'error',
        'Бұл браузерде кіріктірілген дауыстап оқу қолжетімді емес.',
        false
      );
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'kk-KZ';
    utterance.rate = 0.96;
    utterance.pitch = this.voice === 'Kore' ? 1.08 : 0.92;

    const voices = window.speechSynthesis.getVoices();
    const kkVoice = voices.find((v) => v.lang.toLowerCase().startsWith('kk'));
    if (kkVoice) {
      utterance.voice = kkVoice;
    }

    utterance.onstart = () => {
      if (token !== this.currentRequestToken) return;
      this.isSpeakingNow = true;
      this.callbacks.onStatusChange('speaking');
    };

    utterance.onend = () => {
      if (token !== this.currentRequestToken) return;
      this.isSpeakingNow = false;
      this.callbacks.onStatusChange('idle');
      this.callbacks.onStageFinished(stageId);
    };

    utterance.onerror = () => {
      if (token !== this.currentRequestToken) return;
      this.isSpeakingNow = false;
      this.callbacks.onStatusChange(
        'error',
        'Браузер дикторы мәтінді оқи алмады.',
        false
      );
    };

    window.speechSynthesis.speak(utterance);
  }

  public async speakStage(stageId: number, text: string): Promise<void> {
    const token = ++this.currentRequestToken;
    this.activeStageId = stageId;

    this.audioEl.pause();
    this.audioEl.currentTime = 0;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.isSpeakingNow = false;

    if (this.provider === 'browser') {
      this.speakBrowser(stageId, text, token);
      return;
    }

    this.callbacks.onStatusChange('loading');

    try {
      const url = await this.fetchAudioUrl(stageId, text, this.voice);
      if (token !== this.currentRequestToken) return;

      this.audioEl.src = url;
      this.audioEl.currentTime = 0;
      await this.audioEl.play();
    } catch (err: unknown) {
      if (token !== this.currentRequestToken) return;
      this.isSpeakingNow = false;
      const isQuota = err instanceof TtsQuotaError;
      const msg =
        err instanceof Error ? err.message : 'Қазақша дыбыстауды жүктеу сәтсіз аяқталды.';
      this.callbacks.onStatusChange('error', msg, isQuota);
    }
  }

  public stop(): void {
    this.currentRequestToken++;
    this.activeStageId = -1;
    this.isSpeakingNow = false;
    this.audioEl.pause();
    this.audioEl.currentTime = 0;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    this.callbacks.onStatusChange('idle');
  }

  public dispose(): void {
    this.stop();
    for (const url of this.blobCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobCache.clear();
    this.inflight.clear();
  }
}
