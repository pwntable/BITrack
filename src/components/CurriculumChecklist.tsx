'use client';

import React from 'react';
import { useProgressStore } from '@/store/progressStore';
import { useCurriculumStore } from '@/store/curriculumStore';
import type { ParsedSubject } from '@/store/curriculumStore';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup
} from '@/components/ui/dropdown-menu';
import { Lock, ChevronDown, BookMarked } from 'lucide-react';
import { gradeRank } from '@/lib/gradeUtils';

const ALL_GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'D-', 'E', 'F'];

function getGradeColor(grade: string) {
  const rank = gradeRank(grade);
  if (rank >= gradeRank('B-')) return 'bg-green-500/90 hover:bg-green-500 text-white';
  if (rank >= gradeRank('C-')) return 'bg-amber-500/90 hover:bg-amber-500 text-white';
  return 'bg-red-500/80 hover:bg-red-500 text-white';
}

export function CurriculumChecklist() {
  const { getActiveCurriculum } = useCurriculumStore();
  const { getSubjects, markIncomplete, upsertSubject } = useProgressStore();
  const [expandedSems, setExpandedSems] = React.useState<string[]>([]);

  const curriculum = getActiveCurriculum();
  const programCode = curriculum?.program_code ?? '';
  const completedSubjects = getSubjects(programCode);

  // Expand all semesters on mount / curriculum change
  React.useEffect(() => {
    if (!curriculum) return;
    const allSems = curriculum.curriculum.flatMap(y =>
      y.semesters.map(s => `y${y.year}-s${s.semester}`)
    );
    setExpandedSems(allSems);
  }, [curriculum?.id]);

  // Handle scroll-to-subject event
  React.useEffect(() => {
    const handleScrollEvent = (e: any) => {
      const code = e.detail?.code;
      if (!code || !curriculum) return;

      let targetSemId = '';
      for (const year of curriculum.curriculum) {
        for (const sem of year.semesters) {
          if (sem.subjects.some(s => s.code === code)) {
            targetSemId = `y${year.year}-s${sem.semester}`;
            break;
          }
        }
      }

      if (targetSemId) {
        setExpandedSems(prev => prev.includes(targetSemId) ? prev : [...prev, targetSemId]);
        setTimeout(() => {
          const element = document.getElementById(`subject-${code}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.classList.add('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background');
            setTimeout(() => element.classList.remove('ring-2', 'ring-primary', 'ring-offset-2', 'ring-offset-background'), 3000);
          }
        }, 100);
      }
    };

    window.addEventListener('scroll-to-subject' as any, handleScrollEvent);
    return () => window.removeEventListener('scroll-to-subject' as any, handleScrollEvent);
  }, [curriculum]);

  if (!curriculum) {
    return (
      <div className="text-center py-20 text-muted-foreground text-sm italic">
        No curriculum loaded. Upload your Pelan Pengajian to get started.
      </div>
    );
  }

  const handleToggle = (checked: boolean, subject: ParsedSubject) => {
    if (checked) {
      if (!completedSubjects[subject.code]) {
        upsertSubject(programCode, subject.code, 'A', subject.credits);
      }
    } else {
      markIncomplete(programCode, subject.code);
    }
  };

  const isPrerequisiteMet = (prerequisite: string | null | undefined) => {
    if (!prerequisite) return true;
    const prereqSubject = completedSubjects[prerequisite];
    if (!prereqSubject) return false;
    return !['D+', 'D', 'D-', 'E', 'F'].includes(prereqSubject.grade);
  };

  const getSemesterProgress = (subjects: ParsedSubject[]) => {
    const total = subjects.length;
    const completed = subjects.filter(s => !!completedSubjects[s.code]).length;
    return { total, completed };
  };

  // Display code strips internal uniqueness suffix (e.g. "UQ 11 (I)" → "UQ 11")
  const displayCode = (code: string) => code.replace(/\s*\([IVX]+\)$/i, '');

  return (
    <div className="w-full space-y-8">
      {curriculum.curriculum.map((yearObj) => (
        <div key={yearObj.year} className="space-y-4">
          <div className="flex items-center gap-3">
            <BookMarked className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold tracking-tight text-white">Year {yearObj.year}</h2>
            <span className="h-px flex-1 bg-white/[0.06]" />
          </div>
          <Accordion
            className="w-full space-y-2"
            value={expandedSems}
            onValueChange={setExpandedSems}
          >
            {yearObj.semesters.map((semObj) => {
              const progress = getSemesterProgress(semObj.subjects);
              const progressPct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;

              return (
                <AccordionItem
                  key={`y${yearObj.year}-s${semObj.semester}`}
                  value={`y${yearObj.year}-s${semObj.semester}`}
                  className="glass rounded-xl overflow-hidden border-none"
                >
                  <AccordionTrigger className="text-sm font-semibold hover:no-underline hover:bg-white/[0.03] px-5 py-4 rounded-xl transition-colors">
                    <div className="flex items-center gap-3 w-full">
                      <span className="text-white">Semester {semObj.semester}</span>
                      <Badge variant="outline" className="text-[10px] font-bold tracking-wider text-muted-foreground border-white/10">
                        {progress.completed}/{progress.total}
                      </Badge>
                      <div className="hidden sm:flex flex-1 max-w-[120px] h-1 rounded-full bg-white/[0.06] overflow-hidden">
                        <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progressPct}%` }} />
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-1 pb-4 px-3 sm:px-5">
                    {semObj.subjects.length === 0 ? (
                      <div className="text-sm text-muted-foreground italic py-4 text-center">No subjects.</div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {semObj.subjects.map((subject, idx) => {
                          const isCompleted = !!completedSubjects[subject.code];
                          const completedGrade = completedSubjects[subject.code]?.grade;
                          const prereqMet = isPrerequisiteMet(subject.prerequisite);

                          return (
                            <div
                              key={`${subject.code}-${idx}`}
                              id={`subject-${subject.code}`}
                              className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg transition-all duration-300 ${
                                isCompleted
                                  ? 'bg-primary/[0.06] border border-primary/10'
                                  : 'bg-white/[0.02] border border-transparent hover:border-white/[0.06] hover:bg-white/[0.03]'
                              }`}
                            >
                              <div className="flex items-start sm:items-center gap-3">
                                <div className="mt-0.5 sm:mt-0">
                                  <Checkbox
                                    checked={isCompleted}
                                    disabled={!prereqMet && !isCompleted}
                                    onCheckedChange={(checked) => handleToggle(checked as boolean, subject)}
                                  />
                                </div>
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className={`font-mono text-xs font-bold tracking-wide ${isCompleted ? 'text-primary' : 'text-white'}`}>
                                      {displayCode(subject.code)}
                                    </span>
                                    {subject.is_elective && (
                                      <Badge variant="outline" className="text-[9px] font-bold border-primary/20 text-primary/70">Elective</Badge>
                                    )}
                                    {!prereqMet && !isCompleted && (
                                      <span title={`Requires ${subject.prerequisite}`}>
                                        <Lock className="h-3 w-3 text-amber-400/70" />
                                      </span>
                                    )}
                                  </div>
                                  <span className={`text-xs leading-tight ${!prereqMet && !isCompleted ? 'text-muted-foreground/60' : 'text-muted-foreground'}`}>
                                    {subject.name}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-2 self-end sm:self-auto">
                                <Badge variant="outline" className="shrink-0 text-[10px] font-bold border-white/10 text-muted-foreground">
                                  {subject.credits} CR
                                </Badge>
                                {isCompleted && (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger>
                                      <Badge className={`shrink-0 cursor-pointer flex items-center gap-1 text-[10px] font-bold transition-all active:scale-95 ${getGradeColor(completedGrade)}`}>
                                        {completedGrade}
                                        <ChevronDown className="h-2.5 w-2.5 opacity-70" />
                                      </Badge>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="max-h-[300px] overflow-y-auto">
                                      <DropdownMenuGroup>
                                        <DropdownMenuLabel className="text-xs">Adjust Grade</DropdownMenuLabel>
                                        <DropdownMenuSeparator />
                                        {ALL_GRADES.map((g) => (
                                          <DropdownMenuItem
                                            key={g}
                                            className="text-sm cursor-pointer"
                                            onClick={() => upsertSubject(programCode, subject.code, g, subject.credits)}
                                          >
                                            {g}
                                          </DropdownMenuItem>
                                        ))}
                                      </DropdownMenuGroup>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
      ))}
    </div>
  );
}
