import {
  getNoteQuarterBeats,
  resolveMeasureSequenceWithOrigin,
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
    const resolvedSeq = resolveMeasureSequenceWithOrigin(page.measures, mIdx);
    for (const { sourceMeasureIndex, notes: resolvedNotes } of resolvedSeq) {
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
  }

  return { events, totalDurationSec: cursorSec, quarterSec };
}

type SampleKey =
  | 'tom'
  | 'bak_r'
  | 'bak_r_center'
  | 'bak_l'
  | 'bak_l_center'
  | 'pelang'
  | 'pelang_1f'
  | 'pelang_3f'
  | 'bak_pelang'
  | 'pelang_r'
  | 'pelang_l'
  | 'chap'
  | 'eshareh'
  | 'riz_edge'
  | 'riz_pelang'
  | 'riz_full';

export type TonbakKitId = 'my_tonbak' | 'teacher' | 'cohesive' | 'warm' | 'crisp' | 'original';

export interface TonbakKitInfo {
  id: TonbakKitId;
  label: string;
  description: string;
}

export const TONBAK_KITS: TonbakKitInfo[] = [
  {
    id: 'my_tonbak',
    label: 'My Tonbak (Recorded)',
    description: 'Your own live 12-bar recording — all 34 strokes, cascades & 3 Riz styles',
  },
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
  const isFullRecorded = kit === 'my_tonbak';
  return {
    tom: [`${prefix}/tom_1.wav`, `${prefix}/tom_2.wav`, `${prefix}/tom_3.wav`],
    bak_r: [`${prefix}/bak_r_1.wav`, `${prefix}/bak_r_2.wav`, `${prefix}/bak_r_3.wav`],
    bak_r_center: isFullRecorded
      ? [`${prefix}/bak_r_center_1.wav`, `${prefix}/bak_r_center_2.wav`, `${prefix}/bak_r_center_3.wav`]
      : [],
    bak_l: [`${prefix}/bak_l_1.wav`, `${prefix}/bak_l_2.wav`, `${prefix}/bak_l_3.wav`],
    bak_l_center: isFullRecorded
      ? [`${prefix}/bak_l_center_1.wav`, `${prefix}/bak_l_center_2.wav`, `${prefix}/bak_l_center_3.wav`]
      : [],
    pelang: isFullRecorded
      ? [`${prefix}/pelang_1.wav`, `${prefix}/pelang_2.wav`, `${prefix}/pelang_3.wav`]
      : [`${prefix}/pelang_1.wav`, `${prefix}/pelang_2.wav`, `${prefix}/bak_l_1.wav`],
    pelang_1f: isFullRecorded ? [`${prefix}/pelang_1f_1.wav`] : [],
    pelang_3f: isFullRecorded ? [`${prefix}/pelang_3f_1.wav`, `${prefix}/pelang_3f_2.wav`] : [],
    bak_pelang: isFullRecorded
      ? [`${prefix}/bak_pelang_1.wav`, `${prefix}/bak_pelang_2.wav`, `${prefix}/bak_pelang_3.wav`]
      : [],
    pelang_r: [`${prefix}/pelang_r_1.wav`, `${prefix}/pelang_r_2.wav`],
    pelang_l: [`${prefix}/pelang_l_1.wav`, `${prefix}/pelang_l_2.wav`],
    chap: isFullRecorded
      ? [`${prefix}/chap_1.wav`, `${prefix}/chap_2.wav`, `${prefix}/chap_3.wav`]
      : [`${prefix}/chap_1.wav`, `${prefix}/chap_2.wav`],
    eshareh: isFullRecorded ? [] : [`${prefix}/eshareh_1.wav`, `${prefix}/eshareh_2.wav`],
    riz_edge: isFullRecorded ? [`${prefix}/riz_edge_1.wav`] : [],
    riz_pelang: isFullRecorded ? [`${prefix}/riz_pelang_1.wav`] : [],
    riz_full: isFullRecorded ? [`${prefix}/riz_full_1.wav`] : [],
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
  private activeKit: TonbakKitId = 'my_tonbak';
  private rrCursor = new Map<SampleKey, number>();
  private volume = 0.9;

  public getKit(): TonbakKitId {
    return this.activeKit;
  }

  public setKit(kit: TonbakKitId): Promise<void> {
    this.activeKit = kit;
    return this.preloadSamples(kit);
  }

  /** Force-reload a kit's WAV files (e.g. right after saving custom picks in the Sample Picker). */
  public reloadKit(kit: TonbakKitId = this.activeKit): Promise<void> {
    this.kitCache.delete(kit);
    this.loadingPromises.delete(kit);
    this.activeKit = kit;
    return this.preloadSamples(kit, Date.now());
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

  /** Preload and decode all real Persian Tonbak round-robin WAV samples for a kit. */
  public preloadSamples(kit: TonbakKitId = this.activeKit, cacheBust?: number): Promise<void> {
    const existing = this.loadingPromises.get(kit);
    if (existing && !cacheBust) return existing;
    if (typeof window === 'undefined' || typeof fetch === 'undefined') {
      return Promise.resolve();
    }

    const ctx = this.ensureContext();
    const kitBuffers = new Map<SampleKey, AudioBuffer[]>();
    const entries = Object.entries(getKitUrls(kit)) as Array<[SampleKey, string[]]>;
    const qs = cacheBust ? `?v=${cacheBust}` : '';

    const promise = Promise.all(
      entries.map(async ([key, urls]) => {
        const decodedList: AudioBuffer[] = [];
        for (const url of urls) {
          try {
            const res = await fetch(`${url}${qs}`);
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
    options: { gain: number; rate?: number; softenHz?: number; maxDurationSec?: number }
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
    const peakGain = Math.max(0.02, options.gain);
    g.gain.setValueAtTime(peakGain, time);
    if (options.maxDurationSec && options.maxDurationSec > 0.02) {
      const stopAt = time + options.maxDurationSec;
      g.gain.setValueAtTime(peakGain, Math.max(time + 0.01, stopAt - 0.025));
      g.gain.exponentialRampToValueAtTime(0.001, stopAt);
    }

    if (options.softenHz) {
      const lpf = ctx.createBiquadFilter();
      lpf.type = 'lowpass';
      lpf.frequency.setValueAtTime(options.softenHz, time);
      src.connect(lpf).connect(g).connect(this.masterBus);
    } else {
      src.connect(g).connect(this.masterBus);
    }

    src.start(time);
    if (options.maxDurationSec && options.maxDurationSec > 0.02) {
      src.stop(time + options.maxDurationSec + 0.005);
    }
    return true;
  }

  /**
   * Play a real recorded Riz roll continuously for ANY duration (short 16th/8th up to 4-beat whole note)
   * using equal-power crossfaded sustain looping over the steady-state body of the recording.
   */
  private playSustainedRoll(
    ctx: AudioContext,
    key: SampleKey,
    time: number,
    totalDur: number,
    gain: number
  ): boolean {
    const kitMap = this.kitCache.get(this.activeKit);
    const list = kitMap?.get(key);
    if (!list || list.length === 0 || !this.masterBus) return false;

    const buf = list[0];
    const bufDur = buf.duration;
    if (bufDur < 0.25) return false;

    const loopStart = Math.min(0.14, bufDur * 0.15);
    const loopEnd = Math.max(loopStart + 0.25, bufDur - 0.08);
    const xfade = Math.min(0.12, (loopEnd - loopStart) * 0.28);
    const endTime = time + totalDur;
    const peakGain = Math.max(0.02, gain);

    // Short roll that fits completely inside one buffer pass: play directly with clean release
    if (totalDur <= loopEnd) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.setValueAtTime(peakGain, time);
      const fadeStart = Math.max(time + 0.015, endTime - 0.035);
      g.gain.setValueAtTime(peakGain, fadeStart);
      g.gain.linearRampToValueAtTime(0.0005, endTime + 0.01);
      src.connect(g).connect(this.masterBus);
      src.start(time, 0, Math.min(bufDur, totalDur + 0.02));
      return true;
    }

    // Longer roll (e.g. half, dotted half, whole note): seamlessly crossfade steady-state segments
    let cursor = time;
    let segIdx = 0;
    while (cursor < endTime - 0.005 && segIdx < 16) {
      const isFirst = segIdx === 0;
      const offset = isFirst ? 0 : loopStart;
      const availDur = loopEnd - offset;
      const remaining = endTime - cursor;
      const isLast = remaining <= availDur;
      const segDur = isLast ? remaining + 0.015 : availDur;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      // Subtle ±0.8% rate variation on looped segments prevents any mechanical phasing
      src.playbackRate.setValueAtTime(isFirst ? 1.0 : 0.992 + (segIdx % 3) * 0.008, cursor);

      const g = ctx.createGain();
      if (isFirst) {
        g.gain.setValueAtTime(peakGain, cursor);
      } else {
        g.gain.setValueAtTime(0.0005, cursor);
        g.gain.linearRampToValueAtTime(peakGain, cursor + xfade);
      }

      if (isLast) {
        const fadeStart = Math.max(cursor + (isFirst ? 0.015 : xfade), endTime - 0.035);
        g.gain.setValueAtTime(peakGain, fadeStart);
        g.gain.linearRampToValueAtTime(0.0005, endTime + 0.015);
      } else {
        const fadeOutStart = cursor + availDur - xfade;
        g.gain.setValueAtTime(peakGain, fadeOutStart);
        g.gain.linearRampToValueAtTime(0.0005, cursor + availDur);
      }

      src.connect(g).connect(this.masterBus);
      src.start(cursor, offset, Math.min(bufDur - offset, segDur + 0.01));

      if (isLast) break;
      cursor += availDur - xfade;
      segIdx += 1;
    }
    return true;
  }

  /** Trigger a single tonbak stroke at `time` (AudioContext seconds). */
  public triggerStroke(
    stroke: StrokeType,
    time: number,
    options: {
      velocity?: number;
      finger?: string;
      placement?: 'center' | 'edge' | 'loop';
      rizStyle?: 'edge' | 'pelang' | 'full';
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
      const totalDur = Math.max(0.11, options.durationSec ?? 0.35);
      const rizStyle = options.rizStyle ?? 'full';

      // When using a kit with real recorded Riz rolls (e.g. My Tonbak) and no glissando sweep,
      // play the authentic recorded Riz seamlessly for ANY duration via crossfaded sustain looping!
      if (!options.glissando) {
        const rizKey: SampleKey =
          rizStyle === 'edge' ? 'riz_edge' : rizStyle === 'pelang' ? 'riz_pelang' : 'riz_full';
        if (this.playSustainedRoll(ctx, rizKey, time, totalDur, humanVel * 0.96)) {
          return;
        }
      }

      // Dynamic duration-filling Riz (used for Glissando pitch/timbre sweeps & kits without recorded rolls)
      const targetStepSec = rizStyle === 'full' ? 0.031 : 0.036;
      const count = Math.max(4, Math.round(totalDur / targetStepSec));
      const exactStep = totalDur / count;
      const cascade: Array<{ key: SampleKey; rateBias: number; gainBias: number }> =
        rizStyle === 'edge'
          ? [
              { key: 'chap', rateBias: 1.02, gainBias: 0.72 },
              { key: 'bak_l', rateBias: 1.04, gainBias: 0.66 },
            ]
          : rizStyle === 'pelang'
            ? [
                { key: 'chap', rateBias: 1.03, gainBias: 0.72 },
                { key: 'pelang', rateBias: 1.06, gainBias: 0.78 },
              ]
            : [
                { key: 'bak_r', rateBias: 0.98, gainBias: 0.66 },
                { key: 'bak_l', rateBias: 1.03, gainBias: 0.62 },
                { key: 'pelang', rateBias: 1.06, gainBias: 0.76 },
                { key: 'bak_l', rateBias: 1.0, gainBias: 0.6 },
              ];

      for (let i = 0; i < count; i += 1) {
        const jitter = i === 0 || i === count - 1 ? 0 : (Math.random() - 0.5) * 0.002;
        const t = Math.max(ctx.currentTime + 0.002, time + i * exactStep + jitter);
        const phase = i / Math.max(1, count - 1);
        const swell = 0.58 + 0.38 * Math.sin(phase * Math.PI);
        const finger = cascade[i % cascade.length];
        const glissShift =
          options.glissando === 'down'
            ? 1.38 * Math.pow(0.84 / 1.38, phase)
            : options.glissando
              ? 0.84 * Math.pow(1.38 / 0.84, phase)
              : 1.0;

        const softenHz =
          options.glissando === 'down'
            ? 7200 - phase * 4000
            : options.glissando
              ? 3200 + phase * 4000
              : rizStyle === 'pelang'
                ? 6200
                : 4600;

        const remainingSec = Math.max(0.055, time + totalDur - t + 0.025);
        this.playRoundRobinSample(ctx, finger.key, t, {
          gain: humanVel * swell * finger.gainBias,
          rate: finger.rateBias * glissShift,
          softenHz,
          maxDurationSec: Math.min(0.095, remainingSec),
        });
      }
      return;
    }

    // Simultaneous Bak R + Pelang L (×̇ on Page 30)
    if (stroke === 'bak_pelang') {
      if (this.playRoundRobinSample(ctx, 'bak_pelang', time, { gain: humanVel, rate: 1.0 })) {
        return;
      }
      this.playRoundRobinSample(ctx, 'bak_r', time, { gain: humanVel * 0.82, rate: 1.0 });
      this.playRoundRobinSample(ctx, 'pelang', time + 0.002, { gain: humanVel * 0.86, rate: 1.04 });
      return;
    }

    // Soft Tom lead-in grace note before a Riz (S / تُم اشاره)
    if (stroke === 'eshareh') {
      this.playRoundRobinSample(ctx, 'tom', time, {
        gain: humanVel * 0.88,
        rate: 1.0,
        maxDurationSec: 0.36,
      });
      return;
    }

    // One-hand 4-finger cascade (curved arc ◠ over ^ or v in Bahman Rajabi notation).
    // In My Tonbak and Teacher's Kit, pelang_r / pelang_l are real recorded 4-finger cascade samples,
    // so play them directly! Other built-in kits synthesize the 4-finger cascade.
    if (stroke === 'pelang_r' || stroke === 'pelang_l') {
      const isGrace = (options.durationSec ?? 0.2) < 0.08;
      if (this.activeKit === 'my_tonbak' || this.activeKit === 'teacher') {
        this.playRoundRobinSample(ctx, stroke, time, {
          gain: isGrace ? humanVel * 0.88 : humanVel,
          rate: isGrace ? 1.08 : 1.0,
          maxDurationSec: isGrace ? 0.14 : undefined,
        });
        return;
      }

      const stepSec = isGrace ? 0.013 : 0.018;
      const fingerGains = [0.56, 0.72, 0.86, 1.0];
      const fingerRates = [1.08, 1.04, 1.0, 0.96];
      for (let f = 0; f < 4; f += 1) {
        const ft = Math.max(ctx.currentTime + 0.002, time + f * stepSec);
        this.playRoundRobinSample(ctx, stroke, ft, {
          gain: humanVel * fingerGains[f] * (isGrace ? 0.76 : 0.88),
          rate: fingerRates[f],
          softenHz: 5800,
          maxDurationSec: 0.085,
        });
      }
      return;
    }

    // Bak R placement: + = center of skin (warmer/deeper), - = edge (crisper)
    if (stroke === 'bak_r' && options.placement === 'center') {
      if (this.playRoundRobinSample(ctx, 'bak_r_center', time, { gain: humanVel, rate: 1.0 })) {
        return;
      }
      this.playRoundRobinSample(ctx, 'bak_r', time, {
        gain: humanVel * 1.04,
        rate: 0.88,
        softenHz: 3100,
      });
      return;
    }
    if (stroke === 'bak_r' && options.placement === 'edge') {
      this.playRoundRobinSample(ctx, 'chap', time, {
        gain: humanVel,
        rate: 1.02,
      });
      return;
    }

    // Left-hand 2-finger center Bak (v⁼ without dot)
    if (stroke === 'bak_l' && options.finger === '=') {
      if (this.playRoundRobinSample(ctx, 'bak_l_center', time, { gain: humanVel, rate: 1.0 })) {
        return;
      }
      this.playRoundRobinSample(ctx, 'bak_l', time, {
        gain: humanVel * 1.04,
        rate: 0.88,
        softenHz: 2900,
      });
      return;
    }

    // Left-hand Pelang click (v̇ with finger 1=pinky, 2=ring, 3=middle, =)
    if (stroke === 'pelang') {
      if (
        options.finger === '1' &&
        this.playRoundRobinSample(ctx, 'pelang_1f', time, { gain: humanVel, rate: 1.0 })
      ) {
        return;
      }
      if (
        options.finger === '3' &&
        this.playRoundRobinSample(ctx, 'pelang_3f', time, { gain: humanVel, rate: 1.0 })
      ) {
        return;
      }
      const fRate =
        options.finger === '1'
          ? 1.12
          : options.finger === '3'
            ? 1.04
            : options.finger === '='
              ? 0.96
              : 1.0;
      this.playRoundRobinSample(ctx, 'pelang', time, {
        gain: humanVel,
        rate: fRate,
      });
      return;
    }

    this.playRoundRobinSample(ctx, stroke, time, {
      gain: humanVel,
      rate: 1.0,
    });
  }

  /** Trigger a full TonbakNote including any preceding grace notes. */
  public triggerNote(note: TonbakNote, time: number, durationSec: number) {
    const ctx = this.ensureContext();
    if (note.graceNotes && note.graceNotes.length > 0) {
      const isDorrabCascade = note.graceNotes.some(
        (g) => g.stroke === 'pelang_r' || g.stroke === 'pelang_l'
      );
      const isTomLeadIn =
        note.graceNotes.length === 1 &&
        (note.graceNotes[0].stroke === 'eshareh' || note.graceNotes[0].stroke === 'tom');
      const graceSpacing = isDorrabCascade
        ? this.activeKit === 'my_tonbak' || this.activeKit === 'teacher'
          ? 0.078
          : 0.056
        : isTomLeadIn
          ? 0.085
          : note.graceNotes.length >= 4
            ? 0.026
            : 0.036;
      const totalGrace = note.graceNotes.length * graceSpacing;
      note.graceNotes.forEach((g, idx) => {
        const gt = Math.max(ctx.currentTime + 0.002, time - totalGrace + idx * graceSpacing);
        this.triggerStroke(g.stroke, gt, {
          velocity: g.stroke === 'eshareh' || g.stroke === 'tom' ? 0.8 : 0.72,
          finger: g.finger,
          durationSec: 0.05,
        });
      });
    }

    const effectiveStroke: StrokeType = note.tremolo ? 'riz' : note.stroke;
    this.triggerStroke(effectiveStroke, time, {
      velocity: note.accent ? 1.12 : 0.95,
      finger: note.finger,
      placement: note.placement,
      rizStyle: note.rizStyle,
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
