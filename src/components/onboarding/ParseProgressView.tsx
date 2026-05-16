'use client';

import React from 'react';
import { CheckCircle, Loader2, Circle } from 'lucide-react';
import type { ParseProgress, ParseStep } from '@/lib/pelanParser';

const STEPS: { id: ParseStep; label: string }[] = [
  { id: 'loading', label: 'Loading file' },
  { id: 'extracting-text', label: 'Extracting text (Path A)' },
  { id: 'running-ocr', label: 'Running OCR (Path B)' },
  { id: 'merging', label: 'Comparing results' },
  { id: 'building-structure', label: 'Building curriculum structure' },
  { id: 'done', label: 'Complete!' },
];

const STEP_ORDER = STEPS.map(s => s.id);

interface ParseProgressViewProps {
  progress: ParseProgress;
}

export function ParseProgressView({ progress }: ParseProgressViewProps) {
  const currentIndex = STEP_ORDER.indexOf(progress.step);

  return (
    <div className="w-full space-y-6">
      {/* Overall progress bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-bold uppercase tracking-widest">Analysing Pelan Pengajian</span>
          <span>{progress.progress}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${progress.progress}%` }}
          />
        </div>
      </div>

      {/* Step list */}
      <div className="space-y-3">
        {STEPS.filter(s => s.id !== 'done').map((step, i) => {
          const isDone = i < currentIndex;
          const isActive = STEP_ORDER[currentIndex] === step.id;
          const isPending = i > currentIndex;

          return (
            <div key={step.id} className="flex items-center gap-3">
              {isDone ? (
                <CheckCircle className="h-4 w-4 text-green-400 shrink-0" />
              ) : isActive ? (
                <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-white/20 shrink-0" />
              )}
              <span className={`text-sm transition-colors ${
                isDone ? 'text-green-400' :
                isActive ? 'text-white font-medium' :
                'text-muted-foreground/50'
              }`}>
                {isActive ? progress.message : step.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
