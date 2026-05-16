import { gradeRank } from '@/lib/gradeUtils';
import curriculumData from '@/data/curriculum.json';
import electivesData from '@/data/electives.json';

export type ExtractedSubject = {
  code: string;
  grade: string;
};

// More flexible regex to capture 2-4 letters and 2-5 digits/wildcards
export const SUBJECT_REGEX = /([A-Z]{2,4}\s?[\d\*]{2,5})\s+.+?\s+([A-F][+-]?|[DE][+-]?)/g;

// List of all subjects for pattern matching
const CURRICULUM_POOL: { code: string; credits: number; pattern: RegExp }[] = [];

function preparePool() {
  const all = [
    ...curriculumData.curriculum.flatMap(y => y.semesters.flatMap(s => s.subjects)),
    ...electivesData
  ];

  all.forEach(sub => {
    // Strip (I), (II), etc. before creating the regex pattern
    const strippedSuffix = sub.code.replace(/\s*\([IV]+\)$/i, '');
    const clean = strippedSuffix.replace(/\s+/g, '').toUpperCase();
    
    // Convert wildcard * to regex . and escape other chars
    const patternStr = '^' + clean.replace(/[\-\[\]\/\{\}\(\)\+\?\.\\\^\$\|]/g, "\\$&").replace(/\*/g, '.') + '$';
    CURRICULUM_POOL.push({
      code: sub.code, // Keep original code like "UQ 11 (I)"
      credits: sub.credits,
      pattern: new RegExp(patternStr)
    });
  });
}

preparePool();

function findMatchingStandardCodes(extractedCode: string): string[] {
  const stripped = extractedCode.replace(/\s+/g, '').toUpperCase();
  
  // Normalize Aliases
  let target = stripped;
  // Map UQD / UQL -> UQ (Co-curricular)
  if (target.startsWith('UQD') || target.startsWith('UQL') || target.startsWith('UQS')) {
    target = 'UQ' + target.slice(3);
  }
  
  const matches = CURRICULUM_POOL.filter(item => item.pattern.test(target));
  if (matches.length > 0) return matches.map(m => m.code);

  // Fallback for generic UQ 11 if the target just starts with UQ and is short
  if (target.startsWith('UQ') && target.length >= 4) {
    return CURRICULUM_POOL.filter(p => p.code.startsWith('UQ 11')).map(m => m.code);
  }

  return [];
}

export function extractSubjects(rawTexts: string[]): ExtractedSubject[] {
  const combinedText = rawTexts.join('\n');
  const results: ExtractedSubject[] = [];
  const allocatedSlots = new Set<string>();

  SUBJECT_REGEX.lastIndex = 0;

  let match;
  while ((match = SUBJECT_REGEX.exec(combinedText)) !== null) {
    const rawCode = match[1];
    const grade = match[2].toUpperCase();

    const standardCodes = findMatchingStandardCodes(rawCode);
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

    if (!allocated) {
      // If all slots are filled, check if we can improve the grade of the first slot
      const firstCode = standardCodes[0];
      const existingIndex = results.findIndex(r => r.code === firstCode);
      if (existingIndex !== -1 && gradeRank(grade) > gradeRank(results[existingIndex].grade)) {
        results[existingIndex].grade = grade;
      }
    }
  }

  return results;
}
