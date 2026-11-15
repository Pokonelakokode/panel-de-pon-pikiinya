// Small WebAudio blip synth. Every sound is generated, nothing is sampled from the ROM.

export type SfxName = 'swap' | 'land' | 'clear' | 'chain' | 'garbage' | 'danger' | 'win' | 'lose' | 'start';

export class Audio {
  private ctx: AudioContext | null = null;
  enabled = true;

  resume(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(name: SfxName, variation = 0): void {
    if (!this.enabled) return;
    this.resume();
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const spec = SOUNDS[name];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = spec.wave;
    const base = spec.freq * Math.pow(2, variation * 0.08);
    osc.frequency.setValueAtTime(base, now);
    if (spec.slide !== 0) osc.frequency.exponentialRampToValueAtTime(Math.max(40, base + spec.slide), now + spec.duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(spec.volume, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + spec.duration + 0.02);
    if (spec.noise) this.noise(ctx, now, spec.duration, spec.volume * 0.5);
  }

  private noise(ctx: AudioContext, now: number, duration: number, volume: number): void {
    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < frames; i++) {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      data[i] = ((seed / 0x7fffffff) * 2 - 1) * (1 - i / frames);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(now);
  }
}

interface SoundSpec { wave: OscillatorType; freq: number; slide: number; duration: number; volume: number; noise?: boolean }

const SOUNDS: Record<SfxName, SoundSpec> = {
  swap: { wave: 'square', freq: 420, slide: 120, duration: 0.06, volume: 0.05 },
  land: { wave: 'triangle', freq: 220, slide: -60, duration: 0.08, volume: 0.06 },
  clear: { wave: 'square', freq: 660, slide: 240, duration: 0.12, volume: 0.06 },
  chain: { wave: 'square', freq: 520, slide: 320, duration: 0.16, volume: 0.075 },
  garbage: { wave: 'sawtooth', freq: 140, slide: -60, duration: 0.24, volume: 0.09, noise: true },
  danger: { wave: 'sawtooth', freq: 300, slide: -120, duration: 0.2, volume: 0.06 },
  win: { wave: 'square', freq: 523, slide: 300, duration: 0.5, volume: 0.08 },
  lose: { wave: 'triangle', freq: 320, slide: -180, duration: 0.6, volume: 0.08 },
  start: { wave: 'square', freq: 700, slide: 100, duration: 0.3, volume: 0.07 },
};

