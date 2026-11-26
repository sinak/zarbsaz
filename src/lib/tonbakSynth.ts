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
 * Physically-inspired Web Audio Persian Tonbak synthesizer.
 * Models goblet wood-body resonance + stretched goat/calfskin membrane harmonics + finger transients.
 */
export class TonbakSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 0.85;

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;

      // Subtle warm acoustic room reverb
      const dryGain = this.ctx.createGain();
      dryGain.gain.value = 0.86;
      const wetGain = this.ctx.createGain();
      wetGain.gain.value = 0.2;

      this.reverbNode = this.ctx.createConvolver();
      this.reverbNode.buffer = this.createRoomImpulse(this.ctx, 0.42, 3.2);

      this.masterGain.connect(dryGain);
      dryGain.connect(this.ctx.destination);

      this.masterGain.connect(this.reverbNode);
      this.reverbNode.connect(wetGain);
      wetGain.connect(this.ctx.destination);

      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.015);
    }
  }

  public getCurrentTime(): number {
    return this.ensureContext().currentTime;
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * 0.15);
    const buf = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  private createRoomImpulse(ctx: AudioContext, durationSec: number, decay: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch += 1) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i += 1) {
        const env = Math.pow(1 - i / length, decay);
        data[i] = (Math.random() * 2 - 1) * env * 0.45;
      }
    }
    return impulse;
  }

  /** Play a subtle wooden metronome tick. */
  public playMetronomeClick(time: number, accented = false) {
    const ctx = this.ensureContext();
    if (!this.masterGain) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(accented ? 1280 : 880, time);
    gain.gain.setValueAtTime(accented ? 0.18 : 0.1, time);
    gain.gain.exponentialRampToValueAtTime(0.0008, time + 0.032);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.04);
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
    if (!this.masterGain || !this.noiseBuffer) return;

    const vel = Math.max(0.15, Math.min(1.2, options.velocity ?? 0.9));
    // Slight organic pitch variation so repeated notes feel alive
    const microDetune = 1 + (Math.random() - 0.5) * 0.018;

    if (stroke === 'riz') {
      const totalDur = Math.max(0.12, options.durationSec ?? 0.35);
      const stepSec = 0.046;
      const count = Math.max(3, Math.floor(totalDur / stepSec));
      for (let i = 0; i < count; i += 1) {
        const t = time + i * stepSec;
        const swell = 0.55 + 0.35 * Math.sin((i / Math.max(1, count - 1)) * Math.PI);
        const subStroke: StrokeType = i % 2 === 0 ? 'bak_r' : 'bak_l';
        const glissShift = options.glissando ? 1 + (i / count) * 0.25 : 1;
        this.synthRimStroke(ctx, t, {
          freq1: (subStroke === 'bak_r' ? 355 : 410) * glissShift * microDetune,
          freq2: (subStroke === 'bak_r' ? 635 : 715) * glissShift * microDetune,
          noiseFreq: subStroke === 'bak_r' ? 2600 : 3200,
          decay: 0.055,
          gain: vel * swell * 0.68,
        });
      }
      return;
    }

    switch (stroke) {
      case 'tom': {
        // Deep resonant center stroke (تُم)
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const g1 = ctx.createGain();
        const g2 = ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(164 * microDetune, time);
        osc1.frequency.exponentialRampToValueAtTime(98 * microDetune, time + 0.048);
        osc1.frequency.exponentialRampToValueAtTime(86 * microDetune, time + 0.38);

        g1.gain.setValueAtTime(0.001, time);
        g1.gain.linearRampToValueAtTime(0.95 * vel, time + 0.004);
        g1.gain.exponentialRampToValueAtTime(0.001, time + 0.42);

        // Warm goblet body second harmonic
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(255 * microDetune, time);
        osc2.frequency.exponentialRampToValueAtTime(192 * microDetune, time + 0.14);

        g2.gain.setValueAtTime(0.001, time);
        g2.gain.linearRampToValueAtTime(0.24 * vel, time + 0.003);
        g2.gain.exponentialRampToValueAtTime(0.001, time + 0.16);

        // Soft palm impact transient
        const noise = ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const lpf = ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.setValueAtTime(520, time);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.32 * vel, time);
        ng.gain.exponentialRampToValueAtTime(0.001, time + 0.032);

        osc1.connect(g1).connect(this.masterGain);
        osc2.connect(g2).connect(this.masterGain);
        noise.connect(lpf).connect(ng).connect(this.masterGain);

        osc1.start(time);
        osc2.start(time);
        noise.start(time);
        osc1.stop(time + 0.44);
        osc2.stop(time + 0.18);
        noise.stop(time + 0.05);
        break;
      }

      case 'bak_r': {
        this.synthRimStroke(ctx, time, {
          freq1: 335 * microDetune,
          freq2: 605 * microDetune,
          noiseFreq: 2450,
          decay: 0.095,
          gain: vel * 0.85,
        });
        break;
      }

      case 'bak_l': {
        const fingerBoost = options.finger === '3' || options.finger === '=' ? 1.07 : 1.0;
        this.synthRimStroke(ctx, time, {
          freq1: 392 * fingerBoost * microDetune,
          freq2: 685 * fingerBoost * microDetune,
          noiseFreq: 3150,
          decay: 0.08,
          gain: vel * 0.78,
        });
        break;
      }

      case 'pelang_r':
      case 'pelang_l': {
        const isRight = stroke === 'pelang_r';
        this.synthRimStroke(ctx, time, {
          freq1: (isRight ? 470 : 515) * microDetune,
          freq2: (isRight ? 860 : 940) * microDetune,
          noiseFreq: isRight ? 4100 : 4550,
          decay: 0.055,
          gain: vel * 0.74,
          snapWeight: 1.35,
        });
        break;
      }

      case 'chap': {
        this.synthRimStroke(ctx, time, {
          freq1: 235 * microDetune,
          freq2: 455 * microDetune,
          noiseFreq: 1650,
          decay: 0.072,
          gain: vel * 0.92,
          snapWeight: 1.15,
        });
        break;
      }

      case 'eshareh': {
        this.synthRimStroke(ctx, time, {
          freq1: 425 * microDetune,
          freq2: 760 * microDetune,
          noiseFreq: 3500,
          decay: 0.045,
          gain: vel * 0.42,
        });
        break;
      }
    }
  }

  private synthRimStroke(
    ctx: AudioContext,
    time: number,
    params: {
      freq1: number;
      freq2: number;
      noiseFreq: number;
      decay: number;
      gain: number;
      snapWeight?: number;
    }
  ) {
    if (!this.masterGain || !this.noiseBuffer) return;
    const { freq1, freq2, noiseFreq, decay, gain, snapWeight = 1 } = params;

    // Primary rim membrane mode
    const osc1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    osc1.type = 'triangle';
    osc1.frequency.setValueAtTime(freq1 * 1.18, time);
    osc1.frequency.exponentialRampToValueAtTime(freq1, time + 0.018);

    g1.gain.setValueAtTime(0.001, time);
    g1.gain.linearRampToValueAtTime(gain * 0.62, time + 0.002);
    g1.gain.exponentialRampToValueAtTime(0.001, time + decay);

    // Upper inharmonic rim mode
    const osc2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(freq2, time);

    g2.gain.setValueAtTime(0.001, time);
    g2.gain.linearRampToValueAtTime(gain * 0.28, time + 0.002);
    g2.gain.exponentialRampToValueAtTime(0.001, time + decay * 0.72);

    // Crisp skin/finger snap transient
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.setValueAtTime(noiseFreq, time);
    bpf.Q.setValueAtTime(1.8, time);

    const ng = ctx.createGain();
    ng.gain.setValueAtTime(gain * 0.55 * snapWeight, time);
    ng.gain.exponentialRampToValueAtTime(0.001, time + 0.024);

    osc1.connect(g1).connect(this.masterGain);
    osc2.connect(g2).connect(this.masterGain);
    noise.connect(bpf).connect(ng).connect(this.masterGain);

    osc1.start(time);
    osc2.start(time);
    noise.start(time);
    osc1.stop(time + decay + 0.02);
    osc2.stop(time + decay + 0.02);
    noise.stop(time + 0.04);
  }

  /** Trigger a full TonbakNote including any preceding grace notes. */
  public triggerNote(note: TonbakNote, time: number, durationSec: number) {
    const ctx = this.ensureContext();
    if (note.graceNotes && note.graceNotes.length > 0) {
      const graceSpacing = 0.036;
      const totalGrace = note.graceNotes.length * graceSpacing;
      note.graceNotes.forEach((g, idx) => {
        const gt = Math.max(ctx.currentTime + 0.002, time - totalGrace + idx * graceSpacing);
        this.triggerStroke(g.stroke, gt, {
          velocity: 0.62,
          finger: g.finger,
        });
      });
    }

    const effectiveStroke: StrokeType = note.tremolo ? 'riz' : note.stroke;
    this.triggerStroke(effectiveStroke, time, {
      velocity: note.accent ? 1.1 : 0.9,
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

    // Schedule metronome clicks if enabled
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

    // Schedule note events within lookahead window
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

    // Handle end of sequence / loop
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
