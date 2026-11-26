import React, { useEffect, useRef } from 'react';
import {
  Copy,
  ClipboardPaste,
  Trash2,
  Plus,
  Repeat,
  Undo2,
  Redo2,
  BookmarkPlus,
  Sparkles,
} from 'lucide-react';
import {
  DURATION_LABELS,
  STROKE_INFO,
  type ClipboardPayload,
  type Duration,
  type FingerMark,
  type StrokeType,
  type TonbakNote,
} from '../types/notation';

interface EditorToolbarProps {
  activeStroke: StrokeType;
  activeDuration: Duration;
  selectedNote: TonbakNote | null;
  hasMeasureSelection: boolean;
  isRepeatMeasureSelected: boolean;
  clipboard: ClipboardPayload | null;
  canUndo: boolean;
  canRedo: boolean;
  statusMessage: string;
  onSelectStroke: (stroke: StrokeType) => void;
  onSelectDuration: (duration: Duration) => void;
  onToggleDotted: () => void;
  onToggleTremolo: () => void;
  onTogglePelangGrace: () => void;
  onCycleFinger: (finger: FingerMark | undefined) => void;
  onInsertNote: () => void;
  onDeleteSelected: () => void;
  onAddMeasure: () => void;
  onToggleRepeatMeasure: () => void;
  onCopySection: () => void;
  onPasteSection: (mode: 'after' | 'replace') => void;
  onSaveSnippet: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const STROKE_ORDER: StrokeType[] = [
  'tom',
  'bak_r',
  'bak_l',
  'pelang_r',
  'pelang_l',
  'chap',
  'riz',
  'eshareh',
  'rest',
];

const DURATION_ORDER: Duration[] = [
  'quarter',
  'eighth',
  'sixteenth',
  'thirtysecond',
  'half',
  'whole',
];

export const EditorToolbar: React.FC<EditorToolbarProps> = ({
  activeStroke,
  activeDuration,
  selectedNote,
  hasMeasureSelection,
  isRepeatMeasureSelected,
  clipboard,
  canUndo,
  canRedo,
  statusMessage,
  onSelectStroke,
  onSelectDuration,
  onToggleDotted,
  onToggleTremolo,
  onTogglePelangGrace,
  onCycleFinger,
  onInsertNote,
  onDeleteSelected,
  onAddMeasure,
  onToggleRepeatMeasure,
  onCopySection,
  onPasteSection,
  onSaveSnippet,
  onUndo,
  onRedo,
}) => {
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Roving tabindex fallback for browsers without native focusgroup support
  useEffect(() => {
    const bar = toolbarRef.current;
    if (!bar || 'focusGroup' in HTMLElement.prototype) return;

    const getItems = () =>
      Array.from(bar.querySelectorAll<HTMLButtonElement>('button[type="button"]'));

    const items = getItems();
    items.forEach((b, i) => {
      b.tabIndex = i === 0 ? 0 : -1;
    });

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLButtonElement | null;
      const list = getItems();
      if (target && list.includes(target)) {
        list.forEach((b) => {
          b.tabIndex = b === target ? 0 : -1;
        });
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const list = getItems();
      const idx = list.indexOf(document.activeElement as HTMLButtonElement);
      if (idx === -1) return;

      const rtl = getComputedStyle(bar).direction === 'rtl';
      let nextIdx = -1;
      if (e.key === 'ArrowRight') nextIdx = (idx + (rtl ? -1 : 1) + list.length) % list.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx + (rtl ? 1 : -1) + list.length) % list.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = list.length - 1;

      if (nextIdx !== -1) {
        e.preventDefault();
        list[nextIdx]?.focus();
      }
    };

    bar.addEventListener('focusin', onFocusIn);
    bar.addEventListener('keydown', onKeyDown);
    return () => {
      bar.removeEventListener('focusin', onFocusIn);
      bar.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const currentStroke = selectedNote?.stroke ?? activeStroke;
  const currentDuration = selectedNote?.duration ?? activeDuration;
  const isDotted = Boolean(selectedNote?.dotted);
  const isTremolo = Boolean(selectedNote?.tremolo || selectedNote?.stroke === 'riz');
  const hasPelangGrace = Boolean(selectedNote?.graceNotes && selectedNote.graceNotes.length > 0);
  const currentFinger = selectedNote?.finger;

  return (
    <div className="editor-toolbar-shell">
      <div
        ref={toolbarRef}
        role="toolbar"
        {...({ focusgroup: 'toolbar wrap' } as Record<string, string>)}
        aria-label="Tonbak notation editor"
        aria-controls="tonbak-score-canvas"
        className="editor-toolbar"
      >
        {/* Group 1: Tonbak Strokes */}
        <div role="group" aria-label="Tonbak strokes" className="toolbar-group">
          {STROKE_ORDER.map((stroke) => {
            const info = STROKE_INFO[stroke];
            const pressed = currentStroke === stroke;
            return (
              <button
                key={stroke}
                type="button"
                className="tb-btn tb-stroke-btn"
                aria-pressed={pressed}
                title={`${info.label} (${info.persian}) — Shortcut: ${info.shortcut}`}
                onClick={() => onSelectStroke(stroke)}
              >
                <span className="tb-stroke-symbol" style={{ color: info.color }}>
                  {stroke === 'tom' && '؟'}
                  {stroke === 'bak_r' && '^'}
                  {stroke === 'bak_l' && 'v̇'}
                  {stroke === 'pelang_r' && '◠^'}
                  {stroke === 'pelang_l' && '◠v'}
                  {stroke === 'chap' && '^̄'}
                  {stroke === 'riz' && '^v'}
                  {stroke === 'eshareh' && '5'}
                  {stroke === 'rest' && '𝄽'}
                </span>
                <span className="tb-btn-label">{info.label}</span>
              </button>
            );
          })}
        </div>

        <span role="separator" aria-orientation="vertical" className="toolbar-sep" />

        {/* Group 2: Durations */}
        <div role="group" aria-label="Note duration" className="toolbar-group">
          {DURATION_ORDER.map((dur) => {
            const meta = DURATION_LABELS[dur];
            const pressed = currentDuration === dur;
            return (
              <button
                key={dur}
                type="button"
                className="tb-btn tb-dur-btn"
                aria-pressed={pressed}
                title={`${meta.name} note — Shortcut: ${meta.shortcut}`}
                onClick={() => onSelectDuration(dur)}
              >
                <span className="tb-dur-glyph">{meta.short}</span>
              </button>
            );
          })}
        </div>

        <span role="separator" aria-orientation="vertical" className="toolbar-sep" />

        {/* Group 3: Modifiers (Dot, Pelang Grace, Riz Tremolo, Finger) */}
        <div role="group" aria-label="Note modifiers" className="toolbar-group">
          <button
            type="button"
            className="tb-btn"
            aria-pressed={isDotted}
            aria-disabled={!selectedNote ? 'true' : undefined}
            title="Toggle augmentation dot (.)"
            onClick={() => selectedNote && onToggleDotted()}
          >
            Dot •
          </button>
          <button
            type="button"
            className="tb-btn"
            aria-pressed={hasPelangGrace}
            aria-disabled={!selectedNote ? 'true' : undefined}
            title="Toggle Pelang grace-note pair (^ v)"
            onClick={() => selectedNote && onTogglePelangGrace()}
          >
            <Sparkles size={14} aria-hidden="true" />
            <span>Pelang</span>
          </button>
          <button
            type="button"
            className="tb-btn"
            aria-pressed={isTremolo}
            aria-disabled={!selectedNote ? 'true' : undefined}
            title="Toggle Riz tremolo slashes"
            onClick={() => selectedNote && onToggleTremolo()}
          >
            Riz ≋
          </button>
          <button
            type="button"
            className="tb-btn"
            aria-disabled={!selectedNote ? 'true' : undefined}
            title="Cycle finger mark (2, 3, =, none)"
            onClick={() => {
              if (!selectedNote) return;
              const order: Array<FingerMark | undefined> = ['2', '3', '=', undefined];
              const next = order[(order.indexOf(currentFinger) + 1) % order.length];
              onCycleFinger(next);
            }}
          >
            Finger: {currentFinger ?? '—'}
          </button>
        </div>

        <span role="separator" aria-orientation="vertical" className="toolbar-sep" />

        {/* Group 4: Insert / Measure / Copy-Paste Actions */}
        <div role="group" aria-label="Edit and section actions" className="toolbar-group">
          <button
            type="button"
            className="tb-btn tb-action-primary"
            title="Insert note after selection (Enter)"
            onClick={onInsertNote}
          >
            <Plus size={14} aria-hidden="true" />
            <span>Note</span>
          </button>
          <button
            type="button"
            className="tb-btn"
            title="Add new measure at end or after selection"
            onClick={onAddMeasure}
          >
            <Plus size={14} aria-hidden="true" />
            <span>Bar</span>
          </button>
          <button
            type="button"
            className="tb-btn"
            aria-pressed={isRepeatMeasureSelected}
            aria-disabled={!hasMeasureSelection ? 'true' : undefined}
            title="Toggle % repeat previous measure"
            onClick={() => hasMeasureSelection && onToggleRepeatMeasure()}
          >
            <Repeat size={14} aria-hidden="true" />
            <span>%</span>
          </button>
          <button
            type="button"
            className="tb-btn"
            aria-disabled={!hasMeasureSelection && !selectedNote ? 'true' : undefined}
            title="Copy selected measure(s) or note (Cmd/Ctrl+C)"
            onClick={() => (hasMeasureSelection || selectedNote) && onCopySection()}
          >
            <Copy size={14} aria-hidden="true" />
            <span>Copy</span>
          </button>
          <button
            type="button"
            className="tb-btn"
            aria-disabled={!clipboard ? 'true' : undefined}
            title="Paste copied section after selection (Cmd/Ctrl+V)"
            onClick={() => clipboard && onPasteSection('after')}
          >
            <ClipboardPaste size={14} aria-hidden="true" />
            <span>Paste</span>
          </button>
          <button
            type="button"
            className="tb-btn"
            aria-disabled={!hasMeasureSelection ? 'true' : undefined}
            title="Save selected measures as reusable phrase snippet"
            onClick={() => hasMeasureSelection && onSaveSnippet()}
          >
            <BookmarkPlus size={14} aria-hidden="true" />
            <span>Snippet</span>
          </button>
          <button
            type="button"
            className="tb-btn tb-danger"
            aria-disabled={!hasMeasureSelection && !selectedNote ? 'true' : undefined}
            title="Delete selected note or measure(s) (Backspace/Delete)"
            onClick={() => (hasMeasureSelection || selectedNote) && onDeleteSelected()}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>

        <span role="separator" aria-orientation="vertical" className="toolbar-sep" />

        {/* Group 5: Undo / Redo */}
        <div role="group" aria-label="History" className="toolbar-group">
          <button
            type="button"
            className="tb-btn"
            aria-label="Undo"
            aria-disabled={!canUndo ? 'true' : undefined}
            title="Undo (Cmd/Ctrl+Z)"
            onClick={() => canUndo && onUndo()}
          >
            <Undo2 size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="tb-btn"
            aria-label="Redo"
            aria-disabled={!canRedo ? 'true' : undefined}
            title="Redo (Cmd/Ctrl+Shift+Z)"
            onClick={() => canRedo && onRedo()}
          >
            <Redo2 size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Live region outside toolbar for screen-reader and visual action feedback */}
      <div className="toolbar-status-bar">
        <p role="status" className="toolbar-status-text">
          {statusMessage ||
            (clipboard
              ? `Clipboard ready: ${
                  clipboard.kind === 'measures'
                    ? `${clipboard.measures?.length ?? 0} measure(s)`
                    : `${clipboard.notes?.length ?? 0} note(s)`
                } from "${clipboard.sourceTitle}" — switch to any page and press Paste (⌘V)`
              : 'Tip: Click any note to edit, click a measure badge (or Shift+Click a range) to copy sections across pages.')}
        </p>
      </div>
    </div>
  );
};
