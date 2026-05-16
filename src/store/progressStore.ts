import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { gradeRank } from '@/lib/gradeUtils';

export type AlertType = 'retake' | 'prerequisite';

export interface Alert {
  type: AlertType;
  code: string;
  message: string;
}

export interface SubjectRecord {
  grade: string;
  credits: number;
}

export interface UploadHistoryItem {
  id: string;
  filename: string;
  timestamp: number;
  extractedData: { code: string; grade: string }[];
  fileId?: string;
}

const RETAKE_GRADES = ['D+', 'D', 'D-', 'E', 'F'];

export const LINKED_SUBJECTS: Record<string, string> = {
  'UQI 10102': 'UQI 10202',
  'UQI 10202': 'UQI 10102'
};

// Per-program record
type ProgramSubjects = Record<string, SubjectRecord>;
type ProgramHistory = UploadHistoryItem[];

interface ProgressState {
  // Keyed by program_code (e.g. 'BIT', 'BIK')
  allSubjects: Record<string, ProgramSubjects>;
  allHistory: Record<string, ProgramHistory>;
  allAlerts: Record<string, Alert[]>;

  // Active program helpers — components call these with the active program_code
  getSubjects: (programCode: string) => ProgramSubjects;
  getAlerts: (programCode: string) => Alert[];
  getHistory: (programCode: string) => ProgramHistory;
  getTotalCredits: (programCode: string, linkedSubjects?: [string, string][]) => number;

  // Actions
  markComplete: (programCode: string, code: string, grade: string, credits: number) => void;
  markIncomplete: (programCode: string, code: string) => void;
  upsertSubject: (programCode: string, code: string, grade: string, credits: number) => void;
  addUploadHistory: (programCode: string, filename: string, data: { code: string; grade: string }[], fileId?: string) => void;
  deleteUploadHistory: (programCode: string, id: string) => void;
  checkAlerts: (programCode: string) => void;
  resetProgram: (programCode: string) => void;
  resetAll: () => void;
}

// ─── Migration helper: detect old flat format and upgrade ─────────────────────
function migrateOldData(raw: any): Pick<ProgressState, 'allSubjects' | 'allHistory' | 'allAlerts'> {
  // New format: has allSubjects key
  if (raw?.allSubjects) return raw;

  // Old format: had completedSubjects flat dict
  const oldSubjects: Record<string, SubjectRecord> = raw?.completedSubjects ?? {};
  const oldHistory: UploadHistoryItem[] = raw?.uploadHistory ?? [];
  const oldAlerts: Alert[] = raw?.alerts ?? [];

  // If old data has BIT-prefixed keys or generic known codes, assign to BIT
  const hasBitKeys = Object.keys(oldSubjects).some(k =>
    k.startsWith('BIT') || k.startsWith('UHB') || k.startsWith('UQI') || k.startsWith('UQ')
  );

  const programCode = hasBitKeys ? 'BIT' : 'UNKNOWN';

  return {
    allSubjects: { [programCode]: oldSubjects },
    allHistory: { [programCode]: oldHistory },
    allAlerts: { [programCode]: oldAlerts },
  };
}

export const useProgressStore = create<ProgressState>()(
  persist(
    immer((set, get) => ({
      allSubjects: {},
      allHistory: {},
      allAlerts: {},

      getSubjects: (programCode) => get().allSubjects[programCode] ?? {},
      getAlerts: (programCode) => get().allAlerts[programCode] ?? [],
      getHistory: (programCode) => get().allHistory[programCode] ?? [],

      getTotalCredits: (programCode, linkedSubjects = []) => {
        const subjects = get().getSubjects(programCode);
        let total = 0;
        const countedLinks = new Set<string>();

        for (const [code, data] of Object.entries(subjects)) {
          if (RETAKE_GRADES.includes(data.grade)) continue;

          // Deduplicate built-in linked subjects (Islam/Moral)
          if (LINKED_SUBJECTS[code]) {
            const partner = LINKED_SUBJECTS[code];
            if (countedLinks.has(partner)) continue;
            countedLinks.add(code);
          }

          // Deduplicate curriculum-defined linked subjects
          const pair = linkedSubjects.find(([a, b]) => a === code || b === code);
          if (pair) {
            const key = pair.join('|');
            if (countedLinks.has(key)) continue;
            countedLinks.add(key);
          }

          // PSM II prerequisite
          if (code.includes('34204')) {
            const psmKey = Object.keys(subjects).find(k => k.includes('34002'));
            if (!psmKey || RETAKE_GRADES.includes(subjects[psmKey].grade)) continue;
          }

          total += data.credits;
        }
        return total;
      },

      markComplete: (programCode, code, grade, credits) => {
        set((state) => {
          if (!state.allSubjects[programCode]) state.allSubjects[programCode] = {};
          state.allSubjects[programCode][code] = { grade, credits };
          const partner = LINKED_SUBJECTS[code];
          if (partner) state.allSubjects[programCode][partner] = { grade, credits };
        });
        get().checkAlerts(programCode);
      },

      upsertSubject: (programCode, code, grade, credits) => {
        set((state) => {
          if (!state.allSubjects[programCode]) state.allSubjects[programCode] = {};
          const existing = state.allSubjects[programCode][code];
          if (!existing || gradeRank(grade) > gradeRank(existing.grade)) {
            state.allSubjects[programCode][code] = { grade, credits };
            const partner = LINKED_SUBJECTS[code];
            if (partner) state.allSubjects[programCode][partner] = { grade, credits };
          }
        });
        get().checkAlerts(programCode);
      },

      markIncomplete: (programCode, code) => {
        set((state) => {
          if (!state.allSubjects[programCode]) return;
          delete state.allSubjects[programCode][code];
          const partner = LINKED_SUBJECTS[code];
          if (partner) delete state.allSubjects[programCode][partner];
        });
        get().checkAlerts(programCode);
      },

      addUploadHistory: (programCode, filename, data, fileId) => {
        set((state) => {
          if (!state.allHistory[programCode]) state.allHistory[programCode] = [];
          state.allHistory[programCode].push({
            id: crypto.randomUUID(),
            filename,
            timestamp: Date.now(),
            extractedData: data,
            fileId,
          });
        });
      },

      deleteUploadHistory: (programCode, id) => {
        set((state) => {
          if (!state.allHistory[programCode]) return;
          const index = state.allHistory[programCode].findIndex(h => h.id === id);
          if (index !== -1) {
            const item = state.allHistory[programCode][index];
            if (!state.allSubjects[programCode]) state.allSubjects[programCode] = {};
            if (item.extractedData) {
              item.extractedData.forEach(ex => {
                delete state.allSubjects[programCode][ex.code];
              });
            } else if ((item as any).codes) {
              (item as any).codes.forEach((code: string) => {
                delete state.allSubjects[programCode][code];
              });
            }
            state.allHistory[programCode].splice(index, 1);
          }
        });
        get().checkAlerts(programCode);
      },

      checkAlerts: (programCode) => {
        set((state) => {
          const subjects = state.allSubjects[programCode] ?? {};
          const newAlerts: Alert[] = [];

          for (const [code, data] of Object.entries(subjects)) {
            if (RETAKE_GRADES.includes(data.grade)) {
              newAlerts.push({
                type: 'retake',
                code,
                message: `Retake required for ${code} (Grade: ${data.grade}). Credits not counted.`,
              });
            }
            if (code.includes('34204')) {
              const psmKey = Object.keys(subjects).find(k => k.includes('34002'));
              if (!psmKey || RETAKE_GRADES.includes(subjects[psmKey].grade)) {
                newAlerts.push({
                  type: 'prerequisite',
                  code,
                  message: `Cannot count PSM II. Prerequisite PSM I must be passed first.`,
                });
              }
            }
          }
          if (!state.allAlerts[programCode]) state.allAlerts[programCode] = [];
          state.allAlerts[programCode] = newAlerts;
        });
      },

      resetProgram: (programCode) => {
        set((state) => {
          delete state.allSubjects[programCode];
          delete state.allHistory[programCode];
          delete state.allAlerts[programCode];
        });
      },

      resetAll: () => {
        set((state) => {
          state.allSubjects = {};
          state.allHistory = {};
          state.allAlerts = {};
        });
      },
    })),
    {
      name: 'uthmpelan-progress-storage',
      partialize: (state) => ({
        allSubjects: state.allSubjects,
        allHistory: state.allHistory,
        allAlerts: state.allAlerts,
      }),
      merge: (persisted: any, current) => {
        // Run migration on load
        const migrated = migrateOldData(persisted);
        return { ...current, ...migrated };
      },
    }
  )
);
