# Latest Image Scraper Error Focused Plan

## Version Context

This plan is based on the latest extraction result after implementing the previous image scraper debug pipeline.

The current scraper has improved from total failure to partial extraction.

Current observed output:

```text
Extraction status: PARTIAL_SUCCESS
Tables detected: 14
Subjects detected: 4
Semesters detected: 1
Confidence: 75%
Credits: 12/?
Rejected rows: 24
```

Pipeline stages:

```text
File Classification: PASSED
Table Detection: PASSED
OCR Quality: PASSED
Metadata Detection: WARNING
Course Row Parser: PASSED, but only 4 rows parsed
Semester Detection: WARNING
Validation: WARNING
Confidence Scoring: PASSED
```

The scraper can now accept image input, route the file to OCR, detect table-like regions, extract OCR text, detect some course-code patterns, parse a small number of rows, and show debug information. However, the extracted curriculum data is still not reliable enough.

The next focus should be **structural parsing**, not basic OCR.

---

## 1. Current Main Problems

### 1.1 Table Over-Detection

The scraper detected 14 table regions.

For this type of curriculum image, the expected useful regions are usually around:

```text
Semester 1 table
Semester 2 table
Semester 3 table
Semester 4 table
Semester 5 table
Semester 6 table
Semester 7 table
Elective courses table
Optional notes area
Optional total credit row
```

So 14 detected tables likely means the table detector is also capturing:

```text
inner row fragments
duplicate nested contours
small total rows
highlight boxes
notes fragments
partial table borders
```

This causes downstream parsing confusion.

---

### 1.2 Left and Right Tables Are Still Being Merged

Rejected row example:

```text
BIK10203~~ | AlgoritmadanPengaturcaraan~~ | 3 | BIK10903 |StrukturData~~ | 3 |
```

This row actually contains two separate courses:

```text
BIK 10203 | Algoritma dan Pengaturcaraan | 3
BIK 10903 | Struktur Data | 3
```

This means that even though table detection is running, the OCR or row reconstruction still allows multiple table columns or multiple course rows to merge into one parser input.

---

### 1.3 Semester Detection Is Still Weak

The scraper detected only:

```text
1 semester detected: [1]
```

But the document should contain around:

```text
Semester 1
Semester 2
Semester 3
Semester 4
Semester 5
Semester 6
Semester 7
```

The current problem is likely that semester detection depends too much on OCR reading the `Sem` column.

The scraper needs layout-based semester assignment.

---

### 1.4 Parsed Subject Data Is Not Reliable

Current parsed examples show invalid or corrupted fields:

```text
BIK 101035
BIK 301035
BIK 30703
BIK 31003
```

Problems:

```text
BIK 101035 has 6 digits instead of 5.
BIK 301035 has 6 digits instead of 5.
Some course names contain merged or unrelated text.
Some courses are assigned to the wrong year or semester.
```

This means parser success should not automatically mean data success. The parser must validate fields after parsing.

---

### 1.5 Confidence Score Is Too High

The system reports:

```text
Confidence: 75%
```

But only 4 subjects and 1 semester were detected.

A result with 4 subjects, 1 semester, 24 rejected rows, and unknown total credits should probably be:

```text
Status: NEEDS_REVIEW
Confidence: 35% to 45%
```

Confidence must consider number of subjects detected, expected semesters detected, rejected rows, course-code validity, credit total validation, merged-row indicators, and metadata completeness.

---

## 2. Updated Goal

The next version of the scraper should improve from:

```text
OCR text extraction
```

to:

```text
reliable table-cell extraction
```

The target structured row should look like this:

```json
{
  "year": 1,
  "semester": 1,
  "course_code": "BIK 10203",
  "course_name": "Algoritma dan Pengaturcaraan",
  "credit": 3,
  "type": "Core",
  "tag": "SC",
  "confidence": 0.91
}
```

The next milestone should be:

```text
Useful tables detected: 8
Subjects detected: 30+
Semesters detected: 7
Credits: close to 120
Rejected rows: fewer than 10
Confidence: meaningful and honest
```

---

## 3. Updated High-Level Pipeline

```text
Upload image / screenshot / image-based PDF
        ↓
File classification
        ↓
Render PDF page to image if needed
        ↓
Image quality check
        ↓
Image preprocessing
        ↓
Raw table region detection
        ↓
Table filtering and deduplication
        ↓
Table classification
        ↓
Semester assignment by layout
        ↓
Per-table crop generation
        ↓
Per-table image enhancement
        ↓
OCR per table crop
        ↓
Row and column reconstruction
        ↓
Multi-course row splitting
        ↓
Course-code normalization
        ↓
Course name cleanup
        ↓
Strict course row validation
        ↓
Recovery parser for rejected rows
        ↓
Credit total validation
        ↓
Confidence recalculation
        ↓
Debug report + review UI
```

---

## 4. Priority 1: Filter and Deduplicate Table Regions

### Problem

The system detected 14 tables, but not all are useful curriculum tables.

### Solution

Add table filtering and deduplication after raw detection.

For every detected region, calculate:

```text
width
height
area
aspect ratio
row count
column count
position
OCR header score
course-code count
contains Jumlah
contains Sem / Kod Kursus / Nama Kursus / Kredit
```

### Filtering Rules

```typescript
function isValidCurriculumTable(region) {
  if (region.width < 250) return false;
  if (region.height < 80) return false;
  if (region.area < 20000) return false;
  if (region.detectedRows < 3) return false;

  return true;
}
```

### Deduplication Rule

If two detected regions overlap heavily, keep the more useful one.

```typescript
if (intersectionOverUnion(tableA, tableB) > 0.75) {
  keepRegionWithHigherTableScore();
}
```

### Table Score Formula

```typescript
tableScore =
  headerKeywordScore * 0.25 +
  courseCodeCountScore * 0.30 +
  rowCountScore * 0.20 +
  sizeScore * 0.15 +
  borderConfidence * 0.10;
```

### Debug Output

```json
{
  "stage": "table_filtering",
  "status": "passed",
  "raw_regions_detected": 14,
  "valid_curriculum_tables": 8,
  "rejected_regions": [
    {
      "region_id": "region_9",
      "reason": "too_small"
    },
    {
      "region_id": "region_11",
      "reason": "duplicate_nested_region"
    }
  ]
}
```

### Success Target

```text
Raw detected regions: 14
Filtered useful regions: 8 or 9
```

---

## 5. Priority 2: Classify Tables Before Parsing

### Problem

The scraper detects tables but does not reliably know which table is semester 1, semester 2, elective table, notes, etc.

### Solution

Every useful table must be classified before course parsing.

Possible table types:

```text
semester_table
elective_table
notes_table
total_credit_table
unknown
```

### Classification Signals

Use:

```text
table position
nearby TAHUN label
Sem column value
presence of course codes
presence of Jumlah row
presence of elective keywords
table size
```

### Layout-Based Semester Assignment

For this common curriculum layout:

```text
top-left table       → semester 1
top-right table      → semester 2
second-left table    → semester 3
second-right table   → semester 4
third-left table     → semester 5
third-right table    → semester 6
bottom-left table    → semester 7
bottom-right table   → elective courses
```

This mapping should be configurable as a `layout_profile`, not hardcoded permanently.

### Example Table Object

```json
{
  "table_id": "table_1",
  "classification": "semester_table",
  "layout_position": "top_left",
  "assigned_year": 1,
  "assigned_semester": 1,
  "confidence": 0.92
}
```

### Debug Output

```json
{
  "stage": "table_classification",
  "status": "partial_success",
  "tables_classified": 8,
  "semester_tables": 7,
  "elective_tables": 1,
  "semesters_detected": [1, 2, 3, 4, 5, 6, 7],
  "method": "layout_position_fallback"
}
```

---

## 6. Priority 3: Fix Year and Semester Mapping

### Problem

The UI currently shows:

```text
Year 1 — Semester 1
Year 1 — Semester 2
Year 1 — Semester 3
Year 1 — Semester 4
Year 1 — Semester 5
```

This is wrong.

### Correct Mapping

```typescript
function yearFromSemester(semester) {
  if ([1, 2].includes(semester)) return 1;
  if ([3, 4].includes(semester)) return 2;
  if ([5, 6].includes(semester)) return 3;
  if (semester === 7) return 4;
  return null;
}
```

### Expected UI Output

```text
Year 1 — Semester 1
Year 1 — Semester 2
Year 2 — Semester 3
Year 2 — Semester 4
Year 3 — Semester 5
Year 3 — Semester 6
Year 4 — Semester 7
```

---

## 7. Priority 4: Prevent Merged Row Parsing

### Problem

Rejected rows show that two course records are merged into one OCR row.

Example:

```text
BIK10203~~ | AlgoritmadanPengaturcaraan~~ | 3 | BIK10903 |StrukturData~~ | 3 |
```

### Solution A: Split Rows by Multiple Course Codes

If a row contains more than one course-code pattern, split it.

```typescript
function splitMergedCourseRow(rowText) {
  const matches = findAllCourseCodeMatches(rowText);

  if (matches.length <= 1) {
    return [rowText];
  }

  const chunks = [];

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = matches[i + 1]?.index ?? rowText.length;
    chunks.push(rowText.slice(start, end).trim());
  }

  return chunks;
}
```

### Example

Input:

```text
BIK10203~~ | AlgoritmadanPengaturcaraan~~ | 3 | BIK10903 |StrukturData~~ | 3 |
```

Output:

```text
BIK10203~~ | AlgoritmadanPengaturcaraan~~ | 3 |
BIK10903 |StrukturData~~ | 3 |
```

Then normalize:

```text
BIK 10203 | Algoritma dan Pengaturcaraan | 3
BIK 10903 | Struktur Data | 3
```

### Solution B: Use Column Boundaries

Better long-term solution:

```text
Do not parse full OCR lines.
Use table-local x-coordinate column boundaries.
```

Expected columns:

```text
Sem | Kod Kursus | Nama Kursus | Kredit | Tag
```

Each OCR box should be assigned to a column by x-position.

---

## 8. Priority 5: Move Toward Table-Cell Extraction

### Problem

The current parser still behaves like:

```text
OCR line → regex parser
```

This is fragile.

### Better Approach

Use:

```text
table crop
→ detect rows and columns
→ create cells
→ OCR or assign OCR boxes to cells
→ parse structured cells
```

### Target Parser Input

```json
{
  "sem_cell": "1",
  "course_code_cell": "BIK10203",
  "course_name_cell": "AlgoritmadanPengaturcaraan",
  "credit_cell": "3",
  "tag_cell": "SC"
}
```

### Avoid Parser Input

```text
BIK10203~~ | AlgoritmadanPengaturcaraan~~ | 3 | BIK10903 | StrukturData~~ | 3 |
```

### Column Boundary Strategy

Use detected vertical table lines when available.

Fallback percentage-based boundaries:

```text
0% - 10%      → semester
10% - 30%     → course code
30% - 85%     → course name
85% - 95%     → credit
95%+          → tag / SC
```

---

## 9. Priority 6: Strict Course Code Validation

### Problem

Current parsed course codes include invalid values:

```text
BIK 101035
BIK 301035
```

These have 6 digits, but normal course codes usually have 5 digits.

### Valid Code Pattern

```typescript
const NORMAL_COURSE_CODE = /^[A-Z]{2,4}\\s?\\d{5}$/;
```

### Placeholder Patterns

Also support:

```text
UQ* 1***1
BI* 3**03
BIT ****3
UQI 10102/10202
```

### Validation Rule

```typescript
function validateCourseCode(code) {
  if (NORMAL_COURSE_CODE.test(code)) return "valid";
  if (PLACEHOLDER_CODE_REGEX.test(code)) return "placeholder";
  return "invalid";
}
```

### Repair Rule for 6-Digit Codes

Some OCR outputs duplicate the final credit digit or nearby number.

Examples:

```text
BIK 101035 → possible BIK 10103
BIK 301035 → possible BIK 30103
```

Repair only if:

```text
removing the last digit creates a valid 5-digit code
course name is not empty
credit is valid
row passes validation
```

### Repair Output

```json
{
  "field": "course_code",
  "before": "BIK 101035",
  "after": "BIK 10103",
  "repair_type": "remove_extra_trailing_digit",
  "confidence": 0.78,
  "requires_review": true
}
```

---

## 10. Priority 7: Course Name Cleanup

### Problem

OCR produces joined or misspelled course names:

```text
AlgoritmadanPengaturcaraan
SenbinaKomputer
KejunteraanSistemPerisian
Pembangunanweb
Fernsian
SamsData
```

### Add Dictionary-Based Cleanup

```typescript
const COURSE_NAME_CORRECTIONS = {
  "AlgoritmadanPengaturcaraan": "Algoritma dan Pengaturcaraan",
  "SenbinaKomputer": "Senibina Komputer",
  "KejunteraanSistemPerisian": "Kejuruteraan Sistem Perisian",
  "Pembangunanweb": "Pembangunan Web",
  "Fernsian": "Perisian",
  "StrukturData": "Struktur Data",
  "PangkalanData": "Pangkalan Data",
  "SamsData": "Sains Data",
  "ApjikasiMudahAh": "Aplikasi Mudah Alih",
  "FalsafahdanCabaranSemasa": "Falsafah dan Cabaran Semasa"
};
```

### Important Rule

Do not silently correct.

Every correction should be logged:

```json
{
  "stage": "course_name_cleanup",
  "before": "SenbinaKomputer",
  "after": "Senibina Komputer",
  "method": "domain_dictionary",
  "requires_review": false
}
```

---

## 11. Priority 8: Recovery Parser for Rejected Rows

### Problem

Rejected rows are not useless. Many are recoverable.

Example rejected row:

```text
BIK10303 | SenbinaKomputer | 3 | BIK 11003 | PangkalanData | 3 |
```

This can be recovered into:

```json
[
  {
    "course_code": "BIK 10303",
    "course_name": "Senibina Komputer",
    "credit": 3
  },
  {
    "course_code": "BIK 11003",
    "course_name": "Pangkalan Data",
    "credit": 3
  }
]
```

### Add Three-Pass Parsing

```text
Pass 1: Strict parser
Pass 2: Recovery parser
Pass 3: Manual review queue
```

### Recovery Parser Handles

```text
missing spaces
multiple course codes in one row
joined course names
extra symbols like ~~ and |
6-digit course codes
credits attached to names
OCR mistakes in course prefixes
```

### Recovery Parser Output

```json
{
  "raw_text": "BIK10303 | SenbinaKomputer | 3 | BIK 11003 | PangkalanData | 3 |",
  "recovered_rows": [
    {
      "course_code": "BIK 10303",
      "course_name": "Senibina Komputer",
      "credit": 3,
      "confidence": 0.82
    },
    {
      "course_code": "BIK 11003",
      "course_name": "Pangkalan Data",
      "credit": 3,
      "confidence": 0.84
    }
  ],
  "requires_review": true
}
```

---

## 12. Priority 9: Improve Credit Extraction

### Problem

Current credit result:

```text
Credits: 12/?
```

This means document total is not reliably detected or calculated.

### Improve Credit Detection

For each table:

```text
Detect each course credit.
Detect the Jumlah row.
Compare calculated total with Jumlah.
```

### Table-Level Credit Validation

```json
{
  "table_id": "semester_1",
  "assigned_semester": 1,
  "document_total": 19,
  "calculated_total": 19,
  "status": "passed"
}
```

### Failure Example

```json
{
  "table_id": "semester_1",
  "assigned_semester": 1,
  "document_total": 19,
  "calculated_total": 12,
  "status": "failed",
  "message": "Likely missed 2 or more course rows."
}
```

### Overall Credit Validation

```json
{
  "document_overall_total": 120,
  "calculated_overall_total": 120,
  "status": "passed"
}
```

---

## 13. Priority 10: Recalculate Confidence More Honestly

### Problem

Current confidence:

```text
75%
```

This is too high for:

```text
4 subjects detected
1 semester detected
24 rejected rows
unknown total credits
```

### New Confidence Inputs

Confidence should include:

```text
valid table count
semester detection completeness
subject count completeness
valid course-code ratio
rejected row ratio
credit total match
metadata completeness
course name quality
number of manual-review rows
```

### Suggested Formula

```typescript
function calculateJobConfidence(metrics) {
  let score = 100;

  if (metrics.semestersDetected < 7) score -= 25;
  if (metrics.subjectsDetected < 20) score -= 25;
  if (metrics.rejectedRows > metrics.parsedRows) score -= 15;
  if (metrics.invalidCourseCodes > 0) score -= 10;
  if (!metrics.creditTotalMatched) score -= 15;
  if (!metrics.programmeCodeDetected) score -= 5;
  if (metrics.mergedRowsDetected > 0) score -= 10;

  return Math.max(0, score);
}
```

### Expected Current Score

Based on current output, the confidence should be closer to:

```text
35% - 45%
```

### Status Mapping

```typescript
if (confidence >= 85 && validationPassed) return "SUCCESS";
if (confidence >= 65 && subjectsDetected >= 25) return "PARTIAL_SUCCESS";
if (confidence >= 35) return "NEEDS_REVIEW";
return "FAILED";
```

Current output should probably be:

```text
NEEDS_REVIEW
```

not strong `PARTIAL_SUCCESS`.

---

## 14. Updated Debug UI Requirements

### 14.1 Add Table Region Debug

Show:

```text
Raw tables detected: 14
Useful tables after filtering: 8
Rejected table regions: 6
```

For each rejected table region:

```text
reason: too small / duplicate / no course patterns / notes area
```

### 14.2 Add Table Classification View

Show each useful table:

```text
Table 1 → Semester 1 → 7 rows → total 19
Table 2 → Semester 2 → 7 rows → total 19
Table 8 → Elective Courses
```

### 14.3 Add Per-Table OCR View

For each table:

```text
OCR text sample
valid course codes found
rows parsed
rows rejected
credit total
```

### 14.4 Add Recovery Results View

Show:

```text
Strict parsed rows
Recovered rows
Rows requiring manual review
Rows that cannot be recovered
```

### 14.5 Add Confidence Explanation

Instead of only:

```text
Confidence: 75%
```

Show:

```text
Confidence: 42%

Reason:
- Only 1 of 7 expected semesters detected: -25
- Only 4 subjects detected: -25
- 24 rejected rows: -15
- Credit total unknown: -15
+ OCR detected readable patterns: +10
```

---

## 15. Updated Backend Response Shape

```json
{
  "status": "NEEDS_REVIEW",
  "root_cause": "merged_rows_and_incomplete_semester_mapping",
  "summary": {
    "raw_tables_detected": 14,
    "valid_tables": 8,
    "subjects_detected": 4,
    "subjects_recovered": 12,
    "semesters_detected": [1, 2, 3, 4, 5, 6, 7],
    "confidence": 48,
    "credits": {
      "calculated": 54,
      "document_total": 120,
      "matched": false
    }
  },
  "stage_results": [
    {
      "stage": "table_filtering",
      "status": "passed",
      "message": "14 raw regions filtered to 8 useful curriculum tables."
    },
    {
      "stage": "table_classification",
      "status": "passed",
      "message": "7 semester tables and 1 elective table detected using layout fallback."
    },
    {
      "stage": "course_row_parser",
      "status": "partial_success",
      "message": "4 strict rows parsed. 12 rows recovered. 8 rows require review."
    },
    {
      "stage": "validation",
      "status": "warning",
      "message": "Credit total does not match document total."
    }
  ],
  "next_actions": [
    "Review recovered rows.",
    "Fix invalid course codes.",
    "Confirm semester totals.",
    "Manually review low-confidence rows."
  ]
}
```

---

## 16. Recommended Next Implementation Order

### Step 1: Table Filtering and Deduplication

Goal:

```text
14 raw detected regions → 8 useful curriculum tables
```

Implement:

```text
region size filtering
overlap deduplication
header keyword scoring
course-code count scoring
```

---

### Step 2: Table Classification and Semester Assignment

Goal:

```text
Semesters detected: 7
```

Implement:

```text
layout profile
table position sorting
year-semester mapping
elective table detection
```

---

### Step 3: Multi-Course Row Splitting

Goal:

```text
Recover rows where two courses are merged into one line.
```

Implement:

```text
find all course code matches in a row
split by course-code positions
parse each chunk separately
```

---

### Step 4: Field Validation and Repair

Goal:

```text
Reject or repair invalid values like BIK 101035.
```

Implement:

```text
strict course-code validation
6-digit repair
course code spacing
OCR prefix correction
course name dictionary cleanup
```

---

### Step 5: Recovery Parser

Goal:

```text
Use rejected rows to recover additional subjects.
```

Implement:

```text
strict parser
recovery parser
manual review queue
```

---

### Step 6: Credit Validation

Goal:

```text
Know whether extraction is complete.
```

Implement:

```text
per-table Jumlah detection
semester total validation
overall total validation
```

---

### Step 7: Honest Confidence Scoring

Goal:

```text
Confidence reflects data reliability, not OCR quantity.
```

Implement:

```text
penalties for missing semesters
penalties for invalid codes
penalties for rejected rows
penalties for credit mismatch
confidence explanation in UI
```

---

## 17. Acceptance Criteria for Next Version

The next version is successful if:

```text
1. Raw detected table regions are filtered into useful curriculum tables.
2. At least 7 semester tables are assigned correctly.
3. UI displays Year 1 Sem 1-2, Year 2 Sem 3-4, Year 3 Sem 5-6, Year 4 Sem 7.
4. Merged rows are split into separate course rows.
5. Course codes with missing spaces are normalized.
6. Invalid 6-digit course codes are repaired or flagged.
7. Rejected rows are recoverable where possible.
8. Confidence score decreases when extraction is incomplete.
9. Credit totals are calculated and compared with document totals.
10. The frontend shows why confidence is low or high.
```

---

## 18. Expected Improved Output

### Current Output

```text
Tables: 14
Subjects: 4
Semesters: 1
Credits: 12/?
Confidence: 75%
Rejected: 24
```

### Target After Next Improvements

```text
Raw tables: 14
Useful tables: 8
Subjects: 30+
Semesters: 7
Credits: 100+/120
Confidence: 55% - 70%
Rejected: fewer than 10
Status: NEEDS_REVIEW or PARTIAL_SUCCESS
```

### Target After Recovery Parser

```text
Useful tables: 8
Subjects: 38+
Semesters: 7
Credits: 120/120
Confidence: 80% - 90%
Rejected: fewer than 5
Status: PARTIAL_SUCCESS or SUCCESS
```

---

## 19. Final Recommendation

The scraper has moved beyond the first failure stage.

The next major engineering focus is:

```text
Convert OCR output into clean table cells before creating curriculum subjects.
```

The biggest current issues are:

```text
table over-detection
merged rows
weak semester mapping
invalid course-code repair
weak confidence scoring
```

Do not focus only on OCR engine changes or regex changes.

The correct next path is:

```text
1. Filter useful tables.
2. Assign each table to a semester.
3. Split merged course rows.
4. Validate and repair course fields.
5. Recover rejected rows.
6. Validate credit totals.
7. Recalculate confidence honestly.
```

This will move the system from:

```text
text extraction with partial parsing
```

to:

```text
structured curriculum extraction with validation and review
```