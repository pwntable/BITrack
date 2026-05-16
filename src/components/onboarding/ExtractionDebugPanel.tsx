'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Bug, CheckCircle2, AlertTriangle, XCircle, Info, BarChart3 } from 'lucide-react';
import type { ExtractionResult, StageLog, RejectedRow } from '@/lib/imageScraperPipeline';

const STATUS_ICON: Record<string, React.ReactNode> = {
  passed: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  warning: <AlertTriangle className="h-4 w-4 text-amber-400" />,
  failed: <XCircle className="h-4 w-4 text-red-400" />,
  skipped: <Info className="h-4 w-4 text-muted-foreground" />,
};

const STATUS_BG: Record<string, string> = {
  passed: 'bg-emerald-500/10 border-emerald-500/20',
  warning: 'bg-amber-500/10 border-amber-500/20',
  failed: 'bg-red-500/10 border-red-500/20',
  skipped: 'bg-muted/20 border-muted/30',
};

const SEVERITY_COLORS: Record<string, string> = {
  info: 'text-muted-foreground',
  warning: 'text-amber-400',
  critical: 'text-red-400',
};

export function ExtractionDebugPanel({ debug }: { debug: ExtractionResult }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'stages' | 'rejected' | 'ocr'>('stages');

  const statusColor = {
    SUCCESS: 'text-emerald-400',
    PARTIAL_SUCCESS: 'text-amber-400',
    NEEDS_REVIEW: 'text-amber-400',
    FAILED: 'text-red-400',
  }[debug.status];

  return (
    <div className="rounded-xl border border-white/[0.06] overflow-hidden">
      {/* Header - always visible */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-3 p-4 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10">
            <Bug className="h-4 w-4 text-primary" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-white">Extraction Debug Report</span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                debug.status === 'SUCCESS' ? 'bg-emerald-500/20 text-emerald-400' :
                debug.status === 'FAILED' ? 'bg-red-500/20 text-red-400' :
                'bg-amber-500/20 text-amber-400'
              }`}>
                {debug.status}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {debug.courses.length} subjects • {debug.semesters_detected.length} semesters •{' '}
              Confidence: {(debug.confidence * 100).toFixed(0)}%
            </p>
          </div>
        </div>
        {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="border-t border-white/[0.06] p-4 space-y-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="Subjects" value={debug.courses.length} color={debug.courses.length > 0 ? 'emerald' : 'red'} />
            <SummaryCard label="Semesters" value={debug.semesters_detected.length} color={debug.semesters_detected.length >= 4 ? 'emerald' : 'amber'} />
            <SummaryCard label="Confidence" value={`${(debug.confidence * 100).toFixed(0)}%`} color={debug.confidence >= 0.7 ? 'emerald' : 'amber'} />
            <SummaryCard
              label="Credits"
              value={`${debug.calculated_total}/${debug.total_credits_found || '?'}`}
              color={debug.total_credits_found && debug.calculated_total === debug.total_credits_found ? 'emerald' : 'amber'}
            />
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-white/[0.03] rounded-lg p-1">
            {(['stages', 'rejected', 'ocr'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
                  activeTab === tab ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:text-white'
                }`}
              >
                {tab === 'stages' ? `Pipeline (${debug.stages.length})` :
                 tab === 'rejected' ? `Rejected (${debug.rejected_rows.length})` :
                 'OCR Sample'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'stages' && <StageTimeline stages={debug.stages} />}
          {activeTab === 'rejected' && <RejectedRowsList rows={debug.rejected_rows} />}
          {activeTab === 'ocr' && <OCRSample lines={debug.ocr_text_sample} />}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const bg = color === 'emerald' ? 'bg-emerald-500/10' : color === 'red' ? 'bg-red-500/10' : 'bg-amber-500/10';
  const text = color === 'emerald' ? 'text-emerald-400' : color === 'red' ? 'text-red-400' : 'text-amber-400';
  return (
    <div className={`rounded-lg p-3 ${bg} border border-white/[0.06]`}>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${text}`}>{value}</p>
    </div>
  );
}

function StageTimeline({ stages }: { stages: StageLog[] }) {
  return (
    <div className="space-y-2">
      {stages.map((stage, i) => (
        <div
          key={i}
          className={`flex items-start gap-3 p-3 rounded-lg border ${STATUS_BG[stage.status]}`}
        >
          <div className="mt-0.5">{STATUS_ICON[stage.status]}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-white capitalize">
                {stage.stage.replace(/_/g, ' ')}
              </span>
              <span className={`text-[10px] uppercase font-bold tracking-wider ${
                stage.status === 'passed' ? 'text-emerald-400' :
                stage.status === 'warning' ? 'text-amber-400' :
                stage.status === 'failed' ? 'text-red-400' : 'text-muted-foreground'
              }`}>
                {stage.status}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 break-words">{stage.message}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function RejectedRowsList({ rows }: { rows: RejectedRow[] }) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-4">No rejected rows.</p>;
  }

  const grouped = {
    critical: rows.filter(r => r.severity === 'critical'),
    warning: rows.filter(r => r.severity === 'warning'),
    info: rows.filter(r => r.severity === 'info'),
  };

  return (
    <div className="space-y-3 max-h-[400px] overflow-y-auto">
      {grouped.critical.length > 0 && (
        <div>
          <p className="text-xs font-bold text-red-400 mb-1.5">⚠ Critical ({grouped.critical.length})</p>
          {grouped.critical.map((row, i) => <RejectedRowItem key={`c-${i}`} row={row} />)}
        </div>
      )}
      {grouped.warning.length > 0 && (
        <div>
          <p className="text-xs font-bold text-amber-400 mb-1.5">⚡ Warnings ({grouped.warning.length})</p>
          {grouped.warning.map((row, i) => <RejectedRowItem key={`w-${i}`} row={row} />)}
        </div>
      )}
      {grouped.info.length > 0 && (
        <div>
          <p className="text-xs font-bold text-muted-foreground mb-1.5">ℹ Info ({grouped.info.length})</p>
          {grouped.info.map((row, i) => <RejectedRowItem key={`i-${i}`} row={row} />)}
        </div>
      )}
    </div>
  );
}

function RejectedRowItem({ row }: { row: RejectedRow }) {
  return (
    <div className="p-2.5 rounded-md bg-white/[0.02] border border-white/[0.04] mb-1.5">
      <p className="text-xs font-mono text-white/80 truncate">{row.raw_text}</p>
      <div className="flex items-center gap-2 mt-1">
        <span className={`text-[10px] ${SEVERITY_COLORS[row.severity]}`}>
          {row.reason.replace(/_/g, ' ')}
        </span>
        {row.suggestion && (
          <span className="text-[10px] text-primary/80">→ {row.suggestion}</span>
        )}
      </div>
    </div>
  );
}

function OCRSample({ lines }: { lines: string[] }) {
  if (lines.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-4">No OCR text captured.</p>;
  }
  return (
    <div className="bg-black/30 rounded-lg p-3 max-h-[400px] overflow-y-auto">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">Raw OCR Output (first {lines.length} lines)</p>
      {lines.map((line, i) => (
        <p key={i} className="text-xs font-mono text-white/70 py-0.5 border-b border-white/[0.04] last:border-0">
          <span className="text-muted-foreground mr-2 inline-block w-6 text-right">{i + 1}</span>
          {line}
        </p>
      ))}
    </div>
  );
}
