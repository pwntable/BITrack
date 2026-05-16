/**
 * pelanParser.ts — v2 (coordinate-aware rewrite)
 * Fixes all 7 confirmed bugs from diagnosis.
 */

import type { ParsedCurriculum, ParsedYear, ParsedSemester, ParsedSubject } from '@/store/curriculumStore';

// ─── Public types ─────────────────────────────────────────────────────────────

export type ParseStep = 'loading' | 'extracting-text' | 'running-ocr' | 'merging' | 'building-structure' | 'done' | 'error';
export interface ParseProgress { step: ParseStep; message: string; progress: number; }
export interface ParseResult { curriculum: ParsedCurriculum; warnings: string[]; }

// ─── Internal types ───────────────────────────────────────────────────────────

export interface PdfLine { text: string; x: number; y: number; }

interface RawRow { code: string; name: string; credits: number; is_elective: boolean; }

interface ParsedMeta {
  programName: string; programCode: string; faculty: string;
  session: string; totalCredits: number;
}

interface ParsedTable extends ParsedMeta {
  years: { year: number; semesters: { sem: number; rows: RawRow[] }[] }[];
  electivePool: RawRow[];
}

// ─── BUG-1 + BUG-2 FIX: Y-coordinate line reconstruction ────────────────────

export function extractLinesFromItems(
  items: any[],
  opts: { yTolerance?: number } = {},
): PdfLine[] {
  const tol = opts.yTolerance ?? 6;
  if (!items.length) return [];

  // Sort by Y descending (PDF Y grows upward), then X ascending
  const sorted = [...items].sort((a, b) => {
    const ay = a.transform[5], by = b.transform[5];
    if (Math.abs(ay - by) > tol) return by - ay;          // different rows
    return a.transform[4] - b.transform[4];               // same row: left→right
  });

  const lines: PdfLine[] = [];
  let currentLine: PdfLine | null = null;

  for (const item of sorted) {
    const str: string = item.str ?? '';
    const x: number = item.transform[4];
    const y: number = item.transform[5];

    if (!currentLine || Math.abs(y - currentLine.y) > tol) {
      currentLine = { text: str, x, y };
      lines.push(currentLine);
    } else {
      // Append with a space separator (preserving left-to-right order)
      currentLine.text += (currentLine.text && str ? '  ' : '') + str;
    }
  }

  return lines;
}

// ─── BUG-3 FIX: Column detection ─────────────────────────────────────────────

export function detectColumns(lines: PdfLine[]): PdfLine[][] {
  if (!lines.length) return [];

  const xs = lines.map(l => l.x).sort((a, b) => a - b);
  const maxX = xs[xs.length - 1];
  const minX = xs[0];
  const range = maxX - minX;

  // If the range is narrow, it's single column
  if (range < 200) return [lines];

  // Find column boundaries using X-gap clustering
  const gaps: { pos: number; gap: number }[] = [];
  for (let i = 1; i < xs.length; i++) {
    const gap = xs[i] - xs[i - 1];
    if (gap > 80) gaps.push({ pos: (xs[i] + xs[i - 1]) / 2, gap });
  }

  // Pick up to 2 largest gaps as column dividers
  const dividers = gaps
    .sort((a, b) => b.gap - a.gap)
    .slice(0, 2)
    .map(g => g.pos)
    .sort((a, b) => a - b);

  if (!dividers.length) return [lines];

  // Bucket lines into columns
  const buckets: PdfLine[][] = Array.from({ length: dividers.length + 1 }, () => []);
  for (const line of lines) {
    let col = 0;
    for (const div of dividers) { if (line.x > div) col++; }
    buckets[col].push(line);
  }

  // Sort each column by Y descending
  return buckets.filter(b => b.length > 0).map(b =>
    b.sort((a, z) => z.y - a.y)
  );
}

// ─── BUG-4 FIX: Subject line parser ──────────────────────────────────────────

// Matches: optional-sem-num  CODE  Name...  credits
// CODE patterns: BIT 11203, UHB 13102, UQ* 1***1, BIT ****3, BIT30502, UQU40103
const SUBJECT_RE = /^(?:\d+\s+)?([A-Z]{2,4}[\s\*]?[\d\*]{2,6}|[A-Z]{2,4}\d{5,7}|[A-Z]{2,3}\*\s?[\d\*]{4,6})\s{2,}(.+?)\s{2,}(\d{1,2})\s*\*?\s*$/;
// Relaxed version for lines with single space (OCR output)
const SUBJECT_RE_RELAXED = /^(?:\d+\s+)?([A-Z]{2,4}[\s\*]?[\d\*]{2,6}|[A-Z]{2,4}\d{5,7}|[A-Z]{2,3}\*\s?[\d\*]{4,6})\s+(.+?)\s+(\d{1,2})\s*\*?\s*$/;

const SKIP_EXACT = new Set(['Jumlah', 'Kredit', 'Kod Kursus', 'Nama Kursus', 'Sem', 'Kod', 'Nama Kursus Kredit']);
const SKIP_PREFIX = ['Jumlah', 'Kursus Pra', '*BIT', '*UHB', '*BIK', '*BIS'];

export function parseSubjectLine(line: string): RawRow | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (SKIP_EXACT.has(trimmed)) return null;
  if (SKIP_PREFIX.some(p => trimmed.startsWith(p))) return null;
  if (/^TAHUN\s*\d/i.test(trimmed)) return null;
  if (/^Sem\s*\d/i.test(trimmed)) return null;

  let m = SUBJECT_RE.exec(trimmed) ?? SUBJECT_RE_RELAXED.exec(trimmed);
  if (!m) return null;

  const code = m[1].trim();
  const name = m[2].trim().replace(/\*+$/, '').trim(); // strip trailing asterisks
  const credits = parseInt(m[3]);

  const is_elective =
    /elektif/i.test(name) ||
    /\*{2,}/.test(code) ||      // BIT ****3, BIT **403
    /^\d\*+\d$/.test(code.split(' ').pop() ?? '');

  return { code, name, credits: isNaN(credits) ? 3 : credits, is_elective };
}

// ─── BUG-5 FIX: Metadata extraction ──────────────────────────────────────────

export function detectProgramMetadata(lines: string[]): ParsedMeta {
  let programName = 'Unknown Programme';
  let programCode = 'UNK';
  let faculty = 'Unknown Faculty';
  let session = '';
  let totalCredits = 120;

  for (const line of lines) {
    // Programme code in parentheses e.g. (BIT)
    const codeMatch = line.match(/\(([A-Z]{2,4})\)/);
    if (codeMatch) {
      programCode = codeMatch[1];
      // Title-case the programme name for display
      programName = line
        .replace(/PROGRAM[ME]*\s*/i, '')
        .replace(/DENGAN KEPUJIAN/i, 'with Honours')
        .trim()
        .replace(/\b([A-Z]{2,})/g, (w) =>
          w.length <= 3 ? w : w[0] + w.slice(1).toLowerCase()
        );
    }

    // Session year pattern
    const sesMatch = line.match(/(\d{4}\/\d{4})/);
    if (sesMatch) session = sesMatch[1];

    // Faculty
    if (/FAKULTI/i.test(line)) {
      faculty = line.replace(/FAKULTI\s*/i, '').trim();
    }

    // Total credits
    const credMatch = line.match(/Jumlah\s+Keseluruhan\s+Kredit\s*[:\s]\s*(\d+)/i)
      ?? line.match(/Jumlah Keseluruhan Kredit\s+(\d+)/i)
      ?? line.match(/Jumlah Keseluruhan Kredit(\d+)/i);
    if (credMatch) totalCredits = parseInt(credMatch[1]);
  }

  return { programName, programCode, faculty, session, totalCredits };
}

// ─── BUG-5 FIX: Two-pass table parser ─────────────────────────────────────────

const YEAR_RE = /TAHUN\s*(\d)/i;
const ELECTIVE_POOL_RE = /Elektif\s+Kursus|Kursus\s+Elektif|Senarai\s+Elektif/i;

export function parseTableLines(lines: PdfLine[]): ParsedTable {
  const textLines = lines.map(l => l.text);
  const meta = detectProgramMetadata(textLines);

  const years: ParsedTable['years'] = [];
  const electivePool: RawRow[] = [];

  let currentYear: (typeof years)[0] | null = null;
  let currentSem: { sem: number; rows: RawRow[] } | null = null;
  let inElectivePool = false;
  let globalSemCounter = 0;

  for (const line of lines) {
    const t = line.text.trim();

    if (ELECTIVE_POOL_RE.test(t)) { inElectivePool = true; continue; }

    const yearMatch = t.match(YEAR_RE);
    if (yearMatch) {
      const yn = parseInt(yearMatch[1]);
      currentYear = { year: yn, semesters: [] };
      years.push(currentYear);
      inElectivePool = false;
      continue;
    }

    // BUG-4 FIX: detect inline semester number "1 BIT 11203..." or just a leading digit
    const inlineSemMatch = t.match(/^(\d+)\s+[A-Z]{2,4}/);
    const semNumOnly = t.match(/^(\d+)$/) && parseInt(t) <= 10;

    if (inlineSemMatch || semNumOnly) {
      const sn = inlineSemMatch ? parseInt(inlineSemMatch[1]) : parseInt(t);
      // Only create a new semester if this number is different from current
      if (!currentSem || currentSem.sem !== sn) {
        globalSemCounter++;
        currentSem = { sem: sn, rows: [] };
        if (!currentYear) {
          // Auto-create year if not yet seen
          currentYear = { year: Math.ceil(globalSemCounter / 2), semesters: [] };
          years.push(currentYear);
        }
        currentYear.semesters.push(currentSem);
      }
    }

    const row = parseSubjectLine(t);
    if (row) {
      if (inElectivePool) {
        electivePool.push(row);
      } else if (currentSem) {
        currentSem.rows.push(row);
      } else {
        // No year/sem context yet — auto-create
        if (!currentYear) {
          currentYear = { year: 1, semesters: [] };
          years.push(currentYear);
        }
        currentSem = { sem: ++globalSemCounter, rows: [row] };
        currentYear.semesters.push(currentSem);
      }
    }

    // Total credits line (can appear mid-table)
    const credMatch = t.match(/Jumlah\s+Keseluruhan\s+Kredit\s*(\d+)/i);
    if (credMatch) meta.totalCredits = parseInt(credMatch[1]);
  }

  return { ...meta, years, electivePool };
}

// ─── BUG-7 FIX: pdfjs worker path resolver ────────────────────────────────────

function getPdfWorkerSrc(): string {
  if (typeof window === 'undefined') return '';
  const { hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return '/pdf.worker.min.mjs';
  return '/BITrack/pdf.worker.min.mjs';
}

// ─── Columnar PDF extraction: match codes, names, credits by X-position ──────

const COURSE_CODE_RE = /^[A-Z]{2,4}[\s\*]?[\d\*]{2,6}$|^[A-Z]{2,4}\d{5,7}$/;
const COURSE_CODE_WITH_NAME_RE = /^([A-Z]{2,4}[\s\*]?[\d\*]{2,6}|[A-Z]{2,4}\d{5,7})\s+(.+)/;

interface RawItem { str: string; x: number; y: number; }

function extractColumnarSubjects(
  items: RawItem[],
  metaLines: string[],
): { subjects: PdfLine[]; meta: string[] } {
  // Find rows that contain course codes (the "Kod Kursus" rows)
  // and rows with course names, credits, semesters, years

  // Separate items by semantic type based on their content
  const codeItems: RawItem[] = [];
  const nameItems: RawItem[] = [];
  const creditItems: RawItem[] = [];
  const semItems: { sem: number; x: number; y: number }[] = [];
  const yearItems: { year: number; x: number; y: number }[] = [];
  const electiveNames: RawItem[] = [];

  // Group items by Y with tolerance
  const yTol = 5;
  const rows: { y: number; cells: RawItem[] }[] = [];
  const sortedByY = [...items].sort((a, b) => a.y - b.y);
  let curRow: { y: number; cells: RawItem[] } | null = null;
  for (const it of sortedByY) {
    if (!curRow || Math.abs(it.y - curRow.y) > yTol) {
      curRow = { y: it.y, cells: [] };
      rows.push(curRow);
    }
    curRow.cells.push(it);
  }

  // Identify which Y-rows contain codes, names, credits
  const codeRowYs: number[] = [];
  const nameRowYs: number[] = [];
  const creditRowYs: number[] = [];

  for (const row of rows) {
    const texts = row.cells.map(c => c.str.trim()).filter(Boolean);
    const codeCount = texts.filter(t => COURSE_CODE_RE.test(t) || COURSE_CODE_WITH_NAME_RE.test(t)).length;
    const numCount = texts.filter(t => /^\d{1,2}$/.test(t) && parseInt(t) <= 20).length;
    const nameCount = texts.filter(t => t.length > 10 && !/^\d+$/.test(t) && !COURSE_CODE_RE.test(t)).length;

    if (codeCount >= 3) {
      // Skip prerequisite rows (e.g. "BIT10303 (mesti lulus sekurang-kurangnya Gred D)")
      const hasPrereqText = texts.some(t => /mesti lulus|Gred\s*[A-F]/i.test(t));
      if (hasPrereqText) continue;

      codeRowYs.push(row.y);
      for (const c of row.cells) {
        const t = c.str.trim();
        if (COURSE_CODE_RE.test(t)) codeItems.push(c);
        else if (COURSE_CODE_WITH_NAME_RE.test(t)) codeItems.push(c); // "UHB 13102 English..."
      }
    } else if (numCount >= 5 && codeCount === 0) {
      creditRowYs.push(row.y);
      for (const c of row.cells) {
        if (/^\d{1,2}$/.test(c.str.trim())) creditItems.push(c);
      }
    } else if (nameCount >= 3) {
      nameRowYs.push(row.y);
      for (const c of row.cells) {
        const t = c.str.trim();
        if (t.length > 3 && !/^Kod|^Nama|^Kredit|^Sem$|^Jumlah/i.test(t)) nameItems.push(c);
      }
    }

    // Detect year headers
    const yearMatch = texts.join(' ').match(/TAHUN\s*(\d)/i);
    if (yearMatch) {
      yearItems.push({ year: parseInt(yearMatch[1]), x: row.cells[0].x, y: row.y });
    }

    // Detect semester numbers (standalone digits in sem-labeled rows)
    if (texts.some(t => /^Sem$/i.test(t))) {
      for (const c of row.cells) {
        const n = parseInt(c.str.trim());
        if (!isNaN(n) && n >= 1 && n <= 10) semItems.push({ sem: n, x: c.x, y: c.y });
      }
    }

    // Collect metadata lines
    for (const c of row.cells) {
      const t = c.str.trim();
      if (/PROGRAM|FAKULTI|PELAN|MULAI|AKADEMIK/i.test(t)) metaLines.push(t);
      if (/Jumlah Keseluruhan/i.test(t)) metaLines.push(t);
    }
  }

  if (codeItems.length === 0) return { subjects: [], meta: metaLines };

  // Match each code to its name and credit by X proximity
  const xTol = 3;
  const results: PdfLine[] = [];

  // Find which semester each X position belongs to
  const getSemForX = (x: number): number => {
    let best = 1;
    let bestDist = Infinity;
    for (const s of semItems) {
      const dist = Math.abs(s.x - x);
      if (dist < bestDist) { bestDist = dist; best = s.sem; }
    }
    return best;
  };

  // Find which year each X position belongs to
  const getYearForX = (x: number): number => {
    let best = 1;
    let bestDist = Infinity;
    for (const yr of yearItems) {
      if (x >= yr.x - 20) { // year header covers everything to its right
        const dist = Math.abs(x - yr.x);
        if (dist < bestDist) { bestDist = dist; best = yr.year; }
      }
    }
    // Assign by range if multiple years
    if (yearItems.length >= 2) {
      const sorted = [...yearItems].sort((a, b) => a.x - b.x);
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (x >= sorted[i].x - 20) return sorted[i].year;
      }
    }
    return best;
  };

  for (const codeItem of codeItems) {
    let code = codeItem.str.trim();
    let name = '';

    // Check if code item already contains the name (e.g. "UHB 13102 English for...")
    const combined = COURSE_CODE_WITH_NAME_RE.exec(code);
    if (combined && combined[2].length > 3) {
      code = combined[1];
      name = combined[2].replace(/\*+$/, '').trim();
    }

    // Find matching name by closest X
    if (!name) {
      let bestDist = Infinity;
      for (const ni of nameItems) {
        const dist = Math.abs(ni.x - codeItem.x);
        if (dist < bestDist) { bestDist = dist; name = ni.str.trim(); }
      }
    }

    // Find matching credit by closest X
    let credit = 3;
    let bestCreditDist = Infinity;
    for (const ci of creditItems) {
      const dist = Math.abs(ci.x - codeItem.x);
      if (dist < bestCreditDist) { bestCreditDist = dist; credit = parseInt(ci.str.trim()) || 3; }
    }

    const sem = getSemForX(codeItem.x);
    const year = getYearForX(codeItem.x);
    const isElective = /\*{2,}/.test(code) || /elektif/i.test(name);

    // Build a synthetic line that parseSubjectLine can handle
    const syntheticLine = `${code}  ${name || 'Unknown'}  ${credit}`;
    results.push({
      text: `YEAR:${year} SEM:${sem} ${syntheticLine}`,
      x: codeItem.x,
      y: codeItem.y,
    });
  }

  return { subjects: results, meta: metaLines };
}

// ─── Columnar-aware table parser ──────────────────────────────────────────────

function parseColumnarResults(lines: PdfLine[]): ParsedTable {
  const textLines = lines.map(l => l.text);
  const meta = detectProgramMetadata(textLines);
  const years: ParsedTable['years'] = [];
  const electivePool: RawRow[] = [];

  // Extract YEAR:N SEM:N prefix from synthetic lines
  const yearSemRe = /^YEAR:(\d+)\s+SEM:(\d+)\s+(.+)$/;

  // Group subjects by year/sem
  const buckets: Record<string, RawRow[]> = {};
  let electiveSection = false;

  for (const line of lines) {
    const m = yearSemRe.exec(line.text);
    if (m) {
      const yr = parseInt(m[1]);
      const sm = parseInt(m[2]);
      const rest = m[3];
      const row = parseSubjectLine(rest);
      if (row) {
        const key = `${yr}-${sm}`;
        if (!buckets[key]) buckets[key] = [];
        buckets[key].push(row);
      }
      continue;
    }

    // Also handle regular lines (from OCR path or other)
    const t = line.text.trim();
    if (ELECTIVE_POOL_RE.test(t)) { electiveSection = true; continue; }
    if (YEAR_RE.test(t)) { electiveSection = false; continue; }

    const row = parseSubjectLine(t);
    if (row) {
      if (electiveSection) electivePool.push(row);
      else {
        if (!buckets['1-1']) buckets['1-1'] = [];
        buckets['1-1'].push(row);
      }
    }

    const credMatch = t.match(/Jumlah\s+Keseluruhan\s+Kredit\s*(\d+)/i);
    if (credMatch) meta.totalCredits = parseInt(credMatch[1]);
  }

  // Build years/semesters from buckets
  const allKeys = Object.keys(buckets).sort();
  const yearMap: Record<number, { year: number; semesters: { sem: number; rows: RawRow[] }[] }> = {};

  for (const key of allKeys) {
    const [yr, sm] = key.split('-').map(Number);
    if (!yearMap[yr]) {
      yearMap[yr] = { year: yr, semesters: [] };
    }
    yearMap[yr].semesters.push({ sem: sm, rows: buckets[key] });
  }

  for (const yr of Object.keys(yearMap).map(Number).sort()) {
    years.push(yearMap[yr]);
  }

  return { ...meta, years, electivePool };
}

// ─── Main PDF extraction ──────────────────────────────────────────────────────

async function extractLinesFromPDF(file: File): Promise<{ lines: PdfLine[]; columnar: boolean }> {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = getPdfWorkerSrc();

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const maxPages = Math.min(pdf.numPages, 5);

    // Collect all raw items across pages
    const allRawItems: RawItem[] = [];

    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1.0 });
      const content = await page.getTextContent();

      for (const item of content.items) {
        const it = item as any;
        if (!it.str?.trim()) continue;
        allRawItems.push({
          str: it.str,
          x: Math.round(it.transform[4]),
          y: Math.round(viewport.height - it.transform[5]),
        });
      }
    }

    if (allRawItems.length === 0) return { lines: [], columnar: false };

    // Try columnar extraction first (handles UTHM landscape table PDFs)
    const metaLines: string[] = [];
    const { subjects } = extractColumnarSubjects(allRawItems, metaLines);

    if (subjects.length >= 5) {
      // Add metadata lines at the top
      const fullLines: PdfLine[] = [
        ...metaLines.map((t, i) => ({ text: t, x: 0, y: -1000 + i })),
        ...subjects,
      ];
      return { lines: fullLines, columnar: true };
    }

    // Fallback: standard horizontal line reconstruction
    const items = allRawItems.map(it => ({
      str: it.str,
      transform: [1, 0, 0, 1, it.x, -it.y], // restore original transform shape
    }));
    const pageLines = extractLinesFromItems(items);
    const cols = detectColumns(pageLines);
    const allLines: PdfLine[] = [];
    for (const col of cols) allLines.push(...col);

    return { lines: allLines, columnar: false };
  } catch (err) {
    console.error('[pelanParser] pdfjs extraction failed:', err);
    return { lines: [], columnar: false };
  }
}

// ─── BUG-6 FIX: OCR with proper error surfacing ───────────────────────────────

async function extractLinesViaOCR(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<PdfLine[]> {
  try {
    const Tesseract = await import('tesseract.js');
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (m: any) => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(Math.round(m.progress * 100));
        }
      },
    });

    const getCanvasBlob = async (canvas: HTMLCanvasElement): Promise<Blob> =>
      new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('Canvas toBlob failed')), 'image/png'));

    let rawText = '';

    if (file.type === 'application/pdf') {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = getPdfWorkerSrc();
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      for (let p = 1; p <= Math.min(pdf.numPages, 4); p++) {
        const page = await pdf.getPage(p);
        const viewport = page.getViewport({ scale: 2.5 }); // High DPI for OCR
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport } as any).promise;
        const blob = await getCanvasBlob(canvas);
        const { data: { text } } = await worker.recognize(blob);
        rawText += '\n' + text;
      }
    } else {
      const { data: { text } } = await worker.recognize(file);
      rawText = text;
    }

    await worker.terminate();

    // Convert flat OCR text into PdfLine[] (Y is line index, X=0)
    return rawText
      .split('\n')
      .map((text, i) => ({ text: text.trim(), x: 0, y: 10000 - i * 12 }))
      .filter(l => l.text.length > 0);

  } catch (err) {
    console.error('[pelanParser] OCR failed:', err);
    return [];
  }
}

// ─── Dedup unique slot suffix ─────────────────────────────────────────────────

function assignUniqueSlots(subjects: ParsedSubject[]): ParsedSubject[] {
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  const codeCount: Record<string, number> = {};
  return subjects.map(sub => {
    const base = sub.code;
    codeCount[base] = (codeCount[base] ?? 0) + 1;
    const n = codeCount[base];
    return n > 1 ? { ...sub, code: `${base} (${roman[n - 1]})` } : sub;
  });
}

function detectLinkedSubjects(lines: PdfLine[]): [string, string][] {
  const text = lines.map(l => l.text).join(' ');
  const pairs: [string, string][] = [];
  const re = /([A-Z]{2,4}\s?[\d]{4,6})\s*\/\s*([A-Z]{2,4}\s?[\d]{4,6})/g;
  let m;
  while ((m = re.exec(text)) !== null) pairs.push([m[1].trim(), m[2].trim()]);
  if ((text.includes('UQI 10102') || text.includes('UQI 10202')) && !pairs.find(([a]) => a === 'UQI 10102')) {
    pairs.push(['UQI 10102', 'UQI 10202']);
  }
  return pairs;
}

function buildCurriculum(parsed: ParsedTable, linked: [string, string][], sourceFilename: string): ParsedCurriculum {
  const curriculum: ParsedYear[] = parsed.years.map(y => ({
    year: y.year,
    semesters: y.semesters.map(s => {
      const subjects = assignUniqueSlots(s.rows.map(r => ({
        code: r.code, name: r.name, credits: r.credits,
        is_elective: r.is_elective || undefined, prerequisite: null,
      })));
      return { semester: s.sem, total_credits: subjects.reduce((a, b) => a + b.credits, 0), subjects };
    }),
  }));

  return {
    id: crypto.randomUUID(),
    program_name: parsed.programName,
    program_code: parsed.programCode,
    faculty: parsed.faculty,
    total_credits_required: parsed.totalCredits,
    academic_session: parsed.session || `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`,
    curriculum,
    elective_pool: parsed.electivePool.map(r => ({ code: r.code, name: r.name, credits: r.credits, is_elective: true, prerequisite: null })),
    linked_subjects: linked,
    uploaded_at: Date.now(),
    source_filename: sourceFilename,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function parsePelanPengajian(file: File, onProgress: (p: ParseProgress) => void): Promise<ParseResult> {
  const warnings: string[] = [];
  onProgress({ step: 'loading', message: 'Loading file…', progress: 5 });

  const isImage = file.type.startsWith('image/');
  let bestLines: PdfLine[] = [];
  let isColumnar = false;

  if (isImage) {
    onProgress({ step: 'running-ocr', message: 'Running OCR on image…', progress: 20 });
    bestLines = await extractLinesViaOCR(file, pct =>
      onProgress({ step: 'running-ocr', message: `OCR: ${pct}%`, progress: 20 + Math.round(pct * 0.5) })
    );
  } else {
    onProgress({ step: 'extracting-text', message: 'Extracting text…', progress: 15 });
    const pdfResult = await extractLinesFromPDF(file);
    bestLines = pdfResult.lines;
    isColumnar = pdfResult.columnar;

    // Check if we got enough subjects from text extraction
    const yearSemRe = /^YEAR:\d+\s+SEM:\d+\s+/;
    const subjectCount = bestLines.filter(l =>
      yearSemRe.test(l.text) || parseSubjectLine(l.text) !== null
    ).length;

    if (subjectCount < 3) {
      // Fall back to OCR for scanned PDFs
      onProgress({ step: 'running-ocr', message: 'Scanned PDF detected — running OCR…', progress: 30 });
      const ocrLines = await extractLinesViaOCR(file, pct =>
        onProgress({ step: 'running-ocr', message: `OCR: ${pct}%`, progress: 30 + Math.round(pct * 0.4) })
      );
      const ocrCount = ocrLines.filter(l => parseSubjectLine(l.text) !== null).length;
      if (ocrCount > subjectCount) {
        bestLines = ocrLines;
        isColumnar = false;
      }
    }

    onProgress({ step: 'merging', message: 'Analyzing structure…', progress: 72 });
  }

  onProgress({ step: 'building-structure', message: 'Building curriculum structure…', progress: 82 });

  // Use columnar parser if columnar extraction was used, otherwise standard parser
  const parsed = isColumnar ? parseColumnarResults(bestLines) : parseTableLines(bestLines);
  const linked = detectLinkedSubjects(bestLines);

  const totalSubjects = parsed.years.reduce(
    (a, y) => a + y.semesters.reduce((b, s) => b + s.rows.length, 0), 0
  );

  if (totalSubjects === 0) {
    warnings.push('Could not detect subject rows automatically. Please review and edit the extracted data manually.');
  }

  if (parsed.years.length === 0) {
    warnings.push('No semester structure detected. You may need to add semesters manually.');
    parsed.years.push({ year: 1, semesters: [{ sem: 1, rows: [] }] });
  }

  const curriculum = buildCurriculum(parsed, linked, file.name);
  onProgress({ step: 'done', message: 'Done!', progress: 100 });
  return { curriculum, warnings };
}
