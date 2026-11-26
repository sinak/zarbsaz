import {
  DURATION_BEAM_COUNT,
  getBeamGroupQuarterSize,
  getNoteQuarterBeats,
  type TimeSignature,
  type TonbakNote,
} from '../types/notation';

export interface BeamGroup {
  /** Indices into the measure's notes array */
  indices: number[];
}

export interface BeamSegment {
  /** Beam level: 1 = 8th, 2 = 16th, 3 = 32nd */
  level: 1 | 2 | 3;
  startIdx: number;
  endIdx: number;
  /** For single-note partial hooks (e.g. a 16th beamed to an 8th) */
  hookDirection?: 'left' | 'right';
}

/**
 * Group consecutive beamable notes (8th, 16th, 32nd, non-rest) that fall within
 * the same rhythmic beat group for the given time signature.
 */
export function computeBeamGroups(notes: TonbakNote[], ts: TimeSignature): BeamGroup[] {
  const beatGroupSize = getBeamGroupQuarterSize(ts);
  const groups: BeamGroup[] = [];
  let currentGroup: number[] = [];
  let currentBucket = -1;
  let cursor = 0;

  const flush = () => {
    if (currentGroup.length >= 2) {
      groups.push({ indices: currentGroup });
    }
    currentGroup = [];
  };

  for (let i = 0; i < notes.length; i += 1) {
    const note = notes[i];
    const dur = getNoteQuarterBeats(note);
    const beamCount = note.stroke === 'rest' ? 0 : DURATION_BEAM_COUNT[note.duration];
    // Small epsilon avoids floating point drift at beat boundaries
    const bucket = Math.floor((cursor + 1e-6) / beatGroupSize);

    if (beamCount === 0) {
      flush();
      currentBucket = -1;
    } else if (bucket !== currentBucket) {
      flush();
      currentGroup = [i];
      currentBucket = bucket;
    } else {
      currentGroup.push(i);
    }

    cursor += dur;
  }

  flush();
  return groups;
}

/**
 * Compute primary (level 1), secondary (level 2), and tertiary (level 3) beam segments
 * for a single beam group.
 */
export function computeBeamSegments(notes: TonbakNote[], group: BeamGroup): BeamSegment[] {
  const segments: BeamSegment[] = [];
  const { indices } = group;
  if (indices.length < 2) return segments;

  for (const level of [1, 2, 3] as const) {
    let runStart = -1;

    const flushRun = (runEndPos: number) => {
      if (runStart === -1) return;
      if (runEndPos > runStart) {
        segments.push({
          level,
          startIdx: indices[runStart],
          endIdx: indices[runEndPos],
        });
      } else {
        // Single note needs a partial beamlet hook pointing inward
        const hookDirection: 'left' | 'right' = runStart === 0 ? 'right' : 'left';
        segments.push({
          level,
          startIdx: indices[runStart],
          endIdx: indices[runStart],
          hookDirection,
        });
      }
      runStart = -1;
    };

    for (let pos = 0; pos < indices.length; pos += 1) {
      const note = notes[indices[pos]];
      const count = DURATION_BEAM_COUNT[note.duration];
      if (count >= level) {
        if (runStart === -1) runStart = pos;
      } else {
        flushRun(pos - 1);
      }
    }
    flushRun(indices.length - 1);
  }

  return segments;
}
