import React, { useEffect, useRef } from 'react';
import { Settings, X, Sliders, Timer, Volume2, Printer } from 'lucide-react';
import { sharedTonbakSynth, TONBAK_KITS, type TonbakKitId } from '../lib/tonbakSynth';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  soundKit: TonbakKitId;
  onChangeKit: (kit: TonbakKitId) => void;
  metronomeOn: boolean;
  onToggleMetronome: () => void;
  volume: number;
  onChangeVolume: (vol: number) => void;
  onOpenSamplePicker: () => void;
  onPrint: () => void;
  /** Optional current piece layout controls (handy on mobile where piece meta controls are tucked away) */
  pieceReadOnly?: boolean;
  meterValue?: string;
  onChangeMeter?: (meter: string) => void;
  barsPerLineValue?: string;
  hasCustomBookLayout?: boolean;
  onChangeBarsPerLine?: (val: string) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  soundKit,
  onChangeKit,
  metronomeOn,
  onToggleMetronome,
  volume,
  onChangeVolume,
  onOpenSamplePicker,
  onPrint,
  pieceReadOnly,
  meterValue,
  onChangeMeter,
  barsPerLineValue,
  hasCustomBookLayout,
  onChangeBarsPerLine,
}) => {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
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

  const activeKitInfo = TONBAK_KITS.find((k) => k.id === soundKit);

  return (
    <dialog
      ref={dialogRef}
      {...({ closedby: 'any' } as Record<string, string>)}
      aria-labelledby="settings-dialog-title"
      className="ocr-dialog settings-dialog"
    >
      <div className="ocr-dialog-inner">
        <header className="ocr-dialog-header">
          <div>
            <h2 id="settings-dialog-title">
              <Settings size={17} aria-hidden="true" style={{ verticalAlign: '-3px', marginRight: 6 }} />
              Audio &amp; Score Settings
            </h2>
            <p className="ocr-dialog-sub">Choose your tonbak sound kit, samples, click track, and print options.</p>
          </div>
          <button
            type="button"
            className="icon-close-btn"
            aria-label="Close settings"
            onClick={() => dialogRef.current?.close()}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="settings-section">
          <label htmlFor="settings-kit-select" className="settings-label">
            Tonbak Sound Kit
          </label>
          <select
            id="settings-kit-select"
            className="settings-select"
            value={soundKit}
            onChange={(e) => {
              const next = e.target.value as TonbakKitId;
              onChangeKit(next);
              void sharedTonbakSynth.setKit(next).then(() => {
                const now = sharedTonbakSynth.getCurrentTime() + 0.02;
                sharedTonbakSynth.triggerStroke('tom', now);
                sharedTonbakSynth.triggerStroke('bak_r', now + 0.16);
                sharedTonbakSynth.triggerStroke('pelang', now + 0.3, { finger: '2' });
              });
            }}
          >
            {TONBAK_KITS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          {activeKitInfo && <p className="settings-help">{activeKitInfo.description}</p>}

          <button
            type="button"
            className="btn-secondary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
            onClick={() => {
              dialogRef.current?.close();
              onOpenSamplePicker();
            }}
          >
            <Sliders size={15} aria-hidden="true" />
            <span>Pick or Record Individual Samples</span>
          </button>
        </div>

        <div className="settings-section">
          <div className="settings-row">
            <span className="settings-label" style={{ margin: 0 }}>
              <Timer size={15} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Metronome Click
            </span>
            <button
              type="button"
              className="btn-toggle"
              aria-pressed={metronomeOn}
              onClick={onToggleMetronome}
            >
              {metronomeOn ? 'On' : 'Off'}
            </button>
          </div>

          <div className="settings-row" style={{ marginTop: 12 }}>
            <label htmlFor="settings-volume-slider" className="settings-label" style={{ margin: 0 }}>
              <Volume2 size={15} aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Volume ({Math.round(volume * 100)}%)
            </label>
            <input
              id="settings-volume-slider"
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              style={{ width: 150 }}
              onChange={(e) => onChangeVolume(Number(e.target.value) / 100)}
            />
          </div>
        </div>

        {meterValue && onChangeMeter && barsPerLineValue && onChangeBarsPerLine && (
          <div className="settings-section">
            <div className="settings-row">
              <label htmlFor="settings-meter-select" className="settings-label" style={{ margin: 0 }}>
                Time Signature (Meter)
              </label>
              <select
                id="settings-meter-select"
                className="settings-select"
                style={{ width: 120 }}
                disabled={pieceReadOnly}
                value={meterValue}
                onChange={(e) => onChangeMeter(e.target.value)}
              >
                <option value="6/8">6/8</option>
                <option value="2/4">2/4</option>
                <option value="3/4">3/4</option>
                <option value="4/4">4/4</option>
                <option value="5/8">5/8</option>
                <option value="7/8">7/8</option>
                <option value="9/8">9/8</option>
                <option value="6/4">6/4</option>
              </select>
            </div>

            <div className="settings-row" style={{ marginTop: 10 }}>
              <label htmlFor="settings-bars-select" className="settings-label" style={{ margin: 0 }}>
                Bars per Line
              </label>
              <select
                id="settings-bars-select"
                className="settings-select"
                style={{ width: 120 }}
                disabled={pieceReadOnly}
                value={barsPerLineValue}
                onChange={(e) => onChangeBarsPerLine(e.target.value)}
              >
                <option value="auto">Auto</option>
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="6">6</option>
                {hasCustomBookLayout && <option value="custom">Book layout</option>}
              </select>
            </div>
          </div>
        )}

        <div className="settings-section">
          <button
            type="button"
            className="btn-secondary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => {
              dialogRef.current?.close();
              onPrint();
            }}
          >
            <Printer size={15} aria-hidden="true" />
            <span>Print Score (White Background)</span>
          </button>
        </div>
      </div>
    </dialog>
  );
};
