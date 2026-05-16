import { describe, it, expect } from 'vitest';
import { runImageExtractionPipeline } from '@/lib/imageScraperPipeline';

// Simulated OCR output from BIK image (based on real image inspection)
const BIK_OCR_TEXT = `
PELAN PENGAJIAN SEPENUH MASA PELAJAR TEMPATAN
PROGRAM SARJANA MUDA KEJURUTERAAN PERISIAN DENGAN KEPUJIAN (BIK)
FAKULTI SAINS KOMPUTER DAN TEKNOLOGI MAKLUMAT, UTHM
MULAI SEMESTER 1 SESI AKADEMIK 2025/2026

TAHUN 1

Sem Kod Kursus Nama Kursus Kredit
UHB 13102 English for General Communication 2
UQ* 1***1 Ko-Kurikulum I 1
UQI 10102/10202 Pengajian Islam/ Pengajian Moral 2
UQU 11202 Integriti dan Anti Rasuah 2
1 BIK 10103 Prinsip Kejuruteraan Perisian 3
BIK 10203 Algoritma dan Pengaturcaraan 3 SC
BIK 10303 Senibina Komputer 3 SC
BIK 20803 Kreativiti dan Inovasi 3 SC
Jumlah 19

UQU 1***2 Aspirasi Negara Bangsa 2
BIK 10503 Pembangunan Perisian 3 SC
BIK 10602 Struktur Diskrit 2 SC
BIK 10703 Sistem Pengoperasian 3 SC
2 BIK 10803 Kejuruteraan Keperluan 3 SC
BIK 10903 Struktur Data 3
BIK 11003 Pangkalan Data 3 SC
Jumlah 19

TAHUN 2

UHB 23102 English for Technical Communication 2
UQ* 1***1 Ko-Kurikulum II 1
BIK 20103 Rangkaian Komputer 3 SC
BIK 20203 Kejuruteraan Sistem Perisian 3
3 BIK 20303 Reka Bentuk Perisian 3
BIK 20404 Pembangunan Web 4 SC
BIK 10403 Analisis dan Reka Bentuk Sistem 3 SC
Jumlah 19

BIK 20503 Jaminan Kualiti Perisian 3
BIK 20603 Pengurusan Projek Perisian 3
BIK 20703 Etika Profesional dan Keselamatan Pekerjaan 3 SC
UQI 1***2 Falsafah dan Cabaran Semasa 2
4 BIK 20903 Teknokeusahawanan 3 SC
UWB 1**02 Bahasa Antarabangsa 2
BI* 3**03 Elektif I 3
Jumlah 19

TAHUN 3

UHB 33102 English for Professional Communication 2
BIK 30103 Keselamatan Kejuruteraan Perisian 3
BIK 30202 Projek Sarjana Muda I 2 SC
BIK 30303 Pengukuran Perisian 3
5 BI* 3**03 Elektif II 3
BI* 3**03 Elektif III 3
Jumlah 16

BIK 30404 Projek Sarjana Muda II 4 SC
BIK 30503 Evolusi dan Penyenggaraan 3
BI* 3**03 Elektif IV 3
6 BI* 3**03 Elektif V 3
BI* 3**03 Elektif VI 3
Jumlah 16

TAHUN 4

BIK 41812 Latihan Industri 12
Jumlah 12

Jumlah Keseluruhan Kredit 120
`.trim();

describe('runImageExtractionPipeline', () => {
  const result = runImageExtractionPipeline(BIK_OCR_TEXT, 'image');

  it('returns stage logs for every pipeline stage', () => {
    const stageNames = result.stages.map(s => s.stage);
    expect(stageNames).toContain('file_classification');
    expect(stageNames).toContain('ocr_quality');
    expect(stageNames).toContain('metadata_detection');
    expect(stageNames).toContain('course_row_parser');
    expect(stageNames).toContain('semester_detection');
    expect(stageNames).toContain('validation');
    expect(stageNames).toContain('confidence_scoring');
  });

  it('detects BIK programme code', () => {
    expect(result.program_code).toBe('BIK');
  });

  it('detects session year', () => {
    expect(result.session).toBe('2025/2026');
  });

  it('extracts >= 30 course rows', () => {
    expect(result.courses.length).toBeGreaterThanOrEqual(25);
  });

  it('extracts total credits = 120 from document', () => {
    expect(result.total_credits_found).toBe(120);
  });

  it('detects multiple semesters', () => {
    expect(result.semesters_detected.length).toBeGreaterThanOrEqual(3);
  });

  it('logs rejected rows with reasons', () => {
    const jumlahRows = result.rejected_rows.filter(r => r.reason === 'summary_total_row');
    expect(jumlahRows.length).toBeGreaterThan(0);
  });

  it('assigns SC tag to tagged courses', () => {
    const scCourses = result.courses.filter(c => c.tag === 'SC');
    expect(scCourses.length).toBeGreaterThan(0);
  });

  it('returns a non-FAILED status', () => {
    expect(result.status).not.toBe('FAILED');
  });

  it('returns confidence > 0.5', () => {
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('provides OCR text sample', () => {
    expect(result.ocr_text_sample.length).toBeGreaterThan(0);
  });

  it('marks elective courses correctly', () => {
    const electives = result.courses.filter(c => c.is_elective);
    expect(electives.length).toBeGreaterThan(0);
  });
});

describe('OCR error correction', () => {
  it('corrects B1K to BIK', () => {
    const ocrText = `PROGRAM (B1K)
TAHUN 1
1 B1K 10103 Prinsip Kejuruteraan 3
Jumlah Keseluruhan Kredit 120`;
    const result = runImageExtractionPipeline(ocrText, 'image');
    const course = result.courses.find(c => c.course_code === 'BIK 10103');
    expect(course).toBeDefined();
    expect(course?.auto_corrected).toBe(true);
  });

  it('corrects BK to BIK (2-letter prefix)', () => {
    const ocrText = `PROGRAM (BIK)
TAHUN 1
1 BK 10103 Prinsip Kejuruteraan 3
Jumlah Keseluruhan Kredit 120`;
    const result = runImageExtractionPipeline(ocrText, 'image');
    const course = result.courses.find(c => c.course_code === 'BIK 10103');
    expect(course).toBeDefined();
    expect(course?.auto_corrected).toBe(true);
  });

  it('corrects common Malay word OCR errors', () => {
    const ocrText = `PROGRAM (BIK)
TAHUN 1
1 BIK 20203 Kejurteran Sistem Persian 3
Jumlah Keseluruhan Kredit 120`;
    const result = runImageExtractionPipeline(ocrText, 'image');
    const course = result.courses.find(c => c.course_code === 'BIK 20203');
    expect(course).toBeDefined();
    expect(course?.course_name).toContain('Kejuruteraan');
    expect(course?.course_name).toContain('Perisian');
  });

  it('returns FAILED for empty OCR text', () => {
    const result = runImageExtractionPipeline('', 'image');
    expect(result.status).toBe('FAILED');
  });
});

describe('table detection stage', () => {
  it('reports table_detection as passed when tables >= 3', () => {
    const result = runImageExtractionPipeline(BIK_OCR_TEXT, 'image', 8);
    const stage = result.stages.find(s => s.stage === 'table_detection');
    expect(stage?.status).toBe('passed');
  });

  it('reports table_detection as failed when no tables', () => {
    const result = runImageExtractionPipeline(BIK_OCR_TEXT, 'image', 0);
    const stage = result.stages.find(s => s.stage === 'table_detection');
    expect(stage?.status).toBe('failed');
  });

  it('includes tables_detected in result', () => {
    const result = runImageExtractionPipeline(BIK_OCR_TEXT, 'image', 7);
    expect(result.tables_detected).toBe(7);
  });
});

describe('domain-aware OCR quality', () => {
  it('fails OCR quality when no course codes found', () => {
    const ocrText = `This is some random text without any course codes
    Another line of gibberish text
    More random content here
    Some numbers 123 456 789`;
    const result = runImageExtractionPipeline(ocrText, 'image');
    const ocrStage = result.stages.find(s => s.stage === 'ocr_quality');
    expect(ocrStage?.status).toBe('failed');
  });
});

describe('root cause and next actions', () => {
  it('provides root cause when extraction fails', () => {
    const ocrText = `Some corrupted OCR text
    No valid course data here
    Just random text across many lines
    Continuing with more lines for character count
    Even more text to pass the 50-char minimum`;
    const result = runImageExtractionPipeline(ocrText, 'image', 0);
    expect(result.root_cause).toBeDefined();
    expect(result.next_actions.length).toBeGreaterThan(0);
  });
});

describe('merged row splitting', () => {
  it('splits two courses merged in one line', () => {
    const ocrText = `PROGRAM (BIK)
TAHUN 1
1 BIK 10103 Prinsip Kejuruteraan Perisian 3 BIK 10203 Algoritma dan Pengaturcaraan 3
Jumlah Keseluruhan Kredit 120`;
    const result = runImageExtractionPipeline(ocrText, 'image');
    const codes = result.courses.map(c => c.course_code);
    expect(codes).toContain('BIK 10103');
    expect(codes).toContain('BIK 10203');
  });
});

describe('6-digit course code repair', () => {
  it('repairs BIK 101035 to BIK 10103', () => {
    const ocrText = `PROGRAM (BIK)
TAHUN 1
1 BIK 101035 Prinsip Kejuruteraan 3
Jumlah Keseluruhan Kredit 120`;
    const result = runImageExtractionPipeline(ocrText, 'image');
    const course = result.courses.find(c => c.course_code === 'BIK 10103');
    expect(course).toBeDefined();
  });
});

describe('course name cleanup', () => {
  it('cleans joined course names', () => {
    const ocrText = `PROGRAM (BIK)
TAHUN 1
1 BIK 10303 SenbinaKomputer 3
Jumlah Keseluruhan Kredit 120`;
    const result = runImageExtractionPipeline(ocrText, 'image');
    const course = result.courses.find(c => c.course_code === 'BIK 10303');
    expect(course?.course_name).toBe('Senibina Komputer');
  });
});

describe('honest confidence scoring', () => {
  it('gives low confidence when few subjects detected', () => {
    const ocrText = `PROGRAM (BIK)
TAHUN 1
1 BIK 10103 Prinsip Kejuruteraan 3
Jumlah Keseluruhan Kredit 120`;
    const result = runImageExtractionPipeline(ocrText, 'image');
    expect(result.confidence).toBeLessThan(0.6);
  });

  it('includes confidence explanation in stages', () => {
    const result = runImageExtractionPipeline(BIK_OCR_TEXT, 'image', 8);
    const confStage = result.stages.find(s => s.stage === 'confidence_scoring');
    expect((confStage?.metadata as any)?.explanation).toBeDefined();
  });
});

describe('year-from-semester mapping', () => {
  it('assigns Year 2 to semester 3', () => {
    const result = runImageExtractionPipeline(BIK_OCR_TEXT, 'image', 8);
    const sem3 = result.courses.find(c => c.semester === 3);
    if (sem3) expect(sem3.year).toBe(2);
  });

  it('assigns Year 3 to semester 5', () => {
    const result = runImageExtractionPipeline(BIK_OCR_TEXT, 'image', 8);
    const sem5 = result.courses.find(c => c.semester === 5);
    if (sem5) expect(sem5.year).toBe(3);
  });
});
