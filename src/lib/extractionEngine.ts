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
    const clean = sub.code.replace(/\s+/g, '').toUpperCase();
    // Convert wildcard * to regex . and escape other chars
    const patternStr = '^' + clean.replace(/[\-\[\]\/\{\}\(\)\+\?\.\\\^\$\|]/g, "\\$&").replace(/\*/g, '.') + '$';
    CURRICULUM_POOL.push({
      code: sub.code,
      credits: sub.credits,
      pattern: new RegExp(patternStr)
    });
  });
}

preparePool();

function findMatchingStandardCode(extractedCode: string): string | null {
  const stripped = extractedCode.replace(/\s+/g, '').toUpperCase();
  
  // Normalize Aliases
  let target = stripped;
  // Map UQD / UQL -> UQ (Co-curricular)
  if (target.startsWith('UQD') || target.startsWith('UQL') || target.startsWith('UQS')) {
    target = 'UQ' + target.slice(3);
  }
  // Map UHB (English) - ensure it follows standard prefix if needed
  
  for (const item of CURRICULUM_POOL) {
    if (item.pattern.test(target)) {
      return item.code;
    }
  }

  // Fallback for generic UQ 11 if the target just starts with UQ and is short
  if (target.startsWith('UQ') && target.length >= 4) {
    const uqMatch = CURRICULUM_POOL.find(p => p.code.startsWith('UQ 11'));
    if (uqMatch) return uqMatch.code;
  }

  return null;
}

export function extractSubjects(rawTexts: string[]): ExtractedSubject[] {
  const combinedText = rawTexts.join('\n');
  const subjectMap = new Map<string, string>(); // Maps standardized code to best grade

  SUBJECT_REGEX.lastIndex = 0;

  let match;
  while ((match = SUBJECT_REGEX.exec(combinedText)) !== null) {
    const rawCode = match[1];
    const grade = match[2].toUpperCase();

    const standardCode = findMatchingStandardCode(rawCode);
    if (!standardCode) continue;

    const existingGrade = subjectMap.get(standardCode);
    if (!existingGrade || gradeRank(grade) > gradeRank(existingGrade)) {
      subjectMap.set(standardCode, grade);
    }
  }

  return Array.from(subjectMap.entries()).map(([code, grade]) => ({
    code,
    grade,
  }));
}
