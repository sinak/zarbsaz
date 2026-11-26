import React, { useEffect, useRef, useState } from 'react';
import {
  Upload,
  Sparkles,
  Cpu,
  Play,
  Square,
  Check,
  X,
  Image as ImageIcon,
  Settings2,
  AlertCircle,
} from 'lucide-react';
import { normalizeOcrPage, type TonbakPage } from '../types/notation';
import { runLocalTonbakOmr } from '../lib/localOmr';
import { sharedTonbakPlayer } from '../lib/tonbakSynth';
import { ScoreView } from './ScoreView';

interface BookPhoto {
  filename: string;
  url: string;
  sizeBytes: number;
}

interface OcrModalProps {
  open: boolean;
  onClose: () => void;
  onImportPage: (page: TonbakPage) => void;
}

export const OcrModal: React.FC<OcrModalProps> = ({ open, onClose, onImportPage }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [bookPhotos, setBookPhotos] = useState<BookPhoto[]>([]);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [selectedImageName, setSelectedImageName] = useState<string>('');
  const [ocrMode, setOcrMode] = useState<'vision' | 'local'>('vision');
  const [serverHasKey, setServerHasKey] = useState<boolean>(false);
  const [showKeySettings, setShowKeySettings] = useState(false);
  const [provider, setProvider] = useState<'openrouter' | 'gemini' | 'openai'>('openrouter');
  const [customApiKey, setCustomApiKey] = useState('');

  const [isScanning, setIsScanning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState<TonbakPage | null>(null);
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const [scanSummary, setScanSummary] = useState<string | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);

  // Open/close native modal dialog with showModal()
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Fallback light-dismiss for browsers without native `closedby="any"` support (e.g. Safari)
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
      if (!inside) {
        dialog.close();
      }
    };

    dialog.addEventListener('click', handleBackdropClick);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('click', handleBackdropClick);
    };
  }, [onClose]);

  // Fetch workspace book photos and OCR key availability when opened
  useEffect(() => {
    if (!open) return;
    fetch('/api/book-photos')
      .then((r) => (r.ok ? r.json() : { photos: [] }))
      .then((data: { photos?: BookPhoto[] }) => setBookPhotos(data.photos || []))
      .catch(() => setBookPhotos([]));

    fetch('/api/ocr-status')
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: { hasOpenRouterKey?: boolean; hasGeminiKey?: boolean; hasOpenAIKey?: boolean }) => {
        const hasAny = Boolean(data.hasOpenRouterKey || data.hasGeminiKey || data.hasOpenAIKey);
        setServerHasKey(hasAny);
        if (!hasAny) setOcrMode('local');
      })
      .catch(() => setServerHasKey(false));
  }, [open]);

  const handleFileSelected = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setSelectedImageUrl(reader.result);
        setSelectedImageName(file.name.replace(/\.[^.]+$/, ''));
        setPreviewPage(null);
        setOverlayUrl(null);
        setErrorMsg(null);
        setScanSummary(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const handlePickBookPhoto = async (photo: BookPhoto) => {
    setErrorMsg(null);
    setPreviewPage(null);
    setOverlayUrl(null);
    setScanSummary(null);
    setSelectedImageName(photo.filename.replace(/\.[^.]+$/, ''));
    try {
      const res = await fetch(photo.url);
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      setSelectedImageUrl(dataUrl);
    } catch {
      setErrorMsg(`Could not load ${photo.filename}`);
    }
  };

  const downscaleDataUrl = async (dataUrl: string, maxDim = 1600): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * ratio);
        c.height = Math.round(img.height * ratio);
        const ctx = c.getContext('2d');
        if (!ctx) return resolve(dataUrl);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  };

  const handleRunOcr = async () => {
    if (!selectedImageUrl) return;
    setIsScanning(true);
    setErrorMsg(null);
    setPreviewPage(null);
    setOverlayUrl(null);
    setScanSummary(null);

    try {
      if (ocrMode === 'vision') {
        const resized = await downscaleDataUrl(selectedImageUrl, 1600);
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

        const page = normalizeOcrPage(
          data.parsed,
          selectedImageName || 'Scanned Page',
          selectedImageUrl
        );
        const noteCount = page.measures.reduce((sum, m) => sum + m.notes.length, 0);
        setPreviewPage(page);
        setScanSummary(
          `AI Vision OCR (${data.model || provider}) imported ${page.measures.length} measures & ${noteCount} notes.`
        );
      } else {
        const result = await runLocalTonbakOmr(
          selectedImageUrl,
          selectedImageName || 'Scanned Tonbak Page'
        );
        setPreviewPage(result.page);
        setOverlayUrl(result.overlayDataUrl);
        setScanSummary(
          `Local Offline OMR detected ${result.stats.stavesDetected} staves, ${result.stats.measuresDetected} measures, and ${result.stats.notesDetected} notes.`
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const togglePreviewPlay = () => {
    if (!previewPage) return;
    if (isPreviewPlaying) {
      sharedTonbakPlayer.stop();
      setIsPreviewPlaying(false);
    } else {
      sharedTonbakPlayer.setCallbacks({
        onStateChange: (playing) => setIsPreviewPlaying(playing),
      });
      sharedTonbakPlayer.play(previewPage);
    }
  };

  const handleConfirmImport = () => {
    if (!previewPage) return;
    sharedTonbakPlayer.stop();
    setIsPreviewPlaying(false);
    onImportPage(previewPage);
    dialogRef.current?.close();
  };

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
            <h2 id="ocr-dialog-title">Scan &amp; OCR Sheet Music Photo</h2>
            <p className="ocr-dialog-sub">
              Upload any photo of standard Persian tonbak notation or pick a page from your book folder.
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

        {/* Source picker: Upload + Book Folder */}
        <div className="ocr-source-grid">
          <div
            className="ocr-dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file && file.type.startsWith('image/')) handleFileSelected(file);
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={22} aria-hidden="true" />
            <strong>Upload Photo</strong>
            <span>Drop JPEG/PNG here or click to browse</span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFileSelected(f);
              }}
            />
          </div>

          {bookPhotos.length > 0 && (
            <div className="ocr-book-strip">
              <div className="ocr-book-strip-label">
                <ImageIcon size={14} aria-hidden="true" />
                <span>Your Book Folder ({bookPhotos.length} photos)</span>
              </div>
              <div className="ocr-book-thumbs">
                {bookPhotos.map((p) => (
                  <button
                    key={p.filename}
                    type="button"
                    className={`ocr-thumb-btn ${
                      selectedImageName === p.filename.replace(/\.[^.]+$/, '') ? 'active' : ''
                    }`}
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

        {/* Engine Selection & Action Row */}
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
                <span>API Settings</span>
              </button>
            )}
            <button
              type="button"
              className="btn-primary"
              disabled={!selectedImageUrl || isScanning}
              onClick={() => void handleRunOcr()}
            >
              {isScanning
                ? 'Scanning notation…'
                : ocrMode === 'vision'
                  ? 'OCR Whole Page'
                  : 'Run Offline OMR'}
            </button>
          </div>
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
              API Key {serverHasKey ? '(optional — local env key detected)' : '(required for AI Vision)'}
              <input
                type="password"
                placeholder="Paste API key or leave blank to use environment key"
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
              />
            </label>
          </div>
        )}

        {errorMsg && (
          <div className="ocr-error" role="alert">
            <AlertCircle size={16} aria-hidden="true" />
            <span>{errorMsg}</span>
            {ocrMode === 'vision' && (
              <button
                type="button"
                className="btn-link"
                onClick={() => {
                  setOcrMode('local');
                  setErrorMsg(null);
                }}
              >
                Switch to Local Offline OMR
              </button>
            )}
          </div>
        )}

        {scanSummary && <div className="ocr-success">{scanSummary}</div>}

        {/* Side-by-side photo & recognized score preview */}
        {selectedImageUrl && (
          <div className="ocr-preview-split">
            <div className="ocr-photo-pane">
              <div className="pane-caption">
                {overlayUrl ? 'Local OMR Detection Overlay' : `Source Photo: ${selectedImageName}`}
              </div>
              <img
                src={overlayUrl || selectedImageUrl}
                alt="Selected sheet music page"
                className="ocr-source-img"
              />
            </div>

            <div className="ocr-score-pane">
              <div className="pane-caption">
                <span>Recognized Notation Preview</span>
                {previewPage && (
                  <button type="button" className="btn-mini" onClick={togglePreviewPlay}>
                    {isPreviewPlaying ? (
                      <>
                        <Square size={12} aria-hidden="true" /> Stop
                      </>
                    ) : (
                      <>
                        <Play size={12} aria-hidden="true" /> Audition on Tonbak
                      </>
                    )}
                  </button>
                )}
              </div>
              {previewPage ? (
                <div className="ocr-score-scroll">
                  <ScoreView
                    page={previewPage}
                    selection={null}
                    playingPosition={null}
                    onSelectNote={() => {}}
                    onSelectMeasure={() => {}}
                    onQuickAddNote={() => {}}
                  />
                </div>
              ) : (
                <div className="ocr-score-placeholder">
                  {isScanning
                    ? 'Analyzing staves, beams, and tonbak symbols…'
                    : ocrMode === 'vision'
                      ? 'Click "OCR Whole Page" above to extract all measures and notes.'
                      : 'Click "Run Offline OMR" above to extract all measures and notes.'}
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
            disabled={!previewPage}
            onClick={handleConfirmImport}
          >
            <Check size={15} aria-hidden="true" />
            <span>Import Page into Library</span>
          </button>
        </footer>
      </div>
    </dialog>
  );
};
