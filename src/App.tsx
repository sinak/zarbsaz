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
  BookOpen,
  BookPlus,
  Share2,
  User,
  LogOut,
  Menu,
  X,
  ChevronDown,
  ChevronRight,
  Users,
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
  type TonbakBook,
  type TonbakNote,
  type TonbakPage,
  type UserProfile,
} from './types/notation';
import { SAMPLE_PAGES } from './data/samplePages';
import { api } from './lib/api';
import {
  sharedTonbakPlayer,
  sharedTonbakSynth,
  TONBAK_KITS,
  type TonbakKitId,
} from './lib/tonbakSynth';
import { ScoreView, type ScoreSelection } from './components/ScoreView';
import { EditorToolbar } from './components/EditorToolbar';
import { OcrModal, type BulkImportResult } from './components/OcrModal';
import { AuthModal } from './components/AuthModal';
import { ShareModal, type ShareTarget } from './components/ShareModal';
import { SharedView } from './components/SharedView';

const STORAGE_BOOKS_KEY = 'zarbsaz_books_v3';
const STORAGE_PAGES_KEY = 'zarbsaz_pages_v3';
const STORAGE_SNIPPETS_KEY = 'zarbsaz_snippets_v3';

const DEFAULT_BOOK_ID = 'guest-book-rajabi';

function createGuestBooks(): TonbakBook[] {
  const now = Date.now();
  return [
    {
      id: DEFAULT_BOOK_ID,
      title: 'آموزش تنبک — Bahman Rajabi',
      author: 'Bahman Rajabi',
      description: 'Sample transcribed pages from your book',
      coverColor: '#9c3b1e',
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function createGuestPages(): TonbakPage[] {
  return SAMPLE_PAGES.map((p, idx) => ({
    ...p,
    bookId: p.id === 'my-composition-1' ? null : DEFAULT_BOOK_ID,
    sortOrder: idx,
  }));
}

function loadGuestBooks(): TonbakBook[] {
  try {
    const raw = localStorage.getItem(STORAGE_BOOKS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TonbakBook[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return createGuestBooks();
}

function loadGuestPages(): TonbakPage[] {
  try {
    const raw = localStorage.getItem(STORAGE_PAGES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TonbakPage[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore
  }
  return createGuestPages();
}

function loadGuestSnippets(): SavedSnippet[] {
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

function parseShareQuery(): { type: 'book' | 'piece'; token: string } | null {
  const params = new URLSearchParams(window.location.search);
  const share = params.get('share');
  if (!share) return null;
  const [type, token] = share.split(':');
  if ((type === 'book' || type === 'piece') && token) {
    return { type, token };
  }
  return null;
}

/** Sync CSS custom properties on native <input type="range"> for cross-browser filled tracks (modern-web-guidance slider). */
function syncSliderProps(el: HTMLInputElement | null, value: number, min: number, max: number) {
  if (!el) return;
  el.style.setProperty('--attr-min', String(min));
  el.style.setProperty('--attr-max', String(max));
  el.style.setProperty('--control-value', String(value));
}

export function App() {
  // Public share route state (/?share=book:TOKEN or /?share=piece:TOKEN)
  const [publicShareRoute, setPublicShareRoute] = useState(parseShareQuery);

  // Auth state (null = Guest Mode)
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  // Library state
  const [books, setBooks] = useState<TonbakBook[]>(loadGuestBooks);
  const [pages, setPages] = useState<TonbakPage[]>(loadGuestPages);
  const [sharedBooks, setSharedBooks] = useState<TonbakBook[]>([]);
  const [sharedBookPieces, setSharedBookPieces] = useState<TonbakPage[]>([]);
  const [sharedPieces, setSharedPieces] = useState<TonbakPage[]>([]);
  const [snippets, setSnippets] = useState<SavedSnippet[]>(loadGuestSnippets);
  const [expandedBooks, setExpandedBooks] = useState<Record<string, boolean>>({
    [DEFAULT_BOOK_ID]: true,
  });

  const [activePageId, setActivePageId] = useState<string>(() => loadGuestPages()[0]?.id || '');
  const [selection, setSelection] = useState<ScoreSelection | null>({
    measureStart: 0,
    measureEnd: 0,
  });
  const [activeStroke, setActiveStroke] = useState<StrokeType>('tom');
  const [activeDuration, setActiveDuration] = useState<Duration>('eighth');
  const [clipboard, setClipboard] = useState<ClipboardPayload | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('');

  // Undo / redo history
  const [undoStack, setUndoStack] = useState<TonbakPage[][]>([]);
  const [redoStack, setRedoStack] = useState<TonbakPage[][]>([]);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingPosition, setPlayingPosition] = useState<{
    measureIndex: number;
    sourceMeasureIndex: number;
    noteId: string;
  } | null>(null);
  const [loopPlayback, setLoopPlayback] = useState(false);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [volume, setVolume] = useState(0.88);
  const [soundKit, setSoundKit] = useState<TonbakKitId>('teacher');

  // Modals, Drawer & Panels
  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrInitialCamera, setOcrInitialCamera] = useState(false);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [showSourcePhoto, setShowSourcePhoto] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newBookOpen, setNewBookOpen] = useState(false);
  const [newBookTitle, setNewBookTitle] = useState('');

  const scoreSvgRef = useRef<SVGSVGElement | null>(null);
  const tempoSliderRef = useRef<HTMLInputElement | null>(null);
  const volumeSliderRef = useRef<HTMLInputElement | null>(null);
  const importJsonRef = useRef<HTMLInputElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);

  const allAccessiblePages = useMemo(
    () => [...pages, ...sharedBookPieces, ...sharedPieces],
    [pages, sharedBookPieces, sharedPieces]
  );

  const activePage = useMemo(
    () => allAccessiblePages.find((p) => p.id === activePageId) || pages[0],
    [allAccessiblePages, activePageId, pages]
  );

  const isActivePageReadOnly = useMemo(
    () => Boolean(activePage && !pages.some((p) => p.id === activePage.id)),
    [activePage, pages]
  );

  const standalonePages = useMemo(() => pages.filter((p) => !p.bookId), [pages]);

  const loadAccountLibrary = useCallback(async () => {
    try {
      const lib = await api.getLibrary();
      setBooks(lib.books);
      setPages(lib.pieces);
      setSharedBooks(lib.sharedBooks);
      setSharedBookPieces(lib.sharedBookPieces);
      setSharedPieces(lib.sharedPieces);
      setSnippets(lib.snippets);
      if (lib.books.length > 0) {
        setExpandedBooks((prev) => ({ ...prev, [lib.books[0].id]: true }));
      }
      if (lib.pieces.length > 0) {
        setActivePageId(lib.pieces[0].id);
      }
    } catch {
      // ignore
    }
  }, []);

  // Check existing session on startup
  useEffect(() => {
    api
      .me()
      .then((res) => {
        if (res.user) {
          setUser(res.user);
          void loadAccountLibrary();
        }
      })
      .catch(() => {
        // stay in guest mode
      });
  }, [loadAccountLibrary]);

  // Persist to localStorage only in Guest mode
  useEffect(() => {
    if (user) return;
    try {
      localStorage.setItem(STORAGE_BOOKS_KEY, JSON.stringify(books));
      localStorage.setItem(STORAGE_PAGES_KEY, JSON.stringify(pages));
      localStorage.setItem(STORAGE_SNIPPETS_KEY, JSON.stringify(snippets));
    } catch {
      // ignore quota errors
    }
  }, [user, books, pages, snippets]);

  // Close mobile drawer on Escape
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // Sync slider CSS variables
  useEffect(() => {
    syncSliderProps(tempoSliderRef.current, activePage?.tempo ?? 96, 40, 200);
  }, [activePage?.tempo]);

  useEffect(() => {
    syncSliderProps(volumeSliderRef.current, Math.round(volume * 100), 0, 100);
  }, [volume]);

  useEffect(() => {
    sharedTonbakPlayer.setOptions({ loop: loopPlayback, metronome: metronomeOn, volume });
  }, [loopPlayback, metronomeOn, volume]);

  const announce = useCallback((msg: string) => setStatusMessage(msg), []);

  // Debounced server sync when editing a piece while logged in
  const schedulePieceSync = useCallback(
    (updated: TonbakPage) => {
      if (!user) return;
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        void api
          .updatePiece(updated.id, {
            title: updated.title,
            subtitle: updated.subtitle,
            bookId: updated.bookId ?? null,
            timeSignature: updated.timeSignature,
            tempo: updated.tempo,
            tempoBeat: updated.tempoBeat,
            measures: updated.measures,
          })
          .catch(() => {
            // ignore transient errors
          });
      }, 450);
    },
    [user]
  );

  const updateActivePage = useCallback(
    (updater: (page: TonbakPage) => TonbakPage, recordUndo = true) => {
      if (!activePage || isActivePageReadOnly) {
        if (isActivePageReadOnly) announce('This shared piece is read-only. Copy measures to your own piece!');
        return;
      }
      setPages((prev) => {
        if (recordUndo) {
          setUndoStack((u) => [...u.slice(-39), prev]);
          setRedoStack([]);
        }
        return prev.map((p) => {
          if (p.id !== activePage.id) return p;
          const next = { ...updater(p), updatedAt: Date.now() };
          schedulePieceSync(next);
          return next;
        });
      });
    },
    [activePage, isActivePageReadOnly, schedulePieceSync, announce]
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

  const handleSelectStroke = useCallback(
    (stroke: StrokeType) => {
      setActiveStroke(stroke);
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
      if (!activePage || isActivePageReadOnly) return;
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
    [activeStroke, activeDuration, selection, activePage, isActivePageReadOnly, updateActivePage]
  );

  const handleAddMeasure = useCallback(() => {
    if (!activePage || isActivePageReadOnly) return;
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
  }, [selection, activePage, isActivePageReadOnly, updateActivePage, announce]);

  const handleToggleRepeatMeasure = useCallback(() => {
    if (!selection || isActivePageReadOnly) return;
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
  }, [selection, isActivePageReadOnly, updateActivePage, announce]);

  const handleDeleteSelected = useCallback(() => {
    if (!selection || !activePage || isActivePageReadOnly) return;

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
  }, [selection, activePage, isActivePageReadOnly, updateActivePage, announce]);

  // Copy & Paste sections across pages (works even from shared read-only pages!)
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
      if (!clipboard || !activePage || isActivePageReadOnly) return;

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
    [clipboard, activePage, isActivePageReadOnly, selection, updateActivePage, announce]
  );

  const handleSaveSnippet = useCallback(async () => {
    if (!selection || !activePage) return;
    const slice = activePage.measures
      .slice(selection.measureStart, selection.measureEnd + 1)
      .map(cloneMeasureWithNewIds);
    const name = `${activePage.title.slice(0, 18)} (m.${selection.measureStart + 1}–${selection.measureEnd + 1})`;

    if (user) {
      try {
        const { snippet } = await api.createSnippet({
          name,
          timeSignature: activePage.timeSignature,
          measures: slice,
        });
        setSnippets((prev) => [snippet, ...prev]);
        announce(`Saved ${slice.length}-measure phrase to Snippet Bank`);
        return;
      } catch {
        // fall through
      }
    }

    const localSnip: SavedSnippet = {
      id: createId('snip'),
      name,
      timeSignature: activePage.timeSignature,
      measures: slice,
      createdAt: Date.now(),
    };
    setSnippets((prev) => [localSnip, ...prev]);
    announce(`Saved ${slice.length}-measure phrase to Snippet Bank`);
  }, [selection, activePage, user, announce]);

  const handleStampSnippet = useCallback(
    (snippet: SavedSnippet) => {
      if (!activePage || isActivePageReadOnly) return;
      const insertAt = selection ? selection.measureEnd + 1 : activePage.measures.length;
      const fresh = snippet.measures.map(cloneMeasureWithNewIds);
      updateActivePage((page) => {
        const next = [...page.measures];
        next.splice(insertAt, 0, ...fresh);
        return { ...page, measures: next };
      });
      setSelection({ measureStart: insertAt, measureEnd: insertAt + fresh.length - 1 });
      setDrawerOpen(false);
      announce(`Inserted snippet "${snippet.name}"`);
    },
    [selection, activePage, isActivePageReadOnly, updateActivePage, announce]
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

  // Playback
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
        onStep: (measureIndex, sourceMeasureIndex, noteId) =>
          setPlayingPosition({ measureIndex, sourceMeasureIndex, noteId }),
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

  // Books & Pieces CRUD
  const handleCreateBook = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newBookTitle.trim();
    if (!title) return;
    if (user) {
      const { book } = await api.createBook({ title });
      setBooks((prev) => [book, ...prev]);
      setExpandedBooks((prev) => ({ ...prev, [book.id]: true }));
    } else {
      const now = Date.now();
      const book: TonbakBook = {
        id: createId('book'),
        title,
        author: '',
        description: '',
        coverColor: '#9c3b1e',
        createdAt: now,
        updatedAt: now,
      };
      setBooks((prev) => [book, ...prev]);
      setExpandedBooks((prev) => ({ ...prev, [book.id]: true }));
    }
    setNewBookTitle('');
    setNewBookOpen(false);
    announce(`Created book "${title}"`);
  };

  const handleDeleteBook = async (bookId: string) => {
    if (user) {
      await api.deleteBook(bookId);
    }
    setBooks((prev) => prev.filter((b) => b.id !== bookId));
    // Pieces inside the deleted book become standalone pieces
    setPages((prev) => prev.map((p) => (p.bookId === bookId ? { ...p, bookId: null } : p)));
    announce('Deleted book (its pieces were moved to Standalone Pieces)');
  };

  const handleCreateNewPiece = async (bookId: string | null = null) => {
    const starter: Omit<TonbakPage, 'id' | 'createdAt' | 'updatedAt'> = {
      bookId,
      title: `قطعه جدید ${pages.length + 1}`,
      subtitle: 'New Tonbak Piece',
      timeSignature: { numerator: 6, denominator: 8 },
      tempo: 96,
      tempoBeat: 'dotted-quarter',
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

    if (user) {
      const { piece } = await api.createPiece(starter);
      setPages((prev) => [...prev, piece]);
      setActivePageId(piece.id);
    } else {
      const now = Date.now();
      const piece: TonbakPage = { ...starter, id: createId('page'), createdAt: now, updatedAt: now };
      setPages((prev) => [...prev, piece]);
      setActivePageId(piece.id);
    }
    if (bookId) setExpandedBooks((prev) => ({ ...prev, [bookId]: true }));
    setSelection({ measureStart: 0, measureEnd: 0 });
    setDrawerOpen(false);
    announce('Created new piece');
  };

  const handleDeletePiece = async (id: string) => {
    if (pages.length <= 1) return;
    if (user) {
      await api.deletePiece(id);
    }
    const remaining = pages.filter((p) => p.id !== id);
    setPages(remaining);
    if (activePageId === id) {
      setActivePageId(remaining[0].id);
      setSelection({ measureStart: 0, measureEnd: 0 });
    }
  };

  // Bulk Import handler (from Camera, Images, or Multi-Page PDFs!)
  const handleBulkImport = async (result: BulkImportResult) => {
    let targetBookId: string | null = null;

    if (result.destination.kind === 'existing-book') {
      targetBookId = result.destination.bookId;
    } else if (result.destination.kind === 'new-book') {
      if (user) {
        const { book } = await api.createBook({ title: result.destination.title });
        setBooks((prev) => [book, ...prev]);
        targetBookId = book.id;
      } else {
        const now = Date.now();
        const book: TonbakBook = {
          id: createId('book'),
          title: result.destination.title,
          author: '',
          description: 'Imported via ZarbSaz OCR',
          coverColor: '#1e4d6b',
          createdAt: now,
          updatedAt: now,
        };
        setBooks((prev) => [book, ...prev]);
        targetBookId = book.id;
      }
    }

    const tagged = result.pages.map((p, idx) => ({
      ...p,
      bookId: targetBookId,
      sortOrder: idx,
    }));

    if (user) {
      const { pieces } = await api.createPiecesBulk(tagged);
      setPages((prev) => [...prev, ...pieces]);
      if (pieces[0]) setActivePageId(pieces[0].id);
    } else {
      setPages((prev) => [...prev, ...tagged]);
      if (tagged[0]) setActivePageId(tagged[0].id);
    }

    if (targetBookId) {
      setExpandedBooks((prev) => ({ ...prev, [targetBookId!]: true }));
    }
    setSelection({ measureStart: 0, measureEnd: 0 });
    announce(`Imported ${tagged.length} piece(s) into your library`);
  };

  const handleOpenShare = (target: ShareTarget) => {
    if (!user) {
      setAuthModalOpen(true);
      announce('Sign in or create a free account to share books & pieces with others.');
      return;
    }
    setShareTarget(target);
  };

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
    setSharedBooks([]);
    setSharedBookPieces([]);
    setSharedPieces([]);
    const guestBooks = loadGuestBooks();
    const guestPages = loadGuestPages();
    setBooks(guestBooks);
    setPages(guestPages);
    setSnippets(loadGuestSnippets());
    setActivePageId(guestPages[0]?.id || '');
    announce('Signed out — now using Guest Mode');
  };

  const handleExportJson = () => {
    if (!activePage) return;
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
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const page = normalizeOcrPage(parsed, file.name.replace(/\.json$/i, ''));
        if (user) {
          const { piece } = await api.createPiece(page);
          setPages((prev) => [...prev, piece]);
          setActivePageId(piece.id);
        } else {
          setPages((prev) => [...prev, page]);
          setActivePageId(page.id);
        }
        setSelection({ measureStart: 0, measureEnd: 0 });
        announce(`Imported "${page.title}"`);
      } catch {
        announce('Invalid JSON score file');
      }
    };
    reader.readAsText(file);
  };

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ocrOpen || authModalOpen || shareTarget) {
        return;
      }

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
    authModalOpen,
    shareTarget,
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

  // If user opened a public share link (/?share=book:... or /?share=piece:...)
  if (publicShareRoute) {
    return (
      <>
        <SharedView
          shareType={publicShareRoute.type}
          token={publicShareRoute.token}
          user={user}
          onExit={() => {
            window.history.replaceState({}, '', '/');
            setPublicShareRoute(null);
          }}
          onRequestLogin={() => setAuthModalOpen(true)}
          onCloned={() => {
            window.history.replaceState({}, '', '/');
            setPublicShareRoute(null);
            void loadAccountLibrary();
          }}
        />
        <AuthModal
          open={authModalOpen}
          onClose={() => setAuthModalOpen(false)}
          onAuthenticated={(u) => {
            setUser(u);
            void loadAccountLibrary();
          }}
        />
      </>
    );
  }

  if (!activePage) return null;

  const selectPiece = (id: string) => {
    sharedTonbakPlayer.stop();
    setIsPlaying(false);
    setPlayingPosition(null);
    setActivePageId(id);
    setSelection({ measureStart: 0, measureEnd: 0 });
    setDrawerOpen(false);
  };

  return (
    <div className="app-layout">
      {/* Top Header & Tonbak Player Bar */}
      <header className="top-bar">
        <div className="brand-block">
          <button
            type="button"
            className="mobile-menu-btn"
            aria-label="Open library menu"
            aria-expanded={drawerOpen}
            aria-controls="library-drawer"
            onClick={() => setDrawerOpen((v) => !v)}
          >
            <Menu size={20} aria-hidden="true" />
          </button>
          <div className="brand-emblem" aria-hidden="true">
            <Drum size={20} />
          </div>
          <div>
            <h1 className="brand-title">
              ZarbSaz <span className="brand-persian">ضرب‌ساز</span>
            </h1>
            <p className="brand-sub">Persian Tonbak Studio</p>
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
            <span>{isPlaying ? 'Stop' : 'Play'}</span>
          </button>

          {selection && (
            <button
              type="button"
              className="btn-secondary hide-xs"
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
            <span className="hide-sm">Loop</span>
          </button>

          <button
            type="button"
            className="btn-toggle"
            aria-pressed={metronomeOn}
            onClick={() => setMetronomeOn((v) => !v)}
            title="Metronome click"
          >
            <Timer size={14} aria-hidden="true" />
            <span className="hide-sm">Click</span>
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

          <div className="kit-picker">
            <label htmlFor="kit-select" className="sr-only">
              Tonbak sound kit
            </label>
            <select
              id="kit-select"
              className="kit-select"
              aria-label="Tonbak sound kit"
              title={TONBAK_KITS.find((k) => k.id === soundKit)?.description}
              value={soundKit}
              onChange={(e) => {
                const next = e.target.value as TonbakKitId;
                setSoundKit(next);
                void sharedTonbakSynth.setKit(next).then(() => {
                  // Play a quick Tom + Bak preview of the newly selected kit
                  const now = sharedTonbakSynth.getCurrentTime() + 0.02;
                  sharedTonbakSynth.triggerStroke('tom', now);
                  sharedTonbakSynth.triggerStroke('bak_r', now + 0.16);
                  sharedTonbakSynth.triggerStroke('bak_l', now + 0.3);
                });
                const info = TONBAK_KITS.find((k) => k.id === next);
                announce(`Switched Tonbak kit to ${info?.label}: ${info?.description}`);
              }}
            >
              {TONBAK_KITS.map((k) => (
                <option key={k.id} value={k.id}>
                  Kit: {k.label}
                </option>
              ))}
            </select>
          </div>

          <div className="slider-control slider-vol hide-sm">
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

        {/* Top-right Primary Actions: Camera/Import + Account */}
        <div className="top-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setOcrInitialCamera(false);
              setOcrOpen(true);
            }}
          >
            <Camera size={15} aria-hidden="true" />
            <span>Import / OCR</span>
          </button>

          <button
            type="button"
            className="btn-secondary hide-sm"
            aria-label="Print sheet music"
            onClick={() => window.print()}
            title="Print sheet music"
          >
            <Printer size={15} aria-hidden="true" />
          </button>

          {user ? (
            <div className="account-pill">
              <User size={14} aria-hidden="true" />
              <span className="account-name">@{user.username}</span>
              <button
                type="button"
                className="account-logout-btn"
                aria-label="Sign out"
                title="Sign out"
                onClick={() => void handleLogout()}
              >
                <LogOut size={13} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setAuthModalOpen(true)}
            >
              <User size={14} aria-hidden="true" />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Split Workspace */}
      <div className="workspace-body">
        {/* Mobile Backdrop for Drawer */}
        {drawerOpen && (
          <div
            className="drawer-backdrop"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
        )}

        {/* Library Sidebar (Acts as Slide-Out Drawer on Mobile < 900px) */}
        <aside
          id="library-drawer"
          className={`sidebar ${drawerOpen ? 'drawer-open' : ''}`}
          aria-label="Books, pieces, and snippets"
        >
          <div className="drawer-mobile-header">
            <strong>Library {user ? `(@${user.username})` : '(Guest)'}</strong>
            <button
              type="button"
              className="icon-close-btn"
              aria-label="Close library menu"
              onClick={() => setDrawerOpen(false)}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <div className="sidebar-scroll">
            {/* Books Section */}
            <section className="sidebar-section">
              <div className="sidebar-header">
                <h2>
                  <BookOpen size={14} aria-hidden="true" /> Books ({books.length})
                </h2>
                <button
                  type="button"
                  className="btn-mini"
                  onClick={() => setNewBookOpen((v) => !v)}
                  title="Create a new book"
                >
                  <BookPlus size={13} aria-hidden="true" /> Book
                </button>
              </div>

              {newBookOpen && (
                <form className="inline-book-form" onSubmit={(e) => void handleCreateBook(e)}>
                  <input
                    type="text"
                    placeholder="Book title…"
                    value={newBookTitle}
                    onChange={(e) => setNewBookTitle(e.target.value)}
                    autoFocus
                  />
                  <button type="submit" className="btn-mini">
                    Add
                  </button>
                </form>
              )}

              <ul className="book-list">
                {books.map((book) => {
                  const bookPieces = pages.filter((p) => p.bookId === book.id);
                  const isOpen = Boolean(expandedBooks[book.id]);
                  return (
                    <li key={book.id} className="book-card">
                      <div className="book-card-header">
                        <button
                          type="button"
                          className="book-toggle-btn"
                          aria-expanded={isOpen}
                          onClick={() =>
                            setExpandedBooks((prev) => ({ ...prev, [book.id]: !prev[book.id] }))
                          }
                        >
                          {isOpen ? (
                            <ChevronDown size={14} aria-hidden="true" />
                          ) : (
                            <ChevronRight size={14} aria-hidden="true" />
                          )}
                          <span className="book-title-text">{book.title}</span>
                          <span className="book-count">{bookPieces.length}</span>
                        </button>
                        <div className="book-card-actions">
                          <button
                            type="button"
                            className="icon-tiny-btn"
                            aria-label={`Add piece to ${book.title}`}
                            title="Add new piece to this book"
                            onClick={() => void handleCreateNewPiece(book.id)}
                          >
                            <FilePlus2 size={13} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="icon-tiny-btn"
                            aria-label={`Share ${book.title}`}
                            title="Share book"
                            onClick={() => handleOpenShare({ type: 'book', item: book })}
                          >
                            <Share2 size={13} aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            className="icon-tiny-btn danger"
                            aria-label={`Delete ${book.title}`}
                            title="Delete book"
                            onClick={() => void handleDeleteBook(book.id)}
                          >
                            <Trash2 size={12} aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      {isOpen && (
                        <ul className="page-list nested-page-list">
                          {bookPieces.length === 0 ? (
                            <li className="sidebar-empty-nested">No pieces in this book yet.</li>
                          ) : (
                            bookPieces.map((p) => (
                              <li
                                key={p.id}
                                className={`page-item ${p.id === activePage.id ? 'active' : ''}`}
                              >
                                <button
                                  type="button"
                                  className="page-item-btn"
                                  onClick={() => selectPiece(p.id)}
                                >
                                  <span className="page-item-title">{p.title}</span>
                                  <span className="page-item-meta">
                                    {p.timeSignature.numerator}/{p.timeSignature.denominator} •{' '}
                                    {p.measures.length} bars
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  className="icon-tiny-btn"
                                  aria-label={`Share ${p.title}`}
                                  title="Share piece"
                                  onClick={() => handleOpenShare({ type: 'piece', item: p })}
                                >
                                  <Share2 size={12} aria-hidden="true" />
                                </button>
                                {pages.length > 1 && (
                                  <button
                                    type="button"
                                    className="page-delete-btn"
                                    aria-label={`Delete ${p.title}`}
                                    onClick={() => void handleDeletePiece(p.id)}
                                  >
                                    <Trash2 size={12} aria-hidden="true" />
                                  </button>
                                )}
                              </li>
                            ))
                          )}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Standalone Pieces Section */}
            <section className="sidebar-section">
              <div className="sidebar-header">
                <h2>
                  <Music2 size={14} aria-hidden="true" /> Standalone ({standalonePages.length})
                </h2>
                <button
                  type="button"
                  className="btn-mini"
                  onClick={() => void handleCreateNewPiece(null)}
                  title="Create new standalone piece"
                >
                  <FilePlus2 size={13} aria-hidden="true" /> Piece
                </button>
              </div>

              <ul className="page-list">
                {standalonePages.map((p) => (
                  <li key={p.id} className={`page-item ${p.id === activePage.id ? 'active' : ''}`}>
                    <button
                      type="button"
                      className="page-item-btn"
                      onClick={() => selectPiece(p.id)}
                    >
                      <span className="page-item-title">{p.title}</span>
                      <span className="page-item-meta">
                        {p.timeSignature.numerator}/{p.timeSignature.denominator} •{' '}
                        {p.measures.length} bars
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-tiny-btn"
                      aria-label={`Share ${p.title}`}
                      title="Share piece"
                      onClick={() => handleOpenShare({ type: 'piece', item: p })}
                    >
                      <Share2 size={12} aria-hidden="true" />
                    </button>
                    {pages.length > 1 && (
                      <button
                        type="button"
                        className="page-delete-btn"
                        aria-label={`Delete ${p.title}`}
                        onClick={() => void handleDeletePiece(p.id)}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            {/* Shared With Me Section (Account users) */}
            {(sharedBooks.length > 0 || sharedPieces.length > 0) && (
              <section className="sidebar-section">
                <div className="sidebar-header">
                  <h2>
                    <Users size={14} aria-hidden="true" /> Shared With Me
                  </h2>
                </div>
                <ul className="page-list">
                  {sharedBooks.map((sb) => {
                    const sbPieces = sharedBookPieces.filter((p) => p.bookId === sb.id);
                    return (
                      <li key={sb.id} className="book-card">
                        <div className="shared-book-label">
                          <strong>{sb.title}</strong>
                          <span>by @{sb.ownerUsername}</span>
                        </div>
                        <ul className="page-list nested-page-list">
                          {sbPieces.map((p) => (
                            <li
                              key={p.id}
                              className={`page-item ${p.id === activePage.id ? 'active' : ''}`}
                            >
                              <button
                                type="button"
                                className="page-item-btn"
                                onClick={() => selectPiece(p.id)}
                              >
                                <span className="page-item-title">{p.title}</span>
                                <span className="page-item-meta">Read-only • Copy bars</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  })}
                  {sharedPieces.map((p) => (
                    <li
                      key={p.id}
                      className={`page-item ${p.id === activePage.id ? 'active' : ''}`}
                    >
                      <button
                        type="button"
                        className="page-item-btn"
                        onClick={() => selectPiece(p.id)}
                      >
                        <span className="page-item-title">{p.title}</span>
                        <span className="page-item-meta">by @{p.ownerUsername}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Saved Phrases (Snippets) */}
            <section className="sidebar-section">
              <div className="sidebar-header">
                <h2>
                  <Bookmark size={14} aria-hidden="true" /> Saved Phrases ({snippets.length})
                </h2>
              </div>
              {snippets.length === 0 ? (
                <p className="sidebar-empty">
                  Select measures and click <strong>Snippet</strong> to save reusable phrases.
                </p>
              ) : (
                <ul className="snippet-list">
                  {snippets.map((snip) => (
                    <li key={snip.id} className="snippet-item">
                      <button
                        type="button"
                        className="snippet-stamp-btn"
                        onClick={() => handleStampSnippet(snip)}
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
                        onClick={async () => {
                          if (user) await api.deleteSnippet(snip.id);
                          setSnippets((s) => s.filter((x) => x.id !== snip.id));
                        }}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <div className="sidebar-footer">
            <button type="button" className="btn-secondary btn-sm" onClick={handleExportJson}>
              <Download size={13} aria-hidden="true" /> Export
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => importJsonRef.current?.click()}
            >
              <Upload size={13} aria-hidden="true" /> Import
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
              aria-label="Piece title"
              readOnly={isActivePageReadOnly}
              value={activePage.title}
              onChange={(e) => updateActivePage((p) => ({ ...p, title: e.target.value }), false)}
            />
            <div className="meta-controls">
              {!isActivePageReadOnly && (
                <label className="meta-field">
                  <span>Book</span>
                  <select
                    aria-label="Assign piece to book"
                    value={activePage.bookId || ''}
                    onChange={(e) =>
                      updateActivePage(
                        (p) => ({ ...p, bookId: e.target.value || null }),
                        false
                      )
                    }
                  >
                    <option value="">Standalone</option>
                    {books.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="meta-field">
                <span>Meter</span>
                <select
                  disabled={isActivePageReadOnly}
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

              {!isActivePageReadOnly && (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => handleOpenShare({ type: 'piece', item: activePage })}
                >
                  <Share2 size={14} aria-hidden="true" />
                  <span>Share</span>
                </button>
              )}

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
                  <span className="hide-xs">Photo</span>
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
            statusMessage={
              isActivePageReadOnly
                ? `Viewing shared piece by @${activePage.ownerUsername || 'user'} (read-only). You can play it or copy any bars into your own piece.`
                : statusMessage
            }
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
            onSaveSnippet={() => void handleSaveSnippet()}
            onUndo={handleUndo}
            onRedo={handleRedo}
          />

          {/* Score Engraving Canvas */}
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

            <div className="score-scroll-area" tabIndex={0} role="region" aria-label="Sheet music score">
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

          {/* Mobile Quick Camera FAB */}
          <button
            type="button"
            className="mobile-camera-fab"
            aria-label="Take photo of sheet music"
            onClick={() => {
              setOcrInitialCamera(true);
              setOcrOpen(true);
            }}
          >
            <Camera size={22} aria-hidden="true" />
          </button>
        </main>
      </div>

      {/* Bulk OCR / Camera / PDF Import Modal */}
      <OcrModal
        open={ocrOpen}
        initialCamera={ocrInitialCamera}
        books={books}
        defaultBookId={activePage.bookId ?? null}
        onClose={() => setOcrOpen(false)}
        onImportPages={(res) => void handleBulkImport(res)}
      />

      {/* Sign In / Sign Up Modal */}
      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onAuthenticated={(u) => {
          setUser(u);
          announce(`Signed in as @${u.username}`);
          void loadAccountLibrary();
        }}
      />

      {/* Share Book / Piece Modal */}
      <ShareModal
        target={shareTarget}
        onClose={() => setShareTarget(null)}
        onUpdated={(type, updated) => {
          if (type === 'book') {
            const b = updated as TonbakBook;
            setBooks((prev) => prev.map((x) => (x.id === b.id ? b : x)));
            setShareTarget({ type: 'book', item: b });
          } else {
            const p = updated as TonbakPage;
            setPages((prev) => prev.map((x) => (x.id === p.id ? p : x)));
            setShareTarget({ type: 'piece', item: p });
          }
        }}
      />
    </div>
  );
}

export default App;
