/**
 * TDD Tests for pelanParser.ts
 * These tests cover all 7 confirmed root causes from diagnosis.
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';
import {
  extractLinesFromItems,
  detectColumns,
  parseSubjectLine,
  parseTableLines,
  detectProgramMetadata,
} from '@/lib/pelanParser';

// ─── Fixture data (real pdfjs item shapes) ───────────────────────────────────

/** Simulates pdfjs TextItem format */
function item(str: string, x: number, y: number, w = 50): any {
  return { str, transform: [1, 0, 0, 1, x, y], width: w, height: 10, hasEOL: false };
}

// ─── T-01 & T-02: Line reconstruction from Y-coordinates ─────────────────────

describe('extractLinesFromItems', () => {
  it('T-01: groups items on same Y into one line', () => {
    const items = [
      item('BIT', 50, 100),
      item('11203', 75, 100),
      item('Prinsip TM', 150, 100),
      item('3', 450, 100),
    ];
    const lines = extractLinesFromItems(items);
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toContain('BIT');
    expect(lines[0].text).toContain('11203');
  });

  it('T-02: sorts items left-to-right by X within same line', () => {
    const items = [
      item('3', 450, 100),       // credit (rightmost)
      item('BIT 11203', 50, 100),  // code (leftmost)
      item('Prinsip TM', 150, 100), // name (middle)
    ];
    const lines = extractLinesFromItems(items);
    expect(lines[0].text).toMatch(/BIT 11203.*Prinsip TM.*3/);
  });

  it('T-03: separates items on different Y into different lines', () => {
    const items = [
      item('UHB 13102', 50, 200),
      item('English for General Communication', 150, 200),
      item('2', 450, 200),
      item('UQ* 1***1', 50, 185),
      item('Ko-Kurikulum I', 150, 185),
      item('1', 450, 185),
    ];
    const lines = extractLinesFromItems(items);
    expect(lines).toHaveLength(2);
  });

  it('T-04: handles credit appearing on a separate Y from name (split credit)', () => {
    // In BIT PDFs, credit renders slightly below the name
    const items = [
      item('UQI 10102', 50, 200),
      item('Pengajian Islam*', 150, 200),
      item('2', 450, 192), // credit at slightly different Y
    ];
    const lines = extractLinesFromItems(items, { yTolerance: 15 });
    // Should merge into 1 line because Y difference < tolerance
    expect(lines).toHaveLength(1);
    expect(lines[0].text).toMatch(/UQI 10102.*2/);
  });
});

// ─── T-03: Column detection ───────────────────────────────────────────────────

describe('detectColumns', () => {
  it('T-05: splits a 3-column layout into separate column groups', () => {
    const lines = [
      // Col 1: x ~50
      { text: 'UHB 13102  English  2', x: 50, y: 200 },
      { text: 'BIT 11203  Prinsip  3', x: 50, y: 185 },
      // Col 2: x ~350
      { text: 'UQ* 1***1  Ko-Kuri  1', x: 350, y: 200 },
      { text: 'BIT 10303  Pengatur  3', x: 350, y: 185 },
      // Col 3: x ~650
      { text: 'BIT 21303  Interaksi  3', x: 650, y: 200 },
    ];
    const cols = detectColumns(lines);
    expect(cols.length).toBeGreaterThanOrEqual(2);
    // Each column's lines should not mix X origins significantly
    expect(cols[0].every(l => l.x < 300)).toBe(true);
  });

  it('T-06: returns single column when layout is single-column', () => {
    const lines = [
      { text: 'UHB 13102  English  2', x: 50, y: 200 },
      { text: 'BIT 11203  Prinsip  3', x: 50, y: 185 },
    ];
    const cols = detectColumns(lines);
    expect(cols.length).toBe(1);
  });
});

// ─── T-04 to T-06: Subject line parsing ──────────────────────────────────────

describe('parseSubjectLine', () => {
  it('T-07: parses standard "code  name  credit" line', () => {
    const result = parseSubjectLine('BIT 11203  Prinsip Teknologi Maklumat  3');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('BIT 11203');
    expect(result!.name).toBe('Prinsip Teknologi Maklumat');
    expect(result!.credits).toBe(3);
  });

  it('T-08: strips leading semester number prefix', () => {
    const result = parseSubjectLine('1 BIT 11203  Prinsip Teknologi Maklumat  3');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('BIT 11203');
  });

  it('T-09: handles wildcard codes like "BIT ****3"', () => {
    const result = parseSubjectLine('BIT ****3  Elektif I  3');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('BIT ****3');
    expect(result!.is_elective).toBe(true);
  });

  it('T-10: handles codes without space like "BIT30502"', () => {
    const result = parseSubjectLine('BIT30502  Perancangan Sumber Enterprise  2');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('BIT30502');
    expect(result!.credits).toBe(2);
  });

  it('T-11: handles wildcard star codes like "UQ* 1***1"', () => {
    const result = parseSubjectLine('UQ* 1***1  Ko-Kurikulum I  1');
    expect(result).not.toBeNull();
    expect(result!.code).toBe('UQ* 1***1');
  });

  it('T-12: returns null for non-subject lines', () => {
    expect(parseSubjectLine('Jumlah  20')).toBeNull();
    expect(parseSubjectLine('TAHUN 1')).toBeNull();
    expect(parseSubjectLine('Sem Kod Kursus Nama Kursus Kredit')).toBeNull();
    expect(parseSubjectLine('')).toBeNull();
  });

  it('T-13: marks elective subjects correctly', () => {
    const r1 = parseSubjectLine('BIT ****3  Elektif III  3');
    expect(r1!.is_elective).toBe(true);

    const r2 = parseSubjectLine('BIT 11203  Prinsip Teknologi Maklumat  3');
    expect(r2!.is_elective).toBe(false);
  });

  it('T-14: detects trailing asterisks in name (prerequisite marker)', () => {
    const result = parseSubjectLine('BIT 34204  Projek Sarjana Muda II*  4');
    expect(result).not.toBeNull();
    expect(result!.credits).toBe(4);
    // asterisk should not corrupt credit parsing
  });
});

// ─── T-07 to T-08: Full table parse ──────────────────────────────────────────

describe('parseTableLines', () => {
  // Minimal BIT-like flat line set
  const sampleLines = [
    { text: 'PELAN PENGAJIAN SEPENUH MASA PELAJAR TEMPATAN', x: 50, y: 900 },
    { text: 'PROGRAM SARJANA MUDA TEKNOLOGI MAKLUMAT DENGAN KEPUJIAN (BIT)', x: 50, y: 885 },
    { text: 'FAKULTI SAINS KOMPUTER DAN TEKNOLOGI MAKLUMAT, UTHM', x: 50, y: 870 },
    { text: 'MULAI SEMESTER 1 SESI AKADEMIK 2025/2026', x: 50, y: 855 },
    { text: 'TAHUN 1', x: 50, y: 820 },
    { text: 'UHB 13102  English for General Communication  2', x: 50, y: 780 },
    { text: '1  UQ* 1***1  Ko-Kurikulum I  1', x: 50, y: 765 },
    { text: 'UQI 10102  Pengajian Islam  2', x: 50, y: 750 },
    { text: 'BIT 11203  Prinsip Teknologi Maklumat  3', x: 50, y: 735 },
    { text: 'BIT ****3  Elektif I  3', x: 50, y: 720 },
    { text: 'TAHUN 2', x: 50, y: 680 },
    { text: 'BIT 20803  Sistem Pangkalan Data  3', x: 50, y: 640 },
  ];

  it('T-15: extracts programme name and code from header', () => {
    const result = parseTableLines(sampleLines);
    expect(result.programCode).toBe('BIT');
    expect(result.programName).toContain('Teknologi Maklumat');
    expect(result.session).toBe('2025/2026');
  });

  it('T-16: detects multiple years', () => {
    const result = parseTableLines(sampleLines);
    expect(result.years.length).toBeGreaterThanOrEqual(2);
  });

  it('T-17: extracts subjects with correct credits', () => {
    const result = parseTableLines(sampleLines);
    const allSubjects = result.years.flatMap(y => y.semesters.flatMap(s => s.rows));
    expect(allSubjects.length).toBeGreaterThan(0);
    const english = allSubjects.find(s => s.code === 'UHB 13102');
    expect(english).toBeDefined();
    expect(english!.credits).toBe(2);
  });

  it('T-18: marks elective slots correctly', () => {
    const result = parseTableLines(sampleLines);
    const allSubjects = result.years.flatMap(y => y.semesters.flatMap(s => s.rows));
    const elective = allSubjects.find(s => s.code === 'BIT ****3');
    expect(elective?.is_elective).toBe(true);
  });
});

// ─── T-09: Metadata extraction ────────────────────────────────────────────────

describe('detectProgramMetadata', () => {
  it('T-19: extracts BIT programme code', () => {
    const lines = [
      'PROGRAM SARJANA MUDA TEKNOLOGI MAKLUMAT DENGAN KEPUJIAN (BIT)',
      'FAKULTI SAINS KOMPUTER DAN TEKNOLOGI MAKLUMAT',
      'MULAI SEMESTER 1 SESI AKADEMIK 2025/2026',
    ];
    const meta = detectProgramMetadata(lines);
    expect(meta.programCode).toBe('BIT');
    expect(meta.session).toBe('2025/2026');
  });

  it('T-20: extracts BIK programme code', () => {
    const lines = [
      'PROGRAM SARJANA MUDA KEJURUTERAAN PERISIAN DENGAN KEPUJIAN (BIK)',
      'FAKULTI SAINS KOMPUTER DAN TEKNOLOGI MAKLUMAT',
      'MULAI SEMESTER 1 SESI AKADEMIK 2025/2026',
    ];
    const meta = detectProgramMetadata(lines);
    expect(meta.programCode).toBe('BIK');
  });

  it('T-21: detects total credits from "Jumlah Keseluruhan Kredit 120"', () => {
    const lines = ['Jumlah Keseluruhan Kredit 120'];
    const meta = detectProgramMetadata(lines);
    expect(meta.totalCredits).toBe(120);
  });

  it('T-22: falls back to 120 credits if not detected', () => {
    const meta = detectProgramMetadata(['TAHUN 1']);
    expect(meta.totalCredits).toBe(120);
  });
});
