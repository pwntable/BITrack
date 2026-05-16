/**
 * tableDetector.ts — Browser-side table region detection using Canvas API
 *
 * Implements:
 *   Step 1: Raw table detection via line/projection scanning
 *   Step 1b: Table filtering and deduplication (Priority 1)
 *   Step 2: Table classification + semester assignment (Priority 2)
 */

export interface TableRegion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  classification: 'semester_table' | 'elective_table' | 'unknown';
  assignedSemester?: number;
  assignedYear?: number;
  filterScore?: number;
  filterReason?: string;
}

export interface TableDetectionResult {
  regions: TableRegion[];
  rawRegionCount: number;
  filteredRegionCount: number;
  rejectedRegions: { id: string; reason: string }[];
  imageWidth: number;
  imageHeight: number;
}

/**
 * Load an image file (or blob) into an HTMLImageElement
 */
function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    if (src instanceof Blob) {
      img.src = URL.createObjectURL(src);
    } else {
      img.src = src;
    }
  });
}

/**
 * Detect table regions from an image file.
 * Uses horizontal and vertical line detection to find bordered tables.
 */
export async function detectTableRegions(file: File | Blob): Promise<TableDetectionResult> {
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  URL.revokeObjectURL(url);

  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { width, height, data } = imageData;

  // Convert to grayscale
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // Adaptive threshold
  const binary = new Uint8Array(width * height);
  const blockSize = 15;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0, count = 0;
      for (let dy = -blockSize; dy <= blockSize; dy++) {
        for (let dx = -blockSize; dx <= blockSize; dx++) {
          const ny = y + dy, nx = x + dx;
          if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
            sum += gray[ny * width + nx];
            count++;
          }
        }
      }
      const avg = sum / count;
      binary[y * width + x] = gray[y * width + x] < avg - 15 ? 1 : 0;
    }
  }

  // Detect horizontal lines
  const minLineLength = Math.floor(width * 0.15);
  const hLines: { y: number; x1: number; x2: number }[] = [];
  for (let y = 0; y < height; y++) {
    let run = 0, startX = 0;
    for (let x = 0; x < width; x++) {
      if (binary[y * width + x]) {
        if (run === 0) startX = x;
        run++;
      } else {
        if (run >= minLineLength) hLines.push({ y, x1: startX, x2: x - 1 });
        run = 0;
      }
    }
    if (run >= minLineLength) hLines.push({ y, x1: startX, x2: width - 1 });
  }

  // Detect vertical lines
  const minVLineLength = Math.floor(height * 0.02);
  const vLines: { x: number; y1: number; y2: number }[] = [];
  for (let x = 0; x < width; x++) {
    let run = 0, startY = 0;
    for (let y = 0; y < height; y++) {
      if (binary[y * width + x]) {
        if (run === 0) startY = y;
        run++;
      } else {
        if (run >= minVLineLength) vLines.push({ x, y1: startY, y2: y - 1 });
        run = 0;
      }
    }
    if (run >= minVLineLength) vLines.push({ x, y1: startY, y2: height - 1 });
  }

  // Cluster horizontal lines by Y proximity
  const yTol = 5;
  const hClusters: number[] = [];
  const sortedH = [...hLines].sort((a, b) => a.y - b.y);
  for (const line of sortedH) {
    if (hClusters.length === 0 || line.y - hClusters[hClusters.length - 1] > yTol) {
      hClusters.push(line.y);
    }
  }

  // Find table rectangles
  const rawRegions: TableRegion[] = [];
  const minTableHeight = Math.floor(height * 0.04);
  const maxTableHeight = Math.floor(height * 0.35);

  for (let i = 0; i < hClusters.length; i++) {
    for (let j = i + 1; j < hClusters.length; j++) {
      const top = hClusters[i];
      const bottom = hClusters[j];
      const h = bottom - top;
      if (h < minTableHeight || h > maxTableHeight) continue;

      const connectingVLines = vLines.filter(v =>
        v.y1 <= top + 10 && v.y2 >= bottom - 10
      );

      if (connectingVLines.length >= 2) {
        const xs = connectingVLines.map(v => v.x).sort((a, b) => a - b);
        const leftX = xs[0];
        const rightX = xs[xs.length - 1];
        const w = rightX - leftX;

        if (w >= minLineLength) {
          const overlaps = rawRegions.some(r =>
            Math.abs(r.y - top) < minTableHeight && Math.abs(r.x - leftX) < 50
          );
          if (!overlaps) {
            rawRegions.push({
              id: `table_${rawRegions.length + 1}`,
              x: leftX, y: top, width: w, height: h,
              classification: 'unknown',
            });
          }
        }
      }
    }
  }

  // Fallback to projection if not enough tables
  if (rawRegions.length < 3) {
    const projRegions = detectByProjection(gray, width, height);
    if (projRegions.length > rawRegions.length) {
      rawRegions.length = 0;
      rawRegions.push(...projRegions);
    }
  }

  const rawCount = rawRegions.length;

  // ─── Step 1b: Filter and Deduplicate ──────────────────────────────────────
  const { valid, rejected } = filterAndDeduplicate(rawRegions, width, height);

  // Sort by position (top-to-bottom, left-to-right)
  valid.sort((a, b) => {
    const rowA = Math.floor(a.y / (height * 0.12));
    const rowB = Math.floor(b.y / (height * 0.12));
    if (rowA !== rowB) return rowA - rowB;
    return a.x - b.x;
  });

  // ─── Step 2: Classify and assign semesters ────────────────────────────────
  classifyAndAssignSemesters(valid, width, height);

  // Re-ID after filtering
  valid.forEach((r, i) => r.id = `table_${i + 1}`);

  return {
    regions: valid,
    rawRegionCount: rawCount,
    filteredRegionCount: valid.length,
    rejectedRegions: rejected,
    imageWidth: width,
    imageHeight: height,
  };
}

// ─── Table Filtering & Deduplication ────────────────────────────────────────

function filterAndDeduplicate(
  regions: TableRegion[],
  imgWidth: number,
  imgHeight: number,
): { valid: TableRegion[]; rejected: { id: string; reason: string }[] } {
  const rejected: { id: string; reason: string }[] = [];
  const minW = 250;
  const minH = 80;
  const minArea = 20000;

  // Pass 1: Size filter
  let valid = regions.filter(r => {
    const area = r.width * r.height;
    if (r.width < minW) { rejected.push({ id: r.id, reason: 'too_narrow' }); return false; }
    if (r.height < minH) { rejected.push({ id: r.id, reason: 'too_short' }); return false; }
    if (area < minArea) { rejected.push({ id: r.id, reason: 'too_small' }); return false; }
    return true;
  });

  // Pass 2: Overlap deduplication (IoU > 0.5 → keep bigger)
  const keep = new Set(valid.map((_, i) => i));
  for (let i = 0; i < valid.length; i++) {
    if (!keep.has(i)) continue;
    for (let j = i + 1; j < valid.length; j++) {
      if (!keep.has(j)) continue;
      const iou = computeIoU(valid[i], valid[j]);
      if (iou > 0.5) {
        const areaI = valid[i].width * valid[i].height;
        const areaJ = valid[j].width * valid[j].height;
        if (areaI >= areaJ) {
          keep.delete(j);
          rejected.push({ id: valid[j].id, reason: 'duplicate_nested_region' });
        } else {
          keep.delete(i);
          rejected.push({ id: valid[i].id, reason: 'duplicate_nested_region' });
          break;
        }
      }
    }
  }

  // Pass 3: Containment check (if A fully contains B, drop B)
  const afterDedup = valid.filter((_, i) => keep.has(i));
  const finalKeep = new Set(afterDedup.map((_, i) => i));
  for (let i = 0; i < afterDedup.length; i++) {
    if (!finalKeep.has(i)) continue;
    for (let j = 0; j < afterDedup.length; j++) {
      if (i === j || !finalKeep.has(j)) continue;
      if (isContainedIn(afterDedup[j], afterDedup[i])) {
        finalKeep.delete(j);
        rejected.push({ id: afterDedup[j].id, reason: 'contained_in_larger_table' });
      }
    }
  }

  return { valid: afterDedup.filter((_, i) => finalKeep.has(i)), rejected };
}

function computeIoU(a: TableRegion, b: TableRegion): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return 0;
  const intersection = (x2 - x1) * (y2 - y1);
  const union = a.width * a.height + b.width * b.height - intersection;
  return intersection / union;
}

function isContainedIn(inner: TableRegion, outer: TableRegion): boolean {
  return inner.x >= outer.x && inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height;
}

// ─── Table Classification + Semester Assignment ─────────────────────────────

function yearFromSemester(sem: number): number {
  if (sem <= 2) return 1;
  if (sem <= 4) return 2;
  if (sem <= 6) return 3;
  return 4;
}

function classifyAndAssignSemesters(regions: TableRegion[], imgWidth: number, imgHeight: number) {
  if (regions.length === 0) return;

  const midX = imgWidth / 2;

  // Group tables into rows by Y proximity
  const rowGroups: TableRegion[][] = [];
  let currentGroup: TableRegion[] = [regions[0]];

  for (let i = 1; i < regions.length; i++) {
    const prev = currentGroup[currentGroup.length - 1];
    // Same visual row if Y distance is small relative to image
    if (Math.abs(regions[i].y - prev.y) < imgHeight * 0.08) {
      currentGroup.push(regions[i]);
    } else {
      rowGroups.push(currentGroup);
      currentGroup = [regions[i]];
    }
  }
  rowGroups.push(currentGroup);

  // Assign semesters: left-right pairs per row
  let semNumber = 0;
  for (const group of rowGroups) {
    // Sort left to right within the row
    group.sort((a, b) => a.x - b.x);

    for (const table of group) {
      semNumber++;
      const centerX = table.x + table.width / 2;

      // Last position bottom-right is likely elective
      if (semNumber > 7 || (table.y > imgHeight * 0.75 && centerX > midX)) {
        table.classification = 'elective_table';
        table.assignedSemester = undefined;
        table.assignedYear = undefined;
      } else {
        table.classification = 'semester_table';
        table.assignedSemester = semNumber;
        table.assignedYear = yearFromSemester(semNumber);
      }
    }
  }
}

// ─── Projection Fallback ────────────────────────────────────────────────────

function detectByProjection(gray: Uint8Array, width: number, height: number): TableRegion[] {
  const threshold = 128;
  const rowDensity = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] < threshold) dark++;
    }
    rowDensity[y] = dark / width;
  }

  const densityThreshold = 0.05;
  const minBandHeight = height * 0.04;
  const bands: { top: number; bottom: number }[] = [];
  let bandStart = -1;

  for (let y = 0; y < height; y++) {
    if (rowDensity[y] > densityThreshold) {
      if (bandStart < 0) bandStart = y;
    } else {
      if (bandStart >= 0 && y - bandStart >= minBandHeight) {
        bands.push({ top: bandStart, bottom: y });
      }
      bandStart = -1;
    }
  }
  if (bandStart >= 0 && height - bandStart >= minBandHeight) {
    bands.push({ top: bandStart, bottom: height });
  }

  const regions: TableRegion[] = [];
  for (const band of bands) {
    const colDensity = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      let dark = 0;
      for (let y = band.top; y < band.bottom; y++) {
        if (gray[y * width + x] < threshold) dark++;
      }
      colDensity[x] = dark / (band.bottom - band.top);
    }

    let spanStart = -1;
    const spans: { left: number; right: number }[] = [];
    for (let x = 0; x < width; x++) {
      if (colDensity[x] > 0.02) {
        if (spanStart < 0) spanStart = x;
      } else {
        if (spanStart >= 0 && x - spanStart > width * 0.15) {
          spans.push({ left: spanStart, right: x });
        }
        spanStart = -1;
      }
    }
    if (spanStart >= 0 && width - spanStart > width * 0.15) {
      spans.push({ left: spanStart, right: width });
    }

    for (const span of spans) {
      regions.push({
        id: `table_${regions.length + 1}`,
        x: span.left, y: band.top,
        width: span.right - span.left,
        height: band.bottom - band.top,
        classification: 'unknown',
      });
    }
  }

  return regions;
}

// ─── Crop ───────────────────────────────────────────────────────────────────

export async function cropTableRegion(
  file: File | Blob,
  region: TableRegion,
  scaleFactor: number = 3,
  padding: number = 10,
): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  URL.revokeObjectURL(url);

  const x = Math.max(0, region.x - padding);
  const y = Math.max(0, region.y - padding);
  const w = Math.min(img.width - x, region.width + padding * 2);
  const h = Math.min(img.height - y, region.height + padding * 2);

  const canvas = document.createElement('canvas');
  canvas.width = w * scaleFactor;
  canvas.height = h * scaleFactor;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);

  // Auto-contrast
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data: pixels } = imageData;
  let min = 255, max = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }
  const range = max - min || 1;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = Math.min(255, Math.max(0, ((pixels[i] - min) / range) * 255));
    pixels[i + 1] = Math.min(255, Math.max(0, ((pixels[i + 1] - min) / range) * 255));
    pixels[i + 2] = Math.min(255, Math.max(0, ((pixels[i + 2] - min) / range) * 255));
  }
  ctx.putImageData(imageData, 0, 0);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Crop failed')), 'image/png');
  });
}
