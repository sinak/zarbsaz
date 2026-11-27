import {
  getNoteQuarterBeats,
  resolveMeasureWithOrigin,
  type StrokeType,
  type TonbakNote,
  type TonbakPage,
} from '../types/notation';

export interface ScheduledEvent {
  measureIndex: number;
  /** Index of the measure whose notes are actually being played (differs from measureIndex on `%` repeats). */
  sourceMeasureIndex: number;
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
    const { sourceMeasureIndex, notes: resolvedNotes } = resolveMeasureWithOrigin(
      page.measures,
      mIdx
    );
    for (let nIdx = 0; nIdx < resolvedNotes.length; nIdx += 1) {
      const note = resolvedNotes[nIdx];
      const durSec = getNoteQuarterBeats(note) * quarterSec;
      events.push({
        measureIndex: mIdx,
        sourceMeasureIndex,
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

type SampleKey =
  | 'tom'
  | 'bak_r'
  | 'bak_l'
  | 'pelang_r'
  | 'pelang_l'
  | 'chap'
  | 'eshareh'
  | 'riz'
  | 'gliss';

export type TonbakKitId = 'teacher' | 'cohesive' | 'warm' | 'crisp' | 'original';

export interface TonbakKitInfo {
  id: TonbakKitId;
  label: string;
  description: string;
}

export const TONBAK_KITS: TonbakKitInfo[] = [
  {
    id: 'teacher',
    label: "Teacher's Tonbak",
    description: 'Visually verified single-video cuts from IMG_1151.MOV (43 dB SNR, matched room & drum)',
  },
  {
    id: 'cohesive',
    label: 'Cohesive Studio',
    description: 'All strokes cut from one continuous 9s phrase (matched mic & skin tension)',
  },
  {
    id: 'warm',
    label: 'Warm Walnut',
    description: 'Deeper, woodier voicing with fuller Tom resonance',
  },
  {
    id: 'crisp',
    label: 'Crisp Concert',
    description: 'Tighter dry envelopes & crisp rim articulation for fast passages',
  },
  {
    id: 'original',
    label: 'Original Cut',
    description: 'First un-matched cut for A/B comparison',
  },
];

function getKitUrls(kit: TonbakKitId): Record<SampleKey, string[]> {
  const prefix = kit === 'original' ? '/samples' : `/samples/${kit}`;
  return {
    tom: [`${prefix}/tom_1.wav`, `${prefix}/tom_2.wav`, `${prefix}/tom_3.wav`],
    bak_r: [`${prefix}/bak_r_1.wav`, `${prefix}/bak_r_2.wav`, `${prefix}/bak_r_3.wav`],
    bak_l: [`${prefix}/bak_l_1.wav`, `${prefix}/bak_l_2.wav`, `${prefix}/bak_l_3.wav`],
    pelang_r: [`${prefix}/pelang_r_1.wav`, `${prefix}/pelang_r_2.wav`],
    pelang_l: [`${prefix}/pelang_l_1.wav`, `${prefix}/pelang_l_2.wav`],
    chap: [`${prefix}/chap_1.wav`, `${prefix}/chap_2.wav`],
    eshareh: [`${prefix}/eshareh_1.wav`, `${prefix}/eshareh_2.wav`],
    riz: kit === 'teacher' ? [`${prefix}/riz_1.wav`, `${prefix}/riz_2.wav`] : [],
    gliss: kit === 'teacher' ? [`${prefix}/gliss_1.wav`, `${prefix}/gliss_2.wav`] : [],
  };
}

/**
 * Real Round-Robin Sample-Based Persian Tonbak Engine.
 * Cycles through multiple real recorded hits per stroke so rapid 16th/32nd-note runs
 * and Riz rolls sound like a live wooden Persian tonbak with natural goatskin resonance.
 * Source recording: "Tombak, Alireza.mp3" by sonsbcnintercultural (Freesound #256123, CC BY 3.0).
 */
export class TonbakSynth {
  private ctx: AudioContext | null = null;
  private masterBus: GainNode | null = null;
  private kitCache = new Map<TonbakKitId, Map<SampleKey, AudioBuffer[]>>();
  private loadingPromises = new Map<TonbakKitId, Promise<void>>();
  private activeKit: TonbakKitId = 'teacher';
  private rrCursor = new Map<SampleKey, number>();
  private volume = 0.9;

  public getKit(): TonbakKitId {
    return this.activeKit;
  }

  public setKit(kit: TonbakKitId): Promise<void> {
    this.activeKit = kit;
    return this.preloadSamples(kit);
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterBus = this.ctx.createGain();
      this.masterBus.gain.value = this.volume;

      // Subtle warm wooden-room early reflection + clean master bus limiter
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -8;
      comp.knee.value = 10;
      comp.ratio.value = 2.6;
      comp.attack.value = 0.002;
      comp.release.value = 0.11;

      const dryGain = this.ctx.createGain();
      dryGain.gain.value = 0.93;
      const wetGain = this.ctx.createGain();
      wetGain.gain.value = 0.1;

      const reverb = this.ctx.createConvolver();
      reverb.buffer = this.createRoomImpulse(this.ctx, 0.28, 4.2);

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

  /** Preload and decode all 17 real Persian Tonbak round-robin WAV samples for a kit. */
  public preloadSamples(kit: TonbakKitId = this.activeKit): Promise<void> {
    const existing = this.loadingPromises.get(kit);
    if (existing) return existing;
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      return Promise.resolve();
    }

    const ctx = this.ensureContext();
    const kitBuffers = new Map<SampleKey, AudioBuffer[]>();
    const entries = Object.entries(getKitUrls(kit)) as Array<[SampleKey, string[]]>;

    const promise = Promise.all(
      entries.map(async ([key, urls]) => {
        const decodedList: AudioBuffer[] = [];
        for (const url of urls) {
          try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const arr = await res.arrayBuffer();
            const decoded = await ctx.decodeAudioData(arr);
            decodedList.push(decoded);
          } catch {
            // ignore individual fetch failure
          }
        }
        if (decodedList.length > 0) {
          kitBuffers.set(key, decodedList);
        }
      })
    ).then(() => {
      this.kitCache.set(kit, kitBuffers);
    });

    this.loadingPromises.set(kit, promise);
    return promise;
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
        const raw = (Math.random() * 2 - 1) * env * 0.28;
        data[i] = i > 0 ? data[i - 1] * 0.45 + raw * 0.55 : raw;
      }
    }
    return impulse;
  }

  /** Play a subtle wooden metronome tick. */
  public playMetronomeClick(time: number, accented = false) {
    const ctx = this.ensureContext();
    if (!this.masterBus) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(accented ? 1380 : 960, time);
    osc.frequency.exponentialRampToValueAtTime(accented ? 1080 : 760, time + 0.014);
    gain.gain.setValueAtTime(accented ? 0.13 : 0.075, time);
    gain.gain.exponentialRampToValueAtTime(0.0008, time + 0.02);
    osc.connect(gain).connect(this.masterBus);
    osc.start(time);
    osc.stop(time + 0.025);
  }

  /** Pick the next round-robin recording for a stroke and play it with natural micro-dynamics. */
  private playRoundRobinSample(
    ctx: AudioContext,
    key: SampleKey,
    time: number,
    options: { gain: number; rate?: number }
  ): boolean {
    const kitMap = this.kitCache.get(this.activeKit) || this.kitCache.get('cohesive');
    const list = kitMap?.get(key);
    if (!list || list.length === 0 || !this.masterBus) return false;

    const idx = this.rrCursor.get(key) ?? 0;
    const buf = list[idx % list.length];
    this.rrCursor.set(key, (idx + 1) % list.length);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Tiny ±1.2% organic tension variation on top of true round-robin recordings
    const naturalRate = (options.rate ?? 1) * (1 + (Math.random() - 0.5) * 0.024);
    src.playbackRate.setValueAtTime(naturalRate, time);

    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.02, options.gain), time);

    src.connect(g).connect(this.masterBus);
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
      glissando?: 'up' | 'down' | boolean;
    } = {}
  ) {
    if (stroke === 'rest') return;
    const ctx = this.ensureContext();
    if (!this.masterBus) return;

    const vel = Math.max(0.15, Math.min(1.25, options.velocity ?? 0.94));
    const humanVel = vel * (0.94 + Math.random() * 0.11);

    if (stroke === 'riz') {
      const totalDur = Math.max(0.1, options.durationSec ?? 0.35);

      // Prefer real recorded teacher Riz / Glissando sample, fitted cleanly to fill `totalDur`!
      const kitMap = this.kitCache.get(this.activeKit);
      const preferredKey: SampleKey = options.glissando ? 'gliss' : 'riz';
      const recordedList = kitMap?.get(preferredKey);
      if (recordedList && recordedList.length > 0 && this.masterBus) {
        const idx = this.rrCursor.get(preferredKey) ?? 0;
        const buf = recordedList[idx % recordedList.length];
        this.rrCursor.set(preferredKey, (idx + 1) % recordedList.length);

        const src = ctx.createBufferSource();
        src.buffer = buf;
        if (options.glissando) {
          // Gently time-fit and sweep pitch direction (downward slides high->low, upward slides low->high)
          const baseRate = Math.max(0.72, Math.min(1.45, buf.duration / totalDur));
          if (options.glissando === 'down') {
            src.playbackRate.setValueAtTime(baseRate * 1.18, time);
            src.playbackRate.exponentialRampToValueAtTime(baseRate * 0.86, time + totalDur);
          } else {
            src.playbackRate.setValueAtTime(baseRate * 0.92, time);
            src.playbackRate.exponentialRampToValueAtTime(baseRate * 1.16, time + totalDur);
          }
        } else {
          // Loop the real Riz roll seamlessly if the note is longer than the clip
          src.loop = totalDur > buf.duration;
          src.playbackRate.setValueAtTime(1 + (Math.random() - 0.5) * 0.025, time);
        }

        const g = ctx.createGain();
        const peakG = Math.max(0.05, humanVel * 0.92);
        g.gain.setValueAtTime(0.001, time);
        g.gain.linearRampToValueAtTime(peakG, time + 0.012);
        g.gain.setValueAtTime(peakG, Math.max(time + 0.02, time + totalDur - 0.024));
        g.gain.exponentialRampToValueAtTime(0.001, time + totalDur + 0.006);

        src.connect(g).connect(this.masterBus);
        src.start(time);
        src.stop(time + totalDur + 0.012);
        return;
      }

      // Fallback for kits without recorded Riz clips: duration-filling alternating finger cascade
      const targetStepSec = 0.038;
      const count = Math.max(3, Math.round(totalDur / targetStepSec));
      const exactStep = totalDur / count;
      const cascade: SampleKey[] = ['bak_r', 'bak_l', 'eshareh', 'bak_l'];
      for (let i = 0; i < count; i += 1) {
        const jitter = i === 0 || i === count - 1 ? 0 : (Math.random() - 0.5) * 0.0025;
        const t = Math.max(ctx.currentTime + 0.002, time + i * exactStep + jitter);
        const phase = i / Math.max(1, count - 1);
        const swell = 0.62 + 0.34 * Math.sin(phase * Math.PI);
        const key = cascade[i % cascade.length];
        const glissRate =
          options.glissando === 'down'
            ? 1.24 - phase * 0.3
            : options.glissando
              ? 1 + phase * 0.28
              : 1;
        this.playRoundRobinSample(ctx, key, t, {
          gain: humanVel * swell * (key === 'eshareh' ? 0.92 : 0.78),
          rate: glissRate,
        });
      }
      return;
    }

    const fingerRate =
      stroke === 'bak_l' && (options.finger === '3' || options.finger === '=') ? 1.05 : 1.0;

    this.playRoundRobinSample(ctx, stroke, time, {
      gain: stroke === 'eshareh' ? humanVel * 0.72 : humanVel,
      rate: fingerRate,
    });
  }

  /** Trigger a full TonbakNote including any preceding grace notes. */
  public triggerNote(note: TonbakNote, time: number, durationSec: number) {
    const ctx = this.ensureContext();
    if (note.graceNotes && note.graceNotes.length > 0) {
      const graceSpacing = 0.033;
      const totalGrace = note.graceNotes.length * graceSpacing;
      note.graceNotes.forEach((g, idx) => {
        const gt = Math.max(ctx.currentTime + 0.002, time - totalGrace + idx * graceSpacing);
        this.triggerStroke(g.stroke, gt, {
          velocity: 0.66,
          finger: g.finger,
        });
      });
    }

    const effectiveStroke: StrokeType = note.tremolo ? 'riz' : note.stroke;
    this.triggerStroke(effectiveStroke, time, {
      velocity: note.accent ? 1.12 : 0.95,
      finger: note.finger,
      durationSec,
      glissando: note.glissando,
    });
  }
}

export interface PlayerCallbacks {
  onStep?: (measureIndex: number, sourceMeasureIndex: number, noteId: string) => void;
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
          this.callbacks.onStep?.(ev.measureIndex, ev.sourceMeasureIndex, ev.note.id);
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
