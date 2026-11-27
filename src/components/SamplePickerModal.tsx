import React, { useEffect, useRef, useState } from 'react';
import { Play, Check, X, Sliders, Volume2 } from 'lucide-react';
import { sharedTonbakSynth } from '../lib/tonbakSynth';

interface CandidateItem {
  file: string;
  label: string;
  meta: string;
}

type CandidatePoolKey = 'tom' | 'bak_r' | 'bak_l' | 'riz' | 'gliss';

type TargetStrokeKey =
  | 'tom'
  | 'bak_r'
  | 'bak_l'
  | 'pelang_r'
  | 'pelang_l'
  | 'chap'
  | 'eshareh'
  | 'riz'
  | 'gliss';

const STROKE_TABS: Array<{
  key: TargetStrokeKey;
  label: string;
  defaultPool: CandidatePoolKey;
  maxPicks: number;
}> = [
  { key: 'tom', label: 'Tom (تُم)', defaultPool: 'tom', maxPicks: 3 },
  { key: 'bak_r', label: 'Bak R (^)', defaultPool: 'bak_r', maxPicks: 3 },
  { key: 'bak_l', label: 'Bak L (v̇)', defaultPool: 'bak_l', maxPicks: 3 },
  { key: 'pelang_r', label: 'Pelang R', defaultPool: 'bak_l', maxPicks: 2 },
  { key: 'pelang_l', label: 'Pelang L', defaultPool: 'bak_l', maxPicks: 2 },
  { key: 'chap', label: 'Chap (^̄)', defaultPool: 'bak_r', maxPicks: 2 },
  { key: 'eshareh', label: 'Eshareh (5)', defaultPool: 'bak_r', maxPicks: 2 },
  { key: 'riz', label: 'Riz Roll', defaultPool: 'riz', maxPicks: 2 },
  { key: 'gliss', label: 'Glissando', defaultPool: 'gliss', maxPicks: 2 },
];

interface SamplePickerModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (updatedStrokes: string[]) => void;
}

export const SamplePickerModal: React.FC<SamplePickerModalProps> = ({
  open,
  onClose,
  onSaved,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [manifest, setManifest] = useState<Record<CandidatePoolKey, CandidateItem[]> | null>(null);
  const [activeStroke, setActiveStroke] = useState<TargetStrokeKey>('tom');
  const [activePool, setActivePool] = useState<CandidatePoolKey>('tom');
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [playingFile, setPlayingFile] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setFeedback(null);
      dialog.showModal();
      fetch('/samples/candidates/manifest.json')
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => setManifest(data))
        .catch(() => setManifest(null));
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);
    if ('closedBy' in HTMLDialogElement.prototype) {
      return () => dialog.removeEventListener('close', handleClose);
    }
    const handleClick = (e: MouseEvent) => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const inside =
        r.top <= e.clientY && e.clientY <= r.bottom && r.left <= e.clientX && e.clientX <= r.right;
      if (!inside) dialog.close();
    };
    dialog.addEventListener('click', handleClick);
    return () => {
      dialog.removeEventListener('close', handleClose);
      dialog.removeEventListener('click', handleClick);
    };
  }, [onClose]);

  const currentTab = STROKE_TABS.find((t) => t.key === activeStroke) || STROKE_TABS[0];
  const currentPicks = selected[activeStroke] || [];
  const items = manifest?.[activePool] || [];

  const playCandidate = (file: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
    }
    const audio = new Audio(`/samples/candidates/${encodeURIComponent(file)}`);
    audioRef.current = audio;
    setPlayingFile(file);
    audio.onended = () => setPlayingFile((cur) => (cur === file ? null : cur));
    void audio.play();
  };

  const togglePick = (file: string) => {
    setSelected((prev) => {
      const list = prev[activeStroke] || [];
      if (list.includes(file)) {
        return { ...prev, [activeStroke]: list.filter((f) => f !== file) };
      }
      const next = [...list, file].slice(-currentTab.maxPicks);
      return { ...prev, [activeStroke]: next };
    });
  };

  const totalPickedStrokes = Object.values(selected).filter((v) => v.length > 0).length;

  const handleSave = async () => {
    if (totalPickedStrokes === 0) return;
    setSaving(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/teacher-kit/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mapping: selected }),
      });
      const data = (await res.json()) as { ok?: boolean; updated?: string[]; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to save kit');

      await sharedTonbakSynth.reloadKit('teacher');
      const now = sharedTonbakSynth.getCurrentTime() + 0.03;
      sharedTonbakSynth.triggerStroke('tom', now);
      sharedTonbakSynth.triggerStroke('bak_r', now + 0.18);
      sharedTonbakSynth.triggerStroke('bak_l', now + 0.32);

      onSaved(data.updated || []);
      setFeedback(`Saved ${(data.updated || []).join(', ')} into Teacher's Tonbak kit!`);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      aria-labelledby="sampler-dialog-title"
      className="ocr-dialog"
    >
      <div className="ocr-dialog-inner">
        <header className="ocr-dialog-header">
          <div>
            <h2 id="sampler-dialog-title">
              <Sliders size={18} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />
              Teacher&apos;s Tonbak — Sample Picker
            </h2>
            <p className="ocr-dialog-sub">
              Click any recording to audition it, select your favorite 1–{currentTab.maxPicks} clean hits for each stroke, then click Save.
            </p>
          </div>
          <button
            type="button"
            className="icon-close-btn"
            aria-label="Close sample picker"
            onClick={() => dialogRef.current?.close()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        {/* Target Stroke Tabs */}
        <div className="sampler-stroke-tabs" role="tablist" aria-label="Target tonbak stroke">
          {STROKE_TABS.map((tab) => {
            const count = (selected[tab.key] || []).length;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeStroke === tab.key}
                className={`sampler-tab ${activeStroke === tab.key ? 'active' : ''}`}
                onClick={() => {
                  setActiveStroke(tab.key);
                  setActivePool(tab.defaultPool);
                }}
              >
                <span>{tab.label}</span>
                {count > 0 && <span className="sampler-tab-badge">{count}</span>}
              </button>
            );
          })}
        </div>

        {/* Source Pool Switcher (in case you want to browse another pool for this stroke) */}
        <div className="sampler-pool-bar">
          <span>Browsing recordings:</span>
          {(['tom', 'bak_r', 'bak_l', 'riz', 'gliss'] as CandidatePoolKey[]).map((pool) => (
            <button
              key={pool}
              type="button"
              className="btn-mini"
              aria-pressed={activePool === pool}
              onClick={() => setActivePool(pool)}
            >
              {pool === 'tom' && 'Toms'}
              {pool === 'bak_r' && 'Warm Rims'}
              {pool === 'bak_l' && 'Crisp Rims'}
              {pool === 'riz' && 'Riz Rolls'}
              {pool === 'gliss' && 'Glissandos'}
            </button>
          ))}
        </div>

        {/* Audition Grid */}
        {!manifest ? (
          <div className="ocr-score-placeholder">
            No candidate recordings found in <code>public/samples/candidates/</code>.
          </div>
        ) : (
          <div className="sampler-grid">
            {items.map((item) => {
              const isPicked = currentPicks.includes(item.file);
              const isPlaying = playingFile === item.file;
              return (
                <div
                  key={item.file}
                  className={`sampler-card ${isPicked ? 'picked' : ''} ${isPlaying ? 'playing' : ''}`}
                >
                  <button
                    type="button"
                    className="sampler-play-btn"
                    onClick={() => playCandidate(item.file)}
                    title={`Play ${item.label}`}
                  >
                    {isPlaying ? <Volume2 size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                    <span className="sampler-card-info">
                      <strong>{item.label}</strong>
                      <small>{item.meta}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`sampler-pick-btn ${isPicked ? 'picked' : ''}`}
                    aria-pressed={isPicked}
                    onClick={() => {
                      playCandidate(item.file);
                      togglePick(item.file);
                    }}
                  >
                    {isPicked ? <Check size={14} aria-hidden="true" /> : null}
                    <span>{isPicked ? 'Picked' : `Use as ${currentTab.label.split(' ')[0]}`}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {feedback && <div className="ocr-success">{feedback}</div>}

        <footer className="ocr-dialog-footer">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => dialogRef.current?.close()}
          >
            Close
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={saving || totalPickedStrokes === 0}
            onClick={() => void handleSave()}
          >
            <Check size={15} aria-hidden="true" />
            <span>
              {saving
                ? 'Saving…'
                : `Save ${totalPickedStrokes} Stroke${totalPickedStrokes === 1 ? '' : 's'} to Teacher's Kit`}
            </span>
          </button>
        </footer>
      </div>
    </dialog>
  );
};
