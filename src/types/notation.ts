export type StrokeType =
  | 'tom'      // ؟  (تُم — deep bass center stroke)
  | 'bak_r'    // ^  (بک راست — right-hand rim stroke)
  | 'bak_l'    // v̇  (بک چپ — left-hand rim stroke)
  | 'pelang_r' // ^ with arc (پلنگ راست — right snap/flick)
  | 'pelang_l' // v with arc (پلنگ چپ — left snap/flick)
  | 'chap'     // ^̄  (چپ / accented muted rim)
  | 'riz'      // ^v with arc + tremolo (ریز — alternating roll)
  | 'eshareh'  // اشاره — soft ornamental tap
  | 'rest';    // سکوت — rest

export type Duration =
  | 'whole'
  | 'half'
  | 'quarter'
  | 'eighth'
  | 'sixteenth'
  | 'thirtysecond';

export type FingerMark = '2' | '3' | '4' | '=';

export interface GraceNote {
  stroke: StrokeType;
  finger?: FingerMark;
}

export type GlissandoDirection = 'up' | 'down';

export interface TonbakNote {
  id: string;
  stroke: StrokeType;
  duration: Duration;
  dotted?: boolean;
  finger?: FingerMark;
  tremolo?: boolean;
  glissando?: GlissandoDirection | boolean;
  accent?: boolean;
  graceNotes?: GraceNote[];
}

export interface Measure {
  id: string;
  notes: TonbakNote[];
  /** When true, renders the `%` (repeat previous measure) sign and plays the preceding measure. */
  isRepeatPrevious?: boolean;
}

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  createdAt: number;
}

export interface TonbakBook {
  id: string;
  ownerId?: string;
  ownerUsername?: string;
  title: string;
  author: string;
  description: string;
  coverColor: string;
  shareToken?: string;
  isPublic?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TonbakPage {
  id: string;
  ownerId?: string;
  ownerUsername?: string;
  bookId?: string | null;
  sortOrder?: number;
  title: string;
  subtitle?: string;
  timeSignature: TimeSignature;
  tempo: number;
  tempoBeat?: 'quarter' | 'dotted-quarter';
  measures: Measure[];
  /** For scanned/imported book pages: exact number of measures on each printed staff line. */
  barsPerLine?: number[];
  sourceImage?: string;
  shareToken?: string;
  isPublic?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ClipboardPayload {
  kind: 'measures' | 'notes';
  sourceTitle: string;
  timeSignature: TimeSignature;
  measures?: Measure[];
  notes?: TonbakNote[];
}

export interface SavedSnippet {
  id: string;
  name: string;
  timeSignature: TimeSignature;
  measures: Measure[];
  createdAt: number;
}

export interface StrokeInfo {
  type: StrokeType;
  label: string;
  persian: string;
  shortcut: string;
  description: string;
  color: string;
}

export const STROKE_INFO: Record<StrokeType, StrokeInfo> = {
  tom: {
    type: 'tom',
    label: 'Tom',
    persian: 'تُم',
    shortcut: 'T',
    description: 'Deep center bass stroke (dotless hook)',
    color: '#9c3b1e',
  },
  bak_r: {
    type: 'bak_r',
    label: 'Bak R',
    persian: 'بک راست',
    shortcut: 'R',
    description: 'Right-hand rim stroke (^)',
    color: '#1e4d6b',
  },
  bak_l: {
    type: 'bak_l',
    label: 'Bak L',
    persian: 'بک چپ',
    shortcut: 'L',
    description: 'Left-hand rim stroke (v̇)',
    color: '#2d6a4f',
  },
  pelang_r: {
    type: 'pelang_r',
    label: 'Pelang R',
    persian: 'پلنگ راست',
    shortcut: 'P',
    description: 'Right-hand finger snap (^ with arc)',
    color: '#7a4988',
  },
  pelang_l: {
    type: 'pelang_l',
    label: 'Pelang L',
    persian: 'پلنگ چپ',
    shortcut: 'O',
    description: 'Left-hand finger snap (v with arc)',
    color: '#6b4c7a',
  },
  chap: {
    type: 'chap',
    label: 'Chap',
    persian: 'چپ',
    shortcut: 'C',
    description: 'Accented / damped rim stroke (^̄)',
    color: '#8f5b14',
  },
  riz: {
    type: 'riz',
    label: 'Riz',
    persian: 'ریز',
    shortcut: 'Z',
    description: 'Alternating finger roll (^v tremolo)',
    color: '#b0413e',
  },
  eshareh: {
    type: 'eshareh',
    label: 'Eshareh',
    persian: 'اشاره',
    shortcut: 'E',
    description: 'Soft ornamental tap',
    color: '#5a6270',
  },
  rest: {
    type: 'rest',
    label: 'Rest',
    persian: 'سکوت',
    shortcut: '0',
    description: 'Silence / rhythmic rest',
    color: '#73706a',
  },
};

export const DURATION_QUARTER_VALUE: Record<Duration, number> = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
  thirtysecond: 0.125,
};

export const DURATION_BEAM_COUNT: Record<Duration, number> = {
  whole: 0,
  half: 0,
  quarter: 0,
  eighth: 1,
  sixteenth: 2,
  thirtysecond: 3,
};

export const DURATION_LABELS: Record<Duration, { short: string; name: string; shortcut: string }> = {
  whole: { short: '1', name: 'Whole', shortcut: '1' },
  half: { short: '1/2', name: 'Half', shortcut: '2' },
  quarter: { short: '1/4', name: 'Quarter', shortcut: '3' },
  eighth: { short: '1/8', name: 'Eighth', shortcut: '4' },
  sixteenth: { short: '1/16', name: '16th', shortcut: '5' },
  thirtysecond: { short: '1/32', name: '32nd', shortcut: '6' },
};

let idCounter = 1;
export function createId(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

/** Duration of a single note in quarter-note beats. */
export function getNoteQuarterBeats(note: Pick<TonbakNote, 'duration' | 'dotted'>): number {
  const base = DURATION_QUARTER_VALUE[note.duration] ?? 0.5;
  return note.dotted ? base * 1.5 : base;
}

/** Capacity of a measure in quarter-note beats. */
export function getMeasureQuarterCapacity(ts: TimeSignature): number {
  return (ts.numerator * 4) / ts.denominator;
}

/** Beat group size in quarter-note beats for rhythmic beaming. */
export function getBeamGroupQuarterSize(ts: TimeSignature): number {
  // Compound meters like 6/8, 9/8, 12/8 group by dotted quarter (1.5 quarter beats)
  if (ts.denominator === 8 && ts.numerator % 3 === 0 && ts.numerator >= 6) {
    return 1.5;
  }
  // Simple meters group by one beat (quarter note for /4, eighth note for /8)
  return 4 / ts.denominator;
}

/** Resolve `%` repeat measures and also return the index of the source measure being replayed. */
export function resolveMeasureWithOrigin(
  measures: Measure[],
  index: number
): { sourceMeasureIndex: number; notes: TonbakNote[] } {
  let cursor = index;
  while (cursor >= 0) {
    const m = measures[cursor];
    if (!m) return { sourceMeasureIndex: index, notes: [] };
    if (!m.isRepeatPrevious) {
      return { sourceMeasureIndex: cursor, notes: m.notes };
    }
    cursor -= 1;
  }
  return { sourceMeasureIndex: index, notes: [] };
}

/** Resolve `%` repeat measures by looking back to the nearest non-repeat measure. */
export function resolveMeasureNotes(measures: Measure[], index: number): TonbakNote[] {
  return resolveMeasureWithOrigin(measures, index).notes;
}

/** Deep-clone a measure with fresh unique IDs (for copy/paste). */
export function cloneMeasureWithNewIds(measure: Measure): Measure {
  return {
    id: createId('m'),
    isRepeatPrevious: measure.isRepeatPrevious,
    notes: measure.notes.map(cloneNoteWithNewIds),
  };
}

/** Deep-clone a note with a fresh unique ID. */
export function cloneNoteWithNewIds(note: TonbakNote): TonbakNote {
  return {
    ...note,
    id: createId('n'),
    graceNotes: note.graceNotes ? note.graceNotes.map((g) => ({ ...g })) : undefined,
  };
}

const VALID_STROKES = new Set<StrokeType>([
  'tom',
  'bak_r',
  'bak_l',
  'pelang_r',
  'pelang_l',
  'chap',
  'riz',
  'eshareh',
  'rest',
]);

const VALID_DURATIONS = new Set<Duration>([
  'whole',
  'half',
  'quarter',
  'eighth',
  'sixteenth',
  'thirtysecond',
]);

const VALID_FINGERS = new Set<FingerMark>(['2', '3', '4', '=']);

/** Sanitize untrusted JSON (from Vision OCR or JSON import) into a valid TonbakPage. */
export function normalizeOcrPage(raw: unknown, fallbackTitle = 'Imported Page', sourceImage?: string): TonbakPage {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const tsRaw = (obj.timeSignature && typeof obj.timeSignature === 'object'
    ? obj.timeSignature
    : {}) as Record<string, unknown>;

  const numerator =
    typeof tsRaw.numerator === 'number' && tsRaw.numerator >= 1 && tsRaw.numerator <= 16
      ? Math.round(tsRaw.numerator)
      : 6;
  const denominator =
    typeof tsRaw.denominator === 'number' && [2, 4, 8, 16].includes(tsRaw.denominator)
      ? tsRaw.denominator
      : 8;

  const tempo =
    typeof obj.tempo === 'number' && obj.tempo >= 30 && obj.tempo <= 240
      ? Math.round(obj.tempo)
      : denominator === 8
        ? 96
        : 76;

  const tempoBeat =
    obj.tempoBeat === 'dotted-quarter' || obj.tempoBeat === 'quarter'
      ? obj.tempoBeat
      : denominator === 8 && numerator % 3 === 0
        ? 'dotted-quarter'
        : 'quarter';

  const rawMeasures = Array.isArray(obj.measures) ? obj.measures : [];
  const measures: Measure[] = rawMeasures.map((mRaw) => {
    const m = (mRaw && typeof mRaw === 'object' ? mRaw : {}) as Record<string, unknown>;
    const isRepeatPrevious = Boolean(m.isRepeatPrevious);
    const rawNotes = Array.isArray(m.notes) ? m.notes : [];
    const notes: TonbakNote[] = isRepeatPrevious
      ? []
      : rawNotes.map((nRaw) => {
          const n = (nRaw && typeof nRaw === 'object' ? nRaw : {}) as Record<string, unknown>;
          const stroke: StrokeType = VALID_STROKES.has(n.stroke as StrokeType)
            ? (n.stroke as StrokeType)
            : 'bak_r';
          const duration: Duration = VALID_DURATIONS.has(n.duration as Duration)
            ? (n.duration as Duration)
            : 'eighth';
          const finger: FingerMark | undefined = VALID_FINGERS.has(n.finger as FingerMark)
            ? (n.finger as FingerMark)
            : stroke === 'bak_l'
              ? '2'
              : undefined;
          const graceNotes = Array.isArray(n.graceNotes)
            ? n.graceNotes
                .filter((g) => g && typeof g === 'object')
                .map((g) => {
                  const gObj = g as Record<string, unknown>;
                  const gStroke: StrokeType = VALID_STROKES.has(gObj.stroke as StrokeType)
                    ? (gObj.stroke as StrokeType)
                    : 'pelang_r';
                  return {
                    stroke: gStroke,
                    finger: VALID_FINGERS.has(gObj.finger as FingerMark)
                      ? (gObj.finger as FingerMark)
                      : undefined,
                  };
                })
            : undefined;

          return {
            id: createId('n'),
            stroke,
            duration,
            dotted: Boolean(n.dotted),
            finger,
            tremolo: Boolean(n.tremolo) || stroke === 'riz',
            glissando:
              n.glissando === 'up' || n.glissando === 'down'
                ? n.glissando
                : n.glissando
                  ? 'up'
                  : undefined,
            accent: Boolean(n.accent),
            graceNotes: graceNotes && graceNotes.length > 0 ? graceNotes : undefined,
          };
        });

    return {
      id: createId('m'),
      isRepeatPrevious,
      notes,
    };
  });

  if (measures.length === 0) {
    measures.push({
      id: createId('m'),
      notes: [
        { id: createId('n'), stroke: 'tom', duration: 'eighth' },
        { id: createId('n'), stroke: 'bak_l', duration: 'eighth', finger: '2' },
        { id: createId('n'), stroke: 'bak_r', duration: 'eighth' },
      ],
    });
  }

  const barsPerLine = Array.isArray(obj.barsPerLine)
    ? obj.barsPerLine
        .map((n) => (typeof n === 'number' ? Math.round(n) : 0))
        .filter((n) => n >= 1 && n <= 12)
    : undefined;

  const now = Date.now();
  return {
    id: createId('page'),
    title: typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : fallbackTitle,
    subtitle: typeof obj.subtitle === 'string' && obj.subtitle.trim() ? obj.subtitle.trim() : undefined,
    timeSignature: { numerator, denominator },
    tempo,
    tempoBeat,
    measures,
    barsPerLine: barsPerLine && barsPerLine.length > 0 ? barsPerLine : undefined,
    sourceImage,
    createdAt: now,
    updatedAt: now,
  };
}
