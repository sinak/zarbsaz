import type { ScoreSelection } from '../components/ScoreView';
import type { TonbakPage } from '../types/notation';

export interface ParsedScoreUrl {
  pageId: string | null;
  /** 0-based inclusive bar range */
  measureStart?: number;
  measureEnd?: number;
  /** 0-based note index within measureStart */
  noteIndex?: number;
}

/**
 * Parse a ZarbSaz deep-link URL of the form:
 * - `/p/<pageId>`
 * - `/p/<pageId>?bars=3`
 * - `/p/<pageId>?bars=3-6`
 * - `/p/<pageId>?bars=3&note=2`
 * (Query parameters use human-friendly 1-based bar & note numbers matching the score badges.)
 */
export function parseScoreUrl(pathname: string, search: string): ParsedScoreUrl {
  const match = pathname.match(/^\/p\/([^/]+)\/?$/);
  const pageId = match ? decodeURIComponent(match[1]) : null;
  const params = new URLSearchParams(search);

  let measureStart: number | undefined;
  let measureEnd: number | undefined;
  let noteIndex: number | undefined;

  const barsRaw = params.get('bars');
  if (barsRaw) {
    const rangeMatch = barsRaw.trim().match(/^(\d+)(?:-(\d+))?$/);
    if (rangeMatch) {
      const a = parseInt(rangeMatch[1], 10);
      const b = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : a;
      if (a >= 1 && b >= 1) {
        measureStart = Math.min(a, b) - 1;
        measureEnd = Math.max(a, b) - 1;
      }
    }
  }

  const noteRaw = params.get('note');
  if (noteRaw && measureStart !== undefined && measureStart === measureEnd) {
    const n = parseInt(noteRaw.trim(), 10);
    if (Number.isFinite(n) && n >= 1) {
      noteIndex = n - 1;
    }
  }

  return { pageId, measureStart, measureEnd, noteIndex };
}

/**
 * Resolve parsed 0-based indices against an actual `TonbakPage`, clamping safely
 * to valid measure and note bounds and resolving `noteId`.
 */
export function resolveUrlSelection(
  page: TonbakPage,
  parsed: ParsedScoreUrl
): ScoreSelection | null {
  if (parsed.measureStart === undefined || page.measures.length === 0) return null;
  const maxM = page.measures.length - 1;
  const measureStart = Math.max(0, Math.min(parsed.measureStart, maxM));
  const measureEnd = Math.max(
    measureStart,
    Math.min(parsed.measureEnd ?? measureStart, maxM)
  );

  let noteId: string | undefined;
  if (parsed.noteIndex !== undefined && measureStart === measureEnd) {
    const notes = page.measures[measureStart]?.notes || [];
    if (notes.length > 0) {
      const safeIdx = Math.max(0, Math.min(parsed.noteIndex, notes.length - 1));
      noteId = notes[safeIdx]?.id;
    }
  }

  return { measureStart, measureEnd, noteId };
}

/**
 * Build a clean relative URL for a page and optional bar/note selection.
 */
export function buildScoreUrl(page: TonbakPage, selection: ScoreSelection | null): string {
  const base = `/p/${encodeURIComponent(page.id)}`;
  if (!selection) return base;

  const params = new URLSearchParams();
  const startBar = selection.measureStart + 1;
  const endBar = selection.measureEnd + 1;
  params.set('bars', startBar === endBar ? String(startBar) : `${startBar}-${endBar}`);

  if (selection.noteId && selection.measureStart === selection.measureEnd) {
    const notes = page.measures[selection.measureStart]?.notes || [];
    const nIdx = notes.findIndex((n) => n.id === selection.noteId);
    if (nIdx >= 0) {
      params.set('note', String(nIdx + 1));
    }
  }

  return `${base}?${params.toString()}`;
}
