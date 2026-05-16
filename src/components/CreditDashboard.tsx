'use client';

import React, { useEffect, useState } from 'react';
import { useProgressStore } from '@/store/progressStore';
import { calculateCGPA } from '@/lib/gradeUtils';
import curriculumData from '@/data/curriculum.json';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Lock, CheckCircle, RotateCcw, BookOpen, ArrowRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function CreditDashboard() {
  const { completedSubjects, alerts, getTotalCredits, resetAll } = useProgressStore();
  const [mounted, setMounted] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);

  // Avoid hydration mismatch by only rendering after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="animate-pulse glass rounded-2xl h-[400px] w-full" />;
  }

  const earned = getTotalCredits();
  const target = 120;
  const percentage = Math.min(earned / target, 1);
  const remainingCredits = Math.max(0, target - earned);
  
  const currentCGPA = calculateCGPA(completedSubjects);

  // Compute metrics
  const retakeCount = alerts.filter(a => a.type === 'retake').length;
  const passedSubjectsCount = Object.keys(completedSubjects).length - retakeCount;
  
  const totalSubjects = curriculumData.curriculum.reduce((acc, year) => 
    acc + year.semesters.reduce((semAcc, sem) => semAcc + sem.subjects.length, 0), 0
  );
  const remainingSubjectsCount = Math.max(0, totalSubjects - passedSubjectsCount);

  // SVG parameters
  const size = 200;
  const strokeWidth = 14;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - percentage * circumference;

  // Dynamic ring colors
  let ringStroke = '#0f766e';
  let ringGlow = 'drop-shadow(0 0 8px rgba(15, 118, 110, 0.4))';
  if (earned >= 100) {
    ringStroke = '#22c55e';
    ringGlow = 'drop-shadow(0 0 8px rgba(34, 197, 94, 0.4))';
  } else if (earned >= 60) {
    ringStroke = '#f59e0b';
    ringGlow = 'drop-shadow(0 0 8px rgba(245, 158, 11, 0.4))';
  }

  const confirmReset = () => {
    resetAll();
    toast.success('All progress has been reset.');
    setIsResetOpen(false);
  };

  return (
    <div className="flex flex-col gap-8 w-full">
      {/* Progress Ring + CGPA */}
      <div className="relative glass-strong rounded-2xl p-6 sm:p-10 overflow-hidden">
        {/* Reset Button Positioned Top-Right */}
        <div className="absolute top-4 right-4 z-20">
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setIsResetOpen(true)} 
            className="text-[10px] h-7 font-bold uppercase tracking-widest text-muted-foreground/40 hover:text-red-400 hover:bg-red-400/10 transition-all gap-1.5 px-2"
          >
            <RotateCcw className="h-3 w-3" />
            Reset All
          </Button>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-8">
          {/* Ring */}
          <div className="relative flex items-center justify-center w-44 h-44 sm:w-52 sm:h-52 shrink-0">
            {/* Pulsing outer ring */}
            <div className="absolute inset-0 rounded-full border border-primary/20 animate-pulse-ring" />
            <svg
              className="w-full h-full transform -rotate-90"
              viewBox={`0 0 ${size} ${size}`}
              style={{ filter: ringGlow }}
            >
              {/* Background track */}
              <circle
                cx={size / 2} cy={size / 2} r={radius}
                stroke="currentColor" strokeWidth={strokeWidth}
                fill="transparent"
                className="text-white/[0.06]"
              />
              {/* Progress arc */}
              <circle
                cx={size / 2} cy={size / 2} r={radius}
                stroke={ringStroke} strokeWidth={strokeWidth}
                fill="transparent"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            {/* Center text */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
                {earned}
              </span>
              <span className="text-[11px] sm:text-xs text-muted-foreground font-medium tracking-wide">
                / 120 credits
              </span>
            </div>
          </div>

          {/* CGPA + Stats */}
          <div className="flex-1 text-center sm:text-left space-y-4">
            <div>
              <p className="text-xs uppercase tracking-widest text-muted-foreground font-bold mb-1">Estimated CGPA</p>
              <p className="text-5xl sm:text-6xl font-extrabold tracking-tight bg-gradient-to-r from-primary to-teal-400 bg-clip-text text-transparent">
                {currentCGPA.toFixed(2)}
              </p>
            </div>
            <div className="flex flex-wrap justify-center sm:justify-start gap-2">
              <Badge className="bg-primary/15 text-primary border-primary/20 hover:bg-primary/20 transition-colors text-xs px-3 py-1">
                {Math.round(percentage * 100)}% Complete
              </Badge>
              {remainingCredits > 0 && (
                <Badge variant="outline" className="text-xs px-3 py-1 text-muted-foreground">
                  {remainingCredits} credits remaining
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Reset Confirmation */}
      <AlertDialog open={isResetOpen} onOpenChange={setIsResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-500">Reset All Progress?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all your selected subjects, grades, and upload history. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReset} className="bg-red-500 hover:bg-red-600">
              Reset Everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass rounded-xl p-4 sm:p-5 hover:shadow-xl hover:shadow-teal-accent/5 transition-all duration-300 group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-muted-foreground">Total Passed</span>
            <CheckCircle className="h-4 w-4 text-green-400 opacity-60 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-white">{passedSubjectsCount}</div>
          <p className="text-[10px] text-muted-foreground mt-1">subjects completed</p>
        </div>

        <div className="glass rounded-xl p-4 sm:p-5 hover:shadow-xl hover:shadow-amber-accent/5 transition-all duration-300 group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-muted-foreground">Retake Required</span>
            <RotateCcw className="h-4 w-4 text-amber-400 opacity-60 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className={`text-2xl sm:text-3xl font-extrabold ${retakeCount > 0 ? 'text-amber-400' : 'text-white'}`}>{retakeCount}</div>
          <p className="text-[10px] text-muted-foreground mt-1">needs attention</p>
        </div>

        <div className="glass rounded-xl p-4 sm:p-5 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-muted-foreground">Remaining Credits</span>
            <ArrowRight className="h-4 w-4 text-primary opacity-60 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-white">{remainingCredits}</div>
          <p className="text-[10px] text-muted-foreground mt-1">credits to go</p>
        </div>

        <div className="glass rounded-xl p-4 sm:p-5 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 group">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-widest text-muted-foreground">Remaining Subs</span>
            <BookOpen className="h-4 w-4 text-primary opacity-60 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="text-2xl sm:text-3xl font-extrabold text-white">{remainingSubjectsCount}</div>
          <p className="text-[10px] text-muted-foreground mt-1">subjects left</p>
        </div>
      </div>

      {/* Action Items (Alerts) */}
      {alerts.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Action Items</h3>
          <div className="grid grid-cols-1 gap-3">
            {alerts.map((alert, idx) => (
              <div
                key={`${alert.code}-${idx}`}
                className="glass rounded-xl p-4 border-l-[3px] border-l-amber-500 cursor-pointer hover:bg-white/[0.06] transition-all duration-200 active:scale-[0.995] animate-glow-amber group"
                onClick={() => window.dispatchEvent(new CustomEvent('scroll-to-subject', { detail: { code: alert.code } }))}
                role="button"
                tabIndex={0}
                aria-label={`Resolve alert for ${alert.code}`}
              >
                <div className="flex items-start gap-4">
                  <div className="mt-0.5 p-1.5 rounded-lg bg-amber-500/10">
                    {alert.type === 'retake' ? (
                      <AlertTriangle className="h-4 w-4 text-amber-400" />
                    ) : (
                      <Lock className="h-4 w-4 text-amber-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-white">{alert.code}</span>
                      <Badge variant="outline" className="text-[9px] uppercase font-bold tracking-widest border-amber-500/30 text-amber-400">
                        {alert.type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {alert.message}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
