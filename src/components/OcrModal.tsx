import React, { useEffect, useRef, useState } from 'react';
import {
  Upload,
  Camera,
  FileText,
  Sparkles,
  Cpu,
  Play,
  Square,
  Check,
  X,
  Image as ImageIcon,
  Settings2,
  AlertCircle,
  Trash2,
  BookOpen,
} from 'lucide-react';
import {
  createId,
  normalizeOcrPage,
  type TonbakBook,
  type TonbakPage,
} from '../types/notation';
import { runLocalTonbakOmr } from '../lib/localOmr';
import { renderPdfToImages } from '../lib/pdfImport';
import { sharedTonbakPlayer } from '../lib/tonbakSynth';
import { ScoreView } from './ScoreView';

interface BookPhoto {
  filename: string;
  url: string;
  sizeBytes: number;
}

interface QueueItem {
  id: string;
  name: string;
  imageDataUrl: string;
  status: 'pending' | 'scanning' | 'done' | 'error';
  error?: string;
  page?: TonbakPage;
  overlayUrl?: string;
  summary?: string;
}

export interface BulkImportResult {
  pages: TonbakPage[];
  destination:
    | { kind: 'standalone' }
    | { kind: 'existing-book'; bookId: string }
    | { kind: 'new-book'; title: string; author?: string };
}

interface OcrModalProps {
  open: boolean;
  initialCamera?: boolean;
  books: TonbakBook[];
  defaultBookId?: string | null;
  onClose: () => void;
  onImportPages: (result: BulkImportResult) => void;
}

export const OcrModal: React.FC<OcrModalProps> = ({
  open,
  initialCamera = false,
  books,
  defaultBookId,
  onClose,
  onImportPages,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [bookPhotos, setBookPhotos] = useState<BookPhoto[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [activeQueueId, setActiveQueueId] = useState<string | null>(null);
  const [ocrMode, setOcrMode] = useState<'vision' | 'local'>('vision');
  const [serverHasKey, setServerHasKey] = useState<boolean>(false);
  const [showKeySettings, setShowKeySettings] = useState(false);
  const [provider, setProvider] = useState<'openrouter' | 'gemini' | 'openai'>('openrouter');
  const [customApiKey, setCustomApiKey] = useState('');

  // Destination (Standalone vs Existing Book vs New Book)
  const [destMode, setDestMode] = useState<'standalone' | 'existing-book' | 'new-book'>(
    defaultBookId ? 'existing-book' : 'standalone'
  );
  const [targetBookId, setTargetBookId] = useState<string>(defaultBookId || books[0]?.id || '');
  const [newBookTitle, setNewBookTitle] = useState('');

  const [isScanning, setIsScanning] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  const activeItem = queue.find((q) => q.id === activeQueueId) || queue[0] || null;
  const completedPages = queue.filter((q) => q.status === 'done' && q.page).map((q) => q.page!);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      if (defaultBookId) {
        setDestMode('existing-book');
        setTargetBookId(defaultBookId);
      }
      if (initialCamera) {
        window.setTimeout(() => cameraInputRef.current?.click(), 120);
      }
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialCamera, defaultBookId]);

  // Fallback light-dismiss for browsers without native `closedby="any"` (Safari)
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      sharedTonbakPlayer.stop();
      setIsPreviewPlaying(false);
      onClose();
    };
    dialog.addEventListener('close', handleClose);

    if ('closedBy' in HTMLDialogElement.prototype) {
      return () => dialog.removeEventListener('close', handleClose);
    }

    const handleBackdropClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) dialog.close();
    };

    dialog.addEventListener('click', handleBackdropClick);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('click', handleBackdropClick);
    };
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    fetch('/api/book-photos')
      .then((r) => (r.ok ? r.json() : { photos: [] }))
      .then((data: { photos?: BookPhoto[] }) => setBookPhotos(data.photos || []))
      .catch(() => setBookPhotos([]));

    fetch('/api/ocr-status')
      .then((r) => (r.ok ? r.json() : {}))
      .then(
        (data: { hasOpenRouterKey?: boolean; hasGeminiKey?: boolean; hasOpenAIKey?: boolean }) => {
          const hasAny = Boolean(data.hasOpenRouterKey || data.hasGeminiKey || data.hasOpenAIKey);
          setServerHasKey(hasAny);
          if (!hasAny) setOcrMode('local');
        }
      )
      .catch(() => setServerHasKey(false));
  }, [open]);

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleFilesAdded = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setGlobalError(null);
    const added: QueueItem[] = [];

    for (const file of list) {
      if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
        try {
          setPdfProgress(`Rendering PDF "${file.name}"…`);
          const pdfPages = await renderPdfToImages(file, (cur, tot) =>
            setPdfProgress(`Rendering "${file.name}" — page ${cur} of ${tot}…`)
          );
          for (const p of pdfPages) {
            added.push({
              id: createId('q'),
              name: p.name,
              imageDataUrl: p.imageDataUrl,
              status: 'pending',
            });
          }
          // Auto-suggest creating a new book named after the PDF!
          if (!newBookTitle && pdfPages.length > 1) {
            setDestMode('new-book');
            setNewBookTitle(file.name.replace(/\.pdf$/i, ''));
          }
        } catch (err) {
          setGlobalError(
            `Could not read PDF "${file.name}": ${err instanceof Error ? err.message : String(err)}`
          );
        } finally {
          setPdfProgress(null);
        }
      } else if (file.type.startsWith('image/')) {
        const dataUrl = await readFileAsDataUrl(file);
        added.push({
          id: createId('q'),
          name: file.name.replace(/\.[^.]+$/, '') || 'Captured Photo',
          imageDataUrl: dataUrl,
          status: 'pending',
        });
      }
    }

    if (added.length > 0) {
      setQueue((prev) => [...prev, ...added]);
      setActiveQueueId((cur) => cur || added[0].id);
      if (added.length > 1 && destMode === 'standalone' && !newBookTitle) {
        setDestMode('new-book');
        setNewBookTitle('Imported Tonbak Book');
      }
    }
  };

  const handlePickBookPhoto = async (photo: BookPhoto) => {
    setGlobalError(null);
    try {
      const res = await fetch(photo.url);
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const item: QueueItem = {
        id: createId('q'),
        name: photo.filename.replace(/\.[^.]+$/, ''),
        imageDataUrl: dataUrl,
        status: 'pending',
      };
      setQueue((prev) => [...prev, item]);
      setActiveQueueId(item.id);
    } catch {
      setGlobalError(`Could not load ${photo.filename}`);
    }
  };

  const downscaleDataUrl = async (dataUrl: string, maxDim = 1600): Promise<string> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * ratio);
        c.height = Math.round(img.height * ratio);
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(dataUrl);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });

  const handleRunBatchOcr = async () => {
    const targets = queue.filter((q) => q.status !== 'done');
    if (targets.length === 0) return;

    setIsScanning(true);
    setGlobalError(null);

    for (const item of targets) {
      setActiveQueueId(item.id);
      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: 'scanning', error: undefined } : q))
      );

      try {
        if (ocrMode === 'vision') {
          const resized = await downscaleDataUrl(item.imageDataUrl, 1600);
          const res = await fetch('/api/ocr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              imageDataUrl: resized,
              provider,
              apiKey: customApiKey.trim() || undefined,
            }),
          });
          const data = (await res.json()) as {
            parsed?: unknown;
            model?: string;
            error?: string;
          };
          if (!res.ok || !data.parsed) {
            throw new Error(data.error || 'Vision OCR failed');
          }
          const page = normalizeOcrPage(data.parsed, item.name, resized);
          const noteCount = page.measures.reduce((sum, m) => sum + m.notes.length, 0);
          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id
                ? {
                    ...q,
                    status: 'done',
                    page,
                    summary: `AI Vision (${data.model || provider}): ${page.measures.length} bars, ${noteCount} notes`,
                  }
                : q
            )
          );
        } else {
          const result = await runLocalTonbakOmr(item.imageDataUrl, item.name);
          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id
                ? {
                    ...q,
                    status: 'done',
                    page: result.page,
                    overlayUrl: result.overlayDataUrl,
                    summary: `Local OMR: ${result.stats.stavesDetected} staves, ${result.stats.measuresDetected} bars, ${result.stats.notesDetected} notes`,
                  }
                : q
            )
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: 'error', error: msg } : q))
        );
      }
    }

    setIsScanning(false);
  };

  const togglePreviewPlay = () => {
    if (!activeItem?.page) return;
    if (isPreviewPlaying) {
      sharedTonbakPlayer.stop();
      setIsPreviewPlaying(false);
    } else {
      sharedTonbakPlayer.setCallbacks({
        onStateChange: (playing) => setIsPreviewPlaying(playing),
      });
      sharedTonbakPlayer.play(activeItem.page);
    }
  };

  const handleConfirmImport = () => {
    if (completedPages.length === 0) return;
    sharedTonbakPlayer.stop();
    setIsPreviewPlaying(false);

    const destination: BulkImportResult['destination'] =
      destMode === 'new-book'
        ? { kind: 'new-book', title: newBookTitle.trim() || 'Imported Book' }
        : destMode === 'existing-book' && targetBookId
          ? { kind: 'existing-book', bookId: targetBookId }
          : { kind: 'standalone' };

    onImportPages({ pages: completedPages, destination });
    setQueue([]);
    setActiveQueueId(null);
    dialogRef.current?.close();
  };

  const pendingCount = queue.filter((q) => q.status !== 'done').length;

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      aria-labelledby="ocr-dialog-title"
      className="ocr-dialog"
    >
      <div className="ocr-dialog-inner">
        <header className="ocr-dialog-header">
          <div>
            <h2 id="ocr-dialog-title">Scan &amp; Bulk Import Sheet Music</h2>
            <p className="ocr-dialog-sub">
              Snap a photo with your phone camera, or bulk-import multiple images &amp; multi-page PDFs.
            </p>
          </div>
          <button
            type="button"
            className="icon-close-btn"
            aria-label="Close OCR dialog"
            onClick={() => dialogRef.current?.close()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {/* Source picker: Mobile Camera + Bulk Images/PDF + Book Folder */}
        <div className="ocr-source-grid">
          <div className="ocr-upload-actions">
            <button
              type="button"
              className="ocr-camera-btn"
              onClick={() => cameraInputRef.current?.click()}
            >
              <Camera size={20} aria-hidden="true" />
              <strong>Take Photo</strong>
              <span>Use phone camera</span>
            </button>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                if (e.target.files) void handleFilesAdded(e.target.files);
                e.target.value = '';
              }}
            />

            <div
              className="ocr-dropzone"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files) void handleFilesAdded(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="dropzone-icons">
                <Upload size={18} aria-hidden="true" />
                <FileText size={18} aria-hidden="true" />
              </div>
              <strong>Images or PDFs</strong>
              <span>Select multiple files or multi-page PDF</span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files) void handleFilesAdded(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          {bookPhotos.length > 0 && (
            <div className="ocr-book-strip">
              <div className="ocr-book-strip-label">
                <ImageIcon size={14} aria-hidden="true" />
                <span>Local Book Folder ({bookPhotos.length} photos) — click to queue</span>
              </div>
              <div className="ocr-book-thumbs">
                {bookPhotos.map((p) => (
                  <button
                    key={p.filename}
                    type="button"
                    className="ocr-thumb-btn"
                    onClick={() => void handlePickBookPhoto(p)}
                  >
                    <img src={p.url} alt={p.filename} loading="lazy" />
                    <span>{p.filename.replace(/\.jpeg$/i, '')}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {pdfProgress && <div className="ocr-info-banner">{pdfProgress}</div>}

        {/* Import Queue Strip */}
        {queue.length > 0 && (
          <div className="ocr-queue-bar">
            <div className="ocr-queue-header">
              <span>
                Import Queue ({queue.length} page{queue.length === 1 ? '' : 's'},{' '}
                {completedPages.length} ready)
              </span>
              <button
                type="button"
                className="btn-link"
                disabled={isScanning}
                onClick={() => {
                  setQueue([]);
                  setActiveQueueId(null);
                }}
              >
                Clear Queue
              </button>
            </div>
            <div className="ocr-queue-chips">
              {queue.map((item) => (
                <div
                  key={item.id}
                  className={`queue-chip ${activeItem?.id === item.id ? 'active' : ''} status-${item.status}`}
                >
                  <button
                    type="button"
                    className="queue-chip-main"
                    onClick={() => setActiveQueueId(item.id)}
                  >
                    <span className="queue-dot" aria-hidden="true" />
                    <span className="queue-chip-name">{item.name}</span>
                  </button>
                  <button
                    type="button"
                    className="queue-chip-del"
                    aria-label={`Remove ${item.name}`}
                    disabled={isScanning}
                    onClick={() =>
                      setQueue((prev) => prev.filter((q) => q.id !== item.id))
                    }
                  >
                    <Trash2 size={11} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Engine Selection & Destination Row */}
        <div className="ocr-controls-row">
          <div className="ocr-mode-pills" role="group" aria-label="OCR engine">
            <button
              type="button"
              className="mode-pill"
              aria-pressed={ocrMode === 'vision'}
              onClick={() => setOcrMode('vision')}
            >
              <Sparkles size={14} aria-hidden="true" />
              <span>AI Vision OCR {serverHasKey ? '(Ready)' : ''}</span>
            </button>
            <button
              type="button"
              className="mode-pill"
              aria-pressed={ocrMode === 'local'}
              onClick={() => setOcrMode('local')}
            >
              <Cpu size={14} aria-hidden="true" />
              <span>Local Offline OMR</span>
            </button>
          </div>

          <div className="ocr-action-right">
            {ocrMode === 'vision' && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowKeySettings((v) => !v)}
              >
                <Settings2 size={14} aria-hidden="true" />
                <span>API Key</span>
              </button>
            )}
            <button
              type="button"
              className="btn-primary"
              disabled={pendingCount === 0 || isScanning}
              onClick={() => void handleRunBatchOcr()}
            >
              {isScanning
                ? 'Scanning queue…'
                : ocrMode === 'vision'
                  ? `OCR ${pendingCount || queue.length} Page${(pendingCount || queue.length) === 1 ? '' : 's'}`
                  : `Offline OMR (${pendingCount || queue.length})`}
            </button>
          </div>
        </div>

        {/* Destination Book / Standalone selector */}
        <div className="ocr-dest-row">
          <span className="ocr-dest-label">
            <BookOpen size={14} aria-hidden="true" /> Save to:
          </span>
          <select
            aria-label="Import destination"
            value={destMode}
            onChange={(e) =>
              setDestMode(e.target.value as 'standalone' | 'existing-book' | 'new-book')
            }
          >
            <option value="standalone">Standalone Piece(s)</option>
            {books.length > 0 && <option value="existing-book">Existing Book</option>}
            <option value="new-book">Create New Book</option>
          </select>

          {destMode === 'existing-book' && books.length > 0 && (
            <select
              aria-label="Target book"
              value={targetBookId}
              onChange={(e) => setTargetBookId(e.target.value)}
            >
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          )}

          {destMode === 'new-book' && (
            <input
              type="text"
              className="ocr-new-book-input"
              placeholder="New book title (e.g. Bahman Rajabi Vol. 1)"
              value={newBookTitle}
              onChange={(e) => setNewBookTitle(e.target.value)}
            />
          )}
        </div>

        {showKeySettings && ocrMode === 'vision' && (
          <div className="ocr-key-panel">
            <label>
              Provider
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as 'openrouter' | 'gemini' | 'openai')}
              >
                <option value="openrouter">OpenRouter (Gemini 2.5 Flash)</option>
                <option value="gemini">Google Gemini Direct</option>
                <option value="openai">OpenAI (GPT-4o mini)</option>
              </select>
            </label>
            <label className="ocr-key-input-wrap">
              API Key {serverHasKey ? '(optional — local env key detected)' : '(required)'}
              <input
                type="password"
                placeholder="Paste API key or leave blank to use environment key"
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
              />
            </label>
          </div>
        )}

        {(globalError || activeItem?.error) && (
          <div className="ocr-error" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{globalError || activeItem?.error}</span>
            {ocrMode === 'vision' && (
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setOcrMode('local');
                  setGlobalError(null);
                }}
              >
                Switch to Local Offline OMR
              </button>
            )}
          </div>
        )}

        {activeItem?.summary && <div className="ocr-success">{activeItem.summary}</div>}

        {/* Side-by-side preview of currently selected queue item */}
        {activeItem && (
          <div className="ocr-preview-split">
            <div className="ocr-photo-pane">
              <div className="pane-caption">
                {activeItem.overlayUrl
                  ? `OMR Overlay: ${activeItem.name}`
                  : `Source: ${activeItem.name}`}
              </div>
              <img
                src={activeItem.overlayUrl || activeItem.imageDataUrl}
                alt={`Sheet music page ${activeItem.name}`}
                className="ocr-source-img"
              />
            </div>

            <div className="ocr-score-pane">
              <div className="pane-caption">
                <span>Recognized Notation Preview</span>
                {activeItem.page && (
                  <button type="button" className="btn-mini" onClick={togglePreviewPlay}>
                    {isPreviewPlaying ? (
                      <>
                        <Square size={12} aria-hidden="true" /> Stop
                      </>
                    ) : (
                      <>
                        <Play size={12} aria-hidden="true" /> Audition
                      </>
                    )}
                  </button>
                )}
              </div>
              {activeItem.page ? (
                <div className="ocr-score-scroll">
                  <ScoreView
                    page={activeItem.page}
                    selection={null}
                    playingPosition={null}
                    onSelectNote={() => {}}
                    onSelectMeasure={() => {}}
                    onQuickAddNote={() => {}}
                  />
                </div>
              ) : (
                <div className="ocr-score-placeholder">
                  {activeItem.status === 'scanning'
                    ? 'Analyzing staves, beams, and tonbak symbols…'
                    : ocrMode === 'vision'
                      ? 'Click "OCR" above to extract all measures and notes.'
                      : 'Click "Offline OMR" above to extract all measures and notes.'}
                </div>
              )}
            </div>
          </div>
        )}

        <footer className="ocr-dialog-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => dialogRef.current?.close()}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={completedPages.length === 0}
            onClick={handleConfirmImport}
          >
            <Check size={15} aria-hidden="true" />
            <span>
              Import {completedPages.length || ''} Piece{completedPages.length === 1 ? '' : 's'}
            </span>
          </button>
        </footer>
      </div>
    </dialog>
  );
};
