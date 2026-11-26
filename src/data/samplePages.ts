import { createId, type Measure, type TonbakNote, type TonbakPage } from '../types/notation';

type NoteSpec = Omit<TonbakNote, 'id'>;

function n(
  stroke: NoteSpec['stroke'],
  duration: NoteSpec['duration'],
  opts: Partial<Omit<NoteSpec, 'stroke' | 'duration'>> = {}
): TonbakNote {
  return {
    id: createId('n'),
    stroke,
    duration,
    ...opts,
  };
}

const PELANG_PAIR: NoteSpec['graceNotes'] = [
  { stroke: 'pelang_r' },
  { stroke: 'pelang_l' },
];

function m(notes: TonbakNote[]): Measure {
  return { id: createId('m'), notes };
}

function repeatM(): Measure {
  return { id: createId('m'), isRepeatPrevious: true, notes: [] };
}

const now = Date.now();

/**
 * Sample pages accurately transcribed from the user's Bahman Rajabi Tonbak book photos
 * located in this workspace (IMG_0334.jpeg, IMG_0338.jpeg, IMG_0343.jpeg).
 */
export const SAMPLE_PAGES: TonbakPage[] = [
  {
    id: 'book-page-18',
    title: 'آموزش تنبک — صفحه ۱۸',
    subtitle: 'Page 18 (IMG_0334.jpeg) • 6/8 Pelang & Bak Etude',
    timeSignature: { numerator: 6, denominator: 8 },
    tempo: 96,
    tempoBeat: 'dotted-quarter',
    sourceImage: '/api/book-photos/IMG_0334.jpeg',
    createdAt: now - 3000,
    updatedAt: now - 3000,
    measures: [
      // Line 1 (IMG_0334.jpeg)
      m([
        n('bak_r', 'eighth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'eighth', { finger: '2' }),
        n('bak_r', 'eighth'),
        n('tom', 'eighth'),
        n('bak_l', 'quarter', { finger: '2' }),
      ]),
      m([
        n('bak_r', 'eighth', { graceNotes: PELANG_PAIR }),
        n('tom', 'eighth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'eighth', { finger: '2' }),
        n('bak_r', 'quarter'),
      ]),
      m([
        n('tom', 'eighth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'eighth', { finger: '2' }),
        n('tom', 'eighth'),
        n('bak_r', 'eighth'),
        n('tom', 'quarter'),
      ]),
      // Line 2
      m([
        n('tom', 'eighth', { graceNotes: PELANG_PAIR }),
        n('tom', 'eighth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'eighth', { finger: '2' }),
        n('bak_r', 'quarter'),
      ]),
      m([
        n('tom', 'eighth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'eighth', { finger: '2' }),
        n('tom', 'eighth'),
        n('bak_r', 'eighth'),
        n('tom', 'quarter'),
      ]),
      // Line 3 (with % measure repeats!)
      m([
        n('tom', 'quarter', { graceNotes: PELANG_PAIR }),
        n('bak_r', 'eighth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'eighth', { finger: '2' }),
        n('tom', 'quarter'),
      ]),
      repeatM(),
      repeatM(),
      m([
        n('bak_r', 'eighth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'eighth', { finger: '2' }),
        n('bak_r', 'eighth'),
        n('tom', 'eighth'),
        n('bak_l', 'quarter', { finger: '2' }),
      ]),
      // Line 4
      m([
        n('bak_r', 'quarter', { graceNotes: PELANG_PAIR }),
        n('tom', 'eighth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'eighth', { finger: '2' }),
        n('bak_r', 'quarter'),
      ]),
      repeatM(),
      repeatM(),
      m([
        n('tom', 'eighth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'eighth', { finger: '2' }),
        n('tom', 'eighth'),
        n('bak_r', 'eighth'),
        n('tom', 'quarter'),
      ]),
    ],
  },
  {
    id: 'book-page-39',
    title: 'دوره متوسطه — صفحه ۳۹',
    subtitle: 'Page 39 (IMG_0338.jpeg) • 2/4 32nd-Note & Riz Drills',
    timeSignature: { numerator: 2, denominator: 4 },
    tempo: 66,
    tempoBeat: 'quarter',
    sourceImage: '/api/book-photos/IMG_0338.jpeg',
    createdAt: now - 2000,
    updatedAt: now - 2000,
    measures: [
      // Line 1 (IMG_0338.jpeg)
      m([
        n('tom', 'eighth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'sixteenth'),
        n('bak_r', 'sixteenth'),
        n('tom', 'sixteenth'),
        n('bak_l', 'sixteenth'),
        n('bak_r', 'eighth'),
      ]),
      m([
        n('tom', 'thirtysecond', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'thirtysecond'),
        n('bak_r', 'thirtysecond'),
        n('bak_l', 'thirtysecond'),
        n('tom', 'thirtysecond'),
        n('bak_l', 'thirtysecond'),
        n('bak_r', 'thirtysecond'),
        n('bak_l', 'thirtysecond'),
        n('tom', 'sixteenth'),
        n('bak_l', 'sixteenth'),
        n('bak_r', 'eighth'),
      ]),
      // Line 2
      m([
        n('bak_r', 'eighth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'sixteenth'),
        n('tom', 'sixteenth'),
        n('bak_r', 'sixteenth'),
        n('bak_l', 'sixteenth'),
        n('tom', 'eighth'),
      ]),
      m([
        n('bak_r', 'thirtysecond', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'thirtysecond'),
        n('tom', 'thirtysecond'),
        n('bak_l', 'thirtysecond'),
        n('bak_r', 'thirtysecond'),
        n('bak_l', 'thirtysecond'),
        n('tom', 'thirtysecond'),
        n('bak_l', 'thirtysecond'),
        n('bak_r', 'sixteenth'),
        n('bak_l', 'sixteenth'),
        n('tom', 'eighth'),
      ]),
      // Line 3 (with Riz tremolo!)
      m([
        n('tom', 'sixteenth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'sixteenth'),
        n('riz', 'eighth', { tremolo: true, graceNotes: [{ stroke: 'eshareh' }] }),
        n('tom', 'sixteenth'),
        n('bak_l', 'sixteenth'),
        n('riz', 'eighth', { tremolo: true, graceNotes: [{ stroke: 'eshareh' }] }),
      ]),
      m([
        n('tom', 'thirtysecond'),
        n('bak_l', 'thirtysecond'),
        n('bak_r', 'thirtysecond'),
        n('bak_l', 'thirtysecond'),
        n('tom', 'thirtysecond'),
        n('bak_l', 'thirtysecond'),
        n('bak_r', 'thirtysecond'),
        n('bak_l', 'thirtysecond'),
        n('tom', 'sixteenth'),
        n('bak_l', 'sixteenth'),
        n('riz', 'eighth', { tremolo: true, graceNotes: [{ stroke: 'eshareh' }] }),
      ]),
    ],
  },
  {
    id: 'book-page-58',
    title: 'آموزش تنبک — صفحه ۵۸',
    subtitle: 'Page 58 (IMG_0343.jpeg) • 6/8 Rapid 16th-Note Etude',
    timeSignature: { numerator: 6, denominator: 8 },
    tempo: 104,
    tempoBeat: 'dotted-quarter',
    sourceImage: '/api/book-photos/IMG_0343.jpeg',
    createdAt: now - 1000,
    updatedAt: now - 1000,
    measures: [
      // Line 1 (IMG_0343.jpeg)
      m([
        n('tom', 'eighth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'eighth', { finger: '2' }),
        n('bak_r', 'eighth'),
        n('tom', 'eighth'),
        n('bak_l', 'quarter', { finger: '2' }),
      ]),
      m([
        n('bak_r', 'eighth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'eighth', { finger: '2' }),
        n('bak_r', 'eighth'),
        n('tom', 'eighth'),
        n('bak_l', 'quarter', { finger: '2' }),
      ]),
      m([
        n('bak_r', 'sixteenth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('bak_r', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('bak_r', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('tom', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('tom', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('pelang_r', 'sixteenth'),
        n('pelang_l', 'sixteenth'),
      ]),
      // Line 2
      repeatM(),
      m([
        n('bak_r', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('bak_r', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('tom', 'sixteenth'),
        n('pelang_l', 'sixteenth'),
        n('bak_r', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('bak_r', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('tom', 'sixteenth'),
        n('pelang_l', 'sixteenth'),
      ]),
      m([
        n('bak_r', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('bak_r', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('bak_r', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('tom', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('tom', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('pelang_r', 'sixteenth'),
        n('pelang_l', 'sixteenth'),
      ]),
      // Line 3
      m([
        n('bak_r', 'eighth'),
        n('bak_l', 'eighth', { finger: '2' }),
        n('tom', 'eighth'),
        n('bak_r', 'eighth'),
        n('tom', 'quarter'),
      ]),
      m([
        n('tom', 'eighth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'eighth', { finger: '2' }),
        n('tom', 'eighth'),
        n('bak_r', 'eighth'),
        n('tom', 'quarter'),
      ]),
      m([
        n('tom', 'sixteenth', { graceNotes: PELANG_PAIR }),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('tom', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('tom', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('bak_r', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('bak_r', 'sixteenth'),
        n('bak_l', 'sixteenth', { finger: '2' }),
        n('pelang_r', 'sixteenth'),
        n('pelang_l', 'sixteenth'),
      ]),
    ],
  },
  {
    id: 'my-composition-1',
    title: 'قطعه جدید — My Tonbak Piece',
    subtitle: 'Scratchpad • Copy & paste sections from any page here',
    timeSignature: { numerator: 6, denominator: 8 },
    tempo: 96,
    tempoBeat: 'dotted-quarter',
    createdAt: now,
    updatedAt: now,
    measures: [
      m([
        n('tom', 'eighth'),
        n('bak_l', 'eighth', { finger: '2' }),
        n('bak_r', 'eighth'),
        n('tom', 'eighth'),
        n('bak_l', 'eighth', { finger: '2' }),
        n('bak_r', 'eighth'),
      ]),
      m([
        n('tom', 'quarter'),
        n('bak_r', 'eighth'),
        n('tom', 'eighth'),
        n('bak_l', 'eighth', { finger: '2' }),
        n('bak_r', 'eighth'),
      ]),
    ],
  },
];
