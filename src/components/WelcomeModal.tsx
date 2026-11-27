import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Volume2,
  Camera,
  Sliders,
  Share2,
  Sparkles,
  Check,
} from 'lucide-react';
import { sharedTonbakSynth } from '../lib/tonbakSynth';

interface WelcomeModalProps {
  open: boolean;
  onClose: () => void;
  onTryScan?: () => void;
}

const TOTAL_SLIDES = 4;

export const WelcomeModal: React.FC<WelcomeModalProps> = ({ open, onClose, onTryScan }) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [slide, setSlide] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setSlide(0);
      dialog.showModal();
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

  const playDemoGroove = async () => {
    setPreviewPlaying(true);
    await sharedTonbakSynth.preloadSamples();
    const t0 = sharedTonbakSynth.getCurrentTime() + 0.04;
    const step = 0.19; // brisk 6/8 Persian groove
    sharedTonbakSynth.triggerStroke('tom', t0, { velocity: 1.0 });
    sharedTonbakSynth.triggerStroke('pelang', t0 + step, { finger: '2', velocity: 0.9 });
    sharedTonbakSynth.triggerStroke('bak_r', t0 + step * 2, { velocity: 0.95 });
    sharedTonbakSynth.triggerStroke('tom', t0 + step * 3, { velocity: 1.0 });
    sharedTonbakSynth.triggerStroke('riz', t0 + step * 4, { durationSec: step * 2, rizStyle: 'full' });
    window.setTimeout(() => setPreviewPlaying(false), 1250);
  };

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      aria-labelledby="welcome-dialog-title"
      className="ocr-dialog welcome-dialog"
    >
      <div className="welcome-inner">
        <button
          type="button"
          className="icon-close-btn welcome-close"
          aria-label="Skip intro"
          onClick={() => dialogRef.current?.close()}
        >
          <X size={18} aria-hidden="true" />
        </button>

        {/* Animated Visual Stage */}
        <div className="welcome-stage" aria-hidden="true">
          {slide === 0 && (
            <div className="welcome-anim-score">
              <svg viewBox="0 0 360 116" className="welcome-svg">
                <rect x="0" y="0" width="360" height="116" rx="10" fill="#fbf7ef" stroke="#e4d8c5" />
                <line x1="22" y1="84" x2="338" y2="84" stroke="#2b231b" strokeWidth="1.6" />
                <line x1="28" y1="74" x2="28" y2="94" stroke="#241e18" strokeWidth="2.4" />
                <line x1="33" y1="74" x2="33" y2="94" stroke="#241e18" strokeWidth="2.4" />
                <text x="48" y="80" fontSize="15" fontWeight="700" fontFamily="Georgia, serif" fill="#241e18">6</text>
                <text x="48" y="96" fontSize="15" fontWeight="700" fontFamily="Georgia, serif" fill="#241e18">8</text>

                {/* Animated glowing playhead */}
                <rect className="anim-playhead" x="76" y="16" width="36" height="84" rx="6" fill="rgba(217, 107, 39, 0.18)" />

                {/* 6/8 Beam */}
                <line x1="96" y1="48" x2="188" y2="48" stroke="#241e18" strokeWidth="4" />
                <line x1="234" y1="48" x2="296" y2="48" stroke="#241e18" strokeWidth="4" />

                {/* Notes: Tom, Pelang, Bak R | Tom, Riz */}
                {[
                  { x: 92, label: '؟', color: '#9c3b1e', delay: '0s' },
                  { x: 138, label: 'v̇²', color: '#1b7a5a', delay: '0.45s' },
                  { x: 184, label: '^', color: '#1e4d6b', delay: '0.9s' },
                  { x: 230, label: '؟', color: '#9c3b1e', delay: '1.35s' },
                  { x: 292, label: '◠^v', color: '#b0413e', delay: '1.8s', riz: true },
                ].map((n, idx) => (
                  <g key={idx} className="anim-note-pulse" style={{ animationDelay: n.delay }}>
                    <ellipse cx={n.x} cy={84} rx={5.2} ry={3.8} transform={`rotate(-18 ${n.x} 84)`} fill="#241e18" />
                    <line x1={n.x + 4.4} y1={83} x2={n.x + 4.4} y2={48} stroke="#241e18" strokeWidth="1.6" />
                    {n.riz && (
                      <g stroke="#b0413e" strokeWidth="1.8" strokeLinecap="round">
                        <line x1={n.x} y1={72} x2={n.x + 9} y2={67} />
                        <line x1={n.x} y1={66} x2={n.x + 9} y2={61} />
                        <line x1={n.x} y1={60} x2={n.x + 9} y2={55} />
                      </g>
                    )}
                    <text x={n.x} y={36} textAnchor="middle" fontSize="14" fontWeight="700" fill={n.color}>
                      {n.label}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          )}

          {slide === 1 && (
            <div className="welcome-anim-scan">
              <div className="scan-card">
                <div className="scan-header-bar" />
                <div className="scan-staff-row"><span /><span /><span /><span /></div>
                <div className="scan-staff-row"><span /><span /><span /></div>
                <div className="scan-staff-row"><span /><span /><span /><span /></div>
                <div className="scan-beam" />
              </div>
              <div className="scan-arrow">→</div>
              <div className="scan-result-card">
                <div className="scan-badge"><Sparkles size={12} /> Interactive Score</div>
                <div className="scan-mini-notes">
                  <span style={{ color: '#9c3b1e' }}>؟</span>
                  <span style={{ color: '#1b7a5a' }}>v̇²</span>
                  <span style={{ color: '#1e4d6b' }}>^</span>
                  <span style={{ color: '#b0413e' }}>◠^v</span>
                </div>
                <div className="scan-mini-staff" />
              </div>
            </div>
          )}

          {slide === 2 && (
            <div className="welcome-anim-compose">
              <div className="compose-pills">
                <span className="compose-pill p1">؟ Tom</span>
                <span className="compose-pill p2">^ Bak R</span>
                <span className="compose-pill p3">v̇ Pelang</span>
                <span className="compose-pill p4">◠^v Riz</span>
              </div>
              <div className="compose-staff-preview">
                <div className="compose-line" />
                <div className="compose-dots">
                  <span className="c-dot d1" />
                  <span className="c-dot d2" />
                  <span className="c-dot d3" />
                  <span className="c-dot d4" />
                </div>
              </div>
              <div className="compose-hint-row">
                <span className="compose-chip">+ Note</span>
                <span className="compose-chip">+ Bar</span>
                <span className="compose-chip">Copy &amp; Paste</span>
              </div>
            </div>
          )}

          {slide === 3 && (
            <div className="welcome-anim-features">
              <div className="w-feat-card f1">
                <Volume2 size={18} />
                <strong>Real Tonbak Kits</strong>
                <span>Tempo slider, loop &amp; click</span>
              </div>
              <div className="w-feat-card f2">
                <Sliders size={18} />
                <strong>Play from Any Note</strong>
                <span>Tap a note, hit Play</span>
              </div>
              <div className="w-feat-card f3">
                <Share2 size={18} />
                <strong>Share &amp; Print</strong>
                <span>Public links &amp; crisp PDF</span>
              </div>
              <div className="w-feat-card f4">
                <Camera size={18} />
                <strong>Photo &amp; PDF OCR</strong>
                <span>Import entire books</span>
              </div>
            </div>
          )}
        </div>

        {/* Slide Copy */}
        <div className="welcome-copy">
          {slide === 0 && (
            <>
              <span className="welcome-kicker">ضرب‌ساز • Persian Tonbak Studio</span>
              <h2 id="welcome-dialog-title">Read, hear, and practice Tonbak notation</h2>
              <p>
                ZarbSaz brings Bahman Rajabi&apos;s single-line percussion notation to life with real
                recorded Persian tonbak audio — including Tom, Bak, Pelang, 4-finger cascades, Riz,
                and directional Glissandos.
              </p>
              <button
                type="button"
                className="btn-secondary welcome-demo-btn"
                onClick={() => void playDemoGroove()}
              >
                <Volume2 size={15} aria-hidden="true" />
                <span>{previewPlaying ? 'Playing 6/8 groove…' : 'Hear a 6/8 Tonbak Groove'}</span>
              </button>
            </>
          )}

          {slide === 1 && (
            <>
              <span className="welcome-kicker">AI Vision + Offline OMR</span>
              <h2 id="welcome-dialog-title">Snap a photo or drop in a PDF</h2>
              <p>
                Take a photo of any book page on your phone or upload a multi-page PDF. ZarbSaz
                transcribes the rhythms and strokes into an editable, playable score in seconds.
              </p>
            </>
          )}

          {slide === 2 && (
            <>
              <span className="welcome-kicker">Compose &amp; Customize</span>
              <h2 id="welcome-dialog-title">Tap any note to hear, edit, or play from there</h2>
              <p>
                Click any note to audition it or start playback right from that spot. Use the
                toolbar to insert strokes, change durations, copy measures across pages, or write
                your own pieces from scratch.
              </p>
            </>
          )}

          {slide === 3 && (
            <>
              <span className="welcome-kicker">Built for Daily Practice</span>
              <h2 id="welcome-dialog-title">Loop tricky bars, slow down tempo, and share</h2>
              <p>
                Slow down hard passages with the tempo slider, turn on the metronome or switch sound
                kits in <strong>Settings (⚙)</strong>, print clean black-on-white sheets, or sign in
                to sync and share your books.
              </p>
            </>
          )}
        </div>

        {/* Progress Dots & Navigation */}
        <div className="welcome-footer">
          <div className="welcome-dots" role="tablist" aria-label="Intro slides">
            {Array.from({ length: TOTAL_SLIDES }).map((_, idx) => (
              <button
                key={idx}
                type="button"
                role="tab"
                aria-selected={slide === idx}
                aria-label={`Slide ${idx + 1} of ${TOTAL_SLIDES}`}
                className={`welcome-dot ${slide === idx ? 'active' : ''}`}
                onClick={() => setSlide(idx)}
              />
            ))}
          </div>

          <div className="welcome-nav-btns">
            {slide > 0 ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setSlide((s) => Math.max(0, s - 1))}
              >
                <ChevronLeft size={15} aria-hidden="true" />
                <span>Back</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => dialogRef.current?.close()}
              >
                Skip
              </button>
            )}

            {slide < TOTAL_SLIDES - 1 ? (
              <button
                type="button"
                className="btn-primary"
                onClick={() => setSlide((s) => Math.min(TOTAL_SLIDES - 1, s + 1))}
              >
                <span>Next</span>
                <ChevronRight size={15} aria-hidden="true" />
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                {onTryScan && (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => {
                      dialogRef.current?.close();
                      onTryScan();
                    }}
                  >
                    <Camera size={14} aria-hidden="true" />
                    <span>Scan Page</span>
                  </button>
                )}
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => dialogRef.current?.close()}
                >
                  <Check size={15} aria-hidden="true" />
                  <span>Start Playing</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </dialog>
  );
};
