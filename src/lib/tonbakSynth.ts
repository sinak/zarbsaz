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

/**
 * Acoustic modal-synthesis Persian Tonbak engine.
 * Models a walnut/mulberry goblet drum with stretched goatskin:
 * - Circular membrane Bessel mode ratios (1.00, 1.59, 2.14, 2.30, 2.92)
 * - Helmholtz air-cavity fundamental + skin tension pitch drop on impact
 * - Layered pink-noise skin/fingertip attack transients through wood-body resonant filters
 * - Gentle saturation + wooden room early-reflection reverb + master bus compressor
 */
export class TonbakSynth {
  private ctx: AudioContext | null = null;
  private masterBus: GainNode | null = null;
  private whiteNoise: AudioBuffer | null = null;
  private pinkNoise: AudioBuffer | null = null;
  private volume = 0.88;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterBus = this.ctx.createGain();
      this.masterBus.gain.value = this.volume;

      // Subtle wooden-body warmth EQ
      const warmth = this.ctx.createBiquadFilter();
      warmth.type = 'lowshelf';
      warmth.frequency.value = 180;
      warmth.gain.value = 3.2;

      // Gentle master compressor keeps rapid rolls & loud Toms natural and punchy
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.knee.value = 12;
      comp.ratio.value = 3.2;
      comp.attack.value = 0.003;
      comp.release.value = 0.14;

      // Warm small-room acoustic ambience
      const dryGain = this.ctx.createGain();
      dryGain.gain.value = 0.88;
      const wetGain = this.ctx.createGain();
      wetGain.gain.value = 0.16;

      const reverb = this.ctx.createConvolver();
      reverb.buffer = this.createRoomImpulse(this.ctx, 0.38, 3.6);

      this.masterBus.connect(warmth);
      warmth.connect(comp);
      comp.connect(dryGain).connect(this.ctx.destination);
      comp.connect(reverb).connect(wetGain).connect(this.ctx.destination);

      this.whiteNoise = this.createWhiteNoiseBuffer(this.ctx);
      this.pinkNoise = this.createPinkNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
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

  private createWhiteNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.18);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  /** Paul Kellet pink noise approximation — sounds far warmer and more like real skin than harsh white noise. */
  private createPinkNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.22);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.969 * b2 + white * 0.153852;
      b3 = 0.8665 * b3 + white * 0.3104856;
      b4 = 0.55 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.016898;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.14;
      b6 = white * 0.115926;
    }
    return buf;
  }

  private createRoomImpulse(ctx: AudioContext, durationSec: number, decay: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch += 1) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i += 1) {
        const t = i / length;
        const env = Math.pow(1 - t, decay);
        // Subtle low-pass smoothing on tail for warm wooden room
        const raw = (Math.random() * 2 - 1) * env * 0.38;
        data[i] = i > 0 ? data[i - 1] * 0.35 + raw * 0.65 : raw;
      }
    }
    return impulse;
  }

  /** Play a dry wooden metronome click. */
  public playMetronomeClick(time: number, accented = false) {
    const ctx = this.ensureContext();
    if (!this.masterBus || !this.whiteNoise) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(accented ? 1420 : 980, time);
    osc.frequency.exponentialRampToValueAtTime(accented ? 1120 : 780, time + 0.015);
    gain.gain.setValueAtTime(accented ? 0.16 : 0.09, time);
    gain.gain.exponentialRampToValueAtTime(0.0008, time + 0.024);
    osc.connect(gain).connect(this.masterBus);
    osc.start(time);
    osc.stop(time + 0.03);
  }

  /** Trigger a single realistic tonbak stroke at `time` (AudioContext seconds). */
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
    if (!this.masterBus || !this.whiteNoise || !this.pinkNoise) return;

    const vel = Math.max(0.15, Math.min(1.2, options.velocity ?? 0.92));
    // Natural human micro-variation in strike position/tension (±1.5%)
    const humanPitch = 1 + (Math.random() - 0.5) * 0.028;
    const humanVel = vel * (0.94 + Math.random() * 0.12);

    if (stroke === 'riz') {
      const totalDur = Math.max(0.12, options.durationSec ?? 0.35);
      const baseStep = 0.043;
      const count = Math.max(3, Math.floor(totalDur / baseStep));
      for (let i = 0; i < count; i += 1) {
        const jitter = i === 0 ? 0 : (Math.random() - 0.5) * 0.004;
        const t = Math.max(ctx.currentTime + 0.002, time + i * baseStep + jitter);
        const swell = 0.58 + 0.38 * Math.sin((i / Math.max(1, count - 1)) * Math.PI);
        const isRight = i % 2 === 0;
        const gliss = options.glissando ? 1 + (i / count) * 0.32 : 1;
        this.synthModalRim(ctx, t, {
          fundamental: (isRight ? 305 : 355) * gliss * humanPitch,
          decay: 0.044,
          skinFreq: isRight ? 2100 : 2850,
          snapFreq: isRight ? 3600 : 4400,
          gain: humanVel * swell * 0.62,
          toneWeight: 0.42,
          snapWeight: 1.05,
        });
      }
      return;
    }

    switch (stroke) {
      case 'tom': {
        // Authentic deep center goatskin Tom (تُم):
        // 1. Helmholtz goblet cavity + fundamental skin mode with tension pitch-drop
        const f0 = 90 * humanPitch;
        this.playMode(ctx, time, f0 * 1.62, f0, 0.036, 0.36, humanVel * 0.88, 'sine');
        // 2. Circular membrane Bessel overtones (1.59x and 2.14x — non-harmonic = real drumhead!)
        this.playMode(ctx, time, f0 * 1.59 * 1.25, f0 * 1.59, 0.022, 0.17, humanVel * 0.28, 'sine');
        this.playMode(ctx, time, f0 * 2.14 * 1.15, f0 * 2.14, 0.016, 0.095, humanVel * 0.14, 'sine');
        // 3. Soft fleshy finger/palm skin contact thump (pink noise lowpass + midrange wood tap)
        this.playNoiseBurst(ctx, time, this.pinkNoise, 'bandpass', 420, 1.1, 0.028, humanVel * 0.65);
        this.playNoiseBurst(ctx, time, this.pinkNoise, 'bandpass', 1150, 1.6, 0.014, humanVel * 0.24);
        break;
      }

      case 'bak_r': {
        // Right-hand Bak (بک راست): dry, crisp rim hit with clear wood-shell crack
        this.synthModalRim(ctx, time, {
          fundamental: 295 * humanPitch,
          decay: 0.068,
          skinFreq: 1850,
          snapFreq: 3450,
          gain: humanVel * 0.88,
          toneWeight: 0.46,
          snapWeight: 1.15,
        });
        break;
      }

      case 'bak_l': {
        // Left-hand Bak (بک چپ): slightly tighter & higher rim pitch; finger 3/= brighter
        const fingerShift = options.finger === '3' || options.finger === '=' ? 1.09 : 1.0;
        this.synthModalRim(ctx, time, {
          fundamental: 348 * fingerShift * humanPitch,
          decay: 0.056,
          skinFreq: 2450,
          snapFreq: 4150,
          gain: humanVel * 0.8,
          toneWeight: 0.42,
          snapWeight: 1.18,
        });
        break;
      }

      case 'pelang_r':
      case 'pelang_l': {
        // Pelang (پلنگ): sharp, percussive finger-flick snap off the skin edge
        const isRight = stroke === 'pelang_r';
        this.synthModalRim(ctx, time, {
          fundamental: (isRight ? 430 : 475) * humanPitch,
          decay: 0.038,
          skinFreq: isRight ? 3300 : 3800,
          snapFreq: isRight ? 5200 : 5800,
          gain: humanVel * 0.78,
          toneWeight: 0.3,
          snapWeight: 1.48,
        });
        break;
      }

      case 'chap': {
        // Chap / accented damped rim slap: muted lower-mid body + dry palm slap
        this.synthModalRim(ctx, time, {
          fundamental: 215 * humanPitch,
          decay: 0.052,
          skinFreq: 1320,
          snapFreq: 2650,
          gain: humanVel * 0.94,
          toneWeight: 0.52,
          snapWeight: 1.1,
        });
        break;
      }

      case 'eshareh': {
        // Eshareh (اشاره): delicate ghost fingertip tap near rim
        this.synthModalRim(ctx, time, {
          fundamental: 375 * humanPitch,
          decay: 0.036,
          skinFreq: 2700,
          snapFreq: 4300,
          gain: humanVel * 0.42,
          toneWeight: 0.35,
          snapWeight: 0.9,
        });
        break;
      }
    }
  }

  private playMode(
    ctx: AudioContext,
    time: number,
    startFreq: number,
    endFreq: number,
    bendSec: number,
    decaySec: number,
    peakGain: number,
    type: OscillatorType
  ) {
    if (!this.masterBus) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, time);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), time + bendSec);

    g.gain.setValueAtTime(0.0008, time);
    g.gain.linearRampToValueAtTime(peakGain, time + 0.0025);
    g.gain.exponentialRampToValueAtTime(0.0008, time + decaySec);

    osc.connect(g).connect(this.masterBus);
    osc.start(time);
    osc.stop(time + decaySec + 0.015);
  }

  private playNoiseBurst(
    ctx: AudioContext,
    time: number,
    buffer: AudioBuffer,
    filterType: BiquadFilterType,
    freq: number,
    q: number,
    decaySec: number,
    peakGain: number
  ) {
    if (!this.masterBus) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    // Start at a slight random offset in the noise buffer so consecutive hits never phase-lock
    const offset = Math.random() * 0.05;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freq, time);
    filter.Q.setValueAtTime(q, time);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0008, time);
    g.gain.linearRampToValueAtTime(peakGain, time + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0008, time + decaySec);

    src.connect(filter).connect(g).connect(this.masterBus);
    src.start(time, offset, decaySec + 0.02);
  }

  private synthModalRim(
    ctx: AudioContext,
    time: number,
    p: {
      fundamental: number;
      decay: number;
      skinFreq: number;
      snapFreq: number;
      gain: number;
      toneWeight: number;
      snapWeight: number;
    }
  ) {
    if (!this.pinkNoise || !this.whiteNoise) return;
    // Three inharmonic circular-membrane rim modes (1.00, 1.59, 2.30)
    this.playMode(
      ctx,
      time,
      p.fundamental * 1.14,
      p.fundamental,
      0.012,
      p.decay,
      p.gain * p.toneWeight * 0.65,
      'sine'
    );
    this.playMode(
      ctx,
      time,
      p.fundamental * 1.59,
      p.fundamental * 1.56,
      0.01,
      p.decay * 0.72,
      p.gain * p.toneWeight * 0.36,
      'sine'
    );
    this.playMode(
      ctx,
      time,
      p.fundamental * 2.3,
      p.fundamental * 2.26,
      0.008,
      p.decay * 0.48,
      p.gain * p.toneWeight * 0.18,
      'sine'
    );

    // Warm goatskin mid-crack (pink noise) + crisp fingertip transient (white noise)
    this.playNoiseBurst(
      ctx,
      time,
      this.pinkNoise,
      'bandpass',
      p.skinFreq,
      1.9,
      0.022,
      p.gain * p.snapWeight * 0.78
    );
    this.playNoiseBurst(
      ctx,
      time,
      this.whiteNoise,
      'bandpass',
      p.snapFreq,
      2.2,
      0.011,
      p.gain * p.snapWeight * 0.52
    );
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
          velocity: 0.64,
          finger: g.finger,
        });
      });
    }

    const effectiveStroke: StrokeType = note.tremolo ? 'riz' : note.stroke;
    this.triggerStroke(effectiveStroke, time, {
      velocity: note.accent ? 1.12 : 0.92,
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

  public play(page: TonbakPage, startMeasure = 0, endMeasure = page.measures.length - 1) {
    this.stop(false);
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
