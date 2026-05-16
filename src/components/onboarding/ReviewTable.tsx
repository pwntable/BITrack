'use client';

import React, { useState } from 'react';
import type { ParsedCurriculum, ParsedSubject } from '@/store/curriculumStore';
import { Plus, Trash2, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ReviewTableProps {
  curriculum: ParsedCurriculum;
  warnings: string[];
  onConfirm: (edited: ParsedCurriculum) => void;
  onCancel: () => void;
}

function SubjectRow({
  subject,
  onChange,
  onDelete,
}: {
  subject: ParsedSubject;
  onChange: (s: ParsedSubject) => void;
  onDelete: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_2fr_auto_auto_auto] gap-2 items-center py-1.5 border-b border-white/[0.04] last:border-0">
      <input
        className="bg-white/[0.04] border border-white/10 rounded-md px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-primary/50 w-full"
        value={subject.code}
        onChange={e => onChange({ ...subject, code: e.target.value })}
        placeholder="Code"
      />
      <input
        className="bg-white/[0.04] border border-white/10 rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:border-primary/50 w-full"
        value={subject.name}
        onChange={e => onChange({ ...subject, name: e.target.value })}
        placeholder="Subject name"
      />
      <input
        type="number"
        min={1}
        max={12}
        className="bg-white/[0.04] border border-white/10 rounded-md px-2 py-1 text-xs text-white focus:outline-none focus:border-primary/50 w-14 text-center"
        value={subject.credits}
        onChange={e => onChange({ ...subject, credits: parseInt(e.target.value) || 0 })}
      />
      <button
        type="button"
        onClick={() => onChange({ ...subject, is_elective: !subject.is_elective })}
        className={cn(
          'text-[10px] font-bold px-2 py-1 rounded-md border transition-colors whitespace-nowrap',
          subject.is_elective
            ? 'bg-primary/20 border-primary/30 text-primary'
            : 'bg-white/[0.04] border-white/10 text-muted-foreground'
        )}
      >
        {subject.is_elective ? 'Elective' : 'Core'}
      </button>
      <button
        type="button"
        onClick={onDelete}
        className="p-1 rounded-md text-muted-foreground/40 hover:text-red-400 hover:bg-red-400/10 transition-colors"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function ReviewTable({ curriculum, warnings, onConfirm, onCancel }: ReviewTableProps) {
  const [edited, setEdited] = useState<ParsedCurriculum>(JSON.parse(JSON.stringify(curriculum)));
  const [expandedSems, setExpandedSems] = useState<Set<string>>(
    new Set(
      curriculum.curriculum.flatMap(y =>
        y.semesters.map(s => `${y.year}-${s.semester}`)
      )
    )
  );

  const toggleSem = (key: string) => {
    setExpandedSems(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const updateSubject = (yi: number, si: number, subi: number, updated: ParsedSubject) => {
    setEdited(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as ParsedCurriculum;
      next.curriculum[yi].semesters[si].subjects[subi] = updated;
      return next;
    });
  };

  const deleteSubject = (yi: number, si: number, subi: number) => {
    setEdited(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as ParsedCurriculum;
      next.curriculum[yi].semesters[si].subjects.splice(subi, 1);
      return next;
    });
  };

  const addSubject = (yi: number, si: number) => {
    setEdited(prev => {
      const next = JSON.parse(JSON.stringify(prev)) as ParsedCurriculum;
      next.curriculum[yi].semesters[si].subjects.push({
        code: '',
        name: 'New Subject',
        credits: 3,
        is_elective: false,
        prerequisite: null,
      });
      return next;
    });
  };

  const totalSubjects = edited.curriculum.reduce((a, y) =>
    a + y.semesters.reduce((b, s) => b + s.subjects.length, 0), 0
  );

  return (
    <div className="space-y-6">
      {/* Header info */}
      <div className="glass rounded-xl p-5 space-y-4">
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Programme Info</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Programme Name</label>
            <input
              className="w-full bg-white/[0.04] border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
              value={edited.program_name}
              onChange={e => setEdited(p => ({ ...p, program_name: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Programme Code</label>
            <input
              className="w-full bg-white/[0.04] border border-white/10 rounded-md px-3 py-2 text-sm text-white font-mono uppercase focus:outline-none focus:border-primary/50"
              value={edited.program_code}
              onChange={e => setEdited(p => ({ ...p, program_code: e.target.value.toUpperCase() }))}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Total Credits Required</label>
            <input
              type="number"
              className="w-full bg-white/[0.04] border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
              value={edited.total_credits_required}
              onChange={e => setEdited(p => ({ ...p, total_credits_required: parseInt(e.target.value) || 120 }))}
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Academic Session</label>
            <input
              className="w-full bg-white/[0.04] border border-white/10 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
              value={edited.academic_session}
              onChange={e => setEdited(p => ({ ...p, academic_session: e.target.value }))}
            />
          </div>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <Badge variant="outline" className="text-[10px] font-bold text-muted-foreground border-white/10">
            {totalSubjects} subjects detected
          </Badge>
          {warnings.length > 0 && (
            <Badge variant="outline" className="text-[10px] font-bold text-amber-400 border-amber-400/30">
              {warnings.length} warning{warnings.length > 1 ? 's' : ''}
            </Badge>
          )}
        </div>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              {w}
            </div>
          ))}
        </div>
      )}

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_2fr_auto_auto_auto] gap-2 px-1">
        {['Code', 'Name', 'CR', 'Type', ''].map((h, i) => (
          <span key={i} className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{h}</span>
        ))}
      </div>

      {/* Semester sections */}
      <div className="space-y-3">
        {edited.curriculum.map((year, yi) =>
          year.semesters.map((sem, si) => {
            const key = `${year.year}-${sem.semester}`;
            const isExpanded = expandedSems.has(key);
            const creditSum = sem.subjects.reduce((a, b) => a + b.credits, 0);

            return (
              <div key={key} className="glass rounded-xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => toggleSem(key)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                    <span className="text-sm font-semibold text-white">
                      Year {year.year} — Semester {sem.semester}
                    </span>
                    <Badge variant="outline" className="text-[10px] font-bold text-muted-foreground border-white/10">
                      {sem.subjects.length} subj · {creditSum} CR
                    </Badge>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-3 space-y-1">
                    {sem.subjects.map((sub, subi) => (
                      <SubjectRow
                        key={`${sub.code}-${subi}`}
                        subject={sub}
                        onChange={(updated) => updateSubject(yi, si, subi, updated)}
                        onDelete={() => deleteSubject(yi, si, subi)}
                      />
                    ))}
                    <button
                      type="button"
                      onClick={() => addSubject(yi, si)}
                      className="flex items-center gap-2 text-xs text-primary/70 hover:text-primary transition-colors mt-2 py-1"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add subject
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <Button variant="outline" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          className="flex-1 bg-primary hover:bg-primary/90"
          onClick={() => onConfirm(edited)}
          disabled={!edited.program_code || !edited.program_name}
        >
          Confirm & Load Curriculum
        </Button>
      </div>
    </div>
  );
}
