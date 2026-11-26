/**
 * Procedural Web Audio synthesizer for coastal waves, hydraulic surf impact,
 * and rockfall collapse rumble. Zero external audio assets.
 */
export class CoastalAudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private surfFilter: BiquadFilterNode | null = null;
  private surfGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private enabled = false;
  private ducked = false;

  private applyMasterLevel(): void {
    if (!this.masterGain || !this.ctx) return;
    const target = !this.enabled ? 0.0001 : this.ducked ? 0.16 : 0.45;
    this.masterGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.16);
  }

  public setDucking(ducked: boolean): void {
    this.ducked = ducked;
    this.applyMasterLevel();
  }

  public setEnabled(next: boolean): void {
    this.enabled = next;
    if (next) {
      this.initIfNeeded();
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
    }
    this.applyMasterLevel();
  }

  private initIfNeeded(): void {
    if (this.ctx) return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    this.ctx = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.0001;
    masterGain.connect(ctx.destination);
    this.masterGain = masterGain;

    // Generate 3 seconds of brown/pink noise buffer
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * 3;
    const buffer = ctx.createBuffer(1, length, sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.03 * white) / 1.03;
      data[i] = lastOut * 3.2;
    }
    this.noiseBuffer = buffer;

    // Continuous ocean surf bed
    const surfSrc = ctx.createBufferSource();
    surfSrc.buffer = buffer;
    surfSrc.loop = true;

    const surfFilter = ctx.createBiquadFilter();
    surfFilter.type = 'lowpass';
    surfFilter.frequency.value = 340;
    surfFilter.Q.value = 0.8;

    const surfGain = ctx.createGain();
    surfGain.gain.value = 0.22;

    surfSrc.connect(surfFilter);
    surfFilter.connect(surfGain);
    surfGain.connect(masterGain);
    surfSrc.start();

    this.surfFilter = surfFilter;
    this.surfGain = surfGain;
  }

  /** Modulate ocean surf in real time with the 3D wave cycle */
  public updateSurf(waveCrestFactor: number, wavePower: number): void {
    if (!this.enabled || !this.ctx || !this.surfFilter || !this.surfGain) return;
    const now = this.ctx.currentTime;
    const targetFreq = 180 + waveCrestFactor * 520 * Math.min(wavePower, 1.8);
    const targetGain = 0.14 + waveCrestFactor * 0.22 * Math.min(wavePower, 1.8);
    this.surfFilter.frequency.setTargetAtTime(targetFreq, now, 0.15);
    this.surfGain.gain.setTargetAtTime(targetGain, now, 0.15);
  }

  /** Short hydraulic impact splash when a strong wave slams into the cliff notch */
  public triggerWaveSlam(intensity: number): void {
    if (!this.enabled || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const clamped = Math.min(1, Math.max(0.15, intensity));

    // Splash burst
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(900 + clamped * 600, now);
    filter.frequency.exponentialRampToValueAtTime(220, now + 0.65);
    filter.Q.value = 0.7;

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.28 * clamped, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.75);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.8);

    // Low hydraulic thud
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(72, now);
    osc.frequency.exponentialRampToValueAtTime(34, now + 0.28);

    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.001, now);
    oscGain.gain.linearRampToValueAtTime(0.22 * clamped, now + 0.02);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  /** Dramatic geological rumble + debris crash during cliff collapse */
  public triggerRockfall(): void {
    if (!this.enabled || !this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;

    // Deep earth shear rumble
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(64, now);
    osc.frequency.exponentialRampToValueAtTime(24, now + 1.4);

    const oscGain = this.ctx.createGain();
    oscGain.gain.setValueAtTime(0.001, now);
    oscGain.gain.linearRampToValueAtTime(0.45, now + 0.08);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 1.6);

    osc.connect(oscGain);
    oscGain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 1.65);

    // Cascading rockfall debris roar
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1400, now);
    filter.frequency.exponentialRampToValueAtTime(160, now + 1.8);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.55, now + 0.14);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 2.1);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 2.2);
  }

  public dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
    this.masterGain = null;
    this.surfFilter = null;
    this.surfGain = null;
    this.noiseBuffer = null;
  }
}
