export interface DrumHitStats {
  /** Length of the trimmed recording in milliseconds */
  durationMs: number;
  /** Peak dominant frequency (Hz) in the 50–4000 Hz range */
  peakHz: number;
  /** Energy-weighted spectral centroid (Hz) */
  centroidHz: number;
}

/**
 * Analyze a trimmed mono drum hit to report its length (ms), peak frequency (Hz),
 * and spectral centroid (Hz) — matching the metadata shown on candidate clips.
 */
export function analyzeDrumHit(samples: Float32Array, sampleRate: number): DrumHitStats {
  const durationMs = Math.round((samples.length / sampleRate) * 1000);
  // Analyze first ~64ms (next power-of-2 up to 2048 samples, downsampled 2x for fast DFT)
  const stride = sampleRate >= 40000 ? 2 : 1;
  const effRate = sampleRate / stride;
  const maxN = Math.min(1024, Math.floor(samples.length / stride));
  if (maxN < 32) {
    return { durationMs, peakHz: 0, centroidHz: 0 };
  }

  // Apply Hann window
  const windowed = new Float64Array(maxN);
  for (let i = 0; i < maxN; i += 1) {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (maxN - 1)));
    windowed[i] = samples[i * stride] * w;
  }

  // Evaluate DFT bins from 50 Hz up to 4000 Hz
  const minK = Math.max(1, Math.floor((50 * maxN) / effRate));
  const maxK = Math.min(Math.floor(maxN / 2), Math.ceil((4000 * maxN) / effRate));

  let bestEnergy = -1;
  let peakHz = 0;
  let weightedSum = 0;
  let totalEnergy = 0;

  for (let k = minK; k <= maxK; k += 1) {
    let re = 0;
    let im = 0;
    const step = (2 * Math.PI * k) / maxN;
    for (let n = 0; n < maxN; n += 1) {
      const ang = step * n;
      re += windowed[n] * Math.cos(ang);
      im -= windowed[n] * Math.sin(ang);
    }
    const energy = re * re + im * im;
    const freq = (k * effRate) / maxN;
    if (energy > bestEnergy) {
      bestEnergy = energy;
      peakHz = freq;
    }
    weightedSum += freq * energy;
    totalEnergy += energy;
  }

  return {
    durationMs,
    peakHz: Math.round(peakHz),
    centroidHz: totalEnergy > 0 ? Math.round(weightedSum / totalEnergy) : 0,
  };
}

/**
 * Trim leading silence right to the exact acoustic onset of a drum hit,
 * apply a smooth tail fade, normalize cleanly, and encode as 16-bit PCM WAV.
 */
export function trimAndEncodeDrumWav(
  samples: Float32Array,
  sampleRate: number,
  maxDurationSec = 0.42
): { wavBytes: Uint8Array; trimmedSamples: Float32Array; stats: DrumHitStats } {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
  }

  if (peak < 0.005) {
    throw new Error('Recording was too quiet — try hitting the tonbak closer to the mic.');
  }

  // Find exact strike onset: first sample exceeding 5% of peak, with 1.5ms pre-attack cushion
  const threshold = peak * 0.05;
  let onset = 0;
  for (let i = 0; i < samples.length; i += 1) {
    if (Math.abs(samples[i]) >= threshold) {
      onset = Math.max(0, i - Math.round(sampleRate * 0.0015));
      break;
    }
  }

  const maxLen = Math.round(sampleRate * maxDurationSec);
  const end = Math.min(samples.length, onset + maxLen);
  const trimmed = new Float32Array(end - onset);
  for (let i = 0; i < trimmed.length; i += 1) {
    trimmed[i] = samples[onset + i];
  }

  // Tiny 1ms fade-in and smooth tail fade-out over last 22%
  const fadeIn = Math.min(trimmed.length, Math.round(sampleRate * 0.001));
  for (let i = 0; i < fadeIn; i += 1) {
    trimmed[i] *= i / fadeIn;
  }
  const fadeOut = Math.min(trimmed.length, Math.max(Math.round(sampleRate * 0.03), Math.round(trimmed.length * 0.22)));
  for (let i = 0; i < fadeOut; i += 1) {
    const t = 1 - i / fadeOut;
    trimmed[trimmed.length - fadeOut + i] *= Math.pow(t, 1.7);
  }

  // Normalize to -1.2 dBFS (0.87)
  let newPeak = 0;
  for (let i = 0; i < trimmed.length; i += 1) {
    const a = Math.abs(trimmed[i]);
    if (a > newPeak) newPeak = a;
  }
  const scale = newPeak > 0 ? 0.87 / newPeak : 1;
  for (let i = 0; i < trimmed.length; i += 1) {
    trimmed[i] = Math.max(-1, Math.min(1, trimmed[i] * scale));
  }

  const stats = analyzeDrumHit(trimmed, sampleRate);
  return { wavBytes: encodePcm16Wav(trimmed, sampleRate), trimmedSamples: trimmed, stats };
}

export function encodePcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const numBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + numBytes);
  const view = new DataView(buffer);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) {
      view.setUint8(offset + i, s.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, numBytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
