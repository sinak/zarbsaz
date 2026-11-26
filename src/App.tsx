import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Square,
  Repeat,
  Volume2,
  Camera,
  FilePlus2,
  Download,
  Upload,
  Printer,
  Trash2,
  Bookmark,
  Eye,
  EyeOff,
  Music2,
  Drum,
  Timer,
} from 'lucide-react';
import {
  cloneMeasureWithNewIds,
  cloneNoteWithNewIds,
  createId,
  normalizeOcrPage,
  STROKE_INFO,
  type ClipboardPayload,
  type Duration,
  type FingerMark,
  type Measure,
  type SavedSnippet,
  type StrokeType,
  type TonbakNote,
  type TonbakPage,
} from './types/notation';
import { SAMPLE_PAGES } from './data/samplePages';
import { sharedTonbakPlayer, sharedTonbakSynth } from './lib/tonbakSynth';
import { ScoreView, type ScoreSelection } from './components/ScoreView';
import { EditorToolbar } from './components/EditorToolbar';
import { OcrModal } from './components/OcrModal';

const STORAGE_PAGES_KEY = 'zarbsaz_pages_v1';
const STORAGE_SNIPPETS_KEY = 'zarbsaz_snippets_v1';

function loadInitialPages(): TonbakPage[] {
  try {
    const raw = localStorage.getItem(STORAGE_PAGES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TonbakPage[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return SAMPLE_PAGES;
}

function loadInitialSnippets(): SavedSnippet[] {
  try {
    const raw = localStorage.getItem(STORAGE_SNIPPETS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SavedSnippet[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

/** Sync CSS custom properties on native <input type="range"> for cross-browser filled tracks (modern-web-guidance slider). */
function syncSliderProps(el: HTMLInputElement | null, value: number, min: number, max: number) {
  if (!el) return;
  el.style.setProperty('--attr-min', String(min));
  el.style.setProperty('--attr-max', String(max));
  el.style.setProperty('--control-value', String(value));
}

export function App() {
  const [pages, setPages] = useState<TonbakPage[]>(loadInitialPages);
  const [activePageId, setActivePageId] = useState<string>(() => loadInitialPages()[0]?.id || '');
  const [snippets, setSnippets] = useState<SavedSnippet[]>(loadInitialSnippets);

  const [selection, setSelection] = useState<ScoreSelection | null>({
    measureStart: 0,
    measureEnd: 0,
  });
  const [activeStroke, setActiveStroke] = useState<StrokeType>('tom');
  const [activeDuration, setActiveDuration] = useState<Duration>('eighth');
  const [clipboard, setClipboard] = useState<ClipboardPayload | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Undo / redo history per session
  const [undoStack, setUndoStack] = useState<TonbakPage[][]>([]);
  const [redoStack, setRedoStack] = useState<TonbakPage[][]>([]);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingPosition, setPlayingPosition] = useState<{
    measureIndex: number;
    noteId: string;
  } | null>(null);
  const [loopPlayback, setLoopPlayback] = useState(false);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [volume, setVolume] = useState(0.85);

  // Modals & layout panels
  const [ocrOpen, setOcrOpen] = useState(false);
  const [showSourcePhoto, setShowSourcePhoto] = useState(false);

  const scoreSvgRef = useRef<SVGSVGElement | null>(null);
  const tempoSliderRef = useRef<HTMLInputElement | null>(null);
  const volumeSliderRef = useRef<HTMLInputElement | null>(null);
  const importJsonRef = useRef<HTMLInputElement | null>(null);

  const activePage = useMemo(
    () => pages.find((p) => p.id === activePageId) || pages[0],
    [pages, activePageId]
  );

  // Persist pages & snippets
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PAGES_KEY, JSON.stringify(pages));
    } catch {
      // ignore quota errors
    }
  }, [pages]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SNIPPETS_KEY, JSON.stringify(snippets));
    } catch {
      // ignore
    }
  }, [snippets]);

  // Sync slider CSS variables
  useEffect(() => {
    syncSliderProps(tempoSliderRef.current, activePage?.tempo ?? 96, 40, 200);
  }, [activePage?.tempo]);

  useEffect(() => {
    syncSliderProps(volumeSliderRef.current, Math.round(volume * 100), 0, 100);
  }, [volume]);

  // Wire up player options
  useEffect(() => {
    sharedTonbakPlayer.setOptions({ loop: loopPlayback, metronome: metronomeOn, volume });
  }, [loopPlayback, metronomeOn, volume]);

  const announce = useCallback((msg: string) => {
    setStatusMessage(msg);
  }, []);

  const updateActivePage = useCallback(
    (updater: (page: TonbakPage) => TonbakPage, recordUndo = true) => {
      setPages((prev) => {
        if (recordUndo) {
          setUndoStack((u) => [...u.slice(-39), prev]);
          setRedoStack([]);
        }
        return prev.map((p) =>
          p.id === activePage.id ? { ...updater(p), updatedAt: Date.now() } : p
        );
      });
    },
    [activePage?.id]
  );

  const selectedNote: TonbakNote | null = useMemo(() => {
    if (!activePage || !selection?.noteId) return null;
    const m = activePage.measures[selection.measureStart];
    return m?.notes.find((n) => n.id === selection.noteId) || null;
  }, [activePage, selection]);

  const isRepeatMeasureSelected = useMemo(() => {
    if (!activePage || !selection) return false;
    return Boolean(activePage.measures[selection.measureStart]?.isRepeatPrevious);
  }, [activePage, selection]);

  // Selection handlers
  const handleSelectNote = useCallback(
    (measureIndex: number, noteId: string, shiftKey: boolean) => {
      if (shiftKey && selection) {
        setSelection({
          measureStart: Math.min(selection.measureStart, measureIndex),
          measureEnd: Math.max(selection.measureEnd, measureIndex),
        });
        return;
      }
      setSelection({ measureStart: measureIndex, measureEnd: measureIndex, noteId });
      const note = activePage?.measures[measureIndex]?.notes.find((n) => n.id === noteId);
      if (note) {
        setActiveStroke(note.stroke);
        setActiveDuration(note.duration);
        // Audition the clicked note on the tonbak!
        sharedTonbakSynth.triggerNote(note, sharedTonbakSynth.getCurrentTime() + 0.01, 0.28);
      }
    },
    [activePage, selection]
  );

  const handleSelectMeasure = useCallback(
    (measureIndex: number, shiftKey: boolean) => {
      if (shiftKey && selection) {
        const start = Math.min(selection.measureStart, measureIndex);
        const end = Math.max(selection.measureEnd, measureIndex);
        setSelection({ measureStart: start, measureEnd: end });
        announce(`Selected measures ${start + 1}–${end + 1} (${end - start + 1} bars)`);
      } else {
        setSelection({ measureStart: measureIndex, measureEnd: measureIndex });
        announce(`Selected measure ${measureIndex + 1}`);
      }
    },
    [selection, announce]
  );

  // Edit handlers
  const handleSelectStroke = useCallback(
    (stroke: StrokeType) => {
      setActiveStroke(stroke);
      // Audition stroke sound immediately
      sharedTonbakSynth.triggerStroke(stroke, sharedTonbakSynth.getCurrentTime() + 0.01, {
        finger: stroke === 'bak_l' ? '2' : undefined,
        durationSec: 0.25,
      });

      if (selection?.noteId) {
        updateActivePage((page) => ({
          ...page,
          measures: page.measures.map((m, mIdx) =>
            mIdx !== selection.measureStart
              ? m
              : {
                  ...m,
                  notes: m.notes.map((n) =>
                    n.id !== selection.noteId
                      ? n
                      : {
                          ...n,
                          stroke,
                          finger: stroke === 'bak_l' ? n.finger || '2' : undefined,
                          tremolo: stroke === 'riz',
                        }
                  ),
                }
          ),
        }));
      }
    },
    [selection, updateActivePage]
  );

  const handleSelectDuration = useCallback(
    (duration: Duration) => {
      setActiveDuration(duration);
      if (selection?.noteId) {
        updateActivePage((page) => ({
          ...page,
          measures: page.measures.map((m, mIdx) =>
            mIdx !== selection.measureStart
              ? m
              : {
                  ...m,
                  notes: m.notes.map((n) =>
                    n.id !== selection.noteId ? n : { ...n, duration }
                  ),
                }
          ),
        }));
      }
    },
    [selection, updateActivePage]
  );

  const mutateSelectedNote = useCallback(
    (fn: (note: TonbakNote) => TonbakNote) => {
      if (!selection?.noteId) return;
      updateActivePage((page) => ({
        ...page,
        measures: page.measures.map((m, mIdx) =>
          mIdx !== selection.measureStart
            ? m
            : {
                ...m,
                notes: m.notes.map((n) => (n.id === selection.noteId ? fn(n) : n)),
              }
        ),
      }));
    },
    [selection, updateActivePage]
  );

  const handleInsertNote = useCallback(
    (targetMeasureIdx?: number) => {
      const mIdx = targetMeasureIdx ?? selection?.measureStart ?? activePage.measures.length - 1;
      const newNote: TonbakNote = {
        id: createId('n'),
        stroke: activeStroke,
        duration: activeDuration,
        finger: activeStroke === 'bak_l' ? '2' : undefined,
        tremolo: activeStroke === 'riz',
      };

      updateActivePage((page) => ({
        ...page,
        measures: page.measures.map((m, idx) => {
          if (idx !== mIdx) return m;
          const notes = [...m.notes];
          if (selection?.noteId && idx === selection.measureStart) {
            const pos = notes.findIndex((n) => n.id === selection.noteId);
            notes.splice(pos >= 0 ? pos + 1 : notes.length, 0, newNote);
          } else {
            notes.push(newNote);
          }
          return { ...m, isRepeatPrevious: false, notes };
        }),
      }));

      setSelection({ measureStart: mIdx, measureEnd: mIdx, noteId: newNote.id });
      sharedTonbakSynth.triggerNote(newNote, sharedTonbakSynth.getCurrentTime() + 0.01, 0.25);
    },
    [activeStroke, activeDuration, selection, activePage?.measures.length, updateActivePage]
  );

  const handleAddMeasure = useCallback(() => {
    const insertAt = selection ? selection.measureEnd + 1 : activePage.measures.length;
    const newMeasure: Measure = {
      id: createId('m'),
      notes: [
        { id: createId('n'), stroke: 'tom', duration: 'eighth' },
        { id: createId('n'), stroke: 'bak_l', duration: 'eighth', finger: '2' },
        { id: createId('n'), stroke: 'bak_r', duration: 'eighth' },
      ],
    };
    updateActivePage((page) => {
      const next = [...page.measures];
      next.splice(insertAt, 0, newMeasure);
      return { ...page, measures: next };
    });
    setSelection({ measureStart: insertAt, measureEnd: insertAt });
    announce(`Inserted measure ${insertAt + 1}`);
  }, [selection, activePage?.measures.length, updateActivePage, announce]);

  const handleToggleRepeatMeasure = useCallback(() => {
    if (!selection) return;
    if (selection.measureStart === 0) {
      announce('Measure 1 cannot repeat a previous measure.');
      return;
    }
    updateActivePage((page) => ({
      ...page,
      measures: page.measures.map((m, idx) => {
        if (idx < selection.measureStart || idx > selection.measureEnd) return m;
        const nextRepeat = !m.isRepeatPrevious;
        return {
          ...m,
          isRepeatPrevious: nextRepeat,
          notes: nextRepeat
            ? []
            : m.notes.length > 0
              ? m.notes
              : [{ id: createId('n'), stroke: 'tom', duration: 'eighth' }],
        };
      }),
    }));
    setSelection({ measureStart: selection.measureStart, measureEnd: selection.measureEnd });
  }, [selection, updateActivePage, announce]);

  const handleDeleteSelected = useCallback(() => {
    if (!selection || !activePage) return;

    if (selection.noteId) {
      updateActivePage((page) => ({
        ...page,
        measures: page.measures.map((m, idx) =>
          idx !== selection.measureStart
            ? m
            : { ...m, notes: m.notes.filter((n) => n.id !== selection.noteId) }
        ),
      }));
      setSelection({ measureStart: selection.measureStart, measureEnd: selection.measureStart });
      announce('Deleted note');
      return;
    }

    // Delete selected measure range (keep at least 1 measure on the page)
    if (activePage.measures.length <= selection.measureEnd - selection.measureStart + 1) {
      updateActivePage((page) => ({
        ...page,
        measures: [{ id: createId('m'), notes: [] }],
      }));
      setSelection({ measureStart: 0, measureEnd: 0 });
      announce('Cleared page');
      return;
    }

    const count = selection.measureEnd - selection.measureStart + 1;
    updateActivePage((page) => ({
      ...page,
      measures: page.measures.filter(
        (_, idx) => idx < selection.measureStart || idx > selection.measureEnd
      ),
    }));
    const nextIdx = Math.max(0, selection.measureStart - 1);
    setSelection({ measureStart: nextIdx, measureEnd: nextIdx });
    announce(`Deleted ${count} measure(s)`);
  }, [selection, activePage, updateActivePage, announce]);

  // Copy & Paste sections across pages!
  const handleCopySection = useCallback(() => {
    if (!selection || !activePage) return;
    if (selection.noteId) {
      const note = activePage.measures[selection.measureStart]?.notes.find(
        (n) => n.id === selection.noteId
      );
      if (!note) return;
      setClipboard({
        kind: 'notes',
        sourceTitle: activePage.title,
        timeSignature: activePage.timeSignature,
        notes: [cloneNoteWithNewIds(note)],
      });
      announce(`Copied ${STROKE_INFO[note.stroke].label} note from "${activePage.title}"`);
      return;
    }

    const slice = activePage.measures
      .slice(selection.measureStart, selection.measureEnd + 1)
      .map(cloneMeasureWithNewIds);

    setClipboard({
      kind: 'measures',
      sourceTitle: activePage.title,
      timeSignature: activePage.timeSignature,
      measures: slice,
    });
    announce(
      `Copied ${slice.length} measure(s) (bars ${selection.measureStart + 1}–${selection.measureEnd + 1}) from "${activePage.title}"`
    );
  }, [selection, activePage, announce]);

  const handlePasteSection = useCallback(
    (mode: 'after' | 'replace' = 'after') => {
      if (!clipboard || !activePage) return;

      if (clipboard.kind === 'notes' && clipboard.notes?.length) {
        const mIdx = selection?.measureStart ?? activePage.measures.length - 1;
        const freshNotes = clipboard.notes.map(cloneNoteWithNewIds);
        updateActivePage((page) => ({
          ...page,
          measures: page.measures.map((m, idx) => {
            if (idx !== mIdx) return m;
            const nextNotes = [...m.notes];
            const pos = selection?.noteId
              ? nextNotes.findIndex((n) => n.id === selection.noteId)
              : nextNotes.length - 1;
            nextNotes.splice(pos + 1, 0, ...freshNotes);
            return { ...m, isRepeatPrevious: false, notes: nextNotes };
          }),
        }));
        announce(`Pasted ${freshNotes.length} note(s) into measure ${mIdx + 1}`);
        return;
      }

      if (clipboard.kind === 'measures' && clipboard.measures?.length) {
        const freshMeasures = clipboard.measures.map(cloneMeasureWithNewIds);
        const start = selection ? selection.measureStart : activePage.measures.length;
        const end = selection ? selection.measureEnd : activePage.measures.length - 1;

        updateActivePage((page) => {
          const next = [...page.measures];
          if (mode === 'replace' && selection) {
            next.splice(start, end - start + 1, ...freshMeasures);
          } else {
            next.splice(end + 1, 0, ...freshMeasures);
          }
          return { ...page, measures: next };
        });

        const newStart = mode === 'replace' && selection ? start : end + 1;
        setSelection({
          measureStart: newStart,
          measureEnd: newStart + freshMeasures.length - 1,
        });
        announce(`Pasted ${freshMeasures.length} measure(s) from "${clipboard.sourceTitle}"`);
      }
    },
    [clipboard, activePage, selection, updateActivePage, announce]
  );

  const handleSaveSnippet = useCallback(() => {
    if (!selection || !activePage) return;
    const slice = activePage.measures
      .slice(selection.measureStart, selection.measureEnd + 1)
      .map(cloneMeasureWithNewIds);
    const snippet: SavedSnippet = {
      id: createId('snip'),
      name: `${activePage.title.slice(0, 18)} (m.${selection.measureStart + 1}–${selection.measureEnd + 1})`,
      timeSignature: activePage.timeSignature,
      measures: slice,
      createdAt: Date.now(),
    };
    setSnippets((prev) => [snippet, ...prev]);
    announce(`Saved ${slice.length}-measure phrase to Snippet Bank`);
  }, [selection, activePage, announce]);

  const handleStampSnippet = useCallback(
    (snippet: SavedSnippet) => {
      const insertAt = selection ? selection.measureEnd + 1 : activePage.measures.length;
      const fresh = snippet.measures.map(cloneMeasureWithNewIds);
      updateActivePage((page) => {
        const next = [...page.measures];
        next.splice(insertAt, 0, ...fresh);
        return { ...page, measures: next };
      });
      setSelection({ measureStart: insertAt, measureEnd: insertAt + fresh.length - 1 });
      announce(`Inserted snippet "${snippet.name}"`);
    },
    [selection, activePage?.measures.length, updateActivePage, announce]
  );

  // Undo / Redo
  const handleUndo = useCallback(() => {
    setUndoStack((u) => {
      if (u.length === 0) return u;
      const previous = u[u.length - 1];
      setRedoStack((r) => [...r, pages]);
      setPages(previous);
      announce('Undid last change');
      return u.slice(0, -1);
    });
  }, [pages, announce]);

  const handleRedo = useCallback(() => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const next = r[r.length - 1];
      setUndoStack((u) => [...u, pages]);
      setPages(next);
      announce('Redid change');
      return r.slice(0, -1);
    });
  }, [pages, announce]);

  // Playback controls
  const handlePlay = useCallback(
    (selectionOnly = false) => {
      if (!activePage) return;
      if (isPlaying) {
        sharedTonbakPlayer.stop();
        setIsPlaying(false);
        setPlayingPosition(null);
        return;
      }

      const startM = selectionOnly && selection ? selection.measureStart : 0;
      const endM =
        selectionOnly && selection ? selection.measureEnd : activePage.measures.length - 1;

      sharedTonbakPlayer.setCallbacks({
        onStep: (measureIndex, noteId) => setPlayingPosition({ measureIndex, noteId }),
        onStateChange: (playing) => {
          setIsPlaying(playing);
          if (!playing) setPlayingPosition(null);
        },
      });
      sharedTonbakPlayer.setOptions({ loop: loopPlayback, metronome: metronomeOn, volume });
      sharedTonbakPlayer.play(activePage, startM, endM);
    },
    [activePage, isPlaying, selection, loopPlayback, metronomeOn, volume]
  );

  // Page management
  const handleCreateNewPage = () => {
    const newPage: TonbakPage = {
      id: createId('page'),
      title: `قطعه جدید ${pages.length + 1}`,
      subtitle: 'New Tonbak Composition',
      timeSignature: { numerator: 6, denominator: 8 },
      tempo: 96,
      tempoBeat: 'dotted-quarter',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      measures: [
        {
          id: createId('m'),
          notes: [
            { id: createId('n'), stroke: 'tom', duration: 'eighth' },
            { id: createId('n'), stroke: 'bak_l', duration: 'eighth', finger: '2' },
            { id: createId('n'), stroke: 'bak_r', duration: 'eighth' },
            { id: createId('n'), stroke: 'tom', duration: 'eighth' },
            { id: createId('n'), stroke: 'bak_l', duration: 'quarter', finger: '2' },
          ],
        },
      ],
    };
    setPages((prev) => [newPage, ...prev]);
    setActivePageId(newPage.id);
    setSelection({ measureStart: 0, measureEnd: 0 });
    announce('Created new composition page');
  };

  const handleDeletePage = (id: string) => {
    if (pages.length <= 1) return;
    const remaining = pages.filter((p) => p.id !== id);
    setPages(remaining);
    if (activePageId === id) {
      setActivePageId(remaining[0].id);
      setSelection({ measureStart: 0, measureEnd: 0 });
    }
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(activePage, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activePage.title.replace(/[^\w\u0600-\u06FF-]+/g, '_')}.zarbsaz.json`;
    a.click();
    URL.revokeObjectURL(url);
    announce(`Exported "${activePage.title}" as JSON`);
  };

  const handleImportJsonFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const page = normalizeOcrPage(parsed, file.name.replace(/\.json$/i, ''));
        setPages((prev) => [page, ...prev]);
        setActivePageId(page.id);
        setSelection({ measureStart: 0, measureEnd: 0 });
        announce(`Imported "${page.title}"`);
      } catch {
        announce('Invalid JSON score file');
      }
    };
    reader.readAsText(file);
  };

  // Global keyboard shortcuts (when not typing inside an input/select)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ocrOpen) return;

      const cmd = e.metaKey || e.ctrlKey;
      if (cmd && e.key.toLowerCase() === 'c') {
        e.preventDefault();
        handleCopySection();
        return;
      }
      if (cmd && e.key.toLowerCase() === 'v') {
        e.preventDefault();
        handlePasteSection('after');
        return;
      }
      if (cmd && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if (cmd && e.key.toLowerCase() === 'z' && e.shiftKey) {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        handlePlay(false);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        handleInsertNote();
        return;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        handleDeleteSelected();
        return;
      }

      // Stroke shortcuts
      const k = e.key.toLowerCase();
      if (k === 't') handleSelectStroke('tom');
      else if (k === 'r') handleSelectStroke('bak_r');
      else if (k === 'l') handleSelectStroke('bak_l');
      else if (k === 'p') handleSelectStroke('pelang_r');
      else if (k === 'o') handleSelectStroke('pelang_l');
      else if (k === 'c') handleSelectStroke('chap');
      else if (k === 'z') handleSelectStroke('riz');
      else if (k === 'e') handleSelectStroke('eshareh');
      else if (k === '0') handleSelectStroke('rest');
      // Duration shortcuts
      else if (k === '1') handleSelectDuration('whole');
      else if (k === '2') handleSelectDuration('half');
      else if (k === '3') handleSelectDuration('quarter');
      else if (k === '4') handleSelectDuration('eighth');
      else if (k === '5') handleSelectDuration('sixteenth');
      else if (k === '6') handleSelectDuration('thirtysecond');
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    ocrOpen,
    handleCopySection,
    handlePasteSection,
    handleUndo,
    handleRedo,
    handlePlay,
    handleInsertNote,
    handleDeleteSelected,
    handleSelectStroke,
    handleSelectDuration,
  ]);

  if (!activePage) return null;

  return (
    <div className="app-layout">
      {/* Top Header & Tonbak Player Bar */}
      <header className="top-bar">
        <div className="brand-block">
          <div className="brand-emblem" aria-hidden="true">
            <Drum size={20} />
          </div>
          <div>
            <h1 className="brand-title">
              ZarbSaz <span className="brand-persian">ضرب‌ساز</span>
            </h1>
            <p className="brand-sub">Persian Tonbak Notation &amp; OMR Studio</p>
          </div>
        </div>

        {/* Tonbak Player Transport */}
        <div className="transport-bar" aria-label="Tonbak audio player">
          <button
            type="button"
            className={`play-hero-btn ${isPlaying ? 'playing' : ''}`}
            onClick={() => handlePlay(false)}
            title="Play whole page on Tonbak (Space)"
          >
            {isPlaying ? <Square size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
            <span>{isPlaying ? 'Stop' : 'Play Page'}</span>
          </button>

          {selection && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => handlePlay(true)}
              title="Play selected measure(s) only"
            >
              <Play size={14} aria-hidden="true" />
              <span>
                Bars {selection.measureStart + 1}
                {selection.measureEnd > selection.measureStart
                  ? `–${selection.measureEnd + 1}`
                  : ''}
              </span>
            </button>
          )}

          <button
            type="button"
            className="btn-toggle"
            aria-pressed={loopPlayback}
            onClick={() => setLoopPlayback((v) => !v)}
            title="Loop playback"
          >
            <Repeat size={14} aria-hidden="true" />
            <span>Loop</span>
          </button>

          <button
            type="button"
            className="btn-toggle"
            aria-pressed={metronomeOn}
            onClick={() => setMetronomeOn((v) => !v)}
            title="Metronome click"
          >
            <Timer size={14} aria-hidden="true" />
            <span>Click</span>
          </button>

          <div className="slider-control">
            <label htmlFor="tempo-slider" className="slider-label">
              {activePage.tempoBeat === 'dotted-quarter' ? '♩.' : '♩'} ={' '}
              <strong>{activePage.tempo}</strong>
            </label>
            <input
              ref={tempoSliderRef}
              id="tempo-slider"
              type="range"
              min={40}
              max={200}
              step={2}
              value={activePage.tempo}
              aria-valuetext={`${activePage.tempo} beats per minute`}
              onChange={(e) => {
                const bpm = Number(e.target.value);
                syncSliderProps(e.currentTarget, bpm, 40, 200);
                updateActivePage((p) => ({ ...p, tempo: bpm }), false);
              }}
            />
          </div>

          <div className="slider-control slider-vol">
            <label htmlFor="volume-slider" className="slider-label" aria-label="Volume">
              <Volume2 size={15} aria-hidden="true" />
            </label>
            <input
              ref={volumeSliderRef}
              id="volume-slider"
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              aria-valuetext={`${Math.round(volume * 100)} percent volume`}
              onChange={(e) => {
                const pct = Number(e.target.value);
                syncSliderProps(e.currentTarget, pct, 0, 100);
                setVolume(pct / 100);
              }}
            />
          </div>
        </div>

        {/* Top-right Primary Actions */}
        <div className="top-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => setOcrOpen(true)}
          >
            <Camera size={15} aria-hidden="true" />
            <span>Scan Photo (OCR)</span>
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => window.print()}
            title="Print sheet music"
          >
            <Printer size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Main Split Workspace */}
      <div className="workspace-body">
        {/* Left Sidebar: Pages Library + Reusable Phrase Snippets */}
        <aside className="sidebar" aria-label="Pages and snippets">
          <div className="sidebar-section">
            <div className="sidebar-header">
              <h2>
                <Music2 size={15} aria-hidden="true" /> Pages ({pages.length})
              </h2>
              <div className="sidebar-header-actions">
                <button
                  type="button"
                  className="btn-mini"
                  onClick={handleCreateNewPage}
                  title="Create new blank composition"
                >
                  <FilePlus2 size={13} aria-hidden="true" /> New
                </button>
              </div>
            </div>

            <ul className="page-list">
              {pages.map((p) => {
                const isActive = p.id === activePage.id;
                return (
                  <li key={p.id} className={`page-item ${isActive ? 'active' : ''}`}>
                    <button
                      type="button"
                      className="page-item-btn"
                      onClick={() => {
                        sharedTonbakPlayer.stop();
                        setIsPlaying(false);
                        setPlayingPosition(null);
                        setActivePageId(p.id);
                        setSelection({ measureStart: 0, measureEnd: 0 });
                      }}
                    >
                      <span className="page-item-title">{p.title}</span>
                      <span className="page-item-meta">
                        {p.timeSignature.numerator}/{p.timeSignature.denominator} •{' '}
                        {p.measures.length} bars
                      </span>
                    </button>
                    {pages.length > 1 && (
                      <button
                        type="button"
                        className="page-delete-btn"
                        aria-label={`Delete ${p.title}`}
                        onClick={() => handleDeletePage(p.id)}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="sidebar-section">
            <div className="sidebar-header">
              <h2>
                <Bookmark size={15} aria-hidden="true" /> Saved Phrases ({snippets.length})
              </h2>
            </div>
            {snippets.length === 0 ? (
              <p className="sidebar-empty">
                Select measures on any page and click <strong>Snippet</strong> to save reusable
                rhythmic sections.
              </p>
            ) : (
              <ul className="snippet-list">
                {snippets.map((snip) => (
                  <li key={snip.id} className="snippet-item">
                    <button
                      type="button"
                      className="snippet-stamp-btn"
                      onClick={() => handleStampSnippet(snip)}
                      title="Insert this phrase after the selected measure"
                    >
                      <span className="snippet-name">{snip.name}</span>
                      <span className="snippet-meta">
                        + Paste ({snip.measures.length} bars)
                      </span>
                    </button>
                    <button
                      type="button"
                      className="page-delete-btn"
                      aria-label={`Remove snippet ${snip.name}`}
                      onClick={() => setSnippets((s) => s.filter((x) => x.id !== snip.id))}
                    >
                      <Trash2 size={12} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="sidebar-footer">
            <button type="button" className="btn-secondary btn-sm" onClick={handleExportJson}>
              <Download size={13} aria-hidden="true" /> Export JSON
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => importJsonRef.current?.click()}
            >
              <Upload size={13} aria-hidden="true" /> Import JSON
            </button>
            <input
              ref={importJsonRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImportJsonFile(f);
              }}
            />
          </div>
        </aside>

        {/* Right Main Editor Area */}
        <main className="editor-main">
          {/* Page Metadata Bar */}
          <div className="page-meta-bar">
            <input
              type="text"
              className="page-title-input"
              aria-label="Page title"
              value={activePage.title}
              onChange={(e) => updateActivePage((p) => ({ ...p, title: e.target.value }), false)}
            />
            <div className="meta-controls">
              <label className="meta-field">
                <span>Meter</span>
                <select
                  value={`${activePage.timeSignature.numerator}/${activePage.timeSignature.denominator}`}
                  onChange={(e) => {
                    const [num, den] = e.target.value.split('/').map(Number);
                    updateActivePage((p) => ({
                      ...p,
                      timeSignature: { numerator: num, denominator: den },
                      tempoBeat: den === 8 && num % 3 === 0 ? 'dotted-quarter' : 'quarter',
                    }));
                  }}
                >
                  <option value="6/8">6/8</option>
                  <option value="2/4">2/4</option>
                  <option value="3/4">3/4</option>
                  <option value="4/4">4/4</option>
                  <option value="5/8">5/8</option>
                  <option value="7/8">7/8</option>
                  <option value="9/8">9/8</option>
                </select>
              </label>

              {activePage.sourceImage && (
                <button
                  type="button"
                  className="btn-toggle"
                  aria-pressed={showSourcePhoto}
                  onClick={() => setShowSourcePhoto((v) => !v)}
                >
                  {showSourcePhoto ? (
                    <EyeOff size={14} aria-hidden="true" />
                  ) : (
                    <Eye size={14} aria-hidden="true" />
                  )}
                  <span>Original Photo</span>
                </button>
              )}
            </div>
          </div>

          {/* Accessible Notation Editor Toolbar */}
          <EditorToolbar
            activeStroke={activeStroke}
            activeDuration={activeDuration}
            selectedNote={selectedNote}
            hasMeasureSelection={selection !== null}
            isRepeatMeasureSelected={isRepeatMeasureSelected}
            clipboard={clipboard}
            canUndo={undoStack.length > 0}
            canRedo={redoStack.length > 0}
            statusMessage={statusMessage}
            onSelectStroke={handleSelectStroke}
            onSelectDuration={handleSelectDuration}
            onToggleDotted={() => mutateSelectedNote((n) => ({ ...n, dotted: !n.dotted }))}
            onToggleTremolo={() =>
              mutateSelectedNote((n) => ({
                ...n,
                tremolo: !n.tremolo,
                stroke: !n.tremolo ? 'riz' : n.stroke === 'riz' ? 'bak_r' : n.stroke,
              }))
            }
            onTogglePelangGrace={() =>
              mutateSelectedNote((n) => ({
                ...n,
                graceNotes:
                  n.graceNotes && n.graceNotes.length > 0
                    ? undefined
                    : [{ stroke: 'pelang_r' }, { stroke: 'pelang_l' }],
              }))
            }
            onCycleFinger={(finger: FingerMark | undefined) =>
              mutateSelectedNote((n) => ({ ...n, finger }))
            }
            onInsertNote={() => handleInsertNote()}
            onDeleteSelected={handleDeleteSelected}
            onAddMeasure={handleAddMeasure}
            onToggleRepeatMeasure={handleToggleRepeatMeasure}
            onCopySection={handleCopySection}
            onPasteSection={handlePasteSection}
            onSaveSnippet={handleSaveSnippet}
            onUndo={handleUndo}
            onRedo={handleRedo}
          />

          {/* Score Engraving Canvas (+ optional side-by-side original book photo) */}
          <div
            id="tonbak-score-canvas"
            className={`score-stage ${showSourcePhoto && activePage.sourceImage ? 'with-photo' : ''}`}
          >
            {showSourcePhoto && activePage.sourceImage && (
              <div className="reference-photo-pane">
                <div className="pane-caption">Original Book Photo Reference</div>
                <img src={activePage.sourceImage} alt="Original book page" />
              </div>
            )}

            <div className="score-scroll-area">
              <ScoreView
                page={activePage}
                selection={selection}
                playingPosition={playingPosition}
                onSelectNote={handleSelectNote}
                onSelectMeasure={handleSelectMeasure}
                onQuickAddNote={(mIdx) => handleInsertNote(mIdx)}
                svgRef={scoreSvgRef}
              />
            </div>
          </div>
        </main>
      </div>

      {/* Photo Upload & OCR Modal */}
      <OcrModal
        open={ocrOpen}
        onClose={() => setOcrOpen(false)}
        onImportPage={(newPage) => {
          setPages((prev) => [newPage, ...prev]);
          setActivePageId(newPage.id);
          setSelection({ measureStart: 0, measureEnd: 0 });
          setShowSourcePhoto(Boolean(newPage.sourceImage));
          announce(`Imported "${newPage.title}" (${newPage.measures.length} measures)`);
        }}
      />
    </div>
  );
}

export default App;
