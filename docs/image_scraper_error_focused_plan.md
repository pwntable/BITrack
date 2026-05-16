# Latest Updated Plan: Solving Image Scraper Failure for Curriculum / Pelan Pengajian Extraction

## 1. Current Situation

The latest debug UI shows that the image scraper has improved because it now gives an extraction debug report instead of failing silently.

Current result:

```text
File Classification: PASSED
OCR Quality: PASSED
Metadata Detection: PASSED
Course Row Parser: FAILED
Subjects detected: 0
Semesters detected: 0
Confidence: 0%
```

The OCR sample shows that text is being extracted, but the text is corrupted and not table-aware.

Example OCR output:

```text
[Sem] KodKursus | MNamaKursus | Kredit |
[VQ 16702710202 _lengaan sam Pongafan rar |--| So Cr -
[6110205 gona dan pengatvearsan | 5 | So Cr -
```

Rejected rows also show corrupted partial course rows:

```text
[BK20205 [KejurteranSistem Persian | 3 |
[BIK31103 |[Pembangunan ApjikasiMudah Ah | 3 |
[BT34503 |SamsData 13 |
```

This means the scraper is no longer failing because the file is unreadable. It is failing because the OCR output is not structured enough for the course parser.

---

## 2. Main Diagnosis

The issue is not only regex.

The main issue is:

```text
The current scraper appears to OCR the full image/page as one block.
This causes text from multiple tables and columns to merge together.
The parser receives noisy, corrupted, mixed lines instead of clean course rows.
```

Therefore, the correct solution is:

```text
Do not parse full-page OCR lines directly.
Detect tables first.
Crop each table.
OCR each table or each table cell separately.
Then parse structured rows.
```

---

## 3. Updated Goal

The new goal is to transform the scraper from a plain OCR parser into a layout-aware image extraction system.

The scraper should be able to:

```text
1. Detect image-based curriculum files.
2. Identify table regions.
3. Crop each semester table.
4. Enhance each crop before OCR.
5. OCR per table or per cell.
6. Reconstruct rows and columns using coordinates.
7. Normalize OCR mistakes.
8. Parse course rows.
9. Detect semesters even if OCR misses the Sem column.
10. Validate extracted credits against document totals.
11. Produce clear debug logs at every stage.
```

---

## 4. Updated High-Level Pipeline

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
Table region detection
        ↓
Table crop generation
        ↓
Per-table preprocessing
        ↓
OCR per table crop
        ↓
Optional cell-level OCR
        ↓
Row and column reconstruction
        ↓
Course-code normalization
        ↓
Course row parsing
        ↓
Semester assignment
        ↓
SC tag detection
        ↓
Credit total validation
        ↓
Confidence scoring
        ↓
Debug report + review UI
```

---

## 5. Key Change: OCR Quality Must Mean Usable Text, Not Just Text Count

The current OCR stage passes because it detects many characters.

That is not enough.

Bad OCR quality logic:

```text
OCR extracted 1746 characters across 51 lines
→ OCR passed
```

Better OCR quality logic:

```text
OCR extracted 1746 characters
Valid course-code patterns found: 0
Valid curriculum rows found: 0
Readable table headers: weak
Semester structure: not detected
→ OCR is not usable for curriculum extraction
```

### Add Domain OCR Quality Score

The OCR quality stage should produce:

```json
{
  "total_characters": 1746,
  "total_lines": 51,
  "valid_course_code_count": 0,
  "valid_credit_pattern_count": 4,
  "semester_keyword_count": 1,
  "table_header_score": 0.3,
  "usable_text_score": 0.18,
  "status": "failed_for_curriculum_extraction"
}
```

### Suggested Rule

```typescript
if (validCourseCodeCount === 0) {
  status = "failed_for_curriculum_extraction";
}

if (validCourseCodeCount < 5) {
  status = "warning";
}

if (usableTextScore < 0.4) {
  status = "warning";
}
```

The UI should not display `OCR Quality: PASSED` when OCR text is unreadable for course extraction.

---

## 6. Priority 1 Fix: Stop Full-Page OCR Parsing

Full-page OCR is the main reason rows are corrupted.

Full-page OCR causes this problem:

```text
Semester 1 left table + Semester 2 right table + headers + notes
all become mixed into one text stream.
```

The course parser then receives lines that contain multiple unrelated rows.

Bad parser input:

```text
BIK 20503 Jaminan Kualiti Perisian 3 UQI 11202 Falsafah dan Cabaran Semasa 2
```

Good parser input:

```json
{
  "semester": 4,
  "course_code": "BIK 20503",
  "course_name": "Jaminan Kualiti Perisian",
  "credit": 3
}
```

### Required Change

Before OCR parsing:

```text
Detect table regions
Crop each table
OCR each crop separately
```

---

## 7. Table Region Detection

Curriculum images usually contain clear bordered tables. Use OpenCV or a layout detection model to detect them.

### Table Detection Process

```text
1. Convert image to grayscale.
2. Apply adaptive thresholding.
3. Detect horizontal lines.
4. Detect vertical lines.
5. Combine line masks.
6. Find rectangular contours.
7. Filter by size and aspect ratio.
8. Sort detected regions by y-position and x-position.
9. Classify each table as semester table, elective table, notes, or total row.
```

### Expected Table Regions

For the BIK curriculum image, expected regions are:

```text
Semester 1 table
Semester 2 table
Semester 3 table
Semester 4 table
Semester 5 table
Semester 6 table
Semester 7 table
Elective courses table
```

### Debug Output

```json
{
  "stage": "table_detection",
  "status": "passed",
  "tables_detected": 8,
  "regions": [
    {
      "region_id": "table_1",
      "x": 12,
      "y": 120,
      "width": 460,
      "height": 160,
      "classification": "semester_table"
    },
    {
      "region_id": "table_8",
      "x": 610,
      "y": 640,
      "width": 360,
      "height": 230,
      "classification": "elective_table"
    }
  ]
}
```

### Failure Output

```json
{
  "stage": "table_detection",
  "status": "failed",
  "error_code": "NO_TABLE_REGIONS_FOUND",
  "message": "No table regions detected. Full-page OCR is not reliable for this layout.",
  "suggestion": "Inspect thresholded image and table-line detection debug image."
}
```

---

## 8. Save Table Crop Debug Images

For every extraction job, save table crop images.

Example debug files:

```text
debug/job_123/original.png
debug/job_123/preprocessed.png
debug/job_123/table_lines_detected.png
debug/job_123/tables/table_1.png
debug/job_123/tables/table_2.png
debug/job_123/tables/table_3.png
debug/job_123/ocr_boxes.png
```

The frontend should allow developers to open these images.

This is important because if scraping fails, you can immediately check:

```text
Did the detector crop the correct table?
Was the table crop too small?
Did the crop include two tables accidentally?
Was the crop missing the course code column?
```

---

## 9. Per-Table Image Preprocessing

After cropping each table, preprocess it before OCR.

The text in screenshots is often small. OCR should not run on the raw crop.

### Recommended Preprocessing Per Table

```text
1. Crop table with padding.
2. Upscale crop by 2x or 3x.
3. Convert to grayscale.
4. Denoise.
5. Increase contrast.
6. Apply adaptive threshold.
7. Sharpen text.
8. Optional: remove table lines only after cell boundaries are detected.
```

### Why Upscaling Matters

Current OCR output contains:

```text
KejurteranSistem Persian
ApjikasiMudah Ah
SamsData
```

These errors strongly suggest the OCR engine cannot clearly read small text.

Upscaling each table crop should improve recognition.

### Debug Output

```json
{
  "stage": "per_table_preprocessing",
  "status": "passed",
  "table_id": "table_1",
  "scale_factor": 3,
  "output": "debug/job_123/tables/table_1_preprocessed.png"
}
```

---

## 10. OCR Per Table Crop

Run OCR separately for each table crop.

Do not send the whole image as a single OCR request.

### Per-Table OCR Output

```json
{
  "table_id": "table_1",
  "ocr_text": [
    "Sem Kod Kursus Nama Kursus Kredit",
    "1 UHB 13102 English for General Communication 2",
    "BIK 10103 Prinsip Kejuruteraan Perisian 3",
    "BIK 10203 Algoritma dan Pengaturcaraan 3 SC",
    "Jumlah 19"
  ],
  "valid_course_codes_found": 4,
  "average_confidence": 0.89
}
```

### Table-Level Debug Summary

```json
{
  "stage": "ocr_per_table",
  "status": "partial_success",
  "tables_processed": 8,
  "tables_with_valid_course_codes": 6,
  "tables_failed": 2,
  "average_confidence": 0.84
}
```

This lets the developer know which table failed, instead of only seeing global `0 subjects`.

---

## 11. Cell-Level OCR for Highest Reliability

If per-table OCR is still noisy, move to cell-level OCR.

### Cell-Level Process

```text
Detect rows and columns inside the table.
Crop each cell.
OCR each cell separately.
Map cells to fields.
```

Expected fields:

```text
Sem
Kod Kursus
Nama Kursus
Kredit
Tag / SC
```

### Cell-Level Output

```json
{
  "table_id": "semester_1",
  "row_index": 5,
  "cells": {
    "sem": "",
    "course_code": "BIK 10203",
    "course_name": "Algoritma dan Pengaturcaraan",
    "credit": "3",
    "tag": "SC"
  }
}
```

### Why Cell OCR Is Better

Instead of parsing this corrupted line:

```text
[BK20205 [KejurteranSistem Persian | 3 | [UI 12 ...
```

The parser receives:

```json
{
  "course_code": "BIK 20203",
  "course_name": "Kejuruteraan Sistem Perisian",
  "credit": "3"
}
```

This reduces row-merging and column-merging errors.

---

## 12. Row and Column Reconstruction

If full cell detection is not available, reconstruct rows from OCR boxes using coordinates.

### Row Grouping

Group text boxes by y-coordinate.

```typescript
function groupBoxesIntoRows(boxes, yTolerance = 8) {
  const rows = [];

  for (const box of boxes.sort((a, b) => a.y - b.y)) {
    let matched = null;

    for (const row of rows) {
      if (Math.abs(row.y - box.y) <= yTolerance) {
        matched = row;
        break;
      }
    }

    if (matched) {
      matched.items.push(box);
    } else {
      rows.push({ y: box.y, items: [box] });
    }
  }

  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
  }

  return rows;
}
```

### Column Mapping

Use table-local x-coordinate ranges.

```text
x 0% - 10%      → semester
x 10% - 30%     → course code
x 30% - 85%     → course name
x 85% - 95%     → credit
x 95%+          → tag / SC
```

Column boundaries should be detected dynamically from vertical table lines when possible.

---

## 13. Course Code Normalization

The rejected rows show course codes are sometimes compressed or misread.

Examples:

```text
BK20205
BIK31103
BT34503
```

Normalize before regex parsing.

### Common Corrections

```typescript
const OCR_CORRECTIONS = {
  "B1K": "BIK",
  "BlK": "BIK",
  "B|K": "BIK",
  "BK": "BIK",
  "U0I": "UQI",
  "UQl": "UQI",
  "U0U": "UQU",
  "KodKursus": "Kod Kursus",
  "NamaKursus": "Nama Kursus",
  "Kejurteran": "Kejuruteraan",
  "Persian": "Perisian",
  "Apjikasi": "Aplikasi",
  "Mudah Ah": "Mudah Alih",
  "SamsData": "Sains Data"
};
```

### Course Code Spacing

```text
BIK31103 → BIK 31103
UQU40103 → UQU 40103
BIT34503 → BIT 34503
```

### Normalization Rule

```typescript
function normalizeCourseCode(code: string): string {
  let normalized = code.toUpperCase().trim();

  normalized = normalized
    .replace(/B1K|BLK|B\|K/g, "BIK")
    .replace(/U0I|UQL/g, "UQI")
    .replace(/U0U/g, "UQU");

  normalized = normalized.replace(/^([A-Z]{2,4})(\d{5})$/, "$1 $2");

  return normalized;
}
```

### Correction Log

Every correction must be logged.

```json
{
  "stage": "normalization",
  "type": "ocr_correction",
  "before": "BIK31103",
  "after": "BIK 31103",
  "reason": "missing_space_between_prefix_and_digits"
}
```

---

## 14. Course Row Parser Update

The parser should parse from structured cells whenever possible.

### Preferred Parser Input

```json
{
  "course_code": "BIK 10203",
  "course_name": "Algoritma dan Pengaturcaraan",
  "credit": "3",
  "tag": "SC"
}
```

### Avoid This Parser Input

```text
BIK10203AlgoritmadanPengaturcaraan3SC
```

### Supported Code Formats

```text
BIK 10103
BIK10103
UHB 13102
UQI 10102/10202
UQ* 1***1
BI* 3**03
UQU40103
BIT 10303
BIT ****3
```

### Regex

```typescript
const COURSE_CODE_REGEX = new RegExp(
  [
    "[A-Z]{2,4}\\s?\\d{5}",
    "[A-Z]{2,4}\\s?\\d{5}/\\d{5}",
    "[A-Z]{2,4}\\s?\\d{3,5}/\\d{3,5}",
    "UQ\\*\\s?1\\*\\*\\*1",
    "BI\\*\\s?3\\*\\*03",
    "BIT?\\s?\\*{3,4}3"
  ].join("|")
);
```

---

## 15. Programme Context-Aware Repair

Metadata detection already found the programme code, such as `BIK`.

Use this information to improve parsing.

If programme code is `BIK`, then course code mistakes like this can be treated as likely OCR errors:

```text
BK20205 → likely BIK 20205 or BIK 20203
BIK31103 → BIK 31103
```

But do not blindly save uncertain repairs.

### Suggested Repair Output

```json
{
  "raw_code": "BK20205",
  "suggested_code": "BIK 20205",
  "confidence": 0.62,
  "requires_review": true,
  "reason": "programme code context suggests BIK prefix"
}
```

Only auto-accept repairs when confidence is high and validation passes.

---

## 16. Semester Detection Fallback

The current report says:

```text
0 semesters detected
```

This can happen if OCR misses the Sem column.

Do not depend only on OCR for semester detection.

### Use Multiple Methods

```text
1. Read semester number from Sem column.
2. Read nearby TAHUN labels.
3. Infer semester from table position.
4. Infer semester from known table order.
5. Validate using each table's Jumlah row.
```

### Layout Fallback for This Curriculum Style

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

### Debug Output

```json
{
  "stage": "semester_detection",
  "status": "partial_success",
  "method": "layout_position_fallback",
  "semesters_detected": [1, 2, 3, 4, 5, 6, 7],
  "message": "Semester numbers were inferred from table positions because OCR missed the Sem column."
}
```

---

## 17. SC Tag Detection

Yellow `SC` markers may not be reliably read by OCR.

Use both OCR and color detection.

### OCR Method

If OCR detects `SC`, assign it to the nearest row.

### Color Method

Detect yellow highlights using HSV thresholding.

```typescript
const lowerYellow = [20, 80, 80];
const upperYellow = [40, 255, 255];
```

Then attach the yellow region to the row with the closest y-coordinate.

### Debug Output

```json
{
  "stage": "sc_detection",
  "status": "passed",
  "yellow_regions_detected": 10,
  "sc_tags_assigned": 10,
  "method": "ocr_and_color_detection"
}
```

---

## 18. Credit Validation

Credit validation should be the final gate.

The scraper should compare:

```text
document semester total
vs
calculated semester total
```

and:

```text
document overall total
vs
calculated overall total
```

### Example

```json
{
  "semester": 1,
  "document_total": 19,
  "calculated_total": 19,
  "status": "passed"
}
```

### Failure Example

```json
{
  "semester": 1,
  "document_total": 19,
  "calculated_total": 13,
  "status": "failed",
  "message": "Likely missed course rows in semester 1."
}
```

Only mark extraction as `SUCCESS` when totals match or when the user manually confirms corrected rows.

---

## 19. Rejected Row Logging Upgrade

The current rejected row report is useful but should be expanded.

For every rejected row, include:

```text
raw_text
source table
source row number
OCR confidence
reason
suggested normalized text
suggested fix
severity
```

### Example

```json
{
  "raw_text": "[BIK31103 |[Pembangunan ApjikasiMudah Ah | 3 |",
  "source_table": "table_8",
  "source_row": 6,
  "ocr_confidence": 0.71,
  "reason": "partial_course_match_failed",
  "suggested_normalized_text": "BIK 31103 | Pembangunan Aplikasi Mudah Alih | 3",
  "severity": "warning",
  "requires_review": true
}
```

---

## 20. Updated Frontend Debug Report

The debug report should show root cause, not just stage status.

### Add Root Cause Section

Example:

```text
Root cause:
OCR text is not table-isolated. Text from multiple columns was merged before parsing.
```

or:

```text
Root cause:
Course code regex rejected all rows because OCR returned compressed codes such as BIK31103.
```

### Add Table Debug Tab

Show:

```text
Detected table crops
Per-table OCR sample
Valid course codes per table
Rows parsed per table
Rows rejected per table
```

### Add OCR Quality Tab

Show:

```text
Total OCR characters
Valid course codes found
Valid credits found
Usable text score
Average confidence
Low-confidence rows
```

---

## 21. Updated Backend Response Shape

The API should return something like this:

```json
{
  "status": "FAILED",
  "root_cause": "full_page_ocr_not_table_isolated",
  "summary": {
    "subjects_detected": 0,
    "semesters_detected": 0,
    "confidence": 0,
    "ocr_characters": 1746,
    "ocr_lines": 51,
    "valid_course_codes_found": 0,
    "tables_detected": 0
  },
  "stage_results": [
    {
      "stage": "file_classification",
      "status": "passed",
      "message": "Image file routed to OCR pipeline."
    },
    {
      "stage": "ocr_quality",
      "status": "warning",
      "message": "OCR extracted text, but usable curriculum pattern score is low."
    },
    {
      "stage": "table_detection",
      "status": "not_run",
      "message": "Table detection should run before parsing course rows."
    },
    {
      "stage": "course_row_parser",
      "status": "failed",
      "message": "No valid course rows detected because OCR lines were corrupted."
    }
  ],
  "next_actions": [
    "Enable table region detection.",
    "Crop each table and OCR separately.",
    "Add course code normalization for BIK31103 style codes.",
    "Add layout-based semester fallback."
  ]
}
```

---

## 22. Updated Implementation Priority

### Priority 1: Add Table Detection and Cropping

Implement:

```text
OpenCV table-line detection
contour detection
table crop saving
table crop preview in debug UI
```

Success condition:

```text
System detects 7 to 8 table regions from the curriculum image.
```

---

### Priority 2: OCR Each Table Crop Separately

Implement:

```text
per-table OCR
per-table OCR score
per-table valid course-code count
per-table rejected rows
```

Success condition:

```text
At least some tables produce readable rows with valid course codes.
```

---

### Priority 3: Improve Per-Table Preprocessing

Implement:

```text
upscale 2x or 3x
threshold
sharpen
denoise
compare OCR before and after preprocessing
```

Success condition:

```text
Valid course-code count increases after preprocessing.
```

---

### Priority 4: Coordinate-Based Row and Column Reconstruction

Implement:

```text
group OCR boxes by y-coordinate
assign boxes to columns using x-coordinate
build structured course row objects
```

Success condition:

```text
Parser receives structured fields instead of noisy raw lines.
```

---

### Priority 5: Normalize and Repair OCR Text

Implement:

```text
course-code spacing
common OCR correction dictionary
programme-code context repair
logged corrections
```

Success condition:

```text
BIK31103 becomes BIK 31103 before parsing.
```

---

### Priority 6: Layout-Based Semester Fallback

Implement:

```text
semester assignment from table position
configurable curriculum layout profile
fallback if Sem column OCR fails
```

Success condition:

```text
Semesters detected even when OCR misses the Sem column.
```

---

### Priority 7: Validation and Confidence

Implement:

```text
semester total validation
overall total validation
row confidence
job confidence
manual review status
```

Success condition:

```text
System can tell whether extracted rows are complete and reliable.
```

---

### Priority 8: Vision Model Fallback

If OCR + table extraction still fails:

```text
send table crop or full image to vision-capable extraction model
request strict JSON
validate JSON with same validation engine
mark fields for review
```

This should be fallback only, not the primary method.

---

## 23. Most Likely Fix for the Current Failure

Based on the latest screenshots, the immediate fix is:

```text
1. Do not parse the current full-page OCR output.
2. Add table detection before OCR parsing.
3. Crop each semester table.
4. Upscale each crop.
5. OCR per crop.
6. Reconstruct rows using coordinates.
7. Normalize course codes.
8. Assign semesters using table layout.
9. Validate against credit totals.
```

This is the shortest path to getting subjects detected.

---

## 24. Acceptance Criteria

The updated scraper should be considered successful when:

```text
1. It accepts image uploads directly.
2. It does not require users to convert images to PDF.
3. It detects table regions from the image.
4. It produces table crop debug images.
5. It extracts at least 80% of visible course rows automatically.
6. It detects semester structure using OCR or layout fallback.
7. It validates semester credit totals.
8. It shows useful rejected row reasons.
9. It never marks OCR as passed only because many characters were found.
10. It gives a clear root cause when extraction fails.
```

---

## 25. Final Recommendation

The scraper has already improved because it now gives useful debug output.

The next engineering step is not to keep changing regex blindly.

The next engineering step is:

```text
Make the OCR layout-aware.
```

The final architecture should be:

```text
image
→ table detection
→ table crop
→ crop enhancement
→ OCR per table/cell
→ row/column reconstruction
→ normalization
→ parser
→ validation
→ review UI
```

This will solve the current issue where OCR technically runs, but the parser receives corrupted full-page text.

The most important immediate feature to build is:

```text
table crop detection + per-table OCR debug output
```

Once that exists, every later bug becomes easier to diagnose because you can see exactly which table, row, or cell failed.
