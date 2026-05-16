'use client';

import React, { useState, useRef, useEffect } from 'react';
import { renderPdfToImages } from '@/lib/pdfRenderer';
import { runOcrBatch } from '@/lib/ocrWorkerPool';
import { extractSubjects } from '@/lib/extractionEngine';
import { useProgressStore } from '@/store/progressStore';
import { useCurriculumStore } from '@/store/curriculumStore';
import { gradeRank } from '@/lib/gradeUtils';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { UploadCloud, FileText, Loader2, Trash2, Eye, ExternalLink, ZoomIn } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from '@/components/ui/badge';
import { set, get, del } from 'idb-keyval';

function FilePreview({ fileId, filename }: { fileId: string; filename: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const blob = await get(fileId);
        if (blob instanceof Blob) {
          setUrl(URL.createObjectURL(blob));
        }
      } catch (e) {
        console.error('Failed to load preview', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [fileId]);

  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  if (loading) return <div className="h-48 bg-muted animate-pulse rounded-lg flex items-center justify-center text-xs">Loading preview...</div>;
  if (!url) return <div className="h-48 bg-muted rounded-lg flex items-center justify-center text-xs italic text-muted-foreground">Original file preview not available</div>;

  const handleOpenFullSize = () => {
    if (url) window.open(url, '_blank');
  };

  if (filename.toLowerCase().endsWith('.pdf')) {
    return (
      <div className="space-y-2">
        <iframe src={url} title="PDF Preview" className="w-full h-[400px] rounded-lg border bg-white" />
        <Button 
          variant="secondary" 
          size="sm" 
          className="w-full h-8 text-[10px] font-bold gap-2"
          onClick={handleOpenFullSize}
        >
          <ExternalLink className="h-3 w-3" />
          OPEN PDF IN NEW TAB
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2 group">
      <div 
        className="relative overflow-hidden rounded-lg border bg-muted/10 cursor-zoom-in transition-all hover:ring-2 hover:ring-primary/50"
        onClick={handleOpenFullSize}
      >
        <img src={url} alt="Transcript Preview" className="w-full h-auto max-h-[200px] sm:max-h-[300px] object-contain transition-transform group-hover:scale-[1.02]" />
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white gap-2">
            <ZoomIn className="h-6 w-6" />
            <span className="text-[10px] font-bold uppercase tracking-widest">View Full Size</span>
        </div>
      </div>
      <p className="text-[10px] text-center text-muted-foreground">Original Uploaded Image (Click to zoom)</p>
    </div>
  );
}

function imageToCanvas(file: File): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject(new Error('Failed to get 2d context'));
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      reject(new Error('Failed to load image'));
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

// getCreditsForSubject is now inlined inside TranscriptUploader using curriculum context

export function TranscriptUploader() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { upsertSubject, getSubjects, getHistory, deleteUploadHistory, addUploadHistory } = useProgressStore();
  const { getActiveCurriculum } = useCurriculumStore();
  const curriculum = getActiveCurriculum();
  const programCode = curriculum?.program_code ?? '';
  const completedSubjects = getSubjects(programCode);
  const uploadHistory = getHistory(programCode);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];

    const isValidType = file.type === 'application/pdf' || file.type.startsWith('image/');
    if (!isValidType) {
      toast.error('Unsupported file type', { description: 'Please upload a PDF, PNG, or JPG file.' });
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setStatusText('Initializing...');

    try {
      let canvases: HTMLCanvasElement[] = [];

      // 1. PDF or Image -> HTMLCanvasElement[]
      if (file.type === 'application/pdf') {
        setStatusText('Rendering PDF pages...');
        canvases = await renderPdfToImages(file);
      } else {
        setStatusText('Processing image...');
        canvases = [await imageToCanvas(file)];
      }

      if (canvases.length === 0) {
        toast.error('No readable content found', { description: 'The file may be corrupted or empty.' });
        return;
      }

      // 2. OCR Extraction
      setStatusText('Extracting text (OCR)...');
      const rawTexts = await runOcrBatch(canvases, (completed, total) => {
        setProgress((completed / total) * 100);
        setStatusText(`Extracting text... (${completed}/${total} pages)`);
      });

      // 3. Subject Extraction — use active curriculum subjects
      setStatusText('Analyzing transcript data...');
      const allSubjects = [
        ...(curriculum?.curriculum.flatMap(y => y.semesters.flatMap(s => s.subjects)) ?? []),
        ...(curriculum?.elective_pool ?? []),
      ];
      const extractedSubjects = extractSubjects(rawTexts, allSubjects);

      // Helper: get credits from active curriculum
      const getCreditsForSubject = (code: string): number => {
        const normalised = code.replace(/\s+/g, '').toUpperCase();
        const found = allSubjects.find(s => s.code.replace(/\s+/g, '').toUpperCase() === normalised);
        return found?.credits ?? 3;
      };

      if (extractedSubjects.length === 0) {
        toast.warning('No valid subjects found', {
          description: 'No matching curriculum subjects could be extracted. Please ensure the transcript is readable.',
        });
        return;
      }

      // 4. Update Store
      let imported = 0;
      let skipped = 0;

      for (const subject of extractedSubjects) {
        const existing = completedSubjects[subject.code];
        const rankNew = gradeRank(subject.grade);
        const rankOld = existing ? gradeRank(existing.grade) : 0;
        
        if (!existing || rankNew > rankOld) {
          imported++;
        } else {
          skipped++; // Already known and grade is not better
        }
        
        const credits = getCreditsForSubject(subject.code);
        upsertSubject(programCode, subject.code, subject.grade, credits);
      }

      // Store file in IndexedDB
      const fileId = `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      await set(fileId, file);

      // Record the upload in history
      addUploadHistory(programCode, file.name, extractedSubjects, fileId);

      toast.success('Extraction Complete', {
        description: `${imported} subjects imported/updated, ${skipped} already known (ignored).`,
      });

    } catch (error) {
      console.error('[TranscriptUploader] Processing Error:', error);
      toast.error('Processing failed', { description: 'An unexpected error occurred while analyzing the file.' });
    } finally {
      setIsProcessing(false);
      setProgress(0);
      setStatusText('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleDelete = async (historyItem: any) => {
    if (historyItem.fileId) {
      await del(historyItem.fileId);
    }
    deleteUploadHistory(programCode, historyItem.id);
    toast.info('Upload record removed');
  };

  return (
    <div className="w-full space-y-4">
      <div
        className={`relative rounded-xl p-8 sm:p-10 flex flex-col items-center justify-center text-center transition-all duration-300 ${
          isDragging 
            ? 'glass-strong border-primary/40 shadow-lg shadow-primary/10' 
            : 'glass hover:bg-white/[0.06]'
        } ${isProcessing ? 'pointer-events-none opacity-80' : 'cursor-pointer'}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isProcessing && fileInputRef.current?.click()}
      >
        <input
          type="file"
          className="hidden"
          accept="application/pdf,image/png,image/jpeg"
          ref={fileInputRef}
          onChange={(e) => handleFiles(e.target.files)}
        />

        {isProcessing ? (
          <div className="flex flex-col items-center space-y-4 w-full max-w-sm mx-auto">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <p className="text-xs font-bold uppercase tracking-widest text-primary animate-pulse">{statusText}</p>
            <Progress value={progress} className="w-full h-1.5" />
          </div>
        ) : (
          <>
            <div className="p-3 rounded-xl bg-primary/10 mb-4">
              <UploadCloud className="h-6 w-6 text-primary" />
            </div>
            <h3 className="text-sm font-bold text-white">Upload Transcript</h3>
            <p className="text-[11px] text-muted-foreground mt-2 max-w-[200px] leading-relaxed">
              Drag & drop your transcript (PDF, PNG, JPG) or click to browse.
            </p>
            <div className="flex items-center gap-1.5 mt-4 text-[10px] font-medium text-muted-foreground/60">
              <FileText className="h-3 w-3" />
              <span>Auto-extracts subjects & grades</span>
            </div>
          </>
        )}
      </div>

      {/* Upload History List */}
      {uploadHistory.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">
            Upload History
          </h4>
          <div className="space-y-1.5">
            {uploadHistory.map((item) => (
              <div 
                key={item.id} 
                className="flex items-center justify-between p-2.5 rounded-lg glass group hover:bg-white/[0.06] transition-all"
              >
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium text-white truncate max-w-[150px] sm:max-w-[200px]">
                    {item.filename}
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    {new Date(item.timestamp).toLocaleString()} • {item.extractedData?.length || 0} subjects
                  </span>
                </div>
                
                <div className="flex items-center gap-0.5 shrink-0">
                  <Dialog>
                    <DialogTrigger>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-primary">
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                      <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                          <FileText className="h-5 w-5 text-primary" />
                          <span className="truncate">{item.filename}</span>
                        </DialogTitle>
                      </DialogHeader>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
                        {/* File Preview */}
                        <div className="space-y-2">
                          <h5 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Original Document</h5>
                          {item.fileId ? (
                            <FilePreview fileId={item.fileId} filename={item.filename} />
                          ) : (
                            <div className="h-48 glass rounded-lg flex items-center justify-center text-xs italic text-muted-foreground">
                              Preview not available for legacy uploads
                            </div>
                          )}
                        </div>

                        {/* Extracted Data */}
                        <div className="space-y-2 flex flex-col">
                          <h5 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Extracted Data</h5>
                          <div className="space-y-1.5 max-h-[200px] sm:max-h-[300px] overflow-y-auto pr-1">
                            {item.extractedData?.map((ex, i) => (
                              <div key={i} className="flex items-center justify-between p-2 rounded-lg glass text-xs">
                                <span className="font-mono font-bold text-white">{ex.code.replace(/\s*\([IV]+\)$/i, '')}</span>
                                <Badge variant="secondary" className="font-bold text-[10px]">{ex.grade}</Badge>
                              </div>
                            )) || (
                              <div className="text-center py-4 text-muted-foreground text-xs italic">
                                Subject details not available
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>

                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-7 w-7 text-muted-foreground hover:text-red-400"
                    onClick={() => handleDelete(item)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
