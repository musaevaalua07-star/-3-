export type NarratorVoice = 'Charon' | 'Kore';

export type NarrationStatus = 'idle' | 'loading' | 'speaking' | 'error';

export interface NarrationCallbacks {
  onStatusChange: (status: NarrationStatus, errorMessage?: string) => void;
  onStageFinished: (stageId: number) => void;
}

/**
 * Manages Kazakh voiceover narration fetched from server-side /api/tts
 * with client-side Blob URL caching, stage pre-fetching, and clean playback control.
 */
export class KazakhNarrationEngine {
  private audioEl: HTMLAudioElement;
  private blobCache = new Map<string, string>();
  private inflight = new Map<string, Promise<string>>();
  private currentRequestToken = 0;
  private activeStageId = -1;
  private voice: NarratorVoice = 'Charon';
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
      this.callbacks.onStatusChange('error', 'Аудио ойнату кезінде қате шықты.');
    });
  }

  public setVoice(nextVoice: NarratorVoice): void {
    this.voice = nextVoice;
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
        let errText = 'Дыбыстау қызметі қолжетімсіз.';
        try {
          const data = (await response.json()) as { error?: string };
          if (data?.error) errText = data.error;
        } catch {
          // ignore JSON parse errors
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

  /** Pre-warm the next stage's Kazakh voiceover in the background */
  public prefetch(stageId: number, text: string): void {
    const key = this.getCacheKey(stageId, this.voice);
    if (this.blobCache.has(key) || this.inflight.has(key)) return;
    void this.fetchAudioUrl(stageId, text, this.voice).catch(() => {
      // silent prefetch failure; active speak() surfaces errors properly
    });
  }

  public async speakStage(stageId: number, text: string): Promise<void> {
    const token = ++this.currentRequestToken;
    this.activeStageId = stageId;

    this.audioEl.pause();
    this.audioEl.currentTime = 0;
    this.isSpeakingNow = false;
    this.callbacks.onStatusChange('loading');

    try {
      const url = await this.fetchAudioUrl(stageId, text, this.voice);
      // Discard stale request if user jumped to another stage or stopped narration
      if (token !== this.currentRequestToken) return;

      this.audioEl.src = url;
      this.audioEl.currentTime = 0;
      await this.audioEl.play();
    } catch (err: unknown) {
      if (token !== this.currentRequestToken) return;
      this.isSpeakingNow = false;
      const msg =
        err instanceof Error ? err.message : 'Қазақша дыбыстауды жүктеу сәтсіз аяқталды.';
      this.callbacks.onStatusChange('error', msg);
    }
  }

  public stop(): void {
    this.currentRequestToken++;
    this.activeStageId = -1;
    this.isSpeakingNow = false;
    this.audioEl.pause();
    this.audioEl.currentTime = 0;
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
