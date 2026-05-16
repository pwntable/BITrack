'use client';

import React, { useRef, useState } from 'react';
import { useProgressStore } from '@/store/progressStore';
import { useCurriculumStore } from '@/store/curriculumStore';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Download, Upload, Database, GraduationCap, Plus, Trash2, CheckCircle } from 'lucide-react';
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
import { OnboardingFlow } from '@/components/onboarding/OnboardingFlow';

function isValidImportData(data: unknown): data is Record<string, { grade: string; credits: number }> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
  for (const value of Object.values(data)) {
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    if (typeof record.grade !== 'string') return false;
    if (typeof record.credits !== 'number') return false;
  }
  return true;
}

export function DataManagement() {
  const { getSubjects, upsertSubject } = useProgressStore();
  const { savedCurricula, activeCurriculumId, getActiveCurriculum, setActiveCurriculum, deleteCurriculum } = useCurriculumStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [pendingData, setPendingData] = useState<Record<string, { grade: string; credits: number }> | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const curriculum = getActiveCurriculum();
  const programCode = curriculum?.program_code ?? '';
  const completedSubjects = getSubjects(programCode);

  const handleExport = () => {
    try {
      const exportData = {
        program_code: programCode,
        program_name: curriculum?.program_name,
        exported_at: new Date().toISOString(),
        completedSubjects,
      };
      const dataStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `uthmpelan-${programCode.toLowerCase()}-backup.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Backup exported successfully.');
    } catch (err) {
      toast.error('Failed to export backup.');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      // Support both new format (with completedSubjects key) and old flat format
      const data = parsed.completedSubjects ?? parsed;
      if (!isValidImportData(data)) {
        toast.error('Invalid backup file format.');
        return;
      }
      setPendingData(data);
      setIsAlertOpen(true);
    } catch {
      toast.error('The file is not valid JSON.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const confirmImport = () => {
    if (!pendingData) return;
    let count = 0;
    for (const [code, { grade, credits }] of Object.entries(pendingData)) {
      upsertSubject(programCode, code, grade, credits);
      count++;
    }
    toast.success(`Imported ${count} subject entries.`);
    setPendingData(null);
    setIsAlertOpen(false);
  };

  const confirmDeleteCurriculum = () => {
    if (!deleteId) return;
    deleteCurriculum(deleteId);
    toast.success('Programme removed.');
    setDeleteId(null);
  };

  const formatDate = (ts: number) => {
    if (!ts) return 'Demo';
    return new Date(ts).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  if (showOnboarding) {
    // Inline onboarding for adding a new curriculum
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">Add New Programme</h3>
          <Button variant="ghost" size="sm" onClick={() => setShowOnboarding(false)} className="text-xs text-muted-foreground">
            ← Cancel
          </Button>
        </div>
        <OnboardingFlow onComplete={() => setShowOnboarding(false)} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Curriculum Management */}
      <div className="glass rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <GraduationCap className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">Curriculum Management</h4>
              <p className="text-[10px] text-muted-foreground">Switch between saved programmes or upload a new one.</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowOnboarding(true)}
            className="text-xs h-8 gap-1.5 bg-transparent border-white/10 hover:bg-white/[0.06]"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Programme
          </Button>
        </div>

        <div className="space-y-2">
          {savedCurricula.length === 0 ? (
            <p className="text-xs text-muted-foreground italic text-center py-4">No programmes saved yet.</p>
          ) : (
            savedCurricula.map(c => (
              <div
                key={c.id}
                className={`flex items-center justify-between p-3 rounded-lg border transition-all ${
                  c.id === activeCurriculumId
                    ? 'bg-primary/[0.06] border-primary/20'
                    : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04]'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <GraduationCap className={`h-4 w-4 shrink-0 ${c.id === activeCurriculumId ? 'text-primary' : 'text-muted-foreground'}`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white font-mono">{c.program_code}</span>
                      {c.id === activeCurriculumId && (
                        <Badge className="text-[9px] bg-primary/20 text-primary border-primary/30 font-bold">Active</Badge>
                      )}
                      {c.is_demo && (
                        <Badge variant="outline" className="text-[9px] text-muted-foreground border-white/10">Demo</Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground truncate">{c.program_name} · {formatDate(c.uploaded_at)}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {c.id !== activeCurriculumId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setActiveCurriculum(c.id); toast.success(`Switched to ${c.program_code}.`); }}
                      className="text-[10px] h-7 bg-transparent border-white/10 hover:bg-white/[0.06]"
                    >
                      <CheckCircle className="h-3 w-3 mr-1" />
                      Load
                    </Button>
                  )}
                  {!c.is_demo && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteId(c.id)}
                      className="text-[10px] h-7 text-muted-foreground/40 hover:text-red-400 hover:bg-red-400/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Progress Data Management */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 glass rounded-xl">
        <div className="flex items-center gap-3 flex-1">
          <div className="p-2 rounded-lg bg-primary/10">
            <Database className="h-4 w-4 text-primary" />
          </div>
          <div className="space-y-0.5">
            <h4 className="text-xs font-bold text-white">Progress Backup</h4>
            <p className="text-[10px] text-muted-foreground">
              Backup or restore your progress for <span className="font-bold text-white">{programCode || 'active programme'}</span>.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            className="text-xs h-8 bg-transparent border-white/10 hover:bg-white/[0.06] hover:border-white/20 transition-all"
          >
            <Download className="mr-1.5 h-3.5 w-3.5" />
            Export
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="text-xs h-8 bg-transparent border-white/10 hover:bg-white/[0.06] hover:border-white/20 transition-all"
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Import
          </Button>
          <input type="file" accept=".json" className="hidden" ref={fileInputRef} onChange={handleFileChange} />
        </div>
      </div>

      {/* Delete curriculum confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(o) => { if (!o) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-red-500">Remove Programme?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the curriculum data. Your progress for this programme will be preserved and will reload if you add it again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteCurriculum} className="bg-red-500 hover:bg-red-600">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import confirmation */}
      <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Import</AlertDialogTitle>
            <AlertDialogDescription>
              Import progress data into <strong>{programCode}</strong>? Existing subjects will be updated only if the imported grade is better.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingData(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmImport}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
