/**
 * tableDetector.ts — Browser-side table region detection using Canvas API
 *
 * Priority 1 from the updated plan:
 *   Detect table borders → crop each table → return crop regions
 *
 * Uses adaptive thresholding and line detection via pixel scanning
 * to find rectangular table regions in curriculum images.
 */

export interface TableRegion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  classification: 'semester_table' | 'elective_table' | 'unknown';
}

export interface TableDetectionResult {
  regions: TableRegion[];
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

  // Convert to grayscale and threshold
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    gray[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  }

  // Adaptive threshold: pixel is "dark" if it's significantly darker than local average
  const binary = new Uint8Array(width * height);
  const blockSize = 15;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Local window average
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

  // Detect horizontal lines: rows where many consecutive pixels are dark
  const minLineLength = Math.floor(width * 0.15); // at least 15% of image width
  const hLines: { y: number; x1: number; x2: number }[] = [];

  for (let y = 0; y < height; y++) {
    let run = 0, startX = 0;
    for (let x = 0; x < width; x++) {
      if (binary[y * width + x]) {
        if (run === 0) startX = x;
        run++;
      } else {
        if (run >= minLineLength) {
          hLines.push({ y, x1: startX, x2: x - 1 });
        }
        run = 0;
      }
    }
    if (run >= minLineLength) hLines.push({ y, x1: startX, x2: width - 1 });
  }

  // Detect vertical lines: columns where many consecutive pixels are dark
  const minVLineLength = Math.floor(height * 0.02); // shorter threshold for vertical
  const vLines: { x: number; y1: number; y2: number }[] = [];

  for (let x = 0; x < width; x++) {
    let run = 0, startY = 0;
    for (let y = 0; y < height; y++) {
      if (binary[y * width + x]) {
        if (run === 0) startY = y;
        run++;
      } else {
        if (run >= minVLineLength) {
          vLines.push({ x, y1: startY, y2: y - 1 });
        }
        run = 0;
      }
    }
    if (run >= minVLineLength) vLines.push({ x, y1: startY, y2: height - 1 });
  }

  // Cluster horizontal lines by Y proximity (merge lines within 5px)
  const yTol = 5;
  const hClusters: number[] = [];
  const sortedH = [...hLines].sort((a, b) => a.y - b.y);
  for (const line of sortedH) {
    if (hClusters.length === 0 || line.y - hClusters[hClusters.length - 1] > yTol) {
      hClusters.push(line.y);
    }
  }

  // Find table rectangles: pairs of horizontal lines with vertical lines between them
  const regions: TableRegion[] = [];
  const minTableHeight = Math.floor(height * 0.04);
  const maxTableHeight = Math.floor(height * 0.35);

  // Group consecutive horizontal lines into potential table tops/bottoms
  for (let i = 0; i < hClusters.length; i++) {
    for (let j = i + 1; j < hClusters.length; j++) {
      const top = hClusters[i];
      const bottom = hClusters[j];
      const h = bottom - top;
      if (h < minTableHeight || h > maxTableHeight) continue;

      // Check if there are vertical lines connecting top to bottom
      const connectingVLines = vLines.filter(v =>
        v.y1 <= top + 10 && v.y2 >= bottom - 10
      );

      if (connectingVLines.length >= 2) {
        const xs = connectingVLines.map(v => v.x).sort((a, b) => a - b);
        const leftX = xs[0];
        const rightX = xs[xs.length - 1];
        const w = rightX - leftX;

        if (w >= minLineLength) {
          // Check it doesn't overlap with existing regions
          const overlaps = regions.some(r =>
            Math.abs(r.y - top) < minTableHeight && Math.abs(r.x - leftX) < 50
          );
          if (!overlaps) {
            regions.push({
              id: `table_${regions.length + 1}`,
              x: leftX,
              y: top,
              width: w,
              height: h,
              classification: 'unknown',
            });
          }
        }
      }
    }
  }

  // If line detection didn't find enough tables, use projection-based detection
  if (regions.length < 3) {
    const projectionRegions = detectByProjection(gray, width, height);
    if (projectionRegions.length > regions.length) {
      regions.length = 0;
      regions.push(...projectionRegions);
    }
  }

  // Sort by position (top-left first, then top-right, etc.)
  regions.sort((a, b) => {
    const rowA = Math.floor(a.y / (height * 0.2));
    const rowB = Math.floor(b.y / (height * 0.2));
    if (rowA !== rowB) return rowA - rowB;
    return a.x - b.x;
  });

  // Classify tables based on position
  classifyTables(regions, width, height);

  return { regions, imageWidth: width, imageHeight: height };
}

/**
 * Fallback: detect table regions using horizontal projection profile
 */
function detectByProjection(gray: Uint8Array, width: number, height: number): TableRegion[] {
  // Horizontal projection: count dark pixels per row
  const threshold = 128;
  const rowDensity = new Float32Array(height);
  for (let y = 0; y < height; y++) {
    let dark = 0;
    for (let x = 0; x < width; x++) {
      if (gray[y * width + x] < threshold) dark++;
    }
    rowDensity[y] = dark / width;
  }

  // Find bands of high density (table rows) separated by gaps
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

  // Vertical projection within each band to find left/right edges
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

    // Find horizontal spans
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
        x: span.left,
        y: band.top,
        width: span.right - span.left,
        height: band.bottom - band.top,
        classification: 'unknown',
      });
    }
  }

  return regions;
}

/**
 * Classify table regions based on their position in the image layout.
 * UTHM curriculum images follow a consistent 2-column layout.
 */
function classifyTables(regions: TableRegion[], imgWidth: number, imgHeight: number) {
  // Layout: left=odd semesters, right=even semesters
  const midX = imgWidth / 2;
  let semCounter = 0;

  for (const r of regions) {
    const centerX = r.x + r.width / 2;
    const isLeft = centerX < midX;

    // Small tables at the bottom are likely elective or latihan industri
    if (r.y > imgHeight * 0.75 && r.height < imgHeight * 0.1) {
      r.classification = r.width > imgWidth * 0.5 ? 'elective_table' : 'semester_table';
    } else {
      r.classification = 'semester_table';
    }
  }
}

/**
 * Crop a region from the original image, with padding and upscaling.
 * Returns a Blob suitable for OCR.
 */
export async function cropTableRegion(
  file: File | Blob,
  region: TableRegion,
  scaleFactor: number = 3,
  padding: number = 10,
): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const img = await loadImage(url);
  URL.revokeObjectURL(url);

  // Add padding
  const x = Math.max(0, region.x - padding);
  const y = Math.max(0, region.y - padding);
  const w = Math.min(img.width - x, region.width + padding * 2);
  const h = Math.min(img.height - y, region.height + padding * 2);

  const canvas = document.createElement('canvas');
  canvas.width = w * scaleFactor;
  canvas.height = h * scaleFactor;
  const ctx = canvas.getContext('2d')!;

  // Enable image smoothing for upscaling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Draw the cropped, upscaled region
  ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);

  // Enhance: increase contrast
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data: pixels } = imageData;

  // Compute histogram for auto-contrast
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
