'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// ─── Core Types ─────────────────────────────────────────────────────────────

export interface ParsedSubject {
  code: string;
  name: string;
  credits: number;
  is_elective?: boolean;
  prerequisite?: string | null;
}

export interface ParsedSemester {
  semester: number;
  total_credits: number;
  subjects: ParsedSubject[];
}

export interface ParsedYear {
  year: number;
  semesters: ParsedSemester[];
}

export interface ParsedCurriculum {
  id: string;
  program_name: string;     // "Bachelor of Information Technology with Honours (BIT)"
  program_code: string;     // "BIT"
  faculty: string;          // "FSKTM"
  total_credits_required: number;
  academic_session: string; // "2025/2026"
  curriculum: ParsedYear[];
  elective_pool: ParsedSubject[];
  /** Pairs of codes that are mutually exclusive (student takes one or the other) */
  linked_subjects?: [string, string][];
  uploaded_at: number;
  source_filename: string;
  is_demo?: boolean;
}

// ─── Store Interface ─────────────────────────────────────────────────────────

interface CurriculumState {
  savedCurricula: ParsedCurriculum[];
  activeCurriculumId: string | null;

  // Selectors
  getActiveCurriculum: () => ParsedCurriculum | null;
  getAllSubjects: () => ParsedSubject[];
  getTotalSlots: () => number; // deduplicates linked pairs

  // Actions
  saveCurriculum: (curriculum: ParsedCurriculum) => void;
  setActiveCurriculum: (id: string) => void;
  deleteCurriculum: (id: string) => void;
  resetAll: () => void;
}

// ─── BIT 2025/2026 Demo Curriculum ───────────────────────────────────────────

import bitCurriculumRaw from '@/data/curriculum.json';
import bitElectivesRaw from '@/data/electives.json';

export const BIT_DEMO_CURRICULUM: ParsedCurriculum = {
  id: 'demo-bit-20252026',
  program_name: 'Bachelor of Information Technology with Honours (BIT)',
  program_code: 'BIT',
  faculty: 'FSKTM',
  total_credits_required: 120,
  academic_session: '2025/2026',
  curriculum: bitCurriculumRaw.curriculum as ParsedYear[],
  elective_pool: bitElectivesRaw as ParsedSubject[],
  linked_subjects: [['UQI 10102', 'UQI 10202']],
  uploaded_at: 0,
  source_filename: 'demo-bit-20252026',
  is_demo: true,
};

// ─── Store ───────────────────────────────────────────────────────────────────

export const useCurriculumStore = create<CurriculumState>()(
  persist(
    immer((set, get) => ({
      savedCurricula: [],
      activeCurriculumId: null,

      getActiveCurriculum: () => {
        const { savedCurricula, activeCurriculumId } = get();
        if (!activeCurriculumId) return null;
        return savedCurricula.find(c => c.id === activeCurriculumId) ?? null;
      },

      getAllSubjects: () => {
        const curriculum = get().getActiveCurriculum();
        if (!curriculum) return [];
        return curriculum.curriculum.flatMap(y =>
          y.semesters.flatMap(s => s.subjects)
        );
      },

      getTotalSlots: () => {
        const curriculum = get().getActiveCurriculum();
        if (!curriculum) return 0;

        const allCodes = curriculum.curriculum.flatMap(y =>
          y.semesters.flatMap(s => s.subjects.map(sub => sub.code))
        );

        const linked = curriculum.linked_subjects ?? [];
        const countedLinks = new Set<string>();
        let total = 0;

        for (const code of allCodes) {
          const pair = linked.find(([a, b]) => a === code || b === code);
          if (pair) {
            const key = pair.join('|');
            if (countedLinks.has(key)) continue;
            countedLinks.add(key);
          }
          total++;
        }
        return total;
      },

      saveCurriculum: (curriculum) => {
        set((state) => {
          const existingIndex = state.savedCurricula.findIndex(c => c.id === curriculum.id);
          if (existingIndex !== -1) {
            state.savedCurricula[existingIndex] = curriculum;
          } else {
            state.savedCurricula.push(curriculum);
          }
          state.activeCurriculumId = curriculum.id;
        });
      },

      setActiveCurriculum: (id) => {
        set((state) => {
          if (state.savedCurricula.find(c => c.id === id)) {
            state.activeCurriculumId = id;
          }
        });
      },

      deleteCurriculum: (id) => {
        set((state) => {
          state.savedCurricula = state.savedCurricula.filter(c => c.id !== id);
          if (state.activeCurriculumId === id) {
            state.activeCurriculumId = state.savedCurricula[0]?.id ?? null;
          }
        });
      },

      resetAll: () => {
        set((state) => {
          state.savedCurricula = [];
          state.activeCurriculumId = null;
        });
      },
    })),
    {
      name: 'uthmpelan-curriculum-storage',
      partialize: (state) => ({
        savedCurricula: state.savedCurricula,
        activeCurriculumId: state.activeCurriculumId,
      }),
    }
  )
);
