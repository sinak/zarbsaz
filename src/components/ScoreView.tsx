import React, { useEffect, useMemo, useState } from 'react';
import {
  DURATION_BEAM_COUNT,
  getNoteQuarterBeats,
  STROKE_INFO,
  type Measure,
  type StrokeType,
  type TonbakNote,
  type TonbakPage,
} from '../types/notation';
import { computeBeamGroups, computeBeamSegments } from '../lib/beaming';

export interface ScoreSelection {
  measureStart: number;
  measureEnd: number;
  /** When set, a specific note inside `measureStart` is selected */
  noteId?: string;
}

interface ScoreViewProps {
  page: TonbakPage;
  selection: ScoreSelection | null;
  playingPosition: { measureIndex: number; sourceMeasureIndex?: number; noteId: string } | null;
  onSelectNote: (measureIndex: number, noteId: string, shiftKey: boolean) => void;
  onSelectMeasure: (measureIndex: number, shiftKey: boolean) => void;
  onClearSelection?: () => void;
  onQuickAddNote: (measureIndex: number) => void;
  svgRef?: React.RefObject<SVGSVGElement | null>;
}

const PAGE_WIDTH = 960;
const MARGIN_X = 36;
const USABLE_WIDTH = PAGE_WIDTH - MARGIN_X * 2;
const SYSTEM_HEIGHT = 144;
const STAFF_Y_OFFSET = 104;
const STEM_HEIGHT = 40;
const BEAM_THICKNESS = 4.2;
const BEAM_GAP = 6.2;

/** Render authentic Bahman Rajabi tonbak stroke symbol above a stem/note at (x, y). */
function StrokeGlyph({
  stroke,
  finger,
  placement,
  rizStyle,
  glissando,
  x,
  y,
  color,
  scale = 1,
}: {
  stroke: StrokeType;
  finger?: string;
  placement?: 'center' | 'edge' | 'loop';
  rizStyle?: 'edge' | 'pelang' | 'full';
  glissando?: 'up' | 'down' | boolean;
  x: number;
  y: number;
  color: string;
  scale?: number;
}) {
  if (stroke === 'rest') return null;

  return (
    <g transform={`translate(${x}, ${y}) scale(${scale})`} fill={color} stroke={color}>
      {stroke === 'tom' && (
        // Dotless curved hook (تُم) — authentic Bahman Rajabi Tom glyph with NO dot
        <path
          d="M 3.2 -11.2 C 1.8 -13.6 -3.8 -13.4 -4.4 -8.8 C -4.9 -4.8 -0.4 -3.6 -0.4 1.6"
          fill="none"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {stroke === 'bak_r' && (
        // Caret ^ (Right-hand Bak) with optional + (center), - (edge), or Page 112 loop above
        <g>
          <path
            d="M -4.8 1 L 0 -10.5 L 4.8 1"
            fill="none"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {placement === 'center' && (
            <g strokeWidth="1.6" strokeLinecap="round">
              <line x1={-3.6} y1={-15.5} x2={3.6} y2={-15.5} />
              <line x1={0} y1={-19.1} x2={0} y2={-11.9} />
            </g>
          )}
          {placement === 'edge' && (
            <line x1={-5.5} y1={-14.5} x2={5.5} y2={-14.5} strokeWidth="1.8" strokeLinecap="round" />
          )}
          {placement === 'loop' && (
            // Authentic Rajabi loop/oval curl over ^ (Page 112 lines 1-4)
            <path
              d="M -4.2 -15.5 C -4.2 -19.5 1.8 -19.5 1.8 -15.8 C 1.8 -13.5 -3.6 -13.2 -4.2 -15.5 M -1.2 -13.8 L 5.6 -13.8"
              fill="none"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </g>
      )}

      {stroke === 'bak_l' && (
        // Plain inverted caret v (Left-hand Bak, NO dot; optional = for 2-finger center Bak)
        <g>
          <path
            d="M -4.8 -10.5 L 0 1 L 4.8 -10.5"
            fill="none"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {finger === '=' && (
            <g strokeWidth="1.4">
              <line x1={-4.5} y1={-15.5} x2={4.5} y2={-15.5} />
              <line x1={-4.5} y1={-19} x2={4.5} y2={-19} />
            </g>
          )}
        </g>
      )}

      {stroke === 'pelang' && (
        // Inverted caret v with dot above + optional finger number (1=pinky, 2, 3, 4, =)
        <g>
          <path
            d="M -4.8 -10.5 L 0 1 L 4.8 -10.5"
            fill="none"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={0} cy={-15.2} r={1.6} stroke="none" />
          {finger && finger !== '=' && (
            <text
              x={0}
              y={-20.5}
              textAnchor="middle"
              fontSize="10.5"
              fontWeight="700"
              fontFamily="Georgia, serif"
              stroke="none"
            >
              {finger}
            </text>
          )}
          {finger === '=' && (
            <g strokeWidth="1.4" strokeLinecap="round">
              <line x1={-4.2} y1={-20.5} x2={4.2} y2={-22.5} />
              <line x1={-4.2} y1={-24} x2={4.2} y2={-26} />
            </g>
          )}
        </g>
      )}

      {stroke === 'bak_pelang' && (
        // Dotted × (×̇ — simultaneous Bak R + Pelang L on Page 30)
        <g>
          <line x1={-4.6} y1={-9.5} x2={4.6} y2={0.5} strokeWidth="1.8" strokeLinecap="round" />
          <line x1={4.6} y1={-9.5} x2={-4.6} y2={0.5} strokeWidth="1.8" strokeLinecap="round" />
          <circle cx={0} cy={-14.2} r={1.6} stroke="none" />
        </g>
      )}

      {stroke === 'pelang_r' && (
        // Caret ^ with curved arc above (Right-hand 4-finger cascade)
        <g>
          <path
            d="M -4.5 1 L 0 -9.5 L 4.5 1"
            fill="none"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M -6.5 -12.5 Q 0 -18.5 6.5 -12.5" fill="none" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      )}

      {stroke === 'pelang_l' && (
        // Inverted caret v with curved arc above (Left-hand 4-finger cascade)
        <g>
          <path
            d="M -4.5 -9.5 L 0 1 L 4.5 -9.5"
            fill="none"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M -6.5 -12.5 Q 0 -18.5 6.5 -12.5" fill="none" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      )}

      {stroke === 'chap' && (
        // Caret ^ with macron bar above (Right-hand Bak at the edge)
        <g>
          <path
            d="M -4.6 1 L 0 -9.5 L 4.6 1"
            fill="none"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line x1={-5.5} y1={-14} x2={5.5} y2={-14} strokeWidth="1.8" strokeLinecap="round" />
        </g>
      )}

      {stroke === 'riz' && (
        // ^v Riz:
        // - glissando down: + above ^v
        // - glissando up:   - above ^v
        // - rizStyle 'edge':   plain ^v (no arc, no dot — Page 46 line 3)
        // - rizStyle 'pelang': ^v̇ (dot over v — Page 46 line 4)
        // - rizStyle 'full' (default): ◠(^v) curved arc over both (Page 46 line 5)
        <g>
          <path
            d="M -7.5 1 L -3.8 -9 L 0 1"
            fill="none"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M 1 -9 L 4.8 1 L 8.5 -9"
            fill="none"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {glissando === 'down' ? (
            <g strokeWidth="1.6" strokeLinecap="round">
              <line x1={-3.5} y1={-15.5} x2={4.5} y2={-15.5} />
              <line x1={0.5} y1={-19.5} x2={0.5} y2={-11.5} />
            </g>
          ) : glissando === 'up' || glissando === true ? (
            <line x1={-4.5} y1={-15} x2={5.5} y2={-15} strokeWidth="1.7" strokeLinecap="round" />
          ) : rizStyle === 'edge' ? null : rizStyle === 'pelang' ? (
            <circle cx={4.8} cy={-13.8} r={1.6} stroke="none" />
          ) : (
            <path d="M -9 -12.5 Q 0.5 -20 10 -12.5" fill="none" strokeWidth="1.6" strokeLinecap="round" />
          )}
        </g>
      )}

      {stroke === 'eshareh' && (
        // Authentic Rajabi S-shaped Tom grace lead-in before Riz (Pages 112-113)
        <text
          x={0}
          y={0}
          textAnchor="middle"
          fontSize="12"
          fontWeight="700"
          fontStyle="italic"
          fontFamily="Georgia, serif"
          stroke="none"
        >
          S
        </text>
      )}
    </g>
  );
}

/** Render musical rest glyphs cleanly on the single-line staff. */
function RestGlyph({ duration, x, y, color }: { duration: TonbakNote['duration']; x: number; y: number; color: string }) {
  switch (duration) {
    case 'whole':
      return <rect x={x - 6} y={y} width={12} height={5} fill={color} />;
    case 'half':
      return <rect x={x - 6} y={y - 5} width={12} height={5} fill={color} />;
    case 'quarter':
      return (
        <path
          d={`M ${x - 2} ${y - 16} L ${x + 3} ${y - 8} L ${x - 2.5} ${y - 1} C ${x + 4} ${y + 2} ${x + 2} ${y + 9} ${x - 2} ${y + 11}`}
          fill="none"
          stroke={color}
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'eighth':
      return (
        <g stroke={color} fill={color}>
          <circle cx={x - 2.5} cy={y - 7} r={2.4} stroke="none" />
          <path d={`M ${x - 2} ${y - 7} Q ${x + 3} ${y - 6} ${x + 4.5} ${y - 10} L ${x - 1} ${y + 9}`} fill="none" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      );
    default:
      // 16th or 32nd rest
      return (
        <g stroke={color} fill={color}>
          <circle cx={x - 2.5} cy={y - 10} r={2.1} stroke="none" />
          <circle cx={x - 4} cy={y - 2} r={2.1} stroke="none" />
          <path
            d={`M ${x - 2} ${y - 10} Q ${x + 3} ${y - 9} ${x + 4.5} ${y - 13} L ${x - 2} ${y + 10}`}
            fill="none"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </g>
      );
  }
}

/** Estimate horizontal weight of a measure so dense 16th/32nd-note measures get more room. */
function measureWeight(m: Measure): number {
  if (m.isRepeatPrevious) return 1.1;
  let w = 0.6;
  for (const n of m.notes) {
    const graceExtra = n.graceNotes ? n.graceNotes.length * 0.45 : 0;
    const durWeight =
      n.duration === 'thirtysecond'
        ? 0.68
        : n.duration === 'sixteenth'
          ? 0.78
          : n.duration === 'eighth'
            ? 1.0
            : 1.25;
    w += durWeight + graceExtra;
  }
  return Math.max(1.4, w);
}

/** Partition measures into horizontal lines (systems).
 * When `barsPerLine` is provided (scanned book pages on desktop), honor the exact
 * bar counts from the original printed document; any extra appended bars wrap naturally.
 */
export function layoutSystems(
  measures: Measure[],
  barsPerLine?: number[]
): Array<{ measureIndices: number[]; weights: number[] }> {
  const systems: Array<{ measureIndices: number[]; weights: number[] }> = [];
  let cursor = 0;

  if (barsPerLine && barsPerLine.length > 0) {
    for (const count of barsPerLine) {
      if (cursor >= measures.length) break;
      const take = Math.max(1, Math.min(count, measures.length - cursor));
      const indices: number[] = [];
      const weights: number[] = [];
      for (let k = 0; k < take; k += 1) {
        const idx = cursor + k;
        indices.push(idx);
        weights.push(measureWeight(measures[idx]));
      }
      systems.push({ measureIndices: indices, weights });
      cursor += take;
    }
  }

  let currentIndices: number[] = [];
  let currentWeights: number[] = [];
  let accWeight = 0;

  // Target total weight per system (~19 weight units fits ~3 standard measures or ~2 dense 16th measures)
  const MAX_SYSTEM_WEIGHT = 19.5;

  for (let i = cursor; i < measures.length; i += 1) {
    const w = measureWeight(measures[i]);
    if (
      currentIndices.length > 0 &&
      (accWeight + w > MAX_SYSTEM_WEIGHT || currentIndices.length >= 4)
    ) {
      systems.push({ measureIndices: currentIndices, weights: currentWeights });
      currentIndices = [];
      currentWeights = [];
      accWeight = 0;
    }
    currentIndices.push(i);
    currentWeights.push(w);
    accWeight += w;
  }

  if (currentIndices.length > 0) {
    systems.push({ measureIndices: currentIndices, weights: currentWeights });
  }

  return systems;
}

export const ScoreView: React.FC<ScoreViewProps> = ({
  page,
  selection,
  playingPosition,
  onSelectNote,
  onSelectMeasure,
  onClearSelection,
  onQuickAddNote,
  svgRef,
}) => {
  const [isDesktop, setIsDesktop] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(min-width: 901px)').matches
      : true
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(min-width: 901px)');
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const effectiveBarsPerLine = isDesktop ? page.barsPerLine : undefined;
  const systems = useMemo(
    () => layoutSystems(page.measures, effectiveBarsPerLine),
    [page.measures, effectiveBarsPerLine]
  );
  const headerHeight = 82;
  const totalHeight = headerHeight + systems.length * SYSTEM_HEIGHT + 44;

  const isMeasureSelected = (mIdx: number) =>
    selection !== null && mIdx >= selection.measureStart && mIdx <= selection.measureEnd;

  return (
    <div className="score-paper-wrap">
      <svg
        ref={svgRef}
        className="score-svg"
        viewBox={`0 0 ${PAGE_WIDTH} ${totalHeight}`}
        width="100%"
        role="img"
        aria-label={`Tonbak sheet music: ${page.title}`}
        onClick={() => onClearSelection?.()}
      >
        {/* Warm archival paper background */}
        <rect x={0} y={0} width={PAGE_WIDTH} height={totalHeight} fill="#fbf7ef" rx={6} />

        {/* Header: Persian-style title box on top right + tempo marking on top left */}
        <g transform="translate(36, 22)">
          {/* Tempo marking */}
          <g transform="translate(4, 34)" fill="#241e18">
            <ellipse cx={6} cy={0} rx={5.2} ry={3.8} transform="rotate(-20 6 0)" />
            <line x1={10.5} y1={-1} x2={10.5} y2={-22} stroke="#241e18" strokeWidth={1.6} />
            {page.tempoBeat === 'dotted-quarter' && <circle cx={16} cy={0} r={1.8} />}
            <text
              x={page.tempoBeat === 'dotted-quarter' ? 24 : 18}
              y={3}
              fontSize="15"
              fontWeight="600"
              fontFamily="Georgia, serif"
            >
              = {page.tempo}
            </text>
          </g>

          {/* Title box matching Rajabi book header */}
          <g transform={`translate(${USABLE_WIDTH - 290}, 0)`}>
            <rect
              x={0}
              y={0}
              width={290}
              height={34}
              fill="#f4ede0"
              stroke="#4a3e31"
              strokeWidth={1.1}
              rx={2}
            />
            <text
              x={145}
              y={22}
              textAnchor="middle"
              fontSize="15.5"
              fontWeight="700"
              fontFamily="'Vazirmatn', 'Cormorant Garamond', serif"
              fill="#241e18"
            >
              {page.title}
            </text>
          </g>
          {page.subtitle && (
            <text
              x={USABLE_WIDTH}
              y={50}
              textAnchor="end"
              fontSize="11.5"
              fontFamily="'Inter', sans-serif"
              fill="#6e6050"
            >
              {page.subtitle}
            </text>
          )}
        </g>

        {/* Render each system (line of music) */}
        {systems.map((sys, sysIdx) => {
          const sysTop = headerHeight + sysIdx * SYSTEM_HEIGHT;
          const staffY = sysTop + STAFF_Y_OFFSET;
          const isFirstSystem = sysIdx === 0;
          const prefixWidth = isFirstSystem ? 54 : 26;
          const contentStartX = MARGIN_X + prefixWidth;
          const contentWidth = USABLE_WIDTH - prefixWidth;
          const totalWeight = sys.weights.reduce((a, b) => a + b, 0);

          let cursorX = contentStartX;

          return (
            <g key={sysIdx} className="score-system">
              {/* Single-line percussion staff */}
              <line
                x1={MARGIN_X}
                y1={staffY}
                x2={PAGE_WIDTH - MARGIN_X}
                y2={staffY}
                stroke="#2b231b"
                strokeWidth={1.35}
              />

              {/* Percussion Clef || */}
              <g transform={`translate(${MARGIN_X + 6}, ${staffY})`} stroke="#241e18">
                <line x1={0} y1={-10} x2={0} y2={10} strokeWidth={2.2} />
                <line x1={4.5} y1={-10} x2={4.5} y2={10} strokeWidth={2.2} />
              </g>

              {/* Time signature on first system */}
              {isFirstSystem && (
                <g
                  transform={`translate(${MARGIN_X + 27}, ${staffY})`}
                  fill="#241e18"
                  fontFamily="Georgia, serif"
                  fontWeight="700"
                  textAnchor="middle"
                >
                  <text x={0} y={-4} fontSize="20">
                    {page.timeSignature.numerator}
                  </text>
                  <text x={0} y={17} fontSize="20">
                    {page.timeSignature.denominator}
                  </text>
                </g>
              )}

              {/* Render measures in this system */}
              {sys.measureIndices.map((mIdx, posInSys) => {
                const measure = page.measures[mIdx];
                const mWidth = (sys.weights[posInSys] / totalWeight) * contentWidth;
                const mStartX = cursorX;
                const mEndX = cursorX + mWidth;
                cursorX = mEndX;

                const isLastMeasureOnPage = mIdx === page.measures.length - 1;
                const selectedMeasure = isMeasureSelected(mIdx);
                const isMeasurePlaying = playingPosition?.measureIndex === mIdx;
                const effectiveSourceIdx =
                  playingPosition?.sourceMeasureIndex ?? playingPosition?.measureIndex;
                const isReplaySource =
                  playingPosition !== null &&
                  playingPosition.measureIndex !== effectiveSourceIdx &&
                  effectiveSourceIdx === mIdx;

                // Compute X positions for each note inside this measure
                const innerPadLeft = 18;
                const innerPadRight = 16;
                const innerWidth = Math.max(24, mWidth - innerPadLeft - innerPadRight);

                const noteWeights = measure.notes.map((n) => {
                  const g = n.graceNotes ? n.graceNotes.length * 0.62 : 0;
                  const base = Math.max(0.55, Math.pow(getNoteQuarterBeats(n), 0.55));
                  return base + g;
                });
                const sumNW = noteWeights.reduce((a, b) => a + b, 0) || 1;

                let nCursor = mStartX + innerPadLeft;
                const noteXs = measure.notes.map((n, idx) => {
                  const slotW = (noteWeights[idx] / sumNW) * innerWidth;
                  const graceOffset = n.graceNotes ? Math.min(46, n.graceNotes.length * 10.5) : 0;
                  const cx = nCursor + slotW * 0.36 + graceOffset * 0.65;
                  nCursor += slotW;
                  return cx;
                });

                const beamGroups = computeBeamGroups(measure.notes, page.timeSignature);
                const beamedNoteIndices = new Set<number>();
                beamGroups.forEach((g) => g.indices.forEach((idx) => beamedNoteIndices.add(idx)));

                const beamTopY = staffY - STEM_HEIGHT;

                return (
                  <g key={measure.id} className="score-measure">
                    {/* Measure selection / playback / repeat-source highlight */}
                    {(selectedMeasure || isMeasurePlaying || isReplaySource) && (
                      <rect
                        x={mStartX + 1}
                        y={sysTop + 20}
                        width={Math.max(10, mWidth - 2)}
                        height={SYSTEM_HEIGHT - 28}
                        rx={5}
                        fill={
                          isMeasurePlaying
                            ? 'rgba(217, 130, 43, 0.16)'
                            : isReplaySource
                              ? 'rgba(217, 130, 43, 0.10)'
                              : 'rgba(156, 59, 30, 0.08)'
                        }
                        stroke={
                          isMeasurePlaying
                            ? 'rgba(217, 130, 43, 0.72)'
                            : isReplaySource
                              ? 'rgba(217, 130, 43, 0.55)'
                              : 'rgba(156, 59, 30, 0.45)'
                        }
                        strokeWidth={1.3}
                        strokeDasharray={
                          isReplaySource || (selectedMeasure && !isMeasurePlaying)
                            ? '4 3'
                            : undefined
                        }
                      />
                    )}

                    {/* Clickable measure number badge */}
                    <g
                      className="measure-badge"
                      transform={`translate(${mStartX + 4}, ${sysTop + 24})`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectMeasure(mIdx, e.shiftKey);
                      }}
                      style={{ cursor: 'pointer' }}
                    >
                      <rect
                        x={0}
                        y={-11}
                        width={24}
                        height={15}
                        rx={3}
                        fill={selectedMeasure ? '#9c3b1e' : '#ede4d3'}
                      />
                      <text
                        x={12}
                        y={0}
                        textAnchor="middle"
                        fontSize="9.5"
                        fontWeight="600"
                        fontFamily="'Inter', sans-serif"
                        fill={selectedMeasure ? '#fff' : '#6c5c4b'}
                      >
                        {mIdx + 1}
                      </text>
                    </g>

                    {/* Repeat previous measure sign % */}
                    {measure.isRepeatPrevious ? (
                      <g
                        transform={`translate(${mStartX + mWidth / 2}, ${staffY - 4})`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectMeasure(mIdx, e.shiftKey);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <line
                          x1={-10}
                          y1={10}
                          x2={10}
                          y2={-10}
                          stroke={isMeasurePlaying ? '#c96200' : '#241e18'}
                          strokeWidth={2.8}
                          strokeLinecap="round"
                        />
                        <circle
                          cx={-7}
                          cy={-6}
                          r={2.8}
                          fill={isMeasurePlaying ? '#c96200' : '#241e18'}
                        />
                        <circle
                          cx={7}
                          cy={6}
                          r={2.8}
                          fill={isMeasurePlaying ? '#c96200' : '#241e18'}
                        />
                      </g>
                    ) : measure.notes.length === 0 ? (
                      <g
                        onClick={(e) => {
                          e.stopPropagation();
                          onQuickAddNote(mIdx);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <text
                          x={mStartX + mWidth / 2}
                          y={staffY - 12}
                          textAnchor="middle"
                          fontSize="11"
                          fill="#9c8a76"
                          fontFamily="'Inter', sans-serif"
                        >
                          + Click to add note
                        </text>
                      </g>
                    ) : (
                      <>
                        {/* Beam bars */}
                        {beamGroups.map((group, gIdx) => {
                          const segments = computeBeamSegments(measure.notes, group);
                          return (
                            <g key={gIdx}>
                              {segments.map((seg, sIdx) => {
                                const y = beamTopY + (seg.level - 1) * BEAM_GAP;
                                const x1 = noteXs[seg.startIdx] + 4.4;
                                const x2 = noteXs[seg.endIdx] + 4.4;
                                if (seg.hookDirection) {
                                  const hookLen = 9;
                                  const hx2 = seg.hookDirection === 'right' ? x1 + hookLen : x1 - hookLen;
                                  return (
                                    <line
                                      key={sIdx}
                                      x1={x1}
                                      y1={y}
                                      x2={hx2}
                                      y2={y}
                                      stroke="#241e18"
                                      strokeWidth={BEAM_THICKNESS}
                                    />
                                  );
                                }
                                return (
                                  <line
                                    key={sIdx}
                                    x1={x1}
                                    y1={y}
                                    x2={x2}
                                    y2={y}
                                    stroke="#241e18"
                                    strokeWidth={BEAM_THICKNESS}
                                  />
                                );
                              })}
                            </g>
                          );
                        })}

                        {/* Notes & Rests */}
                        {measure.notes.map((note, nIdx) => {
                          const nx = noteXs[nIdx];
                          const isNoteSelected =
                            selection?.noteId === note.id && selection.measureStart === mIdx;
                          const isNotePlaying =
                            (playingPosition?.measureIndex === mIdx ||
                              effectiveSourceIdx === mIdx) &&
                            playingPosition?.noteId === note.id;

                          const inkColor = isNotePlaying
                            ? '#c96200'
                            : isNoteSelected
                              ? '#9c3b1e'
                              : '#241e18';

                          const symbolColor = isNotePlaying
                            ? '#c96200'
                            : isNoteSelected
                              ? '#9c3b1e'
                              : STROKE_INFO[note.stroke]?.color || '#241e18';

                          const isRest = note.stroke === 'rest';
                          const isHollow = note.duration === 'half' || note.duration === 'whole';
                          const hasStem = !isRest && note.duration !== 'whole';
                          const isBeamed = beamedNoteIndices.has(nIdx);
                          const flagCount = !isBeamed ? DURATION_BEAM_COUNT[note.duration] : 0;
                          const stemX = nx + 4.4;
                          const stemTopY = staffY - STEM_HEIGHT;

                          return (
                            <g
                              key={note.id}
                              className="score-note"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectNote(mIdx, note.id, e.shiftKey);
                              }}
                              style={{ cursor: 'pointer' }}
                            >
                              {/* Generous invisible hit area */}
                              <rect
                                x={nx - 12}
                                y={sysTop + 26}
                                width={24}
                                height={98}
                                fill={
                                  isNotePlaying
                                    ? 'rgba(230, 126, 34, 0.22)'
                                    : isNoteSelected
                                      ? 'rgba(156, 59, 30, 0.14)'
                                      : 'transparent'
                                }
                                rx={4}
                              />

                              {/* Preceding grace notes (Pelang pair / Eshareh) */}
                              {note.graceNotes && note.graceNotes.length > 0 && (
                                <g>
                                  {note.graceNotes.map((g, gi) => {
                                    const gCount = note.graceNotes!.length;
                                    const gx = nx - 11 - (gCount - 1 - gi) * 10;
                                    return (
                                      <g key={gi}>
                                        <ellipse
                                          cx={gx}
                                          cy={staffY}
                                          rx={3.2}
                                          ry={2.3}
                                          transform={`rotate(-20 ${gx} ${staffY})`}
                                          fill={inkColor}
                                        />
                                        <line
                                          x1={gx + 2.8}
                                          y1={staffY - 0.5}
                                          x2={gx + 2.8}
                                          y2={staffY - 22}
                                          stroke={inkColor}
                                          strokeWidth={1.1}
                                        />
                                        <StrokeGlyph
                                          stroke={g.stroke}
                                          finger={g.finger}
                                          x={gx}
                                          y={staffY - 26}
                                          color={symbolColor}
                                          scale={0.72}
                                        />
                                      </g>
                                    );
                                  })}
                                  {/* Grace note beam (2 beams for 2 notes, 3 beams for 3-4 notes) or slash (if 1) */}
                                  {note.graceNotes.length >= 2 ? (
                                    <>
                                      <line
                                        x1={nx - 11 - (note.graceNotes.length - 1) * 10 + 2.8}
                                        y1={staffY - 22}
                                        x2={nx - 11 + 2.8}
                                        y2={staffY - 22}
                                        stroke={inkColor}
                                        strokeWidth={2.2}
                                      />
                                      <line
                                        x1={nx - 11 - (note.graceNotes.length - 1) * 10 + 2.8}
                                        y1={staffY - 18.5}
                                        x2={nx - 11 + 2.8}
                                        y2={staffY - 18.5}
                                        stroke={inkColor}
                                        strokeWidth={2.2}
                                      />
                                      {note.graceNotes.length >= 3 && (
                                        <line
                                          x1={nx - 11 - (note.graceNotes.length - 1) * 10 + 2.8}
                                          y1={staffY - 15}
                                          x2={nx - 11 + 2.8}
                                          y2={staffY - 15}
                                          stroke={inkColor}
                                          strokeWidth={2.2}
                                        />
                                      )}
                                    </>
                                  ) : (
                                    <line
                                      x1={nx - 12}
                                      y1={staffY - 12}
                                      x2={nx - 4}
                                      y2={staffY - 20}
                                      stroke={inkColor}
                                      strokeWidth={1.1}
                                    />
                                  )}
                                  {/* Curved slur from grace notes into main note */}
                                  <path
                                    d={`M ${nx - 11 - (note.graceNotes.length - 1) * 10} ${staffY + 5} Q ${nx - 6 - ((note.graceNotes.length - 1) * 10) / 2} ${staffY + 13} ${nx - 2} ${staffY + 5}`}
                                    fill="none"
                                    stroke={inkColor}
                                    strokeWidth={1.1}
                                  />
                                </g>
                              )}

                              {isRest ? (
                                <RestGlyph duration={note.duration} x={nx} y={staffY} color={inkColor} />
                              ) : (
                                <>
                                  {/* Notehead */}
                                  <ellipse
                                    cx={nx}
                                    cy={staffY}
                                    rx={5.1}
                                    ry={3.7}
                                    transform={`rotate(-18 ${nx} ${staffY})`}
                                    fill={isHollow ? '#fbf7ef' : inkColor}
                                    stroke={inkColor}
                                    strokeWidth={isHollow ? 1.8 : 0.6}
                                  />

                                  {/* Augmentation dot */}
                                  {note.dotted && (
                                    <circle cx={nx + 9} cy={staffY - 3.5} r={1.8} fill={inkColor} />
                                  )}

                                  {/* Stem */}
                                  {hasStem && (
                                    <line
                                      x1={stemX}
                                      y1={staffY - 1}
                                      x2={stemX}
                                      y2={stemTopY}
                                      stroke={inkColor}
                                      strokeWidth={1.45}
                                    />
                                  )}

                                  {/* Unbeamed flags */}
                                  {flagCount > 0 &&
                                    Array.from({ length: flagCount }).map((_, fi) => {
                                      const fy = stemTopY + fi * 6;
                                      return (
                                        <path
                                          key={fi}
                                          d={`M ${stemX} ${fy} C ${stemX + 8} ${fy + 3} ${stemX + 10} ${fy + 11} ${stemX + 4.5} ${fy + 16}`}
                                          fill="none"
                                          stroke={inkColor}
                                          strokeWidth={1.8}
                                          strokeLinecap="round"
                                        />
                                      );
                                    })}

                                  {/* Tremolo slashes for Riz (on stem, or centered above whole notehead) */}
                                  {(note.tremolo || note.stroke === 'riz') && (
                                    <g stroke={inkColor} strokeWidth={1.8} strokeLinecap="round">
                                      {hasStem ? (
                                        <>
                                          <line x1={stemX - 4.5} y1={staffY - 11} x2={stemX + 4.5} y2={staffY - 16} />
                                          <line x1={stemX - 4.5} y1={staffY - 16} x2={stemX + 4.5} y2={staffY - 21} />
                                          <line x1={stemX - 4.5} y1={staffY - 21} x2={stemX + 4.5} y2={staffY - 26} />
                                        </>
                                      ) : (
                                        <>
                                          <line x1={nx - 4.5} y1={staffY - 13} x2={nx + 4.5} y2={staffY - 18} />
                                          <line x1={nx - 4.5} y1={staffY - 18} x2={nx + 4.5} y2={staffY - 23} />
                                          <line x1={nx - 4.5} y1={staffY - 23} x2={nx + 4.5} y2={staffY - 28} />
                                        </>
                                      )}
                                    </g>
                                  )}

                                  {/* Directional Glissando wavy line + 'g' (Bahman Rajabi notation) */}
                                  {note.glissando && (
                                    <g>
                                      {note.glissando === 'down' ? (
                                        <>
                                          <path
                                            d={`M ${nx + 8} ${staffY - 36} q 4 4 7 2 t 7 4 t 7 4 t 7 4 t 7 4`}
                                            fill="none"
                                            stroke={inkColor}
                                            strokeWidth={1.6}
                                            strokeLinecap="round"
                                          />
                                          <text
                                            x={nx + 33}
                                            y={staffY - 4}
                                            fontSize="11.5"
                                            fontFamily="'Inter', sans-serif"
                                            fontWeight="600"
                                            fill={inkColor}
                                          >
                                            g
                                          </text>
                                        </>
                                      ) : (
                                        <>
                                          <path
                                            d={`M ${nx + 8} ${staffY - 12} q 4 -4 7 -2 t 7 -4 t 7 -4 t 7 -4 t 7 -4`}
                                            fill="none"
                                            stroke={inkColor}
                                            strokeWidth={1.6}
                                            strokeLinecap="round"
                                          />
                                          <text
                                            x={nx + 27}
                                            y={staffY - 4}
                                            fontSize="11.5"
                                            fontFamily="'Inter', sans-serif"
                                            fontWeight="600"
                                            fill={inkColor}
                                          >
                                            g
                                          </text>
                                        </>
                                      )}
                                    </g>
                                  )}

                                  {/* Tonbak stroke symbol above stem */}
                                  <StrokeGlyph
                                    stroke={note.stroke}
                                    finger={note.finger}
                                    placement={note.placement}
                                    rizStyle={note.rizStyle}
                                    glissando={note.glissando}
                                    x={nx}
                                    y={stemTopY - 11}
                                    color={symbolColor}
                                  />
                                </>
                              )}
                            </g>
                          );
                        })}
                      </>
                    )}

                    {/* Measure end barline (double final barline on last measure) */}
                    {isLastMeasureOnPage ? (
                      <g stroke="#241e18">
                        <line x1={mEndX - 5} y1={staffY - 16} x2={mEndX - 5} y2={staffY + 2} strokeWidth={1.3} />
                        <line x1={mEndX} y1={staffY - 16} x2={mEndX} y2={staffY + 2} strokeWidth={3.4} />
                      </g>
                    ) : (
                      <line
                        x1={mEndX}
                        y1={staffY - 16}
                        x2={mEndX}
                        y2={staffY + 2}
                        stroke="#241e18"
                        strokeWidth={1.25}
                      />
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
};
