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
  fileId?: string; // ID for IndexedDB storage
}

const RETAKE_GRADES = ['D+', 'D', 'D-', 'E', 'F'];
const LINKED_SUBJECTS: Record<string, string> = {
  'UQI 10102': 'UQI 10202',
  'UQI 10202': 'UQI 10102'
};

interface ProgressState {
  completedSubjects: Record<string, SubjectRecord>;
  alerts: Alert[];
  uploadHistory: UploadHistoryItem[];
  
  // Computed getter
  getTotalCredits: () => number;
  
  // Actions
  markComplete: (code: string, grade: string, credits: number) => void;
  markIncomplete: (code: string) => void;
  upsertSubject: (code: string, grade: string, credits: number) => void;
  addUploadHistory: (filename: string, data: { code: string; grade: string }[], fileId?: string) => void;
  deleteUploadHistory: (id: string) => void;
  checkAlerts: () => void;
  resetAll: () => void;
}

export const useProgressStore = create<ProgressState>()(
  persist(
    immer((set, get) => ({
      completedSubjects: {},
      alerts: [],
      uploadHistory: [],

      getTotalCredits: () => {
        const { completedSubjects } = get();
        let total = 0;
        const countedLinks = new Set<string>();
        
        for (const [code, data] of Object.entries(completedSubjects)) {
          // If retake required, don't count credits
          if (RETAKE_GRADES.includes(data.grade)) continue;
          
          // Deduplicate linked subjects (UQI 10102 / 10202)
          if (LINKED_SUBJECTS[code]) {
            const partner = LINKED_SUBJECTS[code];
            if (countedLinks.has(partner)) continue; // Already counted the other one
            countedLinks.add(code);
          }

          // If PSM II, check if PSM I is passed
          if (code === 'BIT 34204') {
            const psm1 = completedSubjects['BIT 34002'];
            if (!psm1 || RETAKE_GRADES.includes(psm1.grade)) {
              continue;
            }
          }
          
          total += data.credits;
        }
        
        return total;
      },

      markComplete: (code, grade, credits) => {
        set((state) => {
          state.completedSubjects[code] = { grade, credits };
          // Handle linking
          const partner = LINKED_SUBJECTS[code];
          if (partner) {
            state.completedSubjects[partner] = { grade, credits };
          }
        });
        get().checkAlerts();
      },

      upsertSubject: (code, grade, credits) => {
        set((state) => {
          const existing = state.completedSubjects[code];
          if (!existing || gradeRank(grade) > gradeRank(existing.grade)) {
            state.completedSubjects[code] = { grade, credits };
            // Handle linking
            const partner = LINKED_SUBJECTS[code];
            if (partner) {
              state.completedSubjects[partner] = { grade, credits };
            }
          }
        });
        get().checkAlerts();
      },

      markIncomplete: (code) => {
        set((state) => {
          delete state.completedSubjects[code];
          // Handle linking
          const partner = LINKED_SUBJECTS[code];
          if (partner) {
            delete state.completedSubjects[partner];
          }
        });
        get().checkAlerts();
      },

      addUploadHistory: (filename, data, fileId) => {
        set((state) => {
          state.uploadHistory.push({
            id: crypto.randomUUID(),
            filename,
            timestamp: Date.now(),
            extractedData: data,
            fileId
          });
        });
      },

      deleteUploadHistory: (id) => {
        set((state) => {
          const index = state.uploadHistory.findIndex(h => h.id === id);
          if (index !== -1) {
            const historyItem = state.uploadHistory[index];
            // Remove subjects that were part of this upload
            if (historyItem.extractedData) {
              historyItem.extractedData.forEach(item => {
                delete state.completedSubjects[item.code];
              });
            } else if ((historyItem as any).codes) {
              // Handle legacy schema
              (historyItem as any).codes.forEach((code: string) => {
                delete state.completedSubjects[code];
              });
            }
            state.uploadHistory.splice(index, 1);
          }
        });
        get().checkAlerts();
      },

      checkAlerts: () => {
        set((state) => {
          const newAlerts: Alert[] = [];
          
          for (const [code, data] of Object.entries(state.completedSubjects)) {
            // (a) retake-required grades
            if (RETAKE_GRADES.includes(data.grade)) {
              newAlerts.push({
                type: 'retake',
                code,
                message: `Retake required for ${code} (Grade: ${data.grade}). Credits not counted.`
              });
            }

            // (b) PSM II prerequisite
            if (code === 'BIT 34204') {
              const psm1 = state.completedSubjects['BIT 34002'];
              if (!psm1 || RETAKE_GRADES.includes(psm1.grade)) {
                newAlerts.push({
                  type: 'prerequisite',
                  code,
                  message: `Cannot count BIT 34204 (PSM II). Prerequisite BIT 34002 (PSM I) must be passed first.`
                });
              }
            }
          }
          
          state.alerts = newAlerts;
        });
      },

      resetAll: () => {
        set((state) => {
          state.completedSubjects = {};
          state.alerts = [];
          state.uploadHistory = [];
        });
      }
    })),
    {
      name: 'bit-progress-storage',
      partialize: (state) => ({
        completedSubjects: state.completedSubjects,
        alerts: state.alerts,
        uploadHistory: state.uploadHistory,
      }),
    }
  )
);
