'use client';

import React, { useCallback, useRef, useState } from 'react';
import { Upload, FileText, Image, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PelanUploaderProps {
  onFileSelected: (file: File) => void;
  disabled?: boolean;
}

const ACCEPTED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
const ACCEPTED_EXTS = '.pdf,.jpg,.jpeg,.png';

export function PelanUploader({ onFileSelected, disabled }: PelanUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndDispatch = useCallback((file: File) => {
    setError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Please upload a PDF, JPG, or PNG file.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('File size must be under 20MB.');
      return;
    }
    onFileSelected(file);
  }, [onFileSelected]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) validateAndDispatch(file);
  }, [validateAndDispatch]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndDispatch(file);
    // Reset so same file can be re-uploaded
    e.target.value = '';
  }, [validateAndDispatch]);

  return (
    <div className="w-full space-y-4">
      <div
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); if (!disabled) setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          'relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed p-10 sm:p-14 text-center transition-all duration-300 cursor-pointer select-none',
          isDragging
            ? 'border-primary bg-primary/10 scale-[1.01]'
            : 'border-white/10 bg-white/[0.02] hover:border-primary/40 hover:bg-white/[0.04]',
          disabled && 'pointer-events-none opacity-50'
        )}
      >
        {/* Animated glow on drag */}
        {isDragging && (
          <div className="absolute inset-0 rounded-2xl bg-primary/5 animate-pulse" />
        )}

        <div className="relative z-10 p-4 rounded-2xl glass-strong">
          <Upload className="h-10 w-10 text-primary" />
        </div>

        <div className="relative z-10 space-y-2">
          <p className="text-lg font-bold text-white">
            {isDragging ? 'Drop it here!' : 'Upload Pelan Pengajian'}
          </p>
          <p className="text-sm text-muted-foreground">
            Drag & drop or click to browse
          </p>
          <div className="flex items-center justify-center gap-3 mt-3">
            {[
              { icon: FileText, label: 'PDF' },
              { icon: Image, label: 'JPG' },
              { icon: Image, label: 'PNG' },
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full glass text-xs font-bold text-muted-foreground">
                <Icon className="h-3 w-3" />
                {label}
              </div>
            ))}
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTS}
          className="hidden"
          onChange={handleChange}
          disabled={disabled}
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
