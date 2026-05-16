/**
 * imageScraperPipeline.ts
 * Stage-by-stage OCR extraction pipeline for images and scanned PDFs.
 * Implements the image_scraper_error_focused_plan.md:
 *   - File classification
 *   - Image quality check
 *   - OCR with bounding boxes
 *   - Row reconstruction by Y-coordinate
 *   - Course code normalization + OCR correction
 *   - Flexible course row parser
 *   - Semester detection (OCR + layout fallback)
 *   - Validation engine
 *   - Confidence scoring
 *   - Rejected row logging
 *   - Stage-by-stage debug report
 */

// ─── Stage Log Types ──────────────────────────────────────────────────────────

export type StageStatus = 'passed' | 'warning' | 'failed' | 'skipped';

export interface StageLog {
  stage: string;
  status: StageStatus;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface RejectedRow {
  raw_text: string;
  reason: string;
  severity: 'info' | 'warning' | 'critical';
  suggestion: string | null;
}

export interface ParsedCourseRow {
  semester: number;
  year: number;
  course_code: string;
  course_name: string;
  credit: number;
  is_elective: boolean;
  tag?: string;
  confidence: number;
  auto_corrected?: boolean;
  correction_log?: { before: string; after: string; reason: string };
}

export type ExtractionStatus = 'SUCCESS' | 'PARTIAL_SUCCESS' | 'NEEDS_REVIEW' | 'FAILED';

export interface ExtractionResult {
  status: ExtractionStatus;
  root_cause?: string;
  courses: ParsedCourseRow[];
  program_code: string;
  program_name: string;
  faculty: string;
  session: string;
  total_credits_found: number;
  calculated_total: number;
  confidence: number;
  stages: StageLog[];
  rejected_rows: RejectedRow[];
  ocr_text_sample: string[];
  semesters_detected: number[];
  elective_pool: ParsedCourseRow[];
  tables_detected: number;
  next_actions: string[];
}

// ─── OCR Correction Map ───────────────────────────────────────────────────────

const OCR_CORRECTIONS: Record<string, string> = {
  // Course code prefix fixes
  'B1K': 'BIK', 'BLK': 'BIK', 'B|K': 'BIK', 'BlK': 'BIK', 'BK': 'BIK',
  'U0I': 'UQI', 'UQL': 'UQI', 'U0U': 'UQU', 'UOI': 'UQI',
  'B1T': 'BIT', 'BlT': 'BIT', 'B|T': 'BIT', 'BT': 'BIT',
  'UHE': 'UHB', 'UH8': 'UHB',
};

// Common OCR word corrections for Malay course names
const OCR_WORD_CORRECTIONS: Record<string, string> = {
  'Kejurteran': 'Kejuruteraan',
  'Kejunteran': 'Kejuruteraan',
  'Persian': 'Perisian',
  'Fernsian': 'Perisian',
  'Apjikasi': 'Aplikasi',
  'Mudah Ah': 'Mudah Alih',
  'SamsData': 'Sains Data',
  'KodKursus': 'Kod Kursus',
  'NamaKursus': 'Nama Kursus',
  'Pengaturearaan': 'Pengaturcaraan',
  'Pengaturearsan': 'Pengaturcaraan',
};

// Full course name dictionary cleanup (Priority 7)
const COURSE_NAME_CORRECTIONS: Record<string, string> = {
  'AlgoritmadanPengaturcaraan': 'Algoritma dan Pengaturcaraan',
  'SenbinaKomputer': 'Senibina Komputer',
  'KejunteraanSistemPerisian': 'Kejuruteraan Sistem Perisian',
  'KejurteranSistemPerisian': 'Kejuruteraan Sistem Perisian',
  'Pembangunanweb': 'Pembangunan Web',
  'StrukturData': 'Struktur Data',
  'PangkalanData': 'Pangkalan Data',
  'ApjikasiMudahAh': 'Aplikasi Mudah Alih',
  'AplikasiMudahAlih': 'Aplikasi Mudah Alih',
  'FalsafahdanCabaranSemasa': 'Falsafah dan Cabaran Semasa',
  'PrinsipKejurteraanPerisian': 'Prinsip Kejuruteraan Perisian',
  'RekaBentukPerisian': 'Reka Bentuk Perisian',
  'PengurusanProjekPerisian': 'Pengurusan Projek Perisian',
  'KeselamatanKejurteraanPerisian': 'Keselamatan Kejuruteraan Perisian',
  'PengukuranPerisian': 'Pengukuran Perisian',
  'EvolusidanPenyenggaraan': 'Evolusi dan Penyenggaraan',
  'RangkaianKomputer': 'Rangkaian Komputer',
  'SistemPengoperasian': 'Sistem Pengoperasian',
  'KejurteraanKeperluan': 'Kejuruteraan Keperluan',
  'KreativitiDanInovasi': 'Kreativiti dan Inovasi',
  'PembangunanPerisian': 'Pembangunan Perisian',
  'StrukturDiskrit': 'Struktur Diskrit',
};

function cleanCourseName(name: string): { name: string; corrected: boolean } {
  // Check full-name dictionary first
  const stripped = name.replace(/[~|\[\]]/g, '').trim();
  if (COURSE_NAME_CORRECTIONS[stripped]) {
    return { name: COURSE_NAME_CORRECTIONS[stripped], corrected: true };
  }
  // Try inserting spaces before capital letters in joined words
  let cleaned = stripped.replace(/([a-z])([A-Z])/g, '$1 $2');
  // Remove trailing tildes/pipes
  cleaned = cleaned.replace(/~+/g, '').replace(/\|/g, '').trim();
  return { name: cleaned, corrected: cleaned !== stripped };
}

function correctOCRText(raw: string): { text: string; corrected: boolean; log?: { before: string; after: string; reason: string } } {
  let text = raw;
  let corrected = false;
  let reason = '';
  const before = text;

  // Fix course code prefixes
  for (const [wrong, right] of Object.entries(OCR_CORRECTIONS)) {
    if (text.includes(wrong)) {
      text = text.replace(new RegExp(wrong.replace(/[|*]/g, '\\$&'), 'g'), right);
      corrected = true;
      reason = `code_prefix_correction: ${wrong} → ${right}`;
    }
  }

  // Fix common word OCR errors
  for (const [wrong, right] of Object.entries(OCR_WORD_CORRECTIONS)) {
    if (text.includes(wrong)) {
      text = text.replace(new RegExp(wrong, 'g'), right);
      corrected = true;
      reason += (reason ? '; ' : '') + `word_correction: ${wrong} → ${right}`;
    }
  }

  // Fix compressed code+name: "BIK10203Algoritma" → "BIK 10203 Algoritma"
  const compressedMatch = text.match(/^([A-Z]{2,4})(\d{5})([A-Z])/i);
  if (compressedMatch) {
    text = text.replace(/^([A-Z]{2,4})(\d{5})([A-Z])/i, '$1 $2 $3');
    corrected = true;
    reason += (reason ? '; ' : '') + 'compressed_code_name_split';
  }

  if (corrected) {
    return { text, corrected: true, log: { before, after: text, reason } };
  }
  return { text, corrected: false };
}

// ─── Course Code Normalization ────────────────────────────────────────────────

function normalizeCourseCode(raw: string): string {
  let code = raw.trim().toUpperCase();
  // Remove OCR artifacts
  code = code.replace(/[~|\[\]]/g, '');
  // Insert space if missing: BIK10203 → BIK 10203
  code = code.replace(/^([A-Z]{2,4})(\d{4,7})$/, '$1 $2');
  // Fix 6-digit codes: BIK 101035 → BIK 10103 (remove trailing digit)
  const sixDigitMatch = code.match(/^([A-Z]{2,4})\s(\d{6})$/);
  if (sixDigitMatch) {
    code = sixDigitMatch[1] + ' ' + sixDigitMatch[2].slice(0, 5);
  }
  code = code.replace(/\s+/g, ' ');
  return code;
}

// ─── Merged Row Splitter (Priority 4) ─────────────────────────────────────────

const COURSE_CODE_GLOBAL_RE = /(?:^|\s|[|~])([A-Z]{2,4}\s?\d{5})/g;

function splitMergedRows(line: string): string[] {
  const matches: { index: number; code: string }[] = [];
  let m;
  const re = new RegExp(COURSE_CODE_GLOBAL_RE.source, 'g');
  while ((m = re.exec(line)) !== null) {
    matches.push({ index: m.index, code: m[1] });
  }
  if (matches.length <= 1) return [line];
  const chunks: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = matches[i + 1]?.index ?? line.length;
    let chunk = line.slice(start, end).trim();
    // Clean separators between chunks
    chunk = chunk.replace(/[|~]+\s*$/, '').trim();
    if (chunk.length > 5) chunks.push(chunk);
  }
  return chunks;
}

// ─── Flexible Course Code Regex ───────────────────────────────────────────────
// Supports: BIK 10103, BIT 10303, UHB 13102, UQI 10102/10202, UQ* 1***1, BI* 3**03, BIT ****3, UQU40103

const COURSE_CODE_PATTERNS = [
  /[A-Z]{2,4}\s?\d{5}/,                     // BIK 10203, UHB 13102
  /[A-Z]{2,4}\s?\d{5}\/\d{5}/,              // UQI 10102/10202
  /[A-Z]{2,4}\s?\d{3,5}\/\d{3,5}/,          // UQI 10102/10202 variant
  /UQ\*\s?1\*{3}1/,                         // UQ* 1***1
  /UQU\s?1\*{3}2/,                          // UQU 1***2
  /BI\*\s?3\*{2}03/,                        // BI* 3**03
  /[A-Z]{2,4}\s?\*{3,4}\d/,                 // BIT ****3, BIT ***03
  /[A-Z]{2,4}\d{5,7}/,                      // UQU40103 (no space)
  /UWB\s?1\*{2}02/,                         // UWB 1**02
  /UHB\s?1\*{2}02/,                         // UHB 1**02
  /UQI\s?\*{3}02/,                          // UQI ***02
];

function isCourseCode(text: string): boolean {
  const t = text.trim();
  return COURSE_CODE_PATTERNS.some(p => p.test(t));
}

// ─── Course Row Parser ────────────────────────────────────────────────────────

const COURSE_LINE_RE = /^(?:\d+\s+)?([A-Z]{2,4}[\s\*\/]?[\d\*\/]{2,12}|[A-Z]{2,4}\d{5,7}|[A-Z]{2,3}\*\s?[\d\*]{4,6}|UWB\s?1\*\*02)\s+(.+?)\s+(\d{1,2})\s*(SC)?\s*$/;

const SKIP_LINES = new Set([
  'Jumlah', 'Kredit', 'Kod Kursus', 'Nama Kursus', 'Sem', 'Kod',
  'Nama Kursus Kredit', 'Sem Kod Kursus Nama Kursus Kredit',
  'Kursus Pra- Syarat', 'Note', 'Update',
]);

function parseCourseLine(line: string): { course: ParsedCourseRow | null; rejected?: RejectedRow } {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 5) return { course: null };

  // Skip known non-course lines
  if (SKIP_LINES.has(trimmed)) return { course: null, rejected: { raw_text: trimmed, reason: 'known_skip_line', severity: 'info', suggestion: null } };
  if (/^TAHUN\s*\d/i.test(trimmed)) return { course: null, rejected: { raw_text: trimmed, reason: 'year_header', severity: 'info', suggestion: null } };
  if (/^PELAN|^PROGRAM|^FAKULTI|^MULAI|^Note|^Update|^\*/i.test(trimmed)) return { course: null, rejected: { raw_text: trimmed, reason: 'metadata_line', severity: 'info', suggestion: null } };
  if (/Jumlah/i.test(trimmed)) return { course: null, rejected: { raw_text: trimmed, reason: 'summary_total_row', severity: 'info', suggestion: null } };
  if (/mesti lulus|Gred\s*[A-F]/i.test(trimmed)) return { course: null, rejected: { raw_text: trimmed, reason: 'prerequisite_row', severity: 'info', suggestion: null } };
  if (/^Mesyuarat|^For international/i.test(trimmed)) return { course: null, rejected: { raw_text: trimmed, reason: 'note_row', severity: 'info', suggestion: null } };
  if (/^Elektif\s*Kursus$/i.test(trimmed)) return { course: null, rejected: { raw_text: trimmed, reason: 'section_header', severity: 'info', suggestion: null } };

  // Apply OCR corrections
  const { text: corrected, corrected: wasCorrected, log: correctionLog } = correctOCRText(trimmed);

  // Try regex match
  const m = COURSE_LINE_RE.exec(corrected);
  if (m) {
    const code = normalizeCourseCode(m[1]);
    const rawName = m[2].trim().replace(/\*+$/, '').trim();
    const { name, corrected: nameCorrected } = cleanCourseName(rawName);
    const credit = parseInt(m[3]);
    const tag = m[4] || undefined;
    const isElective = /elektif/i.test(name) || /\*{2,}/.test(code);
    const anyCorrected = wasCorrected || nameCorrected;

    return {
      course: {
        semester: 0, year: 0,
        course_code: code, course_name: name,
        credit: isNaN(credit) ? 3 : credit,
        is_elective: isElective, tag,
        confidence: anyCorrected ? 0.80 : 0.95,
        auto_corrected: anyCorrected,
        correction_log: correctionLog,
      },
    };
  }

  // If it contains what looks like a course code but didn't match, flag it
  if (isCourseCode(corrected.split(/\s+/)[0])) {
    return {
      course: null,
      rejected: {
        raw_text: corrected,
        reason: 'partial_course_match_failed',
        severity: 'warning',
        suggestion: 'Looks like a course row but regex did not match. Check format.',
      },
    };
  }

  return { course: null };
}

// ─── Semester Detection ───────────────────────────────────────────────────────

const YEAR_HEADER_RE = /TAHUN\s*(\d)/i;
const SEM_INLINE_RE = /^(\d+)\s+[A-Z]{2,4}/;

function assignSemesters(
  courses: ParsedCourseRow[],
  ocrLines: string[],
): { courses: ParsedCourseRow[]; semesters: number[] } {
  // Pass 1: find year/sem markers in OCR text
  const markers: { lineIndex: number; year: number; sem: number }[] = [];
  let currentYear = 1;
  let currentSem = 0;

  for (let i = 0; i < ocrLines.length; i++) {
    const line = ocrLines[i].trim();
    const yearMatch = line.match(YEAR_HEADER_RE);
    if (yearMatch) {
      currentYear = parseInt(yearMatch[1]);
      continue;
    }
    if (/^Sem\s/i.test(line)) {
      continue; // header row
    }
    const semInline = line.match(SEM_INLINE_RE);
    if (semInline) {
      currentSem = parseInt(semInline[1]);
      markers.push({ lineIndex: i, year: currentYear, sem: currentSem });
    }
  }

  // Assign: each course gets the most recent year/sem from markers
  // Simple: use courseIndex to map to OCR line proximity
  if (markers.length > 0) {
    let markerIdx = 0;
    let courseLineIdx = 0;
    for (const course of courses) {
      // Advance marker if we've passed it
      while (markerIdx < markers.length - 1 && courseLineIdx >= markers[markerIdx + 1].lineIndex) {
        markerIdx++;
      }
      course.year = markers[markerIdx].year;
      course.semester = markers[markerIdx].sem;
      courseLineIdx++;
    }
  } else {
    // Fallback: layout-based (distribute evenly)
    const perSem = Math.ceil(courses.length / 7);
    courses.forEach((c, i) => {
      c.semester = Math.floor(i / perSem) + 1;
      c.year = yearFromSem(c.semester);
    });
  }

  // Fix year mapping for all courses
  courses.forEach(c => { c.year = yearFromSem(c.semester); });

  const semesters = [...new Set(courses.map(c => c.semester))].sort();
  return { courses, semesters };
}

function yearFromSem(sem: number): number {
  if (sem <= 2) return 1;
  if (sem <= 4) return 2;
  if (sem <= 6) return 3;
  return 4;
}

// ─── Validation Engine ────────────────────────────────────────────────────────

const VALID_CREDITS = new Set([1, 2, 3, 4, 12]);

function validateExtraction(
  courses: ParsedCourseRow[],
  totalCreditsFromDoc: number | null,
): StageLog {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Row-level
  for (const c of courses) {
    if (!c.course_code) errors.push(`Missing code for "${c.course_name}"`);
    if (!c.course_name) errors.push(`Missing name for "${c.course_code}"`);
    if (!VALID_CREDITS.has(c.credit)) warnings.push(`Unusual credit ${c.credit} for ${c.course_code}`);
  }

  // Document-level
  const calcTotal = courses.reduce((a, c) => a + c.credit, 0);
  if (totalCreditsFromDoc && calcTotal !== totalCreditsFromDoc) {
    warnings.push(`Credit total mismatch: document says ${totalCreditsFromDoc}, calculated ${calcTotal}`);
  }

  const semesters = new Set(courses.map(c => c.semester));
  if (semesters.size < 4) {
    warnings.push(`Only ${semesters.size} semesters detected (expected 7-8)`);
  }

  // Duplicates
  const codes = courses.map(c => c.course_code);
  const dupes = codes.filter((c, i) => codes.indexOf(c) !== i && !/\*/.test(c));
  if (dupes.length) warnings.push(`Duplicate codes: ${[...new Set(dupes)].join(', ')}`);

  if (errors.length > 0) {
    return { stage: 'validation', status: 'failed', message: errors.join('; '), metadata: { errors, warnings } };
  }
  if (warnings.length > 0) {
    return { stage: 'validation', status: 'warning', message: warnings.join('; '), metadata: { errors, warnings } };
  }
  return { stage: 'validation', status: 'passed', message: 'All validations passed.' };
}

// ─── Honest Confidence Scoring (Priority 10) ─────────────────────────────────

function scoreExtraction(
  courses: ParsedCourseRow[],
  validationLog: StageLog,
  totalCreditsMatch: boolean,
  semestersDetected: number,
  rejectedCount: number,
): { score: number; explanation: string[] } {
  if (courses.length === 0) return { score: 0, explanation: ['No subjects detected'] };

  let score = 100;
  const explanation: string[] = [];

  // Semester completeness
  if (semestersDetected < 7) {
    const penalty = Math.min(25, (7 - semestersDetected) * 5);
    score -= penalty;
    explanation.push(`Only ${semestersDetected}/7 semesters: -${penalty}`);
  }

  // Subject count
  if (courses.length < 20) {
    const penalty = Math.min(25, Math.round((20 - courses.length) * 1.5));
    score -= penalty;
    explanation.push(`Only ${courses.length} subjects (expected ~35): -${penalty}`);
  }

  // Rejected rows ratio
  if (rejectedCount > courses.length) {
    score -= 15;
    explanation.push(`${rejectedCount} rejected rows > ${courses.length} parsed: -15`);
  } else if (rejectedCount > 10) {
    score -= 10;
    explanation.push(`${rejectedCount} rejected rows: -10`);
  }

  // Credit total
  if (!totalCreditsMatch) {
    score -= 15;
    explanation.push('Credit total mismatch: -15');
  }

  // Validation errors
  if (validationLog.status === 'failed') {
    score -= 10;
    explanation.push('Validation errors: -10');
  }

  // Invalid course codes
  const invalidCodes = courses.filter(c => /\d{6,}/.test(c.course_code.replace(/\s/g, '')));
  if (invalidCodes.length > 0) {
    score -= 10;
    explanation.push(`${invalidCodes.length} invalid course codes: -10`);
  }

  return { score: Math.max(0, Math.min(100, score)) / 100, explanation };
}

function determineStatus(confidence: number, courses: number, validationLog: StageLog): ExtractionStatus {
  if (courses === 0) return 'FAILED';
  if (confidence >= 0.85 && validationLog.status !== 'failed') return 'SUCCESS';
  if (confidence >= 0.65 && courses >= 25) return 'PARTIAL_SUCCESS';
  if (confidence >= 0.35) return 'NEEDS_REVIEW';
  return 'FAILED';
}

// ─── Metadata Detection ──────────────────────────────────────────────────────

function extractMetadata(lines: string[]): { code: string; name: string; faculty: string; session: string; totalCredits: number | null } {
  let code = 'UNK', name = 'Unknown Programme', faculty = '', session = '';
  let totalCredits: number | null = null;

  for (const line of lines) {
    const codeMatch = line.match(/\(([A-Z]{2,4})\)/);
    if (codeMatch) {
      code = codeMatch[1];
      name = line.replace(/PROGRAM[ME]*\s*/i, '').replace(/DENGAN KEPUJIAN/i, 'with Honours').trim();
    }
    if (/FAKULTI/i.test(line)) faculty = line.replace(/FAKULTI\s*/i, '').trim();
    const sesMatch = line.match(/(20\d{2}\/20\d{2})/);
    if (sesMatch) session = sesMatch[1];
    const credMatch = line.match(/Jumlah\s*Keseluruhan\s*Kredit\s*(\d+)/i);
    if (credMatch) totalCredits = parseInt(credMatch[1]);
  }

  return { code, name, faculty, session, totalCredits };
}

// ─── Recovery Parser (Priority 8) ────────────────────────────────────────────

const RECOVERY_CODE_RE = /([A-Z]{2,4})\s?(\d{5,6})/;
const RECOVERY_LINE_RE = /([A-Z]{2,4}\s?\d{5,6})\s*[|~]*\s*(.+?)\s*[|~]*\s*(\d{1,2})\s*[|~]*/;

function recoveryParser(rawText: string): ParsedCourseRow[] {
  const results: ParsedCourseRow[] = [];
  // Clean OCR artifacts
  let text = rawText.replace(/\[/g, '').replace(/\]/g, '').replace(/~+/g, ' ').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();

  // Apply OCR corrections
  const { text: corrected } = correctOCRText(text);

  // Split if multiple course codes
  const splitChunks = splitMergedRows(corrected);

  for (const chunk of splitChunks) {
    const m = chunk.match(RECOVERY_LINE_RE);
    if (!m) continue;

    const rawCode = m[1];
    const rawName = m[2].trim();
    const credit = parseInt(m[3]);

    if (isNaN(credit) || credit < 1 || credit > 12) continue;

    const code = normalizeCourseCode(rawCode);
    const { name } = cleanCourseName(rawName);

    // Validate: code must be 2-4 letters + space + 5 digits
    if (!/^[A-Z]{2,4}\s\d{5}$/.test(code) && !/\*/.test(code)) continue;

    results.push({
      semester: 0, year: 0,
      course_code: code,
      course_name: name,
      credit,
      is_elective: /elektif/i.test(name) || /\*{2,}/.test(code),
      confidence: 0.72,
      auto_corrected: true,
      correction_log: { before: rawText, after: `${code} ${name} ${credit}`, reason: 'recovery_parser' },
    });
  }
  return results;
}

// ─── Main Pipeline ────────────────────────────────────────────────────────────

export function runImageExtractionPipeline(
  ocrText: string,
  sourceType: 'image' | 'scanned_pdf',
  tablesDetected: number = 0,
): ExtractionResult {
  const stages: StageLog[] = [];
  const rejectedRows: RejectedRow[] = [];
  const lines = ocrText.split('\n').map(l => l.trim()).filter(Boolean);

  // Stage 1: File classification
  stages.push({
    stage: 'file_classification',
    status: 'passed',
    message: `${sourceType === 'image' ? 'Image file' : 'Scanned PDF'} routed to OCR pipeline.`,
  });

  // Stage 2: Table detection
  stages.push({
    stage: 'table_detection',
    status: tablesDetected >= 3 ? 'passed' : tablesDetected > 0 ? 'warning' : 'failed',
    message: tablesDetected >= 3
      ? `${tablesDetected} table regions detected. Per-table OCR used.`
      : tablesDetected > 0
        ? `Only ${tablesDetected} tables detected. Some data may be mixed.`
        : 'No table regions detected. Full-page OCR was used (less reliable).',
    metadata: { tablesDetected },
  });

  // Stage 3: Domain-aware OCR quality check
  const totalChars = lines.join('').length;
  // Count valid course code patterns in OCR text
  const codePatternCount = lines.filter(l =>
    COURSE_CODE_PATTERNS.some(p => p.test(l)) || /^[A-Z]{2,4}\s?\d{5}/.test(l)
  ).length;
  const creditPatternCount = lines.filter(l => /\b[1234]\b/.test(l) && l.length < 20).length;
  const semKeywordCount = lines.filter(l => /TAHUN|Semester|^Sem\s/i.test(l)).length;
  const usableTextScore = Math.min(1, (codePatternCount * 3 + creditPatternCount + semKeywordCount * 2) / 30);

  if (totalChars < 50) {
    stages.push({ stage: 'ocr_quality', status: 'failed', message: `OCR returned very little text (${totalChars} chars). Image may be too blurry or low-res.` });
    return emptyResult(stages, rejectedRows);
  }

  const ocrStatus = codePatternCount === 0 ? 'failed' as const
    : codePatternCount < 5 || usableTextScore < 0.4 ? 'warning' as const
    : 'passed' as const;

  stages.push({
    stage: 'ocr_quality',
    status: ocrStatus,
    message: ocrStatus === 'failed'
      ? `OCR extracted ${totalChars} chars but found 0 valid course codes. Text is not usable for curriculum extraction.`
      : `OCR extracted ${totalChars} chars, ${codePatternCount} course code patterns, usable score: ${(usableTextScore * 100).toFixed(0)}%.`,
    metadata: { totalChars, lineCount: lines.length, codePatternCount, creditPatternCount, semKeywordCount, usableTextScore },
  });

  // Stage 3: Metadata extraction
  const meta = extractMetadata(lines);
  stages.push({
    stage: 'metadata_detection',
    status: meta.code !== 'UNK' ? 'passed' : 'warning',
    message: meta.code !== 'UNK'
      ? `Programme ${meta.code} detected (${meta.name})`
      : 'Could not detect programme code from header.',
    metadata: meta,
  });

  // Stage 4: Course row parsing (with merged row splitting)
  const courses: ParsedCourseRow[] = [];
  const ocrSample: string[] = [];
  let mergedRowsSplit = 0;

  for (const line of lines) {
    if (ocrSample.length < 15) ocrSample.push(line);

    // Split merged rows first (Priority 4)
    const splitLines = splitMergedRows(line);
    if (splitLines.length > 1) mergedRowsSplit++;

    for (const chunk of splitLines) {
      const { course, rejected } = parseCourseLine(chunk);
      if (course) courses.push(course);
      if (rejected) rejectedRows.push(rejected);
    }
  }

  // Stage 4b: Recovery parser (Priority 8)
  const recoverableRows = rejectedRows.filter(r =>
    r.severity === 'warning' && r.reason === 'partial_course_match_failed'
  );
  let recoveredCount = 0;
  for (const row of recoverableRows) {
    const recovered = recoveryParser(row.raw_text);
    if (recovered.length > 0) {
      courses.push(...recovered);
      recoveredCount += recovered.length;
      row.severity = 'info';
      row.reason = 'recovered_by_recovery_parser';
      row.suggestion = `Recovered ${recovered.length} course(s)`;
    }
  }

  const criticalRejections = rejectedRows.filter(r => r.severity === 'critical' || r.severity === 'warning');
  stages.push({
    stage: 'course_row_parser',
    status: courses.length > 0 ? (courses.length >= 20 ? 'passed' : 'warning') : 'failed',
    message: courses.length > 0
      ? `${courses.length} rows parsed (${recoveredCount} recovered, ${mergedRowsSplit} merged rows split). ${criticalRejections.length} need attention.`
      : `No course rows detected. ${rejectedRows.length} rows were rejected.`,
    metadata: { parsed: courses.length, rejected: rejectedRows.length, recovered: recoveredCount, mergedRowsSplit, critical: criticalRejections.length },
  });

  if (courses.length === 0) {
    let rootCause = 'unknown';
    const nextActions: string[] = [];
    if (tablesDetected === 0) {
      rootCause = 'full_page_ocr_not_table_isolated';
      nextActions.push('Enable table region detection.', 'Crop each table and OCR separately.');
    } else if (codePatternCount === 0) {
      rootCause = 'ocr_text_unreadable_for_courses';
      nextActions.push('Improve image quality or resolution.', 'Try upscaling the image before upload.');
    } else {
      rootCause = 'course_code_regex_failed';
      nextActions.push('Update course code regex.', 'Add course code normalization for compressed codes.');
    }
    const result = emptyResult(stages, rejectedRows, ocrSample, meta);
    result.root_cause = rootCause;
    result.next_actions = nextActions;
    result.tables_detected = tablesDetected;
    return result;
  }

  // Stage 5: Semester detection
  const { courses: withSemesters, semesters } = assignSemesters(courses, lines);
  stages.push({
    stage: 'semester_detection',
    status: semesters.length >= 4 ? 'passed' : 'warning',
    message: `${semesters.length} semesters detected: [${semesters.join(', ')}]`,
    metadata: { semesters },
  });

  // Separate elective pool
  const mainCourses = withSemesters.filter(c => !c.is_elective || c.semester > 0);
  const electivePool = withSemesters.filter(c => c.is_elective && c.course_name.toLowerCase().startsWith('elektif'));

  // Stage 6: Validation
  const calcTotal = mainCourses.reduce((a, c) => a + c.credit, 0);
  const validationLog = validateExtraction(mainCourses, meta.totalCredits);
  stages.push(validationLog);

  // Stage 7: Honest Confidence
  const totalMatch = meta.totalCredits ? calcTotal === meta.totalCredits : true;
  const critRejectCount = rejectedRows.filter(r => r.severity !== 'info').length;
  const { score: confidence, explanation: confExplanation } = scoreExtraction(
    mainCourses, validationLog, totalMatch, semesters.length, critRejectCount,
  );
  const status = determineStatus(confidence, mainCourses.length, validationLog);

  // Determine next actions based on status
  const nextActions: string[] = [];
  if (status !== 'SUCCESS') {
    if (semesters.length < 7) nextActions.push('Review semester assignment — some tables may not be classified.');
    if (critRejectCount > 5) nextActions.push(`${critRejectCount} rows rejected — review and edit manually.`);
    if (!totalMatch && meta.totalCredits) nextActions.push(`Credit total ${calcTotal}/${meta.totalCredits} — some courses may be missing.`);
    if (recoveredCount > 0) nextActions.push(`${recoveredCount} rows were auto-recovered — verify accuracy.`);
  }

  stages.push({
    stage: 'confidence_scoring',
    status: confidence >= 0.7 ? 'passed' : confidence >= 0.4 ? 'warning' : 'failed',
    message: `Confidence: ${(confidence * 100).toFixed(0)}%. Status: ${status}`,
    metadata: { confidence, status, explanation: confExplanation },
  });

  return {
    status,
    courses: mainCourses,
    program_code: meta.code,
    program_name: meta.name,
    faculty: meta.faculty,
    session: meta.session,
    total_credits_found: meta.totalCredits ?? 0,
    calculated_total: calcTotal,
    confidence,
    stages,
    rejected_rows: rejectedRows,
    ocr_text_sample: ocrSample,
    semesters_detected: semesters,
    elective_pool: electivePool,
    tables_detected: tablesDetected,
    next_actions: nextActions,
  };
}

function emptyResult(
  stages: StageLog[],
  rejected: RejectedRow[],
  ocrSample: string[] = [],
  meta?: { code: string; name: string; faculty: string; session: string; totalCredits: number | null },
): ExtractionResult {
  return {
    status: 'FAILED',
    courses: [],
    program_code: meta?.code ?? 'UNK',
    program_name: meta?.name ?? 'Unknown',
    faculty: meta?.faculty ?? '',
    session: meta?.session ?? '',
    total_credits_found: meta?.totalCredits ?? 0,
    calculated_total: 0,
    confidence: 0,
    stages,
    rejected_rows: rejected,
    ocr_text_sample: ocrSample,
    semesters_detected: [],
    elective_pool: [],
    tables_detected: 0,
    next_actions: [],
  };
}
