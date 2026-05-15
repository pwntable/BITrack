'use client';

import { CreditDashboard } from '@/components/CreditDashboard';
import { CurriculumChecklist } from '@/components/CurriculumChecklist';
import { TranscriptUploader } from '@/components/TranscriptUploader';
import { DataManagement } from '@/components/DataManagement';
import { ScrollToTop } from '@/components/ScrollToTop';
import { GraduationCap, ShieldCheck } from 'lucide-react';

export default function Home() {
  return (
    <main className="min-h-screen bg-background relative overflow-hidden">
      {/* Ambient background glow */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full bg-teal-accent/5 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[400px] h-[400px] rounded-full bg-amber-accent/5 blur-[100px]" />
      </div>

      {/* Hero Section */}
      <header className="relative z-10 border-b border-white/[0.06]">
        <div className="container max-w-6xl mx-auto px-4 py-10 sm:py-14">
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
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight bg-gradient-to-r from-white via-white/90 to-primary bg-clip-text text-transparent">
              BITrack
            </h1>
          </div>
          <p className="text-muted-foreground text-base sm:text-lg max-w-2xl leading-relaxed">
            Track your graduation progress, estimate your CGPA, and manage your course history—all securely stored on your own device.
          </p>
        </div>
      </header>

      {/* Main Content */}
      <div className="relative z-10 container max-w-6xl mx-auto px-4 py-10 space-y-12">
        {/* Credit Overview */}
        <section className="space-y-6">
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <span className="h-1 w-6 rounded-full bg-primary" />
            Credit Overview
          </h2>
          <CreditDashboard />
        </section>

        {/* Academic Progress */}
        <section className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-2xl font-bold tracking-tight flex items-center gap-3">
              <span className="h-1 w-6 rounded-full bg-amber-accent" />
              Academic Progress
            </h2>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-4 space-y-6">
              <div className="sticky top-8">
                <TranscriptUploader />
              </div>
            </div>
            <div className="lg:col-span-8">
              <CurriculumChecklist />
            </div>
          </div>
        </section>

        {/* Data Management at bottom */}
        <section className="pt-8 border-t border-white/[0.06]">
          <DataManagement />
        </section>
      </div>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/[0.06] py-6">
        <div className="container max-w-6xl mx-auto px-4 text-center text-xs text-muted-foreground">
          BIT Academic Tracker 2025/2026 — UTHM • Built with privacy in mind
        </div>
      </footer>

      <ScrollToTop />
    </main>
  );
}
