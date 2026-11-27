import {
  createId,
  type Duration,
  type Measure,
  type StrokeType,
  type TonbakNote,
  type TonbakPage,
} from '../types/notation';

export interface LocalOmrResult {
  page: TonbakPage;
  overlayDataUrl: string;
  stats: {
    stavesDetected: number;
    measuresDetected: number;
    notesDetected: number;
  };
}

/**
 * Pure client-side Computer Vision OMR for single-line Persian tonbak sheet music.
 * Runs 100% locally in the browser with no external API or network calls.
 */
export async function runLocalTonbakOmr(
  imageDataUrl: string,
  title = 'Scanned Tonbak Page'
): Promise<LocalOmrResult> {
  const img = await loadImage(imageDataUrl);
  const maxWidth = 1100;
  const scale = img.width > maxWidth ? maxWidth / img.width : 1;
  const w = Math.max(200, Math.round(img.width * scale));
  const h = Math.max(200, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(img, 0, 0, w, h);

  const imgData = ctx.getImageData(0, 0, w, h);
  const gray = toGrayscale(imgData.data, w, h);
  const bin = adaptiveThreshold(gray, w, h);

  // 1. Detect horizontal single-line percussion staves via row projection
  const staffYs = detectStaffLines(bin, w, h);
  const staffSpacing =
    staffYs.length >= 2
      ? median(staffYs.slice(1).map((y, i) => y - staffYs[i]))
      : Math.round(h / 9);

  // Draw diagnostic overlay on a copy of the image
  const overlayCanvas = document.createElement('canvas');
  overlayCanvas.width = w;
  overlayCanvas.height = h;
  const octx = overlayCanvas.getContext('2d')!;
  octx.drawImage(canvas, 0, 0);

  const measures: Measure[] = [];
  const barsPerLine: number[] = [];
  let totalNotes = 0;

  for (let sIdx = 0; sIdx < staffYs.length; sIdx += 1) {
    const startMeasureCount = measures.length;
    const sy = staffYs[sIdx];
    const bandTop = Math.max(0, Math.round(sy - staffSpacing * 0.72));
    const bandBottom = Math.min(h - 1, Math.round(sy + staffSpacing * 0.22));

    // Draw detected staff line in blue
    octx.strokeStyle = 'rgba(30, 110, 210, 0.55)';
    octx.lineWidth = 2;
    octx.beginPath();
    octx.moveTo(0, sy);
    octx.lineTo(w, sy);
    octx.stroke();

    // Find horizontal span of this staff line
    const { leftX, rightX } = findStaffHorizontalSpan(bin, w, sy);
    if (rightX - leftX < w * 0.25) continue;

    // Skip percussion clef (and time signature on first staff)
    const contentLeft = leftX + Math.round((sIdx === 0 ? 0.075 : 0.035) * (rightX - leftX));
    const contentRight = rightX - 6;

    // 2. Detect vertical barlines within this staff
    const barlines = detectBarlines(bin, w, sy, staffSpacing, contentLeft, contentRight);
    const boundaries = [contentLeft, ...barlines, contentRight];

    for (const bx of barlines) {
      octx.strokeStyle = 'rgba(22, 163, 74, 0.75)';
      octx.lineWidth = 2;
      octx.beginPath();
      octx.moveTo(bx, bandTop + 10);
      octx.lineTo(bx, bandBottom);
      octx.stroke();
    }

    // 3. Extract notes inside each measure segment
    for (let b = 0; b < boundaries.length - 1; b += 1) {
      const mx1 = boundaries[b] + 4;
      const mx2 = boundaries[b + 1] - 4;
      if (mx2 - mx1 < 28) continue;

      const noteXs = detectNoteheads(bin, w, h, sy, mx1, mx2, staffSpacing);

      // Check for % repeat measure (very few/no noteheads on staff line, but ink in center)
      if (noteXs.length === 0) {
        const inkRatio = measureInkDensity(bin, w, mx1, mx2, sy - Math.round(staffSpacing * 0.25), sy);
        if (inkRatio > 0.015 && measures.length > 0) {
          measures.push({ id: createId('m'), isRepeatPrevious: true, notes: [] });
        }
        continue;
      }

      const notes: TonbakNote[] = noteXs.map((nx, idx) => {
        const prevX = idx > 0 ? noteXs[idx - 1] : mx1;
        const nextX = idx < noteXs.length - 1 ? noteXs[idx + 1] : mx2;
        const duration = estimateDuration(bin, w, h, sy, nx, prevX, nextX, staffSpacing);
        const stroke = classifyStrokeSymbol(bin, w, h, sy, nx, staffSpacing);

        // Draw notehead highlight on overlay
        octx.strokeStyle = 'rgba(217, 119, 6, 0.9)';
        octx.lineWidth = 2;
        octx.strokeRect(nx - 6, sy - 6, 12, 12);

        return {
          id: createId('n'),
          stroke,
          duration,
          finger: stroke === 'bak_l' ? '2' : undefined,
          tremolo: stroke === 'riz',
        };
      });

      totalNotes += notes.length;
      measures.push({
        id: createId('m'),
        notes,
      });
    }

    const barsInThisLine = measures.length - startMeasureCount;
    if (barsInThisLine > 0) {
      barsPerLine.push(barsInThisLine);
    }
  }

  if (measures.length === 0) {
    measures.push({
      id: createId('m'),
      notes: [
        { id: createId('n'), stroke: 'tom', duration: 'eighth' },
        { id: createId('n'), stroke: 'bak_l', duration: 'eighth', finger: '2' },
        { id: createId('n'), stroke: 'bak_r', duration: 'eighth' },
        { id: createId('n'), stroke: 'tom', duration: 'eighth' },
        { id: createId('n'), stroke: 'bak_l', duration: 'quarter', finger: '2' },
      ],
    });
  }

  const now = Date.now();
  const page: TonbakPage = {
    id: createId('page'),
    title,
    subtitle: `Local OMR (${staffYs.length} staves, ${measures.length} measures detected)`,
    timeSignature: { numerator: 6, denominator: 8 },
    tempo: 96,
    tempoBeat: 'dotted-quarter',
    measures,
    barsPerLine: barsPerLine.length > 0 ? barsPerLine : undefined,
    sourceImage: imageDataUrl,
    createdAt: now,
    updatedAt: now,
  };

  return {
    page,
    overlayDataUrl: overlayCanvas.toDataURL('image/jpeg', 0.85),
    stats: {
      stavesDetected: staffYs.length,
      measuresDetected: measures.length,
      notesDetected: totalNotes,
    },
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for OMR'));
    img.src = src;
  });
}

function toGrayscale(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const gray = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    gray[i] = Math.round(0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
  }
  return gray;
}

/** Fast integral-image adaptive threshold to handle photographed page lighting gradients. */
function adaptiveThreshold(gray: Uint8Array, w: number, h: number): Uint8Array {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 1; y <= h; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= w; x += 1) {
      rowSum += gray[(y - 1) * w + (x - 1)];
      integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + rowSum;
    }
  }

  const bin = new Uint8Array(w * h);
  const radius = Math.max(12, Math.round(w * 0.025));
  const offset = 22;

  for (let y = 0; y < h; y += 1) {
    const y1 = Math.max(0, y - radius);
    const y2 = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x += 1) {
      const x1 = Math.max(0, x - radius);
      const x2 = Math.min(w - 1, x + radius);
      const count = (x2 - x1 + 1) * (y2 - y1 + 1);
      const sum =
        integral[(y2 + 1) * (w + 1) + (x2 + 1)] -
        integral[y1 * (w + 1) + (x2 + 1)] -
        integral[(y2 + 1) * (w + 1) + x1] +
        integral[y1 * (w + 1) + x1];
      const localMean = sum / count;
      bin[y * w + x] = gray[y * w + x] < localMean - offset ? 1 : 0;
    }
  }
  return bin;
}

function detectStaffLines(bin: Uint8Array, w: number, h: number): number[] {
  const rowCounts = new Float32Array(h);
  const xStart = Math.round(w * 0.06);
  const xEnd = Math.round(w * 0.94);
  const span = Math.max(1, xEnd - xStart);

  for (let y = Math.round(h * 0.08); y < Math.round(h * 0.94); y += 1) {
    let dark = 0;
    for (let x = xStart; x < xEnd; x += 1) {
      if (bin[y * w + x]) dark += 1;
    }
    rowCounts[y] = dark / span;
  }

  const candidates: number[] = [];
  const minGap = Math.max(36, Math.round(h * 0.055));

  for (let y = Math.round(h * 0.09); y < Math.round(h * 0.93); y += 1) {
    // A single-line percussion staff has high horizontal density (> 40% dark across page width)
    const density = Math.max(rowCounts[y - 1], rowCounts[y], rowCounts[y + 1]);
    if (rowCounts[y] > 0.36 && rowCounts[y] >= density - 0.01) {
      if (candidates.length === 0 || y - candidates[candidates.length - 1] > minGap) {
        candidates.push(y);
      } else if (rowCounts[y] > rowCounts[candidates[candidates.length - 1]]) {
        candidates[candidates.length - 1] = y;
      }
    }
  }

  return candidates;
}

function findStaffHorizontalSpan(bin: Uint8Array, w: number, sy: number) {
  let leftX = Math.round(w * 0.05);
  let rightX = Math.round(w * 0.95);
  for (let x = 0; x < w; x += 1) {
    if (bin[sy * w + x] || bin[(sy - 1) * w + x] || bin[(sy + 1) * w + x]) {
      leftX = x;
      break;
    }
  }
  for (let x = w - 1; x >= 0; x -= 1) {
    if (bin[sy * w + x] || bin[(sy - 1) * w + x] || bin[(sy + 1) * w + x]) {
      rightX = x;
      break;
    }
  }
  return { leftX, rightX };
}

function detectBarlines(
  bin: Uint8Array,
  w: number,
  sy: number,
  staffSpacing: number,
  leftX: number,
  rightX: number
): number[] {
  const barHeight = Math.max(14, Math.round(staffSpacing * 0.22));
  const yTop = Math.max(0, sy - barHeight);
  const barlines: number[] = [];
  const minMeasureWidth = Math.max(55, Math.round((rightX - leftX) * 0.14));

  for (let x = leftX + minMeasureWidth; x < rightX - 35; x += 1) {
    let dark = 0;
    for (let y = yTop; y <= sy; y += 1) {
      if (bin[y * w + x]) dark += 1;
    }
    const ratio = dark / (barHeight + 1);
    if (ratio > 0.78) {
      // Barlines have no notehead blob right at (x-4..x+4, sy) and no beam directly attached above
      let blobLeft = 0;
      for (let dy = -3; dy <= 3; dy += 1) {
        for (let dx = -7; dx <= -2; dx += 1) {
          if (bin[(sy + dy) * w + (x + dx)]) blobLeft += 1;
        }
      }
      if (blobLeft < 14) {
        if (barlines.length === 0 || x - barlines[barlines.length - 1] > minMeasureWidth) {
          barlines.push(x);
        }
      }
    }
  }
  return barlines;
}

function detectNoteheads(
  bin: Uint8Array,
  w: number,
  h: number,
  sy: number,
  x1: number,
  x2: number,
  staffSpacing: number
): number[] {
  const nhRadius = Math.max(3, Math.round(staffSpacing * 0.045));
  const scores = new Float32Array(x2 - x1);

  for (let x = x1; x < x2; x += 1) {
    let count = 0;
    for (let dy = -nhRadius; dy <= nhRadius; dy += 1) {
      const yy = sy + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -nhRadius; dx <= nhRadius; dx += 1) {
        const xx = x + dx;
        if (xx >= 0 && xx < w && bin[yy * w + xx]) count += 1;
      }
    }
    scores[x - x1] = count / ((2 * nhRadius + 1) * (2 * nhRadius + 1));
  }

  const centers: number[] = [];
  const minNoteDist = Math.max(11, Math.round(staffSpacing * 0.14));

  for (let i = 2; i < scores.length - 2; i += 1) {
    if (
      scores[i] > 0.52 &&
      scores[i] >= scores[i - 1] &&
      scores[i] >= scores[i + 1]
    ) {
      const cx = x1 + i;
      if (centers.length === 0 || cx - centers[centers.length - 1] > minNoteDist) {
        centers.push(cx);
      } else if (scores[i] > scores[centers[centers.length - 1] - x1]) {
        centers[centers.length - 1] = cx;
      }
    }
  }

  return centers;
}

function estimateDuration(
  bin: Uint8Array,
  w: number,
  h: number,
  sy: number,
  nx: number,
  prevX: number,
  nextX: number,
  staffSpacing: number
): Duration {
  // Count horizontal dark beam transitions between this note and its neighbor in the beam band
  const beamYTop = Math.max(0, Math.round(sy - staffSpacing * 0.42));
  const beamYBot = Math.max(beamYTop + 4, Math.round(sy - staffSpacing * 0.18));
  const midRight = Math.round((nx + nextX) / 2);
  const midLeft = Math.round((nx + prevX) / 2);

  const countBandsAtX = (x: number) => {
    if (x < 0 || x >= w) return 0;
    let bands = 0;
    let inRun = false;
    for (let y = beamYTop; y <= beamYBot; y += 1) {
      const dark = bin[y * w + x] === 1;
      if (dark && !inRun) {
        bands += 1;
        inRun = true;
      } else if (!dark) {
        inRun = false;
      }
    }
    return bands;
  };

  const beams = Math.max(
    nextX - nx < staffSpacing * 0.7 ? countBandsAtX(midRight) : 0,
    nx - prevX < staffSpacing * 0.7 ? countBandsAtX(midLeft) : 0
  );

  if (beams >= 3) return 'thirtysecond';
  if (beams === 2) return 'sixteenth';
  if (beams === 1) return 'eighth';

  // Fallback by horizontal spacing
  const spacing = nextX - nx;
  if (spacing < staffSpacing * 0.24) return 'sixteenth';
  if (spacing < staffSpacing * 0.45) return 'eighth';
  return 'quarter';
}

function classifyStrokeSymbol(
  bin: Uint8Array,
  w: number,
  h: number,
  sy: number,
  nx: number,
  staffSpacing: number
): StrokeType {
  // Symbol region sits above the stem/beam
  const symTop = Math.max(0, Math.round(sy - staffSpacing * 0.68));
  const symMid = Math.max(symTop + 2, Math.round(sy - staffSpacing * 0.52));
  const symBot = Math.max(symMid + 2, Math.round(sy - staffSpacing * 0.36));
  const halfW = Math.max(7, Math.round(staffSpacing * 0.09));

  let topInk = 0;
  let botInk = 0;
  let totalInk = 0;
  let leftColInk = 0;
  let rightColInk = 0;

  for (let y = symTop; y <= symBot && y < h; y += 1) {
    for (let x = Math.max(0, nx - halfW); x <= Math.min(w - 1, nx + halfW); x += 1) {
      if (bin[y * w + x]) {
        totalInk += 1;
        if (y <= symMid) topInk += 1;
        else botInk += 1;
        if (x < nx - 2) leftColInk += 1;
        if (x > nx + 2) rightColInk += 1;
      }
    }
  }

  if (totalInk < 4) return 'bak_r';

  // Wide symmetric double symbol (^v) tends to have high total ink across both flanks
  if (totalInk > halfW * 3.8 && leftColInk > 8 && rightColInk > 8) {
    return 'riz';
  }

  // v̇ with finger number '2' has heavier ink in upper half than lower half
  const topRatio = topInk / totalInk;
  if (topRatio > 0.58) return 'bak_l';

  // ؟ (Tom) has rounded upper hook + vertical stem (balanced/slightly right-heavy)
  if (topRatio >= 0.44 && totalInk > halfW * 1.9) return 'tom';

  return 'bak_r';
}

function measureInkDensity(
  bin: Uint8Array,
  w: number,
  x1: number,
  x2: number,
  y1: number,
  y2: number
): number {
  let dark = 0;
  let total = 0;
  for (let y = Math.max(0, y1); y <= y2; y += 1) {
    for (let x = Math.max(0, x1); x <= x2; x += 1) {
      total += 1;
      if (bin[y * w + x]) dark += 1;
    }
  }
  return total > 0 ? dark / total : 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
