# Updated Planning: Image Scraper Error Handling for Curriculum / Pelan Pengajian Extraction

## 1. Problem Statement

The current scraper fails when users upload a screenshot or an image-based PDF of a curriculum plan. The system shows general warnings such as:

- `0 subjects detected`
- `Could not detect subject rows automatically`
- `No semester structure detected`

However, the system does not explain the actual failure point. This makes debugging difficult because the problem could come from image quality, OCR failure, table detection failure, row grouping failure, regex parsing failure, or validation failure.

The updated plan focuses specifically on building an image scraper that is:

- debuggable
- layout-aware
- OCR-aware
- validation-driven
- user-friendly
- able to process images directly without requiring users to convert images into PDF first

---

## 2. Core Principle

The image scraper should not only return extracted data.

It must return:

```text
1. Extracted structured data
2. Raw OCR data
3. Stage-by-stage debug logs
4. Rejected row reasons
5. Confidence score
6. Validation result
7. Suggested fixes
```

The system should be able to answer:

```text
Why did scraping fail?
Where did scraping fail?
Which rows were rejected?
Was OCR successful?
Were tables detected?
Did semester totals match?
Did the parser fail because of regex?
Was the image too blurry or too small?
```

---

## 3. Updated Image Scraper Pipeline

```text
User uploads image / screenshot / image-based PDF
        |
        v
File classification
        |
        v
Image extraction / rendering
        |
        v
Image quality analysis
        |
        v
Image preprocessing
        |
        v
Table region detection
        |
        v
OCR per table region
        |
        v
OCR box grouping into rows
        |
        v
Column reconstruction
        |
        v
Semester detection
        |
        v
Course row parsing
        |
        v
SC tag detection
        |
        v
Validation
        |
        v
Confidence scoring
        |
        v
Debug report generation
        |
        v
Review UI
```

---

## 4. File Classification

The backend must first classify the uploaded file.

### Supported Types

```text
jpg / jpeg / png / webp      -> image OCR pipeline
pdf with text layer          -> PDF text/table extractor
pdf without text layer       -> image OCR pipeline
spreadsheet                  -> spreadsheet extractor
docx                         -> document extractor
unknown                      -> fallback OCR or manual review
```

### PDF Classification Logic

A converted screenshot PDF is still an image-based PDF. Normal PDF text extraction will fail.

```python
def classify_uploaded_file(file_path):
    ext = file_path.lower().split(".")[-1]

    if ext in ["jpg", "jpeg", "png", "webp"]:
        return "image"

    if ext == "pdf":
        text = extract_pdf_text(file_path)

        if text and len(text.strip()) > 100:
            return "text_pdf"

        return "image_pdf"

    if ext in ["xlsx", "xls", "csv"]:
        return "spreadsheet"

    if ext == "docx":
        return "document"

    return "unknown"
```

### Debug Log Example

```json
{
  "stage": "file_classification",
  "status": "passed",
  "file_type": "image_pdf",
  "message": "No text layer detected. Routing file to image OCR pipeline."
}
```

---

## 5. Image Quality Check

Before OCR, the system must check whether the image is suitable for extraction.

### Metrics to Capture

```text
image width
image height
estimated DPI
blur score
contrast score
skew angle
brightness
text density
table-line visibility
```

### Quality Rules

```text
width < 1000px              -> warning
height < 700px              -> warning
blur score too low          -> warning or fail
contrast too low            -> warning
skew angle > 3 degrees      -> deskew required
table lines not visible     -> warning
```

### Example Debug Output

```json
{
  "stage": "image_quality_check",
  "status": "warning",
  "metrics": {
    "width": 1024,
    "height": 768,
    "blur_score": 61.7,
    "contrast_score": 0.43,
    "skew_angle": -0.6
  },
  "message": "Image is readable but low resolution. OCR accuracy may be reduced."
}
```

---

## 6. Image Preprocessing

The scraper should create processed image versions before OCR.

### Preprocessing Steps

```text
1. Convert to grayscale
2. Increase contrast
3. Remove noise
4. Deskew
5. Resize or upscale image
6. Threshold image
7. Detect table lines
8. Save debug images
```

### Important Debug Artifacts

Save these files per extraction job:

```text
debug/original.png
debug/grayscale.png
debug/thresholded.png
debug/deskewed.png
debug/table_lines_detected.png
debug/ocr_boxes.png
debug/table_regions/
```

### Example Debug Log

```json
{
  "stage": "preprocessing",
  "status": "passed",
  "outputs": {
    "deskew_applied": true,
    "deskew_angle": -0.6,
    "upscaled": true,
    "scale_factor": 2,
    "debug_images_saved": true
  }
}
```

---

## 7. Table Region Detection

For curriculum plan images, the scraper must detect table regions before OCR.

Do not OCR the whole page as one block.

### Why Table Detection Matters

Curriculum images usually contain many separate tables:

```text
Semester 1 table
Semester 2 table
Semester 3 table
Semester 4 table
Semester 5 table
Semester 6 table
Semester 7 table
Elective courses table
Notes section
Total credit row
```

If OCR is run on the full image, the text order can become mixed.

### Detection Methods

Use a combination of:

```text
OpenCV line detection
contour detection
layout model
projection profile
known table-like rectangle detection
```

### Debug Log Example

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
      "classification": "semester_table",
      "confidence": 0.91
    },
    {
      "region_id": "table_8",
      "x": 610,
      "y": 640,
      "width": 360,
      "height": 230,
      "classification": "elective_table",
      "confidence": 0.88
    }
  ]
}
```

### Failure Message

If no tables are found:

```json
{
  "stage": "table_detection",
  "status": "failed",
  "error_code": "NO_TABLE_REGIONS_FOUND",
  "message": "OCR cannot continue reliably because no table regions were detected.",
  "suggestion": "Check preprocessing output and table-line detection image."
}
```

---

## 8. OCR per Table Region

Run OCR on each cropped table region, not on the full image.

### Recommended OCR Engines

```text
Primary: PaddleOCR or Google Cloud Vision
Fallback: Tesseract
Enterprise option: AWS Textract or Azure Document Intelligence
```

### OCR Output Format

Each OCR result should preserve text, confidence, and bounding box.

```json
{
  "region_id": "semester_1",
  "text": "BIK 10203",
  "confidence": 0.94,
  "bbox": {
    "x": 82,
    "y": 202,
    "width": 68,
    "height": 14
  }
}
```

### Debug Log Example

```json
{
  "stage": "ocr",
  "status": "passed",
  "engine": "paddleocr",
  "regions_processed": 8,
  "text_blocks_detected": 284,
  "average_confidence": 0.86,
  "low_confidence_blocks": 14
}
```

### Failure Message

```json
{
  "stage": "ocr",
  "status": "failed",
  "error_code": "OCR_NO_TEXT_FOUND",
  "message": "OCR completed but no readable text was detected.",
  "suggestion": "Image may be too blurry, too small, or preprocessing may have removed text."
}
```

---

## 9. Row Reconstruction from OCR Boxes

OCR returns text boxes, not clean table rows.

The scraper must group OCR boxes into rows using y-coordinate proximity.

### Row Grouping Logic

```python
def group_ocr_boxes_into_rows(ocr_boxes, y_tolerance=8):
    rows = []

    for box in sorted(ocr_boxes, key=lambda b: b["y"]):
        matched_row = None

        for row in rows:
            if abs(row["y"] - box["y"]) <= y_tolerance:
                matched_row = row
                break

        if matched_row:
            matched_row["items"].append(box)
        else:
            rows.append({
                "y": box["y"],
                "items": [box]
            })

    for row in rows:
        row["items"] = sorted(row["items"], key=lambda b: b["x"])

    return rows
```

### Debug Output

```json
{
  "stage": "row_reconstruction",
  "status": "passed",
  "rows_created": 47,
  "sample_rows": [
    "BIK 10203 Algoritma dan Pengaturcaraan 3 SC",
    "BIK 10303 Senibina Komputer 3 SC",
    "Jumlah 19"
  ]
}
```

---

## 10. Column Reconstruction

Rows must be split into logical columns.

Expected columns:

```text
Sem | Kod Kursus | Nama Kursus | Kredit | Tag
```

The parser should use x-coordinate boundaries, not only text spacing.

### Column Mapping Example

```text
x = 0-50       -> semester
x = 50-150     -> course code
x = 150-450    -> course name
x = 450-500    -> credit
x = 500+       -> tag / SC
```

Because table positions can vary, column boundaries should be calculated per detected table region.

### Debug Log Example

```json
{
  "stage": "column_reconstruction",
  "status": "passed",
  "columns_detected": ["sem", "course_code", "course_name", "credit", "tag"],
  "sample_row": {
    "sem": "1",
    "course_code": "BIK 10203",
    "course_name": "Algoritma dan Pengaturcaraan",
    "credit": "3",
    "tag": "SC"
  }
}
```

---

## 11. Course Code Normalization

The scraper must normalize OCR mistakes before parsing.

### Common OCR Mistakes

```text
B1K       -> BIK
BlK       -> BIK
B|K       -> BIK
U0I       -> UQI
UQl       -> UQI
O         -> 0 inside course code
I         -> 1 inside course code
missing space: BIK10203 -> BIK 10203
```

### Normalization Function

```python
def normalize_course_code(raw_code):
    code = raw_code.upper().strip()

    replacements = {
        "B1K": "BIK",
        "BLK": "BIK",
        "B|K": "BIK",
        "U0I": "UQI",
        "UQL": "UQI"
    }

    for wrong, right in replacements.items():
        code = code.replace(wrong, right)

    code = re.sub(r"([A-Z]{2,4})(\d{5})", r"\1 \2", code)

    return code
```

### Correction Log

Every correction should be logged.

```json
{
  "stage": "normalization",
  "type": "ocr_correction",
  "before": "B1K 10203",
  "after": "BIK 10203",
  "reason": "common_ocr_confusion",
  "confidence": 0.82
}
```

---

## 12. Course Row Parser

The parser must support flexible course code formats.

### Expected Code Formats

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

### Regex Example

```python
COURSE_CODE_REGEX = r'''
(
  [A-Z]{2,4}\s?\d{5}
  |
  [A-Z]{2,4}\s?\d{5}/\d{5}
  |
  [A-Z]{2,4}\s?\d{3,5}/\d{3,5}
  |
  UQ\*\s?1\*\*\*1
  |
  BI\*\s?3\*\*03
  |
  BIT?\s?\*{3,4}3
)
'''
```

### Course Row Output

```json
{
  "semester": 1,
  "course_code": "BIK 10203",
  "course_name": "Algoritma dan Pengaturcaraan",
  "credit": 3,
  "tag": "SC",
  "source": {
    "region_id": "semester_1",
    "row_index": 6,
    "ocr_confidence": 0.91
  }
}
```

---

## 13. Rejected Row Logging

Do not silently ignore rows.

Every rejected row must have a reason.

### Rejection Categories

```text
expected_rejection
unexpected_rejection
critical_rejection
```

### Expected Rejections

```text
Jumlah
Jumlah Keseluruhan Kredit
TAHUN 1
TAHUN 2
Notes
Update date
table headers
meeting references
```

### Unexpected Rejections

```text
Rows that look like courses but fail parsing
Rows containing BIK/UHB/UQI/UQU but no credit
Rows containing credit but no course code
Rows with low OCR confidence
```

### Example Rejected Row Log

```json
{
  "stage": "course_row_parser",
  "status": "warning",
  "rejected_rows": [
    {
      "raw_text": "BIK 10203 Algoritma dan Pengaturcaraan 3 SC",
      "reason": "regex_pattern_failed",
      "severity": "critical",
      "suggestion": "Update course-code regex or inspect OCR normalization."
    },
    {
      "raw_text": "Jumlah 19",
      "reason": "summary_total_row",
      "severity": "info",
      "suggestion": null
    }
  ]
}
```

---

## 14. Semester Detection

Semester detection should not depend on only one method.

### Detection Methods

```text
1. Read semester number from the Sem column
2. Read nearby year labels, such as TAHUN 1 / TAHUN 2 / TAHUN 3
3. Infer semester from table position
4. Infer semester from known semester totals
```

### Fallback Layout Mapping

If OCR misses the semester column, infer from table position.

Example:

```text
top-left table       -> semester 1
top-right table      -> semester 2
middle-left table    -> semester 3
middle-right table   -> semester 4
lower-left table     -> semester 5
lower-right table    -> semester 6
bottom-left small    -> semester 7
```

This mapping should be configurable, not hardcoded permanently.

### Debug Log Example

```json
{
  "stage": "semester_detection",
  "status": "partial_success",
  "method": "layout_fallback",
  "semesters_detected": [1, 2, 3, 4, 5, 6, 7],
  "message": "Semester column was weak, but semesters were inferred from table position."
}
```

---

## 15. SC Tag Detection

Yellow `SC` markers may be missed by OCR.

Use both OCR and color detection.

### Method 1: OCR-Based

If OCR detects `SC`, assign it to the nearest course row.

### Method 2: Color-Based

Detect yellow regions using HSV color thresholding.

```python
def detect_yellow_regions(image):
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

    lower_yellow = (20, 80, 80)
    upper_yellow = (40, 255, 255)

    mask = cv2.inRange(hsv, lower_yellow, upper_yellow)

    return mask
```

### Assignment Rule

```text
yellow box y-coordinate close to course row y-coordinate
-> assign tag = "SC"
```

### Debug Log Example

```json
{
  "stage": "sc_detection",
  "status": "passed",
  "yellow_regions_detected": 10,
  "sc_tags_assigned": 10
}
```

---

## 16. Validation Engine

Validation is required to detect hidden scraping errors.

### Row-Level Validation

```text
course_code exists
course_name exists
credit exists
credit is numeric
credit is within allowed range
semester exists
OCR confidence above threshold
course code format valid
```

### Document-Level Validation

```text
semester totals match
overall credit total matches
minimum number of courses detected
all required semesters detected
duplicate course codes checked
elective rows detected
programme info detected
```

### Example Expected Totals

For many curriculum plans:

```text
Semester 1 total = 19 or 20
Semester 2 total = 19 or 20
Semester 3 total = 19 or 20
Semester 4 total = 19 or 20
Semester 5 total = 16 or 20
Semester 6 total = 16 or 20
Semester 7 total = 12
Overall total = 120
```

These should be read from the document when possible, not hardcoded.

### Validation Output

```json
{
  "stage": "validation",
  "status": "failed",
  "checks": {
    "overall_total_found": 120,
    "calculated_total": 96,
    "overall_total_match": false,
    "semesters_detected": [1, 2, 3, 4],
    "missing_semesters": [5, 6, 7]
  },
  "message": "Calculated total does not match document total. Some rows were likely missed."
}
```

---

## 17. Confidence Scoring

Each course and the whole extraction job should have confidence scores.

### Row Confidence Inputs

```text
OCR confidence
course-code regex match
credit detected
row grouping quality
semester detection method
whether auto-correction was used
whether row passed validation
```

### Example Formula

```python
def score_course(row):
    score = 1.0

    if row["ocr_confidence"] < 0.85:
        score -= 0.15

    if row.get("auto_corrected"):
        score -= 0.05

    if row.get("semester_detection_method") == "layout_fallback":
        score -= 0.05

    if row.get("tag") == "SC" and row.get("tag_detection_method") == "color_fallback":
        score -= 0.03

    if row.get("validation_errors"):
        score -= 0.30

    return max(score, 0.0)
```

### Job Confidence

```text
average row confidence
number of validation errors
number of critical rejected rows
whether total credits match
whether all semesters were detected
```

---

## 18. Status Model

The scraper should return clear statuses.

```text
SUCCESS
PARTIAL_SUCCESS
NEEDS_REVIEW
FAILED
```

### Status Rules

```text
SUCCESS
- all required sections detected
- all semester totals match
- overall total matches
- confidence above threshold

PARTIAL_SUCCESS
- most subjects detected
- minor warnings exist
- validation mostly passes

NEEDS_REVIEW
- extraction produced data
- but confidence is low or totals mismatch

FAILED
- no OCR text
- no tables detected
- no valid course rows
- severe validation failure
```

### Example

```json
{
  "status": "NEEDS_REVIEW",
  "message": "OCR succeeded but course row parsing failed.",
  "confidence": 0.42
}
```

---

## 19. Debug API Response Design

The frontend should receive structured debug information.

```json
{
  "job_id": "job_123",
  "status": "NEEDS_REVIEW",
  "summary": {
    "file_type": "image_pdf",
    "ocr_used": true,
    "tables_detected": 8,
    "subjects_detected": 0,
    "warnings": 2,
    "confidence": 0.42
  },
  "stage_results": [
    {
      "stage": "file_classification",
      "status": "passed",
      "message": "Image-based PDF detected."
    },
    {
      "stage": "image_quality_check",
      "status": "warning",
      "message": "Image resolution is low."
    },
    {
      "stage": "ocr",
      "status": "passed",
      "message": "OCR detected 284 text blocks."
    },
    {
      "stage": "row_reconstruction",
      "status": "passed",
      "message": "47 rows reconstructed."
    },
    {
      "stage": "course_row_parser",
      "status": "failed",
      "message": "0 rows matched course pattern."
    }
  ],
  "debug": {
    "ocr_text_sample": [
      "BIK 10203 Algoritma dan Pengaturcaraan 3 SC",
      "BIK 10303 Senibina Komputer 3 SC",
      "Jumlah 19"
    ],
    "rejected_rows": [
      {
        "raw_text": "BIK 10203 Algoritma dan Pengaturcaraan 3 SC",
        "reason": "regex_pattern_failed",
        "suggestion": "Update parser to support BIK course codes."
      }
    ],
    "debug_images": {
      "table_detection": "/debug/job_123/table_lines_detected.png",
      "ocr_boxes": "/debug/job_123/ocr_boxes.png"
    }
  }
}
```

---

## 20. Frontend Review UI Improvements

The frontend should show more than warning banners.

### Add Debug Panel

```text
Extraction Summary
- File type
- OCR used
- OCR engine
- Tables detected
- Rows reconstructed
- Subjects detected
- Confidence score
- Validation status
```

### Add Stage Timeline

```text
File classification       Passed
Image quality check       Warning
Preprocessing             Passed
Table detection           Passed
OCR                       Passed
Row reconstruction        Passed
Course parser             Failed
Validation                Skipped
```

### Add Rejected Rows Section

Show:

```text
Raw row
Reason rejected
Severity
Suggested fix
OCR confidence
Source table/region
```

### Add Debug Image Viewer

Allow developers/admins to inspect:

```text
original image
preprocessed image
table detection output
OCR bounding boxes
cropped tables
```

---

## 21. Database Tables for Debuggable Scraping

### extraction_jobs

```sql
CREATE TABLE extraction_jobs (
    id BIGINT PRIMARY KEY,
    file_name VARCHAR(255),
    file_type VARCHAR(50),
    status VARCHAR(50),
    final_confidence DECIMAL(5,2),
    created_at TIMESTAMP,
    completed_at TIMESTAMP
);
```

### extraction_stage_logs

```sql
CREATE TABLE extraction_stage_logs (
    id BIGINT PRIMARY KEY,
    job_id BIGINT,
    stage_name VARCHAR(100),
    status VARCHAR(50),
    message TEXT,
    metadata_json JSON,
    created_at TIMESTAMP
);
```

### ocr_blocks

```sql
CREATE TABLE ocr_blocks (
    id BIGINT PRIMARY KEY,
    job_id BIGINT,
    page_number INT,
    region_id VARCHAR(100),
    text TEXT,
    confidence DECIMAL(5,2),
    bbox_json JSON
);
```

### detected_tables

```sql
CREATE TABLE detected_tables (
    id BIGINT PRIMARY KEY,
    job_id BIGINT,
    page_number INT,
    region_id VARCHAR(100),
    table_type VARCHAR(100),
    bbox_json JSON,
    confidence DECIMAL(5,2)
);
```

### parsed_courses

```sql
CREATE TABLE parsed_courses (
    id BIGINT PRIMARY KEY,
    job_id BIGINT,
    semester INT,
    course_code VARCHAR(50),
    course_name VARCHAR(255),
    credit INT,
    tag VARCHAR(20),
    confidence DECIMAL(5,2),
    source_region_id VARCHAR(100)
);
```

### rejected_rows

```sql
CREATE TABLE rejected_rows (
    id BIGINT PRIMARY KEY,
    job_id BIGINT,
    raw_text TEXT,
    reason VARCHAR(100),
    severity VARCHAR(50),
    suggestion TEXT,
    source_region_id VARCHAR(100)
);
```

---

## 22. Practical Implementation Priority

### Phase 1: Basic Debug Visibility

Implement first:

```text
file classification
OCR pipeline for image/image-PDF
raw OCR output storage
stage logs
rejected row logging
frontend debug panel
```

Goal:

```text
When scraping fails, developers can see why.
```

---

### Phase 2: Better Image Extraction

Implement:

```text
image preprocessing
table detection
table crop OCR
row reconstruction by coordinates
course-code normalization
flexible regex parser
```

Goal:

```text
Improve subject detection from screenshot/image inputs.
```

---

### Phase 3: Validation and Confidence

Implement:

```text
semester total validation
overall credit validation
row confidence score
job confidence score
status model
manual review queue
```

Goal:

```text
Prevent bad data from being saved silently.
```

---

### Phase 4: Advanced Fallback

Implement:

```text
vision model fallback
AI-assisted JSON extraction
schema validation
human approval before saving
```

Goal:

```text
Handle difficult images that OCR/table detection cannot parse reliably.
```

---

## 23. Most Likely Current Failure Causes

Based on the current UI showing `0 subjects detected`, the likely causes are:

```text
1. Image-based PDF is being sent to normal PDF text scraper.
2. OCR is not triggered for image-based PDFs.
3. OCR runs but output is not stored or displayed.
4. OCR output is fragmented and not reconstructed into rows.
5. Course-code regex does not support BIK/UHB/UQI/UQ*/BI* formats.
6. Parser expects semester structure before extracting rows.
7. Semester column is missed by OCR, causing all rows to be ignored.
8. Debug logs are not exposed to the frontend.
```

---

## 24. Recommended Immediate Fix

The immediate fix should be:

```text
1. Detect image-based PDFs automatically.
2. Route image-based PDFs and images to the same OCR pipeline.
3. Save raw OCR text and OCR boxes.
4. Display OCR sample in debug panel.
5. Show stage-by-stage logs in the UI.
6. Add rejected row logs with reasons.
7. Update course-code regex to support BIK curriculum formats.
8. Add layout-based semester fallback.
```

---

## 25. Final Target Behavior

When scraping works:

```json
{
  "status": "SUCCESS",
  "subjects_detected": 35,
  "semesters_detected": [1, 2, 3, 4, 5, 6, 7],
  "overall_total_found": 120,
  "calculated_total": 120,
  "confidence": 0.91
}
```

When scraping partially works:

```json
{
  "status": "NEEDS_REVIEW",
  "subjects_detected": 31,
  "warnings": 5,
  "message": "Some rows require review. Overall total does not match.",
  "debug_available": true
}
```

When scraping fails:

```json
{
  "status": "FAILED",
  "subjects_detected": 0,
  "message": "OCR succeeded but course parser rejected all rows.",
  "root_cause": "course_code_regex_failed",
  "next_action": "Update regex pattern and inspect rejected rows."
}
```

---

## 26. Final Summary

The main issue is not only image scraping accuracy. The bigger issue is lack of visibility.

The scraper should be redesigned as a transparent pipeline:

```text
extract
-> log
-> parse
-> validate
-> explain
-> review
```

The system must process image uploads directly. Users should not need to convert screenshots into PDFs.

For every failed extraction, the system should show:

```text
which stage failed
why it failed
what raw data was detected
which rows were rejected
what validation failed
what the suggested fix is
```

This will make the scraper easier to debug, easier to improve, and safer for production use.
