import React, { useEffect, useRef, useState } from 'react';
import { Play, Check, X, Sliders, Volume2, Mic, Square, Upload } from 'lucide-react';
import { sharedTonbakSynth } from '../lib/tonbakSynth';
import { bytesToBase64, trimAndEncodeDrumWav, type DrumHitStats } from '../lib/wavEncoder';

interface CandidateItem {
  file: string;
  label: string;
  meta: string;
}

type CandidatePoolKey = 'tom' | 'bak_r' | 'bak_l' | 'cascade' | 'riz' | 'gliss';

type TargetStrokeKey =
  | 'tom'
  | 'bak_r'
  | 'bak_l'
  | 'pelang'
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
  { key: 'bak_l', label: 'Bak L (v)', defaultPool: 'bak_r', maxPicks: 3 },
  { key: 'pelang', label: 'Pelang L (v̇)', defaultPool: 'bak_l', maxPicks: 2 },
  { key: 'pelang_r', label: 'Cascade R (◠^)', defaultPool: 'cascade', maxPicks: 2 },
  { key: 'pelang_l', label: 'Cascade L (◠v)', defaultPool: 'cascade', maxPicks: 2 },
  { key: 'chap', label: 'Bak Edge (^̄)', defaultPool: 'bak_l', maxPicks: 2 },
  { key: 'eshareh', label: 'Tom Grace (S)', defaultPool: 'tom', maxPicks: 2 },
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

  // Built-in Raw-PCM Web Audio Mic Recorder state
  const [isRecording, setIsRecording] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [recordedWavUrl, setRecordedWavUrl] = useState<string | null>(null);
  const [recordedWavBase64, setRecordedWavBase64] = useState<string | null>(null);
  const [recordedStats, setRecordedStats] = useState<DrumHitStats | null>(null);
  const [savedLiveStrokes, setSavedLiveStrokes] = useState<Record<string, boolean>>({});
  const [recordError, setRecordError] = useState<string | null>(null);
  const recStreamRef = useRef<MediaStream | null>(null);
  const recCtxRef = useRef<AudioContext | null>(null);
  const recProcRef = useRef<ScriptProcessorNode | null>(null);
  const recSamplesRef = useRef<Float32Array[]>([]);
  const recSampleRateRef = useRef<number>(44100);
  const hitDetectedAtRef = useRef<number | null>(null);
  const isFinalizingRef = useRef<boolean>(false);
  const recordingStrokeRef = useRef<TargetStrokeKey>('tom');
  const uploadAudioRef = useRef<HTMLInputElement | null>(null);

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
  const shortStrokeName = currentTab.label.replace(/\s*\([^)]*\)/, '');
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

  const teardownMic = () => {
    if (recProcRef.current) {
      recProcRef.current.onaudioprocess = null;
      recProcRef.current.disconnect();
      recProcRef.current = null;
    }
    recStreamRef.current?.getTracks().forEach((t) => t.stop());
    recStreamRef.current = null;
    if (recCtxRef.current) {
      void recCtxRef.current.close();
      recCtxRef.current = null;
    }
    hitDetectedAtRef.current = null;
    setIsRecording(false);
    setMicLevel(0);
  };

  const clearPendingTake = () => {
    setRecordedWavUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setRecordedWavBase64(null);
    setRecordedStats(null);
    setRecordError(null);
  };

  // Ensure mic is always released if dialog closes
  useEffect(() => {
    if (!open) {
      teardownMic();
      clearPendingTake();
    }
  }, [open]);

  const finalizePcmRecording = () => {
    if (isFinalizingRef.current) return;
    isFinalizingRef.current = true;
    try {
      teardownMic();

      const chunks = recSamplesRef.current;
      recSamplesRef.current = [];
      const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
      if (totalLen === 0) {
        setRecordError('No audio frames captured from microphone.');
        return;
      }
      const merged = new Float32Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }

      const strokeForTrim = recordingStrokeRef.current;
      const maxDur =
        strokeForTrim === 'tom'
          ? 0.45
          : strokeForTrim === 'pelang_r' || strokeForTrim === 'pelang_l'
            ? 0.34
            : 0.24;
      const { wavBytes, stats } = trimAndEncodeDrumWav(merged, recSampleRateRef.current, maxDur);
      const wavBlob = new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(wavBlob);
      setRecordedWavUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      setRecordedWavBase64(bytesToBase64(wavBytes));
      setRecordedStats(stats);
      const a = new Audio(url);
      void a.play();
    } catch (err) {
      setRecordError(err instanceof Error ? err.message : String(err));
    } finally {
      isFinalizingRef.current = false;
    }
  };

  const stopMicRecording = () => {
    if (!isRecording) return;
    finalizePcmRecording();
  };

  const startMicRecording = async () => {
    teardownMic();
    clearPendingTake();
    setFeedback(null);
    isFinalizingRef.current = false;
    recordingStrokeRef.current = activeStroke;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setRecordError(
        'Microphone API is unavailable in this browser context (requires localhost or HTTPS). You can use "Upload Audio" instead.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      recStreamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') await ctx.resume();
      recCtxRef.current = ctx;
      recSampleRateRef.current = ctx.sampleRate;
      recSamplesRef.current = [];
      hitDetectedAtRef.current = null;

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      recProcRef.current = processor;

      // Silent monitor sink required by Chrome/Safari to keep ScriptProcessor running
      const mute = ctx.createGain();
      mute.gain.value = 0;

      processor.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        recSamplesRef.current.push(copy);

        let peak = 0;
        for (let i = 0; i < copy.length; i += 1) {
          const a = Math.abs(copy[i]);
          if (a > peak) peak = a;
        }
        setMicLevel(Math.min(1, peak * 3.2));

        // Smart auto-capture: once a real drum hit (> 0.06) is heard, capture 550ms of decay and auto-stop!
        if (hitDetectedAtRef.current === null && peak > 0.06) {
          hitDetectedAtRef.current = performance.now();
        } else if (
          hitDetectedAtRef.current !== null &&
          performance.now() - hitDetectedAtRef.current > 550
        ) {
          hitDetectedAtRef.current = null;
          finalizePcmRecording();
        }
      };

      source.connect(processor);
      processor.connect(mute);
      mute.connect(ctx.destination);
      setIsRecording(true);
    } catch (err) {
      setRecordError(
        err instanceof Error
          ? `Mic error: ${err.message}`
          : 'Microphone permission denied or unavailable.'
      );
      setIsRecording(false);
    }
  };

  const handleUploadAudioFile = async (file: File) => {
    setRecordError(null);
    setFeedback(null);
    try {
      const arrBuf = await file.arrayBuffer();
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      const decoded = await ctx.decodeAudioData(arrBuf);
      const channelData = decoded.getChannelData(0);
      const maxDur =
        activeStroke === 'tom'
          ? 0.45
          : activeStroke === 'pelang_r' || activeStroke === 'pelang_l'
            ? 0.34
            : 0.24;
      const { wavBytes, stats } = trimAndEncodeDrumWav(channelData, decoded.sampleRate, maxDur);
      void ctx.close();

      if (recordedWavUrl) URL.revokeObjectURL(recordedWavUrl);
      const wavBlob = new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(wavBlob);
      setRecordedWavUrl(url);
      setRecordedWavBase64(bytesToBase64(wavBytes));
      setRecordedStats(stats);
      const a = new Audio(url);
      void a.play();
    } catch (err) {
      setRecordError(
        `Could not decode audio file: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleSaveRecording = async () => {
    if (!recordedWavBase64) return;
    setSaving(true);
    setRecordError(null);
    try {
      const res = await fetch('/api/teacher-kit/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stroke: activeStroke, wavBase64: recordedWavBase64 }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to save recording');

      await sharedTonbakSynth.reloadKit('teacher');
      sharedTonbakSynth.triggerStroke(
        activeStroke as Parameters<typeof sharedTonbakSynth.triggerStroke>[0],
        sharedTonbakSynth.getCurrentTime() + 0.02
      );
      setSavedLiveStrokes((prev) => ({ ...prev, [activeStroke]: true }));
      clearPendingTake();
      onSaved([activeStroke]);
      setFeedback(`Saved your live mic recording as ${currentTab.label}! Switch tabs to record the next stroke.`);
    } catch (err) {
      setRecordError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

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
              Click any recording to audition it, select your favorite 1–{currentTab.maxPicks} clean hits for each stroke, then click Save. Riz &amp; Glissando rolls automatically build from your chosen Bak R, Bak L, and Eshareh hits to fill any note duration.
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
            const hasLive = Boolean(savedLiveStrokes[tab.key]);
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeStroke === tab.key}
                className={`sampler-tab ${activeStroke === tab.key ? 'active' : ''}`}
                onClick={() => {
                  teardownMic();
                  clearPendingTake();
                  setActiveStroke(tab.key);
                  setActivePool(tab.defaultPool);
                }}
              >
                <span>{tab.label}</span>
                {hasLive && <span className="sampler-tab-badge">🎙</span>}
                {count > 0 && <span className="sampler-tab-badge">{count}</span>}
              </button>
            );
          })}
        </div>

        {/* Built-in Live Mic Recorder for your own Tonbak */}
        <div className="sampler-mic-bar">
          <div className="sampler-mic-left">
            <button
              type="button"
              className={`btn-primary ${isRecording ? 'recording-pulse' : ''}`}
              onClick={() => (isRecording ? stopMicRecording() : void startMicRecording())}
            >
              {isRecording ? <Square size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
              <span>
                {isRecording
                  ? `Listening… play ${shortStrokeName} (or Stop)`
                  : `Record ${shortStrokeName} on Mic`}
              </span>
            </button>

            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => uploadAudioRef.current?.click()}
            >
              <Upload size={13} aria-hidden="true" />
              <span>Upload Audio</span>
            </button>
            <input
              ref={uploadAudioRef}
              type="file"
              accept="audio/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUploadAudioFile(f);
                e.target.value = '';
              }}
            />

            {isRecording ? (
              <div className="mic-meter" aria-label="Live microphone level">
                <div className="mic-meter-fill" style={{ width: `${Math.round(micLevel * 100)}%` }} />
              </div>
            ) : (
              <span className="sampler-mic-hint">
                Waits for your strike, auto-trims &amp; normalizes
              </span>
            )}
          </div>

          {recordedWavUrl && (
            <div className="sampler-mic-actions">
              {recordedStats && (
                <span className="sampler-stats-pill" title="Peak frequency, spectral centroid, and trimmed length">
                  {recordedStats.peakHz} Hz (cent {recordedStats.centroidHz} Hz) •{' '}
                  {recordedStats.durationMs} ms
                </span>
              )}
              <button
                type="button"
                className="btn-mini"
                onClick={() => {
                  const a = new Audio(recordedWavUrl);
                  void a.play();
                }}
              >
                <Play size={12} aria-hidden="true" /> Replay Take
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={saving}
                onClick={() => void handleSaveRecording()}
              >
                <Check size={14} aria-hidden="true" /> Save as {shortStrokeName}
              </button>
            </div>
          )}
        </div>

        {recordError && (
          <div className="ocr-error" role="alert">
            <span>{recordError}</span>
          </div>
        )}

        {/* Source Pool Switcher (in case you want to browse another pool for this stroke) */}
        <div className="sampler-pool-bar">
          <span>Browsing recordings:</span>
          {(['tom', 'bak_r', 'bak_l', 'cascade', 'riz', 'gliss'] as CandidatePoolKey[]).map((pool) => (
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
              {pool === 'cascade' && '4-Finger Cascades'}
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
                    <span>{isPicked ? 'Picked' : `Use as ${shortStrokeName}`}</span>
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {feedback && <div className="ocr-success">{feedback}</div>}

        {/* Live Audition of Dynamically Generated Riz & Glissando Rolls */}
        <div className="sampler-roll-preview">
          <span className="sampler-roll-label">Test Generated Rolls (Teacher&apos;s Kit):</span>
          <div className="sampler-roll-btns">
            <button
              type="button"
              className="btn-mini"
              onClick={() => {
                void sharedTonbakSynth.setKit('teacher').then(() => {
                  sharedTonbakSynth.triggerStroke('riz', sharedTonbakSynth.getCurrentTime() + 0.02, {
                    durationSec: 0.24,
                  });
                });
              }}
            >
              <Play size={12} aria-hidden="true" /> Riz (Short)
            </button>
            <button
              type="button"
              className="btn-mini"
              onClick={() => {
                void sharedTonbakSynth.setKit('teacher').then(() => {
                  sharedTonbakSynth.triggerStroke('riz', sharedTonbakSynth.getCurrentTime() + 0.02, {
                    durationSec: 0.72,
                  });
                });
              }}
            >
              <Play size={12} aria-hidden="true" /> Riz (Long)
            </button>
            <button
              type="button"
              className="btn-mini"
              onClick={() => {
                void sharedTonbakSynth.setKit('teacher').then(() => {
                  sharedTonbakSynth.triggerStroke('riz', sharedTonbakSynth.getCurrentTime() + 0.02, {
                    durationSec: 0.56,
                    glissando: 'up',
                  });
                });
              }}
            >
              <Play size={12} aria-hidden="true" /> Gliss Up (↗g)
            </button>
            <button
              type="button"
              className="btn-mini"
              onClick={() => {
                void sharedTonbakSynth.setKit('teacher').then(() => {
                  sharedTonbakSynth.triggerStroke('riz', sharedTonbakSynth.getCurrentTime() + 0.02, {
                    durationSec: 0.56,
                    glissando: 'down',
                  });
                });
              }}
            >
              <Play size={12} aria-hidden="true" /> Gliss Down (↘g)
            </button>
            <button
              type="button"
              className="btn-mini"
              onClick={() => {
                void sharedTonbakSynth.setKit('teacher').then(() => {
                  sharedTonbakSynth.triggerStroke('pelang_r', sharedTonbakSynth.getCurrentTime() + 0.02);
                });
              }}
            >
              <Play size={12} aria-hidden="true" /> Cascade R (◠^)
            </button>
            <button
              type="button"
              className="btn-mini"
              onClick={() => {
                void sharedTonbakSynth.setKit('teacher').then(() => {
                  sharedTonbakSynth.triggerStroke('pelang_l', sharedTonbakSynth.getCurrentTime() + 0.02);
                });
              }}
            >
              <Play size={12} aria-hidden="true" /> Cascade L (◠v)
            </button>
            <button
              type="button"
              className="btn-mini"
              onClick={() => {
                void sharedTonbakSynth.setKit('teacher').then(() => {
                  sharedTonbakSynth.triggerNote(
                    {
                      id: 'preview-dorrab-tom',
                      stroke: 'tom',
                      duration: 'quarter',
                      graceNotes: [{ stroke: 'pelang_r' }, { stroke: 'pelang_l' }],
                    },
                    sharedTonbakSynth.getCurrentTime() + 0.1,
                    0.35
                  );
                });
              }}
            >
              <Play size={12} aria-hidden="true" /> Dorrab → Tom
            </button>
            <button
              type="button"
              className="btn-mini"
              onClick={() => {
                void sharedTonbakSynth.setKit('teacher').then(() => {
                  sharedTonbakSynth.triggerNote(
                    {
                      id: 'preview-dorrab-bak',
                      stroke: 'bak_r',
                      duration: 'quarter',
                      graceNotes: [{ stroke: 'pelang_r' }, { stroke: 'pelang_l' }],
                    },
                    sharedTonbakSynth.getCurrentTime() + 0.1,
                    0.35
                  );
                });
              }}
            >
              <Play size={12} aria-hidden="true" /> Dorrab → Bak R
            </button>
          </div>
        </div>

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
