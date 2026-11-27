import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, Play, Check, Upload } from 'lucide-react';
import { encodePcm16Wav } from '../lib/wavEncoder';

export const SessionRecorderBar: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [wavBlob, setWavBlob] = useState<Blob | null>(null);
  const [wavUrl, setWavUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const srRef = useRef<number>(44100);
  const startAtRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);

  const cleanupMic = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (procRef.current) {
      procRef.current.onaudioprocess = null;
      procRef.current.disconnect();
      procRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (ctxRef.current) {
      void ctxRef.current.close();
      ctxRef.current = null;
    }
    setIsRecording(false);
    setMicLevel(0);
  };

  useEffect(() => {
    return () => {
      cleanupMic();
    };
  }, []);

  const startRecording = async () => {
    cleanupMic();
    setError(null);
    setStatus(null);
    if (wavUrl) {
      URL.revokeObjectURL(wavUrl);
      setWavUrl(null);
    }
    setWavBlob(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone API unavailable — you can record on your phone/QuickTime and click Upload Audio.');
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
      streamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') await ctx.resume();
      ctxRef.current = ctx;
      srRef.current = ctx.sampleRate;
      chunksRef.current = [];
      startAtRef.current = performance.now();
      setElapsedSec(0);

      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      procRef.current = proc;

      const mute = ctx.createGain();
      mute.gain.value = 0;

      proc.onaudioprocess = (ev) => {
        const input = ev.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        chunksRef.current.push(copy);

        let peak = 0;
        for (let i = 0; i < copy.length; i += 1) {
          const a = Math.abs(copy[i]);
          if (a > peak) peak = a;
        }
        setMicLevel(Math.min(1, peak * 3.2));
      };

      src.connect(proc);
      proc.connect(mute);
      mute.connect(ctx.destination);

      setIsRecording(true);
      timerRef.current = window.setInterval(() => {
        setElapsedSec(Math.floor((performance.now() - startAtRef.current) / 1000));
      }, 250);
    } catch (err) {
      setError(err instanceof Error ? `Mic error: ${err.message}` : 'Could not access microphone.');
    }
  };

  const stopRecording = () => {
    if (!isRecording) return;
    cleanupMic();

    const chunks = chunksRef.current;
    chunksRef.current = [];
    const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
    if (totalLen === 0) {
      setError('No audio captured from microphone.');
      return;
    }

    const merged = new Float32Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }

    const wavBytes = encodePcm16Wav(merged, srRef.current);
    const blob = new Blob([wavBytes.buffer as ArrayBuffer], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    setWavBlob(blob);
    setWavUrl(url);
    setStatus(
      `Captured ${(totalLen / srRef.current).toFixed(1)}s recording. Replay to check, then click Save Recording.`
    );
  };

  const saveBlobToServer = async (blob: Blob, filename?: string) => {
    setSaving(true);
    setError(null);
    try {
      const qs = filename ? `?filename=${encodeURIComponent(filename)}` : '';
      const res = await fetch(`/api/kit-recording${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: blob,
      });
      const data = (await res.json()) as { ok?: boolean; path?: string; bytes?: number; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || 'Failed to save recording');
      const kb = Math.round((data.bytes || 0) / 1024);
      setStatus(
        `Saved to ${data.path} (${kb.toLocaleString()} KB)! Tell me "Done" in chat and I'll slice every stroke into your custom Tonbak kit.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const formatSec = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="sampler-mic-bar" style={{ margin: '0 0 12px 0' }}>
      <div className="sampler-mic-left">
        <button
          type="button"
          className={`btn-primary ${isRecording ? 'recording-pulse' : ''}`}
          onClick={() => (isRecording ? stopRecording() : void startRecording())}
        >
          {isRecording ? <Square size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}
          <span>{isRecording ? `Stop Recording (${formatSec(elapsedSec)})` : 'Record Full Sheet on Mic'}</span>
        </button>

        <button
          type="button"
          className="btn-secondary btn-sm"
          disabled={isRecording || saving}
          onClick={() => uploadRef.current?.click()}
        >
          <Upload size={13} aria-hidden="true" />
          <span>Upload Audio</span>
        </button>
        <input
          ref={uploadRef}
          type="file"
          accept="audio/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void saveBlobToServer(f, f.name);
            e.target.value = '';
          }}
        />

        {isRecording ? (
          <div className="mic-meter" aria-label="Live microphone level">
            <div className="mic-meter-fill" style={{ width: `${Math.round(micLevel * 100)}%` }} />
          </div>
        ) : (
          <span className="sampler-mic-hint">
            Play Bars 1→12 slowly (~1–2s silence after each hit, no metronome)
          </span>
        )}
      </div>

      {wavUrl && wavBlob && (
        <div className="sampler-mic-actions">
          <button
            type="button"
            className="btn-mini"
            onClick={() => {
              const a = new Audio(wavUrl);
              void a.play();
            }}
          >
            <Play size={12} aria-hidden="true" /> Replay
          </button>
          <button
            type="button"
            className="btn-primary"
            disabled={saving}
            onClick={() => void saveBlobToServer(wavBlob, 'user_tonbak_session.wav')}
          >
            <Check size={14} aria-hidden="true" /> {saving ? 'Saving…' : 'Save Recording'}
          </button>
        </div>
      )}

      {status && (
        <div className="ocr-success" style={{ width: '100%', marginTop: 6 }}>
          {status}
        </div>
      )}
      {error && (
        <div className="ocr-error" role="alert" style={{ width: '100%', marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  );
};
