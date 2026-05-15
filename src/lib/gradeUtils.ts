export function gradeRank(grade: string): number {
  const ranks: Record<string, number> = {
    'A+': 14,
    'A': 13,
    'A-': 12,
    'B+': 11,
    'B': 10,
    'B-': 9,
    'C+': 8,
    'C': 7,
    'C-': 6,
    'D+': 5,
    'D': 4,
    'D-': 3,
    'E': 2,
    'F': 1
  };
  
  return ranks[grade.toUpperCase()] || 0;
}

export function calculateCGPA(completedSubjects: Record<string, { grade: string; credits: number }>): number {
  const gradePoints: Record<string, number> = {
    'A+': 4.00, 'A': 4.00, 'A-': 3.67,
    'B+': 3.33, 'B': 3.00, 'B-': 2.67,
    'C+': 2.33, 'C': 2.00, 'C-': 1.67,
    'D+': 1.33, 'D': 1.00, 'D-': 0.67,
    'E': 0.33, 'F': 0.00
  };

  let totalPoints = 0;
  let totalCredits = 0;

  for (const subject of Object.values(completedSubjects)) {
    if (!subject.grade) continue;
    const point = gradePoints[subject.grade.toUpperCase()];
    if (point !== undefined) {
      totalPoints += point * subject.credits;
      totalCredits += subject.credits;
    }
  }

  if (totalCredits === 0) return 0.00;
  
  return Number((totalPoints / totalCredits).toFixed(2));
}
