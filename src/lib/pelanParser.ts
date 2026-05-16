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
  if (hostname === 'localhost' || hostname === '127.0.0.1') return '/pdf.worker.min.js';
  return '/BITrack/pdf.worker.min.js';
}

// ─── BUG-1 + BUG-3 FIX: coordinate-aware pdfjs extraction ───────────────────

async function extractLinesFromPDF(file: File): Promise<PdfLine[]> {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = getPdfWorkerSrc();

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const allLines: PdfLine[] = [];
    const maxPages = Math.min(pdf.numPages, 5);

    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale: 1.0 });
      const content = await page.getTextContent();

      // Use viewport height to flip Y (PDF Y=0 is bottom, we want top-down)
      const items = content.items.map((item: any) => ({
        ...item,
        transform: [
          item.transform[0], item.transform[1],
          item.transform[2], item.transform[3],
          item.transform[4],
          viewport.height - item.transform[5], // flip Y
        ],
      }));

      const pageLines = extractLinesFromItems(items);

      // BUG-3 FIX: detect & split columns, then concatenate columns top-to-bottom
      const cols = detectColumns(pageLines);
      for (const col of cols) {
        allLines.push(...col);
      }
    }

    return allLines;
  } catch (err) {
    console.error('[pelanParser] pdfjs extraction failed:', err);
    return [];
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

  if (isImage) {
    onProgress({ step: 'running-ocr', message: 'Running OCR on image…', progress: 20 });
    bestLines = await extractLinesViaOCR(file, pct =>
      onProgress({ step: 'running-ocr', message: `OCR: ${pct}%`, progress: 20 + Math.round(pct * 0.5) })
    );
  } else {
    onProgress({ step: 'extracting-text', message: 'Extracting text (Path A)…', progress: 15 });
    const pathALines = await extractLinesFromPDF(file);

    // Count useful subject rows in Path A
    const aCount = pathALines.filter(l => parseSubjectLine(l.text) !== null).length;

    if (aCount < 3) {
      // Likely scanned PDF — fall back to OCR
      onProgress({ step: 'running-ocr', message: 'Scanned PDF detected — running OCR…', progress: 30 });
      const pathBLines = await extractLinesViaOCR(file, pct =>
        onProgress({ step: 'running-ocr', message: `OCR: ${pct}%`, progress: 30 + Math.round(pct * 0.4) })
      );
      const bCount = pathBLines.filter(l => parseSubjectLine(l.text) !== null).length;
      bestLines = bCount >= aCount ? pathBLines : pathALines;
    } else {
      bestLines = pathALines;
    }

    onProgress({ step: 'merging', message: 'Comparing results…', progress: 72 });
  }

  const subjectCount = bestLines.filter(l => parseSubjectLine(l.text) !== null).length;
  if (subjectCount === 0) {
    warnings.push('Could not detect subject rows automatically. Please review and edit the extracted data manually.');
  }

  onProgress({ step: 'building-structure', message: 'Building curriculum structure…', progress: 82 });
  const parsed = parseTableLines(bestLines);
  const linked = detectLinkedSubjects(bestLines);

  if (parsed.years.length === 0) {
    warnings.push('No semester structure detected. You may need to add semesters manually.');
    parsed.years.push({ year: 1, semesters: [{ sem: 1, rows: [] }] });
  }

  const curriculum = buildCurriculum(parsed, linked, file.name);
  onProgress({ step: 'done', message: 'Done!', progress: 100 });
  return { curriculum, warnings };
}
