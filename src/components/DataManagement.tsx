'use client';

import React, { useRef, useState } from 'react';
import { useProgressStore } from '@/store/progressStore';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Download, Upload, Database } from 'lucide-react';
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

// Type guard to validate JSON schema
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
  const { completedSubjects, upsertSubject } = useProgressStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [isAlertOpen, setIsAlertOpen] = useState(false);
  const [pendingData, setPendingData] = useState<Record<string, { grade: string; credits: number }> | null>(null);

  const handleExport = () => {
    try {
      const dataStr = JSON.stringify(completedSubjects, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      
      a.href = url;
      a.download = 'bit-progress-backup.json';
      document.body.appendChild(a);
      a.click();
      
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Backup exported successfully.');
    } catch (err) {
      console.error('Export failed:', err);
      toast.error('Failed to export backup.');
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsedData = JSON.parse(text);

      if (!isValidImportData(parsedData)) {
        toast.error('Validation Failed', { 
          description: 'The uploaded file does not match the expected format (Record<string, {grade: string, credits: number}>).' 
        });
        return;
      }

      setPendingData(parsedData);
      setIsAlertOpen(true);
    } catch (err) {
      console.error('Import parsing failed:', err);
      toast.error('Parse Error', { description: 'The file is not valid JSON.' });
    } finally {
      // Clear the input so the same file can be selected again if needed
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const confirmImport = () => {
    if (!pendingData) return;

    let count = 0;
    for (const [code, { grade, credits }] of Object.entries(pendingData)) {
      upsertSubject(code, grade, credits);
      count++;
    }

    toast.success('Import Successful', { description: `Processed ${count} subject entries.` });
    setPendingData(null);
    setIsAlertOpen(false);
  };

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-4 glass rounded-xl">
      <div className="flex items-center gap-3 flex-1">
        <div className="p-2 rounded-lg bg-primary/10">
          <Database className="h-4 w-4 text-primary" />
        </div>
        <div className="space-y-0.5">
          <h4 className="text-xs font-bold text-white">Data Management</h4>
          <p className="text-[10px] text-muted-foreground">
            Backup or restore your progress locally.
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

        <input 
          type="file" 
          accept=".json" 
          className="hidden" 
          ref={fileInputRef} 
          onChange={handleFileChange} 
        />
      </div>

      {/* Import Confirmation */}
      <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Import</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to import this progress data? Existing subjects will be updated if the imported grade is better. This action cannot be undone.
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
