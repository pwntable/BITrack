/**
 * pelanParser.ts
 * Dual-path parser for UTHM Pelan Pengajian files (PDF, JPG, PNG).
 * Path A: pdfjs-dist direct text extraction (machine-readable PDFs)
 * Path B: Tesseract OCR (scanned PDFs, images)
 * Merges both results and picks the richer output.
 */

import type { ParsedCurriculum, ParsedYear, ParsedSemester, ParsedSubject } from '@/store/curriculumStore';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ParseStep =
  | 'loading'
  | 'extracting-text'
  | 'running-ocr'
  | 'merging'
  | 'building-structure'
  | 'done'
  | 'error';

export interface ParseProgress {
  step: ParseStep;
  message: string;
  progress: number; // 0-100
}

export interface ParseResult {
  curriculum: ParsedCurriculum;
  warnings: string[];
}

// ─── Subject Row Regex ─────────────────────────────────────────────────────────
// Matches lines like: "BIT 20303  Senibina Komputer  3"
// Also handles wildcard codes: "BIT ****3", "UQ* 1***1", "BI* 3**03"
const SUBJECT_ROW_RE = /^([A-Z]{2,4}[\s\*]?[\d\*\/]{2,6})\s{1,}(.+?)\s{1,}(\d{1,2})\s*(?:SC)?$/;

// Matches semester/year headers
const YEAR_HEADER_RE = /TAHUN\s*(\d)/i;
const SEM_HEADER_RE = /^Sem\s*(\d+)/i;

// Marks rows to skip
const SKIP_ROWS = ['Jumlah', 'Kredit', 'Kod Kursus', 'Nama Kursus', 'Kod', 'Sem'];
const ELECTIVE_POOL_HEADER_RE = /Elektif\s+Kursus/i;

// ─── Path A: pdfjs Text Extraction ────────────────────────────────────────────

async function extractTextFromPDF(file: File): Promise<string> {
  try {
    const pdfjsLib = await import('pdfjs-dist');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/BITrack/pdf.worker.min.js';
    if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const maxPages = Math.min(pdf.numPages, 5); // cap at 5 pages
    const texts: string[] = [];

    for (let i = 1; i <= maxPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item: any) => item.str)
        .join(' ');
      texts.push(pageText);
    }
    return texts.join('\n');
  } catch {
    return '';
  }
}

// ─── Path B: Tesseract OCR ────────────────────────────────────────────────────

async function extractTextViaOCR(file: File, onProgress?: (pct: number) => void): Promise<string> {
  try {
    const Tesseract = await import('tesseract.js');
    const worker = await Tesseract.createWorker('eng+msa', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text' && onProgress) {
          onProgress(Math.round(m.progress * 100));
        }
      },
    });

    let imageData: string | File = file;

    // For PDFs, render first page to canvas then extract as image blob
    if (file.type === 'application/pdf') {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/BITrack/pdf.worker.min.js';
      if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';
      }

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const allText: string[] = [];

      // OCR each page (max 4)
      for (let i = 1; i <= Math.min(pdf.numPages, 4); i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 2.0 }); // high DPI for better OCR
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport } as any).promise;

        const blob = await new Promise<Blob>((res) => canvas.toBlob(b => res(b!), 'image/png'));
        const { data: { text } } = await worker.recognize(blob);
        allText.push(text);
      }
      await worker.terminate();
      return allText.join('\n');
    }

    const { data: { text } } = await worker.recognize(imageData);
    await worker.terminate();
    return text;
  } catch {
    return '';
  }
}

// ─── Text Normaliser ──────────────────────────────────────────────────────────

function normaliseText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Fix OCR artifacts: common replacements
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    // Normalise spacing
    .replace(/[ \t]{2,}/g, '  ')
    .trim();
}

// ─── Unique code suffix assignment ────────────────────────────────────────────

function assignUniqueSlots(subjects: ParsedSubject[]): ParsedSubject[] {
  const codeCount: Record<string, number> = {};
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

  return subjects.map(sub => {
    const base = sub.code;
    codeCount[base] = (codeCount[base] ?? 0) + 1;
    const n = codeCount[base];
    return n > 1
      ? { ...sub, code: `${base} (${roman[n - 1]})` }
      : sub;
  });
}

// ─── Core Table Parser ────────────────────────────────────────────────────────

interface RawRow {
  code: string;
  name: string;
  credits: number;
  is_elective: boolean;
  low_confidence?: boolean;
}

function parseTableText(text: string): {
  programName: string;
  programCode: string;
  faculty: string;
  session: string;
  totalCredits: number;
  years: { year: number; semesters: { sem: number; rows: RawRow[] }[] }[];
  electivePool: RawRow[];
} {
  const lines = normaliseText(text).split('\n').map(l => l.trim()).filter(Boolean);

  let programName = 'Unknown Programme';
  let programCode = 'UNK';
  let faculty = 'Unknown Faculty';
  let session = '';
  let totalCredits = 120;

  // Extract program metadata from header lines
  for (const line of lines.slice(0, 10)) {
    const progMatch = line.match(/PROGRAM\s+(.+)/i) || line.match(/PROGRAMME\s+(.+)/i);
    if (progMatch) {
      programName = progMatch[1].replace(/DENGAN KEPUJIAN/i, 'with Honours').trim();
      const codeMatch = programName.match(/\(([A-Z]{2,4})\)/);
      if (codeMatch) programCode = codeMatch[1];
    }
    const facMatch = line.match(/FAKULTI\s+(.+)/i);
    if (facMatch) faculty = facMatch[1].trim();
    const sesMatch = line.match(/(\d{4}\/\d{4})/);
    if (sesMatch) session = sesMatch[1];
  }

  const years: { year: number; semesters: { sem: number; rows: RawRow[] }[] }[] = [];
  const electivePool: RawRow[] = [];

  let currentYear: (typeof years)[0] | null = null;
  let currentSem: { sem: number; rows: RawRow[] } | null = null;
  let inElectivePool = false;
  let semCounter = 0;

  for (const line of lines) {
    // Skip noisy lines
    if (SKIP_ROWS.some(s => line.startsWith(s))) continue;

    // Detect elective pool section
    if (ELECTIVE_POOL_HEADER_RE.test(line)) {
      inElectivePool = true;
      continue;
    }

    // Detect year header
    const yearMatch = line.match(YEAR_HEADER_RE);
    if (yearMatch) {
      const yn = parseInt(yearMatch[1]);
      currentYear = { year: yn, semesters: [] };
      years.push(currentYear);
      inElectivePool = false;
      continue;
    }

    // Detect semester header
    const semMatch = line.match(SEM_HEADER_RE);
    if (semMatch) {
      semCounter++;
      const sn = parseInt(semMatch[1]) || semCounter;
      currentSem = { sem: sn, rows: [] };
      if (currentYear) currentYear.semesters.push(currentSem);
      inElectivePool = false;
      continue;
    }

    // Try to match a subject row
    const rowMatch = line.match(SUBJECT_ROW_RE);
    if (rowMatch) {
      const [, code, name, credStr] = rowMatch;
      const credits = parseInt(credStr);
      const isElective = /elektif/i.test(name) || /^BI[A-Z]?\s?\d?\*+\d*$/.test(code.trim());
      const row: RawRow = {
        code: code.trim(),
        name: name.trim(),
        credits: isNaN(credits) ? 3 : credits,
        is_elective: isElective,
        low_confidence: isNaN(credits),
      };

      if (inElectivePool) {
        electivePool.push(row);
      } else if (currentSem) {
        currentSem.rows.push(row);
      } else if (currentYear) {
        // No explicit semester found yet, create one
        currentSem = { sem: ++semCounter, rows: [row] };
        currentYear.semesters.push(currentSem);
      }
    }

    // Try to extract total credits from "Jumlah Keseluruhan Kredit" line
    const totalMatch = line.match(/Jumlah\s+Keseluruhan\s+Kredit\s+(\d+)/i);
    if (totalMatch) totalCredits = parseInt(totalMatch[1]);
  }

  return { programName, programCode, faculty, session, totalCredits, years, electivePool };
}

// ─── Detect linked subjects (Islam/Moral pattern: "UQI 10102/10202") ─────────

function detectLinkedSubjects(text: string): [string, string][] {
  const pairs: [string, string][] = [];

  // Pattern: "UQI 10102/10202" or "UQI 10102/ Pengajian Moral"
  const re = /([A-Z]{2,4}\s?[\d]{4,6})\s*\/\s*([A-Z]{2,4}\s?[\d]{4,6})/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    pairs.push([m[1].trim(), m[2].trim()]);
  }

  // Default: always include standard Islam/Moral pair if either code found
  const hasIslamMoral = text.includes('UQI 10102') || text.includes('UQI 10202');
  if (hasIslamMoral && !pairs.find(([a]) => a === 'UQI 10102')) {
    pairs.push(['UQI 10102', 'UQI 10202']);
  }

  return pairs;
}

// ─── Build ParsedCurriculum from raw parse ────────────────────────────────────

function buildCurriculum(
  parsed: ReturnType<typeof parseTableText>,
  linkedSubjects: [string, string][],
  sourceFilename: string,
): ParsedCurriculum {
  const curriculum: ParsedYear[] = parsed.years.map(y => {
    // Collect all subjects across this year's semesters for uniqueness
    const semesters: ParsedSemester[] = y.semesters.map(s => {
      const subjects = assignUniqueSlots(
        s.rows.map(r => ({
          code: r.code,
          name: r.name,
          credits: r.credits,
          is_elective: r.is_elective || undefined,
          prerequisite: null,
        }))
      );
      return {
        semester: s.sem,
        total_credits: subjects.reduce((a, b) => a + b.credits, 0),
        subjects,
      };
    });
    return { year: y.year, semesters };
  });

  return {
    id: crypto.randomUUID(),
    program_name: parsed.programName,
    program_code: parsed.programCode,
    faculty: parsed.faculty,
    total_credits_required: parsed.totalCredits,
    academic_session: parsed.session || new Date().getFullYear() + '/' + (new Date().getFullYear() + 1),
    curriculum,
    elective_pool: parsed.electivePool.map(r => ({
      code: r.code,
      name: r.name,
      credits: r.credits,
      is_elective: true,
      prerequisite: null,
    })),
    linked_subjects: linkedSubjects,
    uploaded_at: Date.now(),
    source_filename: sourceFilename,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function parsePelanPengajian(
  file: File,
  onProgress: (p: ParseProgress) => void,
): Promise<ParseResult> {
  const warnings: string[] = [];

  onProgress({ step: 'loading', message: 'Loading file...', progress: 5 });

  const isImage = file.type.startsWith('image/');
  let bestText = '';

  if (isImage) {
    onProgress({ step: 'running-ocr', message: 'Running OCR on image...', progress: 20 });
    bestText = await extractTextViaOCR(file, (pct) => {
      onProgress({ step: 'running-ocr', message: `OCR: ${pct}%`, progress: 20 + Math.round(pct * 0.5) });
    });
  } else {
    // PDF: try both paths
    onProgress({ step: 'extracting-text', message: 'Extracting text (Path A)...', progress: 15 });
    const pathAText = await extractTextFromPDF(file);

    onProgress({ step: 'running-ocr', message: 'Running OCR (Path B)...', progress: 30 });
    const pathBText = await extractTextViaOCR(file, (pct) => {
      onProgress({ step: 'running-ocr', message: `OCR: ${pct}%`, progress: 30 + Math.round(pct * 0.35) });
    });

    onProgress({ step: 'merging', message: 'Comparing extraction results...', progress: 70 });
    // Pick whichever has more useful content (more subject-looking lines)
    const countSubjectLines = (t: string) =>
      t.split('\n').filter(l => SUBJECT_ROW_RE.test(l.trim())).length;
    const aCount = countSubjectLines(pathAText);
    const bCount = countSubjectLines(pathBText);

    bestText = aCount >= bCount ? pathAText : pathBText;

    if (aCount === 0 && bCount === 0) {
      warnings.push('Could not detect any subject rows. Please review and edit the extracted data manually.');
    }
  }

  onProgress({ step: 'building-structure', message: 'Building curriculum structure...', progress: 80 });

  const parsed = parseTableText(bestText);
  const linkedSubjects = detectLinkedSubjects(bestText);

  if (parsed.years.length === 0) {
    warnings.push('No semester structure detected. You may need to add semesters manually.');
    // Create a fallback single-year structure
    parsed.years.push({ year: 1, semesters: [{ sem: 1, rows: [] }] });
  }

  const curriculum = buildCurriculum(parsed, linkedSubjects, file.name);

  onProgress({ step: 'done', message: 'Done!', progress: 100 });

  return { curriculum, warnings };
}
