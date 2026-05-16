# Flexible File Scraping and Data Extraction Planning

## 1. Objective

The goal is to build a system that can accept flexible user-uploaded files and extract structured academic study-plan data with minimum noise, minimum error, and clear validation.

The system should support different file types such as:

- PDF files with selectable text
- Scanned PDF files
- JPEG, PNG, or other image files
- Excel or CSV files
- Word documents
- Mixed-layout documents containing tables, notes, highlights, and totals

The system should not only extract data. It must also validate, score, log, and flag uncertain data before storing it as clean data.

---

## 2. Core Principle

Do not use one generic scraper for every file.

Use a pipeline that first identifies the file type, then chooses the correct extraction strategy.

```text
Uploaded File
   ↓
File Type Detection
   ↓
Extractor Router
   ↓
Specialized Extraction Method
   ↓
Normalization
   ↓
Domain Parsing
   ↓
Validation
   ↓
Confidence Scoring
   ↓
Save Clean Data + Log Uncertain Data
```

The scraper should produce three outputs:

1. **Clean structured data**
2. **Raw extraction data**
3. **Error or review logs**

This makes the system safer because uncertain rows are not silently ignored or wrongly saved.

---

## 3. Main Challenges

### 3.1 Different File Types

Each file type behaves differently.

| File Type | Main Problem | Recommended Strategy |
|---|---|---|
| Text PDF | Text may be out of order | PDF text extraction + table extraction |
| Scanned PDF | No selectable text | OCR + layout detection |
| Image | OCR errors and layout confusion | Image preprocessing + OCR + table detection |
| Excel / CSV | Usually structured but may contain merged cells | Spreadsheet parser |
| Word document | Tables may exist inside document body | DOCX parser + table extraction |

---

### 3.2 Layout Confusion

Academic study-plan files usually contain many sections:

- Year sections
- Semester tables
- Course rows
- Credit totals
- Elective course table
- Prerequisite table
- Notes
- International-student replacement notes
- Highlighted labels such as `SC`

The system must separate these correctly.

Example course row:

```text
BIK 10203 | Algoritma dan Pengaturcaraan | 3 | SC
```

Correct parsed output:

```json
{
  "course_code": "BIK 10203",
  "course_name": "Algoritma dan Pengaturcaraan",
  "credit": 3,
  "tag": "SC"
}
```

Wrong output to avoid:

```json
{
  "course_code": "BIK 10203",
  "course_name": "Algoritma dan Pengaturcaraan 3 SC",
  "credit": null
}
```

---

## 4. High-Level System Architecture

```text
Upload Service
   ↓
File Type Detector
   ↓
Extractor Factory / Router
   ↓
Specialized Extractor
      - PDFExtractor
      - ScannedPDFExtractor
      - ImageOCRExtractor
      - SpreadsheetExtractor
      - DocumentExtractor
   ↓
Preprocessor
   ↓
Layout Analyzer
   ↓
Table Extractor
   ↓
Domain Parser
   ↓
Validator
   ↓
Confidence Scorer
   ↓
Storage Layer
      - raw_extractions
      - clean_courses
      - scraping_errors
      - manual_review_queue
   ↓
Admin / Manual Review UI
```

---

## 5. File Type Detection

Start by identifying the uploaded file type.

```python
def detect_file_type(file_path):
    ext = file_path.lower().split(".")[-1]

    if ext == "pdf":
        return "pdf"

    if ext in ["jpg", "jpeg", "png", "webp"]:
        return "image"

    if ext in ["xlsx", "xls", "csv"]:
        return "spreadsheet"

    if ext == "docx":
        return "document"

    return "unknown"
```

Then route the file to a suitable extractor.

```python
def choose_extractor(file_type):
    if file_type == "pdf":
        return PDFExtractor()

    if file_type == "image":
        return ImageOCRExtractor()

    if file_type == "spreadsheet":
        return SpreadsheetExtractor()

    if file_type == "document":
        return DocumentExtractor()

    return GenericOCRExtractor()
```

---

## 6. Extraction Strategy by File Type

## 6.1 PDF with Text Layer

Use this priority:

```text
1. Extract selectable text
2. Extract tables
3. Use OCR only if text extraction fails
```

Recommended tools:

- `pdfplumber`
- `PyMuPDF`
- `Camelot`
- `Tabula`

Example:

```python
import pdfplumber


def extract_pdf_text(path):
    pages = []

    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            text = page.extract_text() or ""
            tables = page.extract_tables()

            pages.append({
                "page": page_number,
                "text": text,
                "tables": tables
            })

    return pages
```

---

## 6.2 Scanned PDF

If a PDF has no useful text layer, treat each page like an image.

Pipeline:

```text
PDF Page
   ↓
Render page as image
   ↓
Preprocess image
   ↓
Detect table regions
   ↓
OCR per region
   ↓
Reconstruct rows and columns
   ↓
Validate
```

Recommended tools:

- `PyMuPDF` for rendering PDF pages
- `OpenCV` for preprocessing
- `PaddleOCR`, `Tesseract`, Google Vision, AWS Textract, or Azure Document Intelligence for OCR

---

## 6.3 Image File

Image files require layout-aware OCR.

Do not OCR the entire image as one raw block if it contains multiple tables.

Use this approach:

```text
Image Input
   ↓
Preprocessing
   ↓
Table Region Detection
   ↓
Crop Each Table
   ↓
OCR Each Table Separately
   ↓
Group OCR Words into Rows
   ↓
Map Rows into Columns
   ↓
Parse Course Data
   ↓
Validate Totals and Fields
```

Recommended tools:

- `OpenCV`
- `PaddleOCR`
- `Tesseract OCR`
- `Google Vision OCR`
- `AWS Textract`
- `Azure Document Intelligence`
- `LayoutParser`

For table-heavy images, recommended combination:

```text
OpenCV table-line detection
+
PaddleOCR or Google Vision OCR
+
Custom course validation rules
```

---

## 6.4 Spreadsheet Files

Spreadsheet files are usually more structured, but may contain merged cells or multi-row headers.

Pipeline:

```text
Spreadsheet Input
   ↓
Read sheets
   ↓
Detect header rows
   ↓
Normalize merged cells
   ↓
Identify semester blocks
   ↓
Parse rows
   ↓
Validate credits and totals
```

Recommended tools:

- `openpyxl`
- `pandas`

---

## 6.5 Word Documents

Word documents may contain paragraphs, tables, and notes.

Pipeline:

```text
DOCX Input
   ↓
Extract paragraphs
   ↓
Extract tables
   ↓
Detect course rows
   ↓
Separate notes from course data
   ↓
Validate
```

Recommended tools:

- `python-docx`

---

## 7. Image Preprocessing Plan

For image or scanned PDF extraction, preprocess the image before OCR.

Common preprocessing steps:

1. Resize image if text is too small
2. Convert to grayscale
3. Increase contrast
4. Deskew image
5. Remove noise
6. Detect table borders
7. Crop table regions

Example:

```python
import cv2


def preprocess_image(image_path):
    image = cv2.imread(image_path)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    gray = cv2.equalizeHist(gray)

    binary = cv2.adaptiveThreshold(
        gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        11
    )

    return binary
```

---

## 8. Table Region Detection

For study-plan images, detect individual table sections instead of treating the whole image as one block.

Expected table regions may include:

- Semester 1 table
- Semester 2 table
- Semester 3 table
- Semester 4 table
- Semester 5 table
- Semester 6 table
- Semester 7 table
- Elective course table
- Notes section

Example region object:

```json
{
  "region_id": "semester_1",
  "x": 10,
  "y": 120,
  "width": 480,
  "height": 160,
  "type": "semester_table"
}
```

This improves:

- OCR accuracy
- Row grouping
- Semester detection
- Credit validation
- Noise reduction

---

## 9. OCR Word Box Handling

OCR engines usually return words or lines with bounding boxes.

Example OCR result:

```json
{
  "text": "BIK 10203",
  "x": 51,
  "y": 184,
  "width": 70,
  "height": 12,
  "confidence": 0.94
}
```

Group OCR boxes into rows using their vertical position.

```python
def group_words_into_rows(ocr_boxes, y_tolerance=8):
    rows = []

    for box in sorted(ocr_boxes, key=lambda b: b["y"]):
        placed = False

        for row in rows:
            if abs(row["y"] - box["y"]) <= y_tolerance:
                row["items"].append(box)
                placed = True
                break

        if not placed:
            rows.append({
                "y": box["y"],
                "items": [box]
            })

    for row in rows:
        row["items"] = sorted(row["items"], key=lambda b: b["x"])

    return rows
```

Then map OCR row items into expected columns:

```text
Sem | Kod Kursus | Nama Kursus | Kredit | Tag
```

---

## 10. Course Row Parsing

Academic study-plan data has predictable row structures.

Common course-code examples:

```text
BIK 10103
BIT 10303
UHB 13102
UQI 10102
UQI 10102/10202
UQ* 1***1
BIT ****3
BI* 3**03
UQU40103
```

The parser should support:

- Normal course codes
- Course codes without spaces
- Slash-separated codes
- Placeholder codes
- Elective placeholder codes

Example regex:

```python
COURSE_CODE_PATTERN = r"""
(
    [A-Z]{2,4}\s?\d{5}
    |
    [A-Z]{2,4}\s?\d{3,5}\/\d{3,5}
    |
    UQ\*\s?1\*\*\*1
    |
    BI\*\s?3\*\*03
    |
    BIT\s?\*\*\*\*3
)
"""
```

Example parsed row:

```json
{
  "year": 1,
  "semester": 1,
  "course_code": "BIK 10203",
  "course_name": "Algoritma dan Pengaturcaraan",
  "credit": 3,
  "tag": "SC",
  "source_type": "image_ocr",
  "ocr_confidence": 0.93
}
```

---

## 11. Text Normalization

Before parsing, normalize OCR or extracted text.

```python
import re


def normalize_text(text):
    text = text.replace("\u00a0", " ")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n+", "\n", text)
    return text.strip()


def normalize_course_code(code):
    code = code.strip().upper()
    code = re.sub(r"\s+", " ", code)
    code = re.sub(r"^([A-Z]{2,4})(\d{5})$", r"\1 \2", code)
    return code
```

Examples:

```text
BIT10303  → BIT 10303
BIK10103  → BIK 10103
UQU40103  → UQU 40103
```

---

## 12. Common OCR Error Correction

OCR may confuse letters and numbers.

Common examples:

```text
B1K → BIK
BlK → BIK
U0I → UQI
O → 0 in numeric parts
I → 1 in numeric parts
```

Example:

```python
def correct_common_ocr_errors(text):
    replacements = {
        "B1K": "BIK",
        "BlK": "BIK",
        "U0I": "UQI"
    }

    for wrong, right in replacements.items():
        text = text.replace(wrong, right)

    return text
```

Important rule:

> Auto-corrections must be logged.

Example correction log:

```json
{
  "raw_value": "B1K 10203",
  "corrected_value": "BIK 10203",
  "correction_type": "ocr_common_replacement",
  "confidence": 0.89
}
```

---

## 13. Detecting Highlighted Tags such as SC

Some files contain highlighted labels such as `SC` beside course rows.

There are two methods.

### 13.1 OCR-Based Detection

If OCR reads `SC`, attach it to the nearest course row based on coordinates.

```text
SC at same y-position as BIK 10203
→ tag BIK 10203 as SC
```

### 13.2 Color-Based Detection

If the tag is highlighted in yellow, detect yellow regions using OpenCV.

```python
def detect_yellow_regions(image):
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

    lower_yellow = (20, 80, 80)
    upper_yellow = (40, 255, 255)

    mask = cv2.inRange(hsv, lower_yellow, upper_yellow)

    return mask
```

Then attach detected yellow regions to the nearest OCR row.

---

## 14. Separating Main Course Rows, Electives, Prerequisites, and Notes

Do not save all extracted rows as normal courses.

Classify rows into categories:

```text
main_course
university_course
elective_placeholder
elective_course
prerequisite_mapping
note
total_row
header_row
unknown_row
```

Example classification:

```python
def classify_row(row_text):
    lower = row_text.lower()

    if "jumlah keseluruhan kredit" in lower:
        return "overall_total"

    if lower.startswith("jumlah"):
        return "semester_total"

    if "for international students" in lower:
        return "note"

    if "elektif" in lower:
        return "elective"

    if "mesti lulus" in lower:
        return "prerequisite_mapping"

    if re.search(COURSE_CODE_PATTERN, row_text, re.VERBOSE):
        return "course_row"

    return "unknown_row"
```

---

## 15. Validation Strategy

Validation is the most important part of the system.

The system should not assume extraction is correct just because OCR returned text.

Use multiple validation layers:

1. Field validation
2. Pattern validation
3. Credit validation
4. Semester total validation
5. Overall total validation
6. Duplicate detection
7. Section completeness check
8. OCR confidence check
9. Layout consistency check

---

## 16. Field-Level Validation

Each course row must have:

- Course code
- Course name
- Credit
- Semester
- Source region

Example:

```python
VALID_CREDIT_VALUES = {1, 2, 3, 4, 12}


def validate_course_row(row):
    errors = []
    warnings = []

    if not row.get("course_code"):
        errors.append("missing_course_code")

    if not row.get("course_name"):
        errors.append("missing_course_name")

    if row.get("credit") not in VALID_CREDIT_VALUES:
        errors.append("invalid_credit_value")

    if row.get("ocr_confidence", 1.0) < 0.80:
        warnings.append("low_ocr_confidence")

    if "*" in row.get("course_code", ""):
        warnings.append("placeholder_course_code")

    return {
        "is_valid": len(errors) == 0,
        "errors": errors,
        "warnings": warnings
    }
```

---

## 17. Semester and Overall Credit Validation

Academic study plans usually contain totals. Use them as strong validation anchors.

Example for one image file:

```python
EXPECTED_TOTALS = {
    1: 19,
    2: 19,
    3: 19,
    4: 19,
    5: 16,
    6: 16,
    7: 12
}

EXPECTED_OVERALL_TOTAL = 120
```

Validation function:

```python
def validate_semester_totals(courses):
    errors = []

    for sem, expected in EXPECTED_TOTALS.items():
        actual = sum(
            course["credit"]
            for course in courses
            if course["semester"] == sem
        )

        if actual != expected:
            errors.append({
                "type": "semester_total_mismatch",
                "semester": sem,
                "expected": expected,
                "actual": actual,
                "severity": "high"
            })

    overall = sum(course["credit"] for course in courses)

    if overall != EXPECTED_OVERALL_TOTAL:
        errors.append({
            "type": "overall_total_mismatch",
            "expected": EXPECTED_OVERALL_TOTAL,
            "actual": overall,
            "severity": "critical"
        })

    return errors
```

---

## 18. Confidence Scoring

Each row should receive a confidence score.

Factors:

- OCR confidence
- Regex match confidence
- Required fields present
- Credit value valid
- Semester total match
- Overall total match
- Whether OCR fallback was used
- Whether auto-correction was applied
- Whether course code is a placeholder

Example:

```python
def score_course(row, validation):
    score = row.get("ocr_confidence", 1.0)

    if validation["errors"]:
        score -= 0.40

    if validation["warnings"]:
        score -= 0.08 * len(validation["warnings"])

    if row.get("source_type") == "ocr":
        score -= 0.05

    if row.get("auto_corrected"):
        score -= 0.05

    if "*" in row.get("course_code", ""):
        score -= 0.05

    return max(min(score, 1.0), 0.0)
```

Example output:

```json
{
  "semester": 1,
  "course_code": "BIK 10203",
  "course_name": "Algoritma dan Pengaturcaraan",
  "credit": 3,
  "tag": "SC",
  "confidence_score": 0.91,
  "errors": [],
  "warnings": []
}
```

---

## 19. Quality Gate

Before saving data as final clean data, run a quality gate.

```python
def quality_gate(result):
    if not result["sections_found"].get("semester_1"):
        return False, "semester_1_not_found"

    if not result["sections_found"].get("elective_courses"):
        return False, "elective_section_not_found"

    if not result["checks"].get("overall_total_match"):
        return False, "overall_total_mismatch"

    if result["metrics"].get("average_confidence", 0) < 0.85:
        return False, "low_average_confidence"

    if result["metrics"].get("unknown_row_ratio", 1) > 0.10:
        return False, "too_many_unknown_rows"

    return True, "passed"
```

The quality gate should return one of these statuses:

```text
SUCCESS
PARTIAL_SUCCESS
NEEDS_REVIEW
FAILED
```

---

## 20. Status Decision Logic

```python
def get_status(validation_errors, confidence):
    critical_errors = [
        error for error in validation_errors
        if error.get("severity") == "critical"
    ]

    if critical_errors:
        return "FAILED"

    if confidence < 0.75:
        return "NEEDS_REVIEW"

    if validation_errors:
        return "PARTIAL_SUCCESS"

    return "SUCCESS"
```

Example API response:

```json
{
  "status": "PARTIAL_SUCCESS",
  "confidence": 0.87,
  "message": "Data extracted, but 4 rows need review.",
  "checks": {
    "semester_totals_match": true,
    "overall_total_match": true,
    "low_confidence_rows": 4,
    "ocr_used": true
  }
}
```

---

## 21. Error Logging

Do not silently skip errors.

Every suspicious row should be stored in an error log.

Example:

```python
def log_scraping_issue(issue_log, page, region, raw_text, error_type, severity):
    issue_log.append({
        "page": page,
        "region": region,
        "raw_text": raw_text,
        "error_type": error_type,
        "severity": severity
    })
```

Example error log:

```json
{
  "page": 1,
  "region": "semester_2",
  "raw_text": "B1K 10503 Pembangunan Perisian 3",
  "error_type": "possible_ocr_error",
  "severity": "medium",
  "suggested_fix": "BIK 10503"
}
```

---

## 22. Database Design

Recommended database tables:

```sql
CREATE TABLE uploaded_files (
    id BIGINT PRIMARY KEY,
    original_file_name VARCHAR(255),
    file_type VARCHAR(50),
    extraction_status VARCHAR(50),
    overall_confidence DECIMAL(5,2),
    created_at TIMESTAMP
);

CREATE TABLE raw_extractions (
    id BIGINT PRIMARY KEY,
    file_id BIGINT,
    page_number INT,
    region_id VARCHAR(100),
    raw_text TEXT,
    ocr_confidence DECIMAL(5,2),
    bounding_box JSON,
    created_at TIMESTAMP
);

CREATE TABLE clean_courses (
    id BIGINT PRIMARY KEY,
    file_id BIGINT,
    year INT,
    semester INT,
    course_code VARCHAR(50),
    course_name VARCHAR(255),
    credit INT,
    category VARCHAR(50),
    tag VARCHAR(20),
    is_placeholder BOOLEAN,
    source_region VARCHAR(100),
    confidence_score DECIMAL(5,2),
    created_at TIMESTAMP
);

CREATE TABLE course_prerequisites (
    id BIGINT PRIMARY KEY,
    file_id BIGINT,
    course_code VARCHAR(50),
    prerequisite_code VARCHAR(50),
    minimum_grade VARCHAR(20),
    created_at TIMESTAMP
);

CREATE TABLE scraping_errors (
    id BIGINT PRIMARY KEY,
    file_id BIGINT,
    page_number INT,
    region_id VARCHAR(100),
    severity VARCHAR(20),
    error_type VARCHAR(100),
    raw_text TEXT,
    suggested_fix TEXT,
    created_at TIMESTAMP
);

CREATE TABLE manual_review_queue (
    id BIGINT PRIMARY KEY,
    file_id BIGINT,
    related_row_id BIGINT,
    review_type VARCHAR(100),
    raw_value TEXT,
    suggested_value TEXT,
    status VARCHAR(50),
    created_at TIMESTAMP
);
```

---

## 23. Manual Review Interface

The system should include a manual review page for uncertain data.

Show:

- Cropped original image/table region
- Raw OCR text
- Parsed result
- Confidence score
- Validation warnings
- Suggested correction
- Approve / Edit / Reject buttons

Example review item:

```json
{
  "raw_text": "B1K 10203 Algoritma dan Pengaturcaraan 3",
  "suggested_value": {
    "course_code": "BIK 10203",
    "course_name": "Algoritma dan Pengaturcaraan",
    "credit": 3
  },
  "warning": "possible_ocr_error_B1K_should_be_BIK"
}
```

---

## 24. Recommended Backend Flow

```python
class ExtractionPipeline:
    def run(self, file_path):
        file_type = detect_file_type(file_path)

        extractor = ExtractorFactory.get_extractor(file_type)

        raw_result = extractor.extract(file_path)

        normalized_result = normalize(raw_result)

        parsed_data = parse_study_plan(normalized_result)

        validation_result = validate(parsed_data)

        confidence = score_extraction(parsed_data, validation_result)

        quality_passed, quality_reason = quality_gate({
            "sections_found": parsed_data["sections_found"],
            "checks": validation_result["checks"],
            "metrics": validation_result["metrics"]
        })

        status = get_status(validation_result["errors"], confidence)

        save_result(
            raw_result=raw_result,
            parsed_data=parsed_data,
            validation_result=validation_result,
            confidence=confidence,
            status=status
        )

        return {
            "status": status,
            "quality_passed": quality_passed,
            "quality_reason": quality_reason,
            "data": parsed_data,
            "validation": validation_result,
            "confidence": confidence
        }
```

---

## 25. How to Know Scraping Has Errors

The system cannot guarantee zero error, especially with image-based OCR. Instead, it should detect risk.

Use these checks:

```text
OCR confidence check
Course-code regex validation
Credit-value validation
Missing-field detection
Semester total validation
Overall credit total validation
Duplicate course-code detection
Unknown-row ratio
Layout consistency check
Auto-correction log
Manual-review queue
```

Extraction should only be trusted when:

```text
All required sections are found
All semester totals match
Overall credit total matches
Course credits are numeric
Course codes match expected pattern
Average confidence is above threshold
Unknown row ratio is below threshold
Critical errors are zero
```

---

## 26. Recommended Thresholds

| Metric | Suggested Threshold |
|---|---:|
| Average OCR confidence | >= 0.85 |
| Row confidence for auto-approve | >= 0.90 |
| Row confidence for manual review | 0.70 - 0.89 |
| Row confidence for reject/fail | < 0.70 |
| Unknown row ratio | <= 10% |
| Critical validation errors | 0 |
| Overall credit mismatch | Fail |
| Missing semester section | Fail or review |

---

## 27. Final Recommended Implementation Plan

### Phase 1: Basic Extraction

Build support for:

- PDF text extraction
- Image OCR extraction
- Basic course-row regex parsing
- JSON output

### Phase 2: Validation Engine

Add:

- Credit validation
- Course-code validation
- Semester total validation
- Overall credit validation
- Error logging

### Phase 3: Layout-Aware Extraction

Add:

- Table detection
- OCR per cropped region
- Row/column reconstruction
- Highlighted `SC` tag detection

### Phase 4: Storage and Review

Add:

- Raw extraction table
- Clean data table
- Error log table
- Manual review queue
- Review UI

### Phase 5: Production Hardening

Add:

- Retry mechanism
- Async processing queue
- File version tracking
- Audit logs
- User correction feedback loop
- Model improvement based on reviewed corrections

---

## 28. Final Summary

The best solution is not a simple scraper. It should be a flexible extraction and validation system.

Recommended approach:

```text
Detect file type
→ choose extractor
→ preprocess file
→ detect layout
→ extract text or OCR
→ reconstruct tables
→ parse academic data
→ validate fields and totals
→ score confidence
→ save clean data
→ log uncertain data
→ send low-confidence rows to manual review
```

The most important idea:

> The system should not only extract data. It should prove the extraction is reliable by validating the result against the document's own structure.

This makes the system safer for flexible user-uploaded files and prevents noisy or incorrect data from being saved into the main database.
