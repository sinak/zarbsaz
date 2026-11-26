import {
  getNoteQuarterBeats,
  resolveMeasureNotes,
  type StrokeType,
  type TonbakNote,
  type TonbakPage,
} from '../types/notation';

export interface ScheduledEvent {
  measureIndex: number;
  noteIndex: number;
  note: TonbakNote;
  startSec: number;
  durationSec: number;
}

/**
 * Compute the duration in seconds of a single quarter-note beat given tempo and tempoBeat.
 * In 6/8 when tempoBeat === 'dotted-quarter' (♩. = 96), one dotted quarter = 1.5 quarter notes = 60/96 sec,
 * so one quarter note = (60 / 96) / 1.5 sec.
 */
export function getQuarterNoteSeconds(
  tempo: number,
  tempoBeat: 'quarter' | 'dotted-quarter' = 'quarter'
): number {
  const safeTempo = Math.max(30, Math.min(240, tempo || 90));
  const beatSec = 60 / safeTempo;
  return tempoBeat === 'dotted-quarter' ? beatSec / 1.5 : beatSec;
}

/**
 * Flatten a range of measures into a timeline of timed note events (in seconds relative to 0).
 */
export function buildPlaybackTimeline(
  page: TonbakPage,
  startMeasure = 0,
  endMeasure = page.measures.length - 1
): { events: ScheduledEvent[]; totalDurationSec: number; quarterSec: number } {
  const quarterSec = getQuarterNoteSeconds(page.tempo, page.tempoBeat);
  const events: ScheduledEvent[] = [];
  let cursorSec = 0;

  const first = Math.max(0, Math.min(startMeasure, page.measures.length - 1));
  const last = Math.max(first, Math.min(endMeasure, page.measures.length - 1));

  for (let mIdx = first; mIdx <= last; mIdx += 1) {
    const resolvedNotes = resolveMeasureNotes(page.measures, mIdx);
    for (let nIdx = 0; nIdx < resolvedNotes.length; nIdx += 1) {
      const note = resolvedNotes[nIdx];
      const durSec = getNoteQuarterBeats(note) * quarterSec;
      events.push({
        measureIndex: mIdx,
        noteIndex: nIdx,
        note,
        startSec: cursorSec,
        durationSec: durSec,
      });
      cursorSec += durSec;
    }
  }

  return { events, totalDurationSec: cursorSec, quarterSec };
}

type SampleKey = 'tom' | 'bak_r' | 'bak_l' | 'pelang_r' | 'pelang_l' | 'chap' | 'eshareh';

const SAMPLE_URLS: Record<SampleKey, string> = {
  tom: '/samples/tom.wav',
  bak_r: '/samples/bak_r.wav',
  bak_l: '/samples/bak_l.wav',
  pelang_r: '/samples/pelang_r.wav',
  pelang_l: '/samples/pelang_l.wav',
  chap: '/samples/chap.wav',
  eshareh: '/samples/eshareh.wav',
};

/**
 * Realistic Sample-Based Persian Tonbak Audio Engine.
 * Plays real recorded acoustic goblet-drum WAV samples sculpted for Persian Tonbak
 * (Tom, Bak R, Bak L, Pelang R/L, Chap, Eshareh) with velocity-linked tone filtering,
 * anti-machine-gun micro-pitch/timing humanization, warm wooden room reverb, and
 * automatic synthesis fallback if samples are still loading.
 */
export class TonbakSynth {
  private ctx: AudioContext | null = null;
  private masterBus: GainNode | null = null;
  private buffers = new Map<SampleKey, AudioBuffer>();
  private loadingPromise: Promise<void> | null = null;
  private volume = 0.88;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterBus = this.ctx.createGain();
      this.masterBus.gain.value = this.volume;

      // Gentle master dynamics compressor for natural punch on rapid rolls & Toms
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -9;
      comp.knee.value = 10;
      comp.ratio.value = 2.8;
      comp.attack.value = 0.002;
      comp.release.value = 0.12;

      // Subtle natural wooden room ambience
      const dryGain = this.ctx.createGain();
      dryGain.gain.value = 0.9;
      const wetGain = this.ctx.createGain();
      wetGain.gain.value = 0.14;

      const reverb = this.ctx.createConvolver();
      reverb.buffer = this.createRoomImpulse(this.ctx, 0.34, 3.8);

      this.masterBus.connect(comp);
      comp.connect(dryGain).connect(this.ctx.destination);
      comp.connect(reverb).connect(wetGain).connect(this.ctx.destination);

      void this.preloadSamples();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  /** Preload and decode all real acoustic tonbak WAV samples into memory. */
  public preloadSamples(): Promise<void> {
    if (this.loadingPromise) return this.loadingPromise;
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      return Promise.resolve();
    }

    const ctx = this.ensureContext();
    this.loadingPromise = Promise.all(
      (Object.entries(SAMPLE_URLS) as Array<[SampleKey, string]>).map(async ([key, url]) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          const arr = await res.arrayBuffer();
          const decoded = await ctx.decodeAudioData(arr);
          this.buffers.set(key, decoded);
        } catch {
          // fallback synth will handle if offline/unavailable
        }
      })
    ).then(() => undefined);

    return this.loadingPromise;
  }

  public setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterBus && this.ctx) {
      this.masterBus.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.015);
    }
  }

  public getCurrentTime(): number {
    return this.ensureContext().currentTime;
  }

  private createRoomImpulse(ctx: AudioContext, durationSec: number, decay: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch += 1) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i += 1) {
        const env = Math.pow(1 - i / length, decay);
        const raw = (Math.random() * 2 - 1) * env * 0.32;
        data[i] = i > 0 ? data[i - 1] * 0.4 + raw * 0.6 : raw;
      }
    }
    return impulse;
  }

  /** Play a crisp wooden metronome tick. */
  public playMetronomeClick(time: number, accented = false) {
    const ctx = this.ensureContext();
    if (!this.masterBus) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(accented ? 1420 : 980, time);
    osc.frequency.exponentialRampToValueAtTime(accented ? 1120 : 780, time + 0.015);
    gain.gain.setValueAtTime(accented ? 0.14 : 0.08, time);
    gain.gain.exponentialRampToValueAtTime(0.0008, time + 0.022);
    osc.connect(gain).connect(this.masterBus);
    osc.start(time);
    osc.stop(time + 0.028);
  }

  /** Play a decoded real acoustic sample with humanization and velocity-linked tone filter. */
  private playSample(
    ctx: AudioContext,
    key: SampleKey,
    time: number,
    options: { gain: number; rate?: number; brightnessHz?: number }
  ): boolean {
    const buf = this.buffers.get(key);
    if (!buf || !this.masterBus) return false;

    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Subtle organic micro-pitch variation (±1.8%) prevents robotic machine-gun repetition
    const humanRate = (options.rate ?? 1) * (1 + (Math.random() - 0.5) * 0.036);
    src.playbackRate.setValueAtTime(humanRate, time);

    // Velocity-sensitive tone filter: softer hits sound slightly warmer, accents brighter
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    const baseBright = options.brightnessHz ?? 9500;
    const velFactor = Math.min(1.15, Math.max(0.55, options.gain));
    tone.frequency.setValueAtTime(baseBright * velFactor, time);

    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.02, options.gain), time);

    src.connect(tone).connect(g).connect(this.masterBus);
    src.start(time);
    return true;
  }

  /** Trigger a single tonbak stroke at `time` (AudioContext seconds). */
  public triggerStroke(
    stroke: StrokeType,
    time: number,
    options: {
      velocity?: number;
      finger?: string;
      durationSec?: number;
      glissando?: boolean;
    } = {}
  ) {
    if (stroke === 'rest') return;
    const ctx = this.ensureContext();
    if (!this.masterBus) return;

    const vel = Math.max(0.15, Math.min(1.25, options.velocity ?? 0.92));
    const humanVel = vel * (0.94 + Math.random() * 0.12);

    if (stroke === 'riz') {
      const totalDur = Math.max(0.12, options.durationSec ?? 0.35);
      const stepSec = 0.042;
      const count = Math.max(3, Math.floor(totalDur / stepSec));
      for (let i = 0; i < count; i += 1) {
        const jitter = i === 0 ? 0 : (Math.random() - 0.5) * 0.004;
        const t = Math.max(ctx.currentTime + 0.002, time + i * stepSec + jitter);
        const swell = 0.56 + 0.4 * Math.sin((i / Math.max(1, count - 1)) * Math.PI);
        const sampleKey: SampleKey = i % 2 === 0 ? 'bak_r' : 'bak_l';
        const glissRate = options.glissando ? 1 + (i / count) * 0.28 : 1;
        const played = this.playSample(ctx, sampleKey, t, {
          gain: humanVel * swell * 0.72,
          rate: glissRate,
          brightnessHz: 7800,
        });
        if (!played) {
          this.fallbackBeep(ctx, t, sampleKey === 'bak_r' ? 310 : 365, 0.04, humanVel * 0.4);
        }
      }
      return;
    }

    const fingerRate =
      stroke === 'bak_l' && (options.finger === '3' || options.finger === '=') ? 1.055 : 1.0;

    const played = this.playSample(ctx, stroke, time, {
      gain: stroke === 'eshareh' ? humanVel * 0.65 : humanVel,
      rate: fingerRate,
      brightnessHz: stroke === 'tom' ? 3800 : 10500,
    });

    if (!played) {
      // Minimal fallback only if sample buffer hasn't decoded yet
      const freq = stroke === 'tom' ? 98 : stroke === 'bak_l' ? 375 : 325;
      this.fallbackBeep(ctx, time, freq, stroke === 'tom' ? 0.24 : 0.06, humanVel * 0.5);
    }
  }

  private fallbackBeep(
    ctx: AudioContext,
    time: number,
    freq: number,
    decay: number,
    gainVal: number
  ) {
    if (!this.masterBus) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.35, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.025);
    g.gain.setValueAtTime(gainVal, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + decay);
    osc.connect(g).connect(this.masterBus);
    osc.start(time);
    osc.stop(time + decay + 0.02);
  }

  /** Trigger a full TonbakNote including any preceding grace notes. */
  public triggerNote(note: TonbakNote, time: number, durationSec: number) {
    const ctx = this.ensureContext();
    if (note.graceNotes && note.graceNotes.length > 0) {
      const graceSpacing = 0.034;
      const totalGrace = note.graceNotes.length * graceSpacing;
      note.graceNotes.forEach((g, idx) => {
        const gt = Math.max(ctx.currentTime + 0.002, time - totalGrace + idx * graceSpacing);
        this.triggerStroke(g.stroke, gt, {
          velocity: 0.68,
          finger: g.finger,
        });
      });
    }

    const effectiveStroke: StrokeType = note.tremolo ? 'riz' : note.stroke;
    this.triggerStroke(effectiveStroke, time, {
      velocity: note.accent ? 1.12 : 0.94,
      finger: note.finger,
      durationSec,
      glissando: note.glissando,
    });
  }
}

export interface PlayerCallbacks {
  onStep?: (measureIndex: number, noteId: string) => void;
  onStateChange?: (isPlaying: boolean) => void;
}

/**
 * Lookahead Web Audio playback scheduler for TonbakPage scores.
 */
export class TonbakPlayer {
  private synth: TonbakSynth;
  private timerId: number | null = null;
  private uiTimers: number[] = [];
  private isPlaying = false;
  private page: TonbakPage | null = null;
  private events: ScheduledEvent[] = [];
  private totalDurationSec = 0;
  private quarterSec = 0.5;
  private nextEventIdx = 0;
  private startAudioTime = 0;
  private loop = false;
  private metronome = false;
  private nextMetroBeat = 0;
  private callbacks: PlayerCallbacks = {};

  constructor(synth: TonbakSynth) {
    this.synth = synth;
  }

  public setCallbacks(cb: PlayerCallbacks) {
    this.callbacks = cb;
  }

  public setOptions(opts: { loop?: boolean; metronome?: boolean; volume?: number }) {
    if (typeof opts.loop === 'boolean') this.loop = opts.loop;
    if (typeof opts.metronome === 'boolean') this.metronome = opts.metronome;
    if (typeof opts.volume === 'number') this.synth.setVolume(opts.volume);
  }

  public async play(page: TonbakPage, startMeasure = 0, endMeasure = page.measures.length - 1) {
    this.stop(false);
    // Ensure real acoustic samples are decoded before scheduling the first beat
    await this.synth.preloadSamples();

    const { events, totalDurationSec, quarterSec } = buildPlaybackTimeline(
      page,
      startMeasure,
      endMeasure
    );
    if (events.length === 0) return;

    this.page = page;
    this.events = events;
    this.totalDurationSec = totalDurationSec;
    this.quarterSec = quarterSec;
    this.nextEventIdx = 0;
    this.nextMetroBeat = 0;
    this.startAudioTime = this.synth.getCurrentTime() + 0.08;
    this.isPlaying = true;
    this.callbacks.onStateChange?.(true);

    this.scheduleTick();
    this.timerId = window.setInterval(() => this.scheduleTick(), 25);
  }

  public stop(notify = true) {
    if (this.timerId !== null) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    this.uiTimers.forEach((id) => window.clearTimeout(id));
    this.uiTimers = [];
    this.isPlaying = false;
    if (notify) {
      this.callbacks.onStateChange?.(false);
    }
  }

  private scheduleTick() {
    if (!this.isPlaying || !this.page) return;
    const now = this.synth.getCurrentTime();
    const lookaheadSec = 0.14;

    if (this.metronome && this.totalDurationSec > 0) {
      const metroStep =
        this.page.tempoBeat === 'dotted-quarter' ? this.quarterSec * 1.5 : this.quarterSec;
      const beatsPerMeasure =
        this.page.tempoBeat === 'dotted-quarter'
          ? Math.max(1, Math.round(this.page.timeSignature.numerator / 3))
          : this.page.timeSignature.numerator;

      while (
        this.nextMetroBeat * metroStep < this.totalDurationSec - 0.001 &&
        this.startAudioTime + this.nextMetroBeat * metroStep < now + lookaheadSec
      ) {
        const beatTime = this.startAudioTime + this.nextMetroBeat * metroStep;
        this.synth.playMetronomeClick(beatTime, this.nextMetroBeat % beatsPerMeasure === 0);
        this.nextMetroBeat += 1;
      }
    }

    while (
      this.nextEventIdx < this.events.length &&
      this.startAudioTime + this.events[this.nextEventIdx].startSec < now + lookaheadSec
    ) {
      const ev = this.events[this.nextEventIdx];
      const noteTime = this.startAudioTime + ev.startSec;
      this.synth.triggerNote(ev.note, noteTime, ev.durationSec);

      const delayMs = Math.max(0, (noteTime - now) * 1000);
      const timer = window.setTimeout(() => {
        if (this.isPlaying) {
          this.callbacks.onStep?.(ev.measureIndex, ev.note.id);
        }
      }, delayMs);
      this.uiTimers.push(timer);

      this.nextEventIdx += 1;
    }

    if (this.nextEventIdx >= this.events.length) {
      const endTime = this.startAudioTime + this.totalDurationSec;
      if (this.loop && endTime < now + lookaheadSec) {
        this.startAudioTime = endTime;
        this.nextEventIdx = 0;
        this.nextMetroBeat = 0;
      } else if (!this.loop && now >= endTime + 0.08) {
        this.stop(true);
      }
    }
  }
}

export const sharedTonbakSynth = new TonbakSynth();
export const sharedTonbakPlayer = new TonbakPlayer(sharedTonbakSynth);
