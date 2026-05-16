/**
 * Test the columnar extraction against real BIT20252026 PDF
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const testDir = join(process.cwd(), 'test/pelan-pengajian');

async function testColumnar(filename) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(join(testDir, filename)));
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1.0 });
  const content = await page.getTextContent();

  const items = content.items
    .filter(i => i.str?.trim())
    .map(i => ({
      str: i.str,
      x: Math.round(i.transform[4]),
      y: Math.round(viewport.height - i.transform[5]),
    }));

  // Import our columnar extractor
  const COURSE_CODE_RE = /^[A-Z]{2,4}[\s\*]?[\d\*]{2,6}$|^[A-Z]{2,4}\d{5,7}$/;
  const COURSE_CODE_WITH_NAME_RE = /^([A-Z]{2,4}[\s\*]?[\d\*]{2,6}|[A-Z]{2,4}\d{5,7})\s+(.+)/;

  // Group by Y
  const yTol = 5;
  const rows = [];
  const sorted = [...items].sort((a, b) => a.y - b.y);
  let cur = null;
  for (const it of sorted) {
    if (!cur || Math.abs(it.y - cur.y) > yTol) {
      cur = { y: it.y, cells: [] };
      rows.push(cur);
    }
    cur.cells.push(it);
  }

  let codeCount = 0;
  for (const row of rows) {
    const texts = row.cells.map(c => c.str.trim()).filter(Boolean);
    const codes = texts.filter(t => COURSE_CODE_RE.test(t) || COURSE_CODE_WITH_NAME_RE.test(t));
    if (codes.length >= 3) {
      console.log(`\nCode row at Y=${row.y}: ${codes.length} codes found`);
      for (const c of codes) console.log(`  - ${c}`);
      codeCount += codes.length;
    }
  }
  
  console.log(`\nTotal codes detected: ${codeCount}`);
  console.log(`File: ${filename}`);
}

for (const f of ['pelan-pengajian-BIT20252026.pdf', 'pelan-pengajian-BIT20242025.pdf']) {
  console.log(`\n${'='.repeat(60)}`);
  await testColumnar(f);
}
