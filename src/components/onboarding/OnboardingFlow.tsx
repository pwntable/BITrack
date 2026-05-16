'use client';

import React, { useState } from 'react';
import { GraduationCap, ShieldCheck, BookOpen } from 'lucide-react';
import { PelanUploader } from '@/components/onboarding/PelanUploader';
import { ParseProgressView } from '@/components/onboarding/ParseProgressView';
import { ReviewTable } from '@/components/onboarding/ReviewTable';
import { ExtractionDebugPanel } from '@/components/onboarding/ExtractionDebugPanel';
import { useCurriculumStore, BIT_DEMO_CURRICULUM, type ParsedCurriculum } from '@/store/curriculumStore';
import { parsePelanPengajian, type ParseProgress, type ParseResult } from '@/lib/pelanParser';
import type { ExtractionResult } from '@/lib/imageScraperPipeline';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

type OnboardingStep = 'upload' | 'parsing' | 'review';

export function OnboardingFlow({ onComplete }: { onComplete?: () => void } = {}) {
  const { saveCurriculum } = useCurriculumStore();
  const [step, setStep] = useState<OnboardingStep>('upload');
  const [parseProgress, setParseProgress] = useState<ParseProgress>({
    step: 'loading',
    message: 'Starting...',
    progress: 0,
  });
  const [parsedResult, setParsedResult] = useState<ParseResult | null>(null);

  const handleFileSelected = async (file: File) => {
    setStep('parsing');
    try {
      const result = await parsePelanPengajian(file, (p) => setParseProgress(p));
      setParsedResult(result);
      setStep('review');
    } catch (err) {
      toast.error('Failed to parse file. Please try again or use the demo.');
      setStep('upload');
    }
  };

  const handleConfirm = (edited: ParsedCurriculum) => {
    saveCurriculum(edited);
    toast.success(`${edited.program_name} loaded successfully!`);
    onComplete?.();
  };

  const handleUseDemoMode = () => {
    saveCurriculum(BIT_DEMO_CURRICULUM);
    toast.success('BIT 2025/2026 demo curriculum loaded!');
    onComplete?.();
  };

  return (
    <div className="min-h-screen bg-background relative overflow-hidden flex flex-col">
      {/* Ambient glows */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-teal-accent/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] rounded-full bg-amber-accent/5 blur-[100px]" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/[0.06]">
        <div className="container max-w-3xl mx-auto px-4 py-8 sm:py-10">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full glass text-xs font-bold uppercase tracking-widest text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              Privacy First • Local Only
            </div>
          </div>
          <div className="flex items-center gap-4 mb-3">
            <div className="p-3 rounded-xl glass-strong">
              <GraduationCap className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-white via-white/90 to-primary bg-clip-text text-transparent">
                UTHMPelan
              </h1>
              <p className="text-muted-foreground text-sm mt-1">
                Academic Progress Tracker for all UTHM students
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 container max-w-3xl mx-auto px-4 py-10">

        {/* ── Step: Upload ─────────────────────────────────────────────────── */}
        {step === 'upload' && (
          <div className="space-y-8">
            <div className="space-y-2 text-center">
              <h2 className="text-2xl font-bold text-white">Get Started</h2>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Upload your Pelan Pengajian to generate your personalised curriculum checklist.
                Your data never leaves your device.
              </p>
            </div>

            <PelanUploader onFileSelected={handleFileSelected} />

            {/* Demo shortcut */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-white/[0.06]" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-background px-4 text-xs text-muted-foreground uppercase tracking-widest">
                  or
                </span>
              </div>
            </div>

            <div className="glass rounded-xl p-5 flex flex-col sm:flex-row items-center gap-4">
              <div className="p-3 rounded-xl bg-primary/10 shrink-0">
                <BookOpen className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 text-center sm:text-left">
                <p className="text-sm font-bold text-white">BIT 2025/2026 Demo</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Try the app with the pre-loaded BIT curriculum without uploading anything
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={handleUseDemoMode}
              >
                Use Demo
              </Button>
            </div>
          </div>
        )}

        {/* ── Step: Parsing ─────────────────────────────────────────────────── */}
        {step === 'parsing' && (
          <div className="flex items-center justify-center min-h-[50vh]">
            <div className="glass rounded-2xl p-8 sm:p-12 w-full max-w-md space-y-6">
              <div className="text-center space-y-2">
                <div className="p-4 rounded-2xl glass-strong inline-flex mx-auto">
                  <GraduationCap className="h-8 w-8 text-primary" />
                </div>
                <h2 className="text-lg font-bold text-white">Analysing your Pelan Pengajian</h2>
              </div>
              <ParseProgressView progress={parseProgress} />
            </div>
          </div>
        )}

        {/* ── Step: Review ──────────────────────────────────────────────────── */}
        {step === 'review' && parsedResult && (
          <div className="space-y-6">
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white">Review Extracted Curriculum</h2>
              <p className="text-muted-foreground text-sm">
                Verify the parsed subjects below. You can edit any field before confirming.
              </p>
            </div>

            {/* Debug panel (only shown when OCR pipeline was used) */}
            {parsedResult.debug && (
              <ExtractionDebugPanel debug={parsedResult.debug} />
            )}

            <ReviewTable
              curriculum={parsedResult.curriculum}
              warnings={parsedResult.warnings}
              onConfirm={handleConfirm}
              onCancel={() => { setStep('upload'); setParsedResult(null); }}
            />
          </div>
        )}
      </main>

      <footer className="relative z-10 border-t border-white/[0.06] py-5">
        <div className="container max-w-3xl mx-auto px-4 text-center text-xs text-muted-foreground">
          UTHMPelan 2025/2026 — UTHM • Built for all UTHM students
        </div>
      </footer>
    </div>
  );
}
