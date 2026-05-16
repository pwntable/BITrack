import { gradeRank } from '@/lib/gradeUtils';
import type { ParsedSubject } from '@/store/curriculumStore';

export type ExtractedSubject = {
  code: string;
  grade: string;
};

// More flexible regex to capture 2-4 letters and 2-5 digits/wildcards
export const SUBJECT_REGEX = /([A-Z]{2,4}\s?[\d\*]{2,5})\s+.+?\s+([A-F][+-]?|[DE][+-]?)/g;

// Pool is rebuilt per-curriculum dynamically
type PoolEntry = { code: string; credits: number; pattern: RegExp };

function buildPool(subjects: ParsedSubject[]): PoolEntry[] {
  const pool: PoolEntry[] = [];
  subjects.forEach(sub => {
    // Strip internal uniqueness suffix (e.g. "UQ 11 (I)" → "UQ 11") before building regex
    const strippedSuffix = sub.code.replace(/\s*\([IVX]+\)$/i, '');
    const clean = strippedSuffix.replace(/\s+/g, '').toUpperCase();
    const patternStr = '^' + clean.replace(/[\-\[\]\/\{\}\(\)\+\?\.\\\^\$\|]/g, '\\$&').replace(/\*/g, '.') + '$';
    pool.push({
      code: sub.code,
      credits: sub.credits,
      pattern: new RegExp(patternStr),
    });
  });
  return pool;
}

function normaliseCode(raw: string): string {
  let target = raw.replace(/\s+/g, '').toUpperCase();
  // Map UQD / UQL / UQS → UQ (Co-curricular)
  if (target.startsWith('UQD') || target.startsWith('UQL') || target.startsWith('UQS')) {
    target = 'UQ' + target.slice(3);
  }
  return target;
}

function findMatchingStandardCodes(
  extractedCode: string,
  pool: PoolEntry[],
): string[] {
  const target = normaliseCode(extractedCode);
  const matches = pool.filter(item => item.pattern.test(target));
  if (matches.length > 0) return matches.map(m => m.code);

  // Fallback: generic UQ → first UQ 11 variant
  if (target.startsWith('UQ') && target.length >= 4) {
    return pool.filter(p => p.code.startsWith('UQ 11')).map(m => m.code);
  }
  return [];
}

export function extractSubjects(
  rawTexts: string[],
  curriculumSubjects: ParsedSubject[],
): ExtractedSubject[] {
  const combinedText = rawTexts.join('\n');
  const results: ExtractedSubject[] = [];
  const allocatedSlots = new Set<string>();

  const pool = buildPool(curriculumSubjects);

  SUBJECT_REGEX.lastIndex = 0;

  let match;
  while ((match = SUBJECT_REGEX.exec(combinedText)) !== null) {
    const rawCode = match[1];
    const grade = match[2].toUpperCase();

    const standardCodes = findMatchingStandardCodes(rawCode, pool);
    if (standardCodes.length === 0) continue;

    let allocated = false;
    for (const sc of standardCodes) {
      if (!allocatedSlots.has(sc)) {
        allocatedSlots.add(sc);
        results.push({ code: sc, grade });
        allocated = true;
        break;
      }
    }

    // If all slots are filled, upgrade grade on first slot if better
    if (!allocated) {
      const firstCode = standardCodes[0];
      const existingIndex = results.findIndex(r => r.code === firstCode);
      if (existingIndex !== -1 && gradeRank(grade) > gradeRank(results[existingIndex].grade)) {
        results[existingIndex].grade = grade;
      }
    }
  }

  return results;
}
