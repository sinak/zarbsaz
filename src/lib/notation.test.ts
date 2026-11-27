import { describe, expect, it } from 'vitest';
import { computeBeamGroups, computeBeamSegments } from './beaming';
import { buildPlaybackTimeline, getQuarterNoteSeconds } from './tonbakSynth';
import { layoutSystems } from '../components/ScoreView';
import {
  cloneMeasureWithNewIds,
  normalizeOcrPage,
  resolveMeasureNotes,
  type Measure,
  type TonbakNote,
  type TonbakPage,
} from '../types/notation';

function mkNote(
  id: string,
  stroke: TonbakNote['stroke'],
  duration: TonbakNote['duration'],
  extra: Partial<TonbakNote> = {}
): TonbakNote {
  return { id, stroke, duration, ...extra };
}

describe('Rhythmic beaming (computeBeamGroups & computeBeamSegments)', () => {
  it('splits six eighth notes in 6/8 into two dotted-quarter beat groups of 3', () => {
    const notes = [0, 1, 2, 3, 4, 5].map((i) => mkNote(`n${i}`, 'bak_r', 'eighth'));
    const groups = computeBeamGroups(notes, { numerator: 6, denominator: 8 });
    expect(groups).toEqual([{ indices: [0, 1, 2] }, { indices: [3, 4, 5] }]);
  });

  it('groups mixed 8th + two 16ths in 2/4 with level-1 across all 3 and level-2 across the 16ths only', () => {
    const notes = [
      mkNote('a', 'tom', 'eighth'),
      mkNote('b', 'bak_l', 'sixteenth'),
      mkNote('c', 'bak_r', 'sixteenth'),
      mkNote('d', 'tom', 'eighth'),
      mkNote('e', 'bak_r', 'eighth'),
    ];
    const groups = computeBeamGroups(notes, { numerator: 2, denominator: 4 });
    expect(groups).toEqual([{ indices: [0, 1, 2] }, { indices: [3, 4] }]);

    const segs = computeBeamSegments(notes, groups[0]);
    expect(segs).toEqual([
      { level: 1, startIdx: 0, endIdx: 2 },
      { level: 2, startIdx: 1, endIdx: 2 },
    ]);
  });

  it('breaks beaming across rests inside a beat', () => {
    const notes = [
      mkNote('a', 'tom', 'eighth'),
      mkNote('r', 'rest', 'eighth'),
      mkNote('b', 'bak_r', 'eighth'),
    ];
    const groups = computeBeamGroups(notes, { numerator: 6, denominator: 8 });
    expect(groups).toEqual([]);
  });

  it('emits inward beamlet hooks for isolated 16ths flanking an 8th', () => {
    const notes = [
      mkNote('a', 'tom', 'sixteenth'),
      mkNote('b', 'bak_l', 'eighth'),
      mkNote('c', 'bak_r', 'sixteenth'),
    ];
    const segs = computeBeamSegments(notes, { indices: [0, 1, 2] });
    expect(segs).toEqual([
      { level: 1, startIdx: 0, endIdx: 2 },
      { level: 2, startIdx: 0, endIdx: 0, hookDirection: 'right' },
      { level: 2, startIdx: 2, endIdx: 2, hookDirection: 'left' },
    ]);
  });
});

describe('Tonbak playback timeline & repeat measure resolution', () => {
  it('computes exact eighth-note duration in 6/8 when tempoBeat is dotted-quarter', () => {
    // At dotted-quarter = 120 BPM, 1 dotted-quarter = 0.5s, so 1 eighth = 0.5 / 3 s
    const quarterSec = getQuarterNoteSeconds(120, 'dotted-quarter');
    expect(quarterSec * 0.5).toBeCloseTo(0.5 / 3, 5);
  });

  it('resolves chained % repeat measures back to the original measure notes', () => {
    const m0: Measure = {
      id: 'm0',
      notes: [mkNote('x1', 'tom', 'quarter'), mkNote('x2', 'bak_r', 'eighth')],
    };
    const m1: Measure = { id: 'm1', isRepeatPrevious: true, notes: [] };
    const m2: Measure = { id: 'm2', isRepeatPrevious: true, notes: [] };

    expect(resolveMeasureNotes([m0, m1, m2], 2).map((n) => n.id)).toEqual(['x1', 'x2']);

    const page: TonbakPage = {
      id: 'p1',
      title: 'Test',
      timeSignature: { numerator: 6, denominator: 8 },
      tempo: 120,
      tempoBeat: 'dotted-quarter',
      measures: [m0, m1, m2],
      createdAt: 0,
      updatedAt: 0,
    };

    const timeline = buildPlaybackTimeline(page, 1, 2);
    // Measures 1 and 2 each have 2 notes => 4 total events, starting at t=0
    expect(timeline.events).toHaveLength(4);
    expect(timeline.events[0].measureIndex).toBe(1);
    expect(timeline.events[0].sourceMeasureIndex).toBe(0);
    expect(timeline.events[0].startSec).toBe(0);
    expect(timeline.events[2].measureIndex).toBe(2);
    expect(timeline.events[2].sourceMeasureIndex).toBe(0);
    // Each measure is 1.5 quarter beats = 1 dotted-quarter = 0.5s at 120 BPM
    expect(timeline.events[2].startSec).toBeCloseTo(0.5, 5);
    expect(timeline.totalDurationSec).toBeCloseTo(1.0, 5);
  });
});

describe('OCR JSON normalization & copy-paste cloning', () => {
  it('sanitizes untrusted OCR output and preserves pelang grace notes and repeat bars', () => {
    const page = normalizeOcrPage(
      {
        title: '  صفحه ۵۸  ',
        timeSignature: { numerator: 6, denominator: 8 },
        tempo: 999, // out of range -> should fall back
        measures: [
          {
            notes: [
              {
                stroke: 'tom',
                duration: 'eighth',
                graceNotes: [{ stroke: 'pelang_r' }, { stroke: 'pelang_l' }],
              },
              { stroke: 'UNKNOWN_STROKE', duration: 'sixteenth' },
            ],
          },
          { isRepeatPrevious: true, notes: [] },
        ],
      },
      'Fallback'
    );

    expect(page.title).toBe('صفحه ۵۸');
    expect(page.tempo).toBe(96);
    expect(page.measures).toHaveLength(2);
    expect(page.measures[0].notes[0].graceNotes).toHaveLength(2);
    expect(page.measures[0].notes[1].stroke).toBe('bak_r');
    expect(page.measures[1].isRepeatPrevious).toBe(true);
  });

  it('assigns fresh unique IDs when cloning a measure for cross-page copy/paste', () => {
    const original: Measure = {
      id: 'm_orig',
      notes: [mkNote('n_orig', 'tom', 'eighth', { graceNotes: [{ stroke: 'pelang_r' }] })],
    };
    const cloned = cloneMeasureWithNewIds(original);

    expect(cloned.id).not.toBe(original.id);
    expect(cloned.notes[0].id).not.toBe(original.notes[0].id);
    expect(cloned.notes[0].stroke).toBe('tom');
    // Mutating clone must not affect original
    cloned.notes[0].graceNotes![0].stroke = 'bak_l';
    expect(original.notes[0].graceNotes![0].stroke).toBe('pelang_r');
  });

  it('honors scanned barsPerLine on desktop and auto-wraps any appended overflow measures', () => {
    const measures: Measure[] = Array.from({ length: 11 }, (_, i) => ({
      id: `m${i}`,
      notes: [mkNote(`n${i}`, 'tom', 'quarter')],
    }));
    // Original scanned page had [3, 2, 4] = 9 bars; 2 extra bars appended should flow to a 4th line
    const systems = layoutSystems(measures, [3, 2, 4]);
    expect(systems.map((s) => s.measureIndices)).toEqual([
      [0, 1, 2],
      [3, 4],
      [5, 6, 7, 8],
      [9, 10],
    ]);
  });
});
